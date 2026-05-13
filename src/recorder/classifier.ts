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

/** Match a cookie name against a single matcher entry. */
function cookieMatches(name: string, matcher: CookieMatcher): boolean {
  if (typeof matcher === 'string') {
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
  return false;
}

/** Match a host against a single origin matcher entry. */
function originMatches(host: string, matcher: OriginMatcher): boolean {
  if (matcher instanceof RegExp) {
    return matcher.test(host);
  }
  if (typeof matcher !== 'string') return false;
  if (matcher.startsWith('*.')) {
    const suffix = matcher.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return matcher === host;
}

/** Local-only classifier: matches against the configured services list. */
export class LocalClassifier implements Classifier {
  constructor(private readonly services: readonly ClassifierServiceConfig[]) {}

  classify(raw: RawDetection): ReturnType<Classifier['classify']> {
    const matchedService = this._findService(raw);
    return matchedService ? { matchedService, status: 'known' } : { status: 'unknown' };
  }

  private _findService(raw: RawDetection): string | undefined {
    if (raw.kind === 'cookie') {
      for (const service of this.services) {
        if (!service.cookies) continue;
        for (const matcher of service.cookies) {
          if (cookieMatches(raw.identifier, matcher)) return service.name;
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
