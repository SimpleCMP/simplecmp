/**
 * Recorder classifier — REQ-7 / ADR-0004 section E.
 *
 * Pure function (modulo the captured services list). Takes a raw detection
 * and returns whether it's known (and which service claims it) or unknown.
 *
 * Phase 2 ships the `LocalClassifier`. Phase 3 will add a `LayeredClassifier`
 * that composes local matching with a remote Service DB lookup; both
 * implement the same `Classifier` interface, so the watchers and the
 * coordinator don't change.
 */

import type {
  Classifier,
  ClassifierServiceConfig,
  CookieMatcher,
  OriginMatcher,
  RawDetection,
} from './types.js';

/**
 * Match a cookie name against a single matcher entry. Plain string =
 * exact match. RegExp / `/regex/` source = pattern match. Tuple form =
 * Klaro compatibility shim. The object form (`{name, requireOrigin}` —
 * ADR-0010) matches only when the required origin has been observed in
 * the session.
 *
 * Exported so `LayeredClassifier` can re-validate Service-DB lookup
 * responses against the host-qualifier (the DB only sees the matcher
 * list, not the recorder's observed origins).
 */
export function cookieMatches(
  name: string,
  matcher: CookieMatcher,
  observedOrigins: ReadonlySet<string>
): boolean {
  if (typeof matcher === 'string') {
    // Slash-bounded strings (e.g. "/^_ga_/") are regex source — used in
    // bundled JSON / Service-DB protocol where RegExp literals aren't
    // representable. Distinguish from a literal cookie name that
    // happens to start with `/` by requiring both ends to be `/`.
    if (matcher.length >= 2 && matcher.startsWith('/') && matcher.endsWith('/')) {
      try {
        return new RegExp(matcher.slice(1, -1)).test(name);
      } catch {
        return false;
      }
    }
    return matcher === name;
  }
  if (matcher instanceof RegExp) {
    return matcher.test(name);
  }
  if (Array.isArray(matcher) && matcher.length > 0) {
    // Klaro's tuple form: [regexSourceString, path?, domain?, ...].
    // We only use the first element for name matching.
    const head = matcher[0];
    if (typeof head !== 'string') return false;
    try {
      return new RegExp(head).test(name);
    } catch {
      // Invalid regex source → fall back to exact match
      return head === name;
    }
  }
  if (
    typeof matcher === 'object' &&
    matcher !== null &&
    'name' in matcher &&
    'requireOrigin' in matcher
  ) {
    // ADR-0010 host-qualified form. Fire only if (a) the name matches
    // and (b) the recorder has observed an origin that the
    // requireOrigin matcher accepts.
    if (!isOriginObserved(matcher.requireOrigin, observedOrigins)) return false;
    return cookieMatches(name, matcher.name, observedOrigins);
  }
  return false;
}

/**
 * Match a host against a single origin matcher entry. Exported so the
 * runtime-patches matcher (ADR-0013 Phase 2) can use the same wildcard
 * semantics — keeps the server-side rewriter, the recorder, and the
 * JS-injected-call patch all classifying hosts consistently.
 */
export function originMatches(host: string, matcher: OriginMatcher): boolean {
  if (matcher instanceof RegExp) {
    return matcher.test(host);
  }
  if (typeof matcher !== 'string') return false;
  // Slash-bounded form per the Service-DB protocol — same convention
  // as cookies (regex source via a bounding pair). Anchored to a FULL-host
  // match: unlike cookie-name regexes (intentionally partial, e.g.
  // `/^_ga/`), an unanchored host regex lets a substring impersonate a
  // service — `/tracker\.com/` would otherwise match
  // `eviltracker.com.attacker.net`. The `(?:…)` group makes the anchors
  // wrap any top-level alternation in the source.
  if (matcher.length >= 2 && matcher.startsWith('/') && matcher.endsWith('/')) {
    try {
      return new RegExp(`^(?:${matcher.slice(1, -1)})$`).test(host);
    } catch {
      return false;
    }
  }
  if (matcher.startsWith('*.')) {
    const suffix = matcher.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return matcher === host;
}

/** Whether any observed origin matches the given matcher. */
function isOriginObserved(matcher: OriginMatcher, observedOrigins: ReadonlySet<string>): boolean {
  for (const host of observedOrigins) {
    if (originMatches(host, matcher)) return true;
  }
  return false;
}

/**
 * Local-only classifier: matches against the configured services list.
 *
 * Stateful (ADR-0010): tracks the set of origins observed via
 * non-cookie detections so host-qualified cookie matchers
 * (`{name, requireOrigin}`) can fire correctly. The recorder feeds
 * non-cookie detections through `classify()` as usual; the
 * observation is recorded as a side-effect. Cookies observed
 * *before* their qualifying origin classify as `unknown` initially;
 * the recorder re-classifies them via `enrichDetection()` once the
 * origin arrives (see `Recorder._reclassifyCookiesOnNewOrigin`).
 */
export class LocalClassifier implements Classifier {
  private readonly observedOrigins = new Set<string>();

  constructor(private readonly services: readonly ClassifierServiceConfig[]) {}

  classify(raw: RawDetection): ReturnType<Classifier['classify']> {
    if (raw.kind !== 'cookie' && raw.origin) {
      this.observedOrigins.add(raw.origin);
    }
    const matchedService = this._findService(raw);
    return matchedService ? { matchedService, status: 'known' } : { status: 'unknown' };
  }

  /**
   * Whether the given origin has been observed via a non-cookie
   * detection in this session.
   */
  hasObservedOrigin(host: string): boolean {
    return this.observedOrigins.has(host);
  }

  /**
   * Read-only view of currently observed origins. The
   * `LayeredClassifier` uses this to re-validate Service-DB lookup
   * responses against host-qualified matchers — without this, the DB
   * would surface candidates whose qualifier the recorder hasn't
   * observed and the enrichment would mis-classify.
   */
  get observedOriginsView(): ReadonlySet<string> {
    return this.observedOrigins;
  }

  private _findService(raw: RawDetection): string | undefined {
    if (raw.kind === 'cookie') {
      for (const service of this.services) {
        if (!service.cookies) continue;
        for (const matcher of service.cookies) {
          if (cookieMatches(raw.identifier, matcher, this.observedOrigins)) return service.name;
        }
      }
      return undefined;
    }
    // All non-cookie kinds are URL-based; match by host.
    if (!raw.origin) return undefined;
    for (const service of this.services) {
      if (!service.origins) continue;
      for (const matcher of service.origins) {
        if (originMatches(raw.origin, matcher)) return service.name;
      }
    }
    return undefined;
  }
}
