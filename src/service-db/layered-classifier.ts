/**
 * Layered classifier — REQ-8 / ADR-0005 section G.
 *
 * Composes `ServiceDbClient` (Phase 3) on top of `LocalClassifier` (Phase 2).
 *
 * Classification strategy:
 *   1. Local config wins. If the integrator's `services` list claims the
 *      detection, we return that immediately, no network call.
 *   2. Otherwise we fall back to `unknown` synchronously and kick off an
 *      async DB lookup. When that resolves with a match, registered
 *      `onEnrichment` listeners are called so the Recorder can update its
 *      stored detection in place.
 *
 * The synchronous return path matches ADR-0004's `Classifier` interface;
 * the async enrichment is opt-in via the listener API.
 */

import { LocalClassifier, cookieMatches } from '../recorder/classifier.js';
import type {
  Classifier,
  ClassifierServiceConfig,
  CookieMatcher,
  DetectionStatus,
  RawDetection,
} from '../recorder/types.js';
import type { ServiceDbClient } from './client.js';
import type { ServiceMatch } from './types.js';

/** Enrichment payload — the recorder uses this to patch its detection. */
export interface Enrichment {
  matchedService: string;
  matchedVendor?: string;
  status: DetectionStatus;
}

export type EnrichmentListener = (raw: RawDetection, enrichment: Enrichment) => void;

export class LayeredClassifier implements Classifier {
  private readonly local: LocalClassifier;
  private readonly listeners = new Set<EnrichmentListener>();

  constructor(
    public readonly dbClient: ServiceDbClient,
    services: readonly ClassifierServiceConfig[]
  ) {
    this.local = new LocalClassifier(services);
  }

  classify(raw: RawDetection): {
    matchedService?: string;
    matchedVendor?: string;
    status: DetectionStatus;
    pending?: Promise<void>;
  } {
    const local = this.local.classify(raw);
    if (local.status === 'known') {
      // Local config wins (ADR-0005 G: site-specific configuration is more
      // authoritative than the shared registry).
      return local;
    }

    const query =
      raw.kind === 'cookie'
        ? { cookie: raw.identifier }
        : raw.origin
          ? { origin: raw.origin }
          : null;
    if (!query) return local;

    // Async DB lookup. Errors are already swallowed inside the client
    // (warns once, returns null). The returned `pending` promise resolves
    // *after* dispatch so the recorder's `detectionSettled` listener sees
    // the enriched detection rather than the bare `unknown` first hit.
    // Always resolves (never rejects) — consumers only care about the
    // signal, not the outcome. (REQ-N7.)
    const pending = this.dbClient
      .lookup(query)
      .then((match) => {
        if (!match) return;
        // ADR-0010: re-validate the match's cookie matchers locally.
        // The DB middleware surfaces a service whose name part matches
        // the queried cookie, but it doesn't know which origins the
        // recorder has actually observed. Without this check, a
        // host-qualified matcher in the DB-returned service would
        // misfire when its qualifier hasn't been observed.
        if (raw.kind === 'cookie' && !this._hostQualifierPasses(match, raw.identifier)) {
          return;
        }
        this._dispatch(raw, this._toEnrichment(match));
      })
      .catch(() => undefined);

    return { ...local, pending };
  }

  /**
   * Whether the cookie matchers on a Service-DB match include at least
   * one entry that fires against `cookieName` given the recorder's
   * currently-observed origins. Strings and Klaro tuples always fire
   * by name only; the ADR-0010 object form fires only when its
   * `requireOrigin` is observed.
   */
  private _hostQualifierPasses(match: ServiceMatch, cookieName: string): boolean {
    const matchers = (match.matches?.cookies ?? []) as CookieMatcher[];
    if (matchers.length === 0) {
      // No cookie matchers in the DB row but the DB still returned
      // this service for a cookie query — assume the match is via an
      // origin path or other channel; let it through.
      return true;
    }
    const observedOrigins = this.local.observedOriginsView;
    for (const matcher of matchers) {
      if (cookieMatches(cookieName, matcher, observedOrigins)) return true;
    }
    return false;
  }

  /** Subscribe to enrichments — typically called from the Recorder wiring. */
  onEnrichment(listener: EnrichmentListener): void {
    this.listeners.add(listener);
  }

  /** Unsubscribe. */
  offEnrichment(listener: EnrichmentListener): void {
    this.listeners.delete(listener);
  }

  private _dispatch(raw: RawDetection, enrichment: Enrichment): void {
    for (const listener of this.listeners) {
      try {
        listener(raw, enrichment);
      } catch (err) {
        console.warn('SimpleCMP service-db: enrichment listener threw:', err);
      }
    }
  }

  private _toEnrichment(match: ServiceMatch): Enrichment {
    return {
      matchedService: match.id,
      matchedVendor: match.vendor,
      status: 'known',
    };
  }
}
