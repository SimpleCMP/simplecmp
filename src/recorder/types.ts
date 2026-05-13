/**
 * Recorder types — REQ-7 / ADR-0004.
 *
 * Shared types for the recorder coordinator, the three watchers, and the
 * classifier. Kept in a single file so adding a new watcher means one
 * import statement.
 */

export type DetectionKind = 'cookie' | 'script' | 'iframe' | 'image' | 'link' | 'request';
export type DetectionStatus = 'known' | 'unknown';

/**
 * A single observed item, normalized across all watchers and de-duplicated
 * by `${kind}:${identifier}`. Created by a watcher, enriched by the
 * classifier, surfaced through the recorder's snapshot.
 */
export interface Detection {
  kind: DetectionKind;
  /**
   * Cookie name, script src URL, image src URL, request URL, etc. The exact
   * format depends on `kind`; treat as opaque per kind.
   */
  identifier: string;
  /** Host derived from the resource URL, for non-cookie kinds. */
  origin?: string;
  firstSeen: number;
  lastSeen: number;
  /**
   * `location.pathname` (+ search) at the time of `firstSeen`. Lets customers
   * answer "which page caused this tracker to load?" without re-running the
   * recorder per route. Captured once, not updated.
   */
  firstSeenOn?: string;
  count: number;
  /** Klaro service name that claims this detection (Phase 2: from local config). */
  matchedService?: string;
  /** Vendor display name, populated by the Service DB classifier (Phase 3). */
  matchedVendor?: string;
  status: DetectionStatus;
}

/**
 * What watchers emit. The classifier turns a `RawDetection` into an enriched
 * `Detection` by adding `matchedService` / `matchedVendor` / `status`.
 */
export type RawDetection = Pick<Detection, 'kind' | 'identifier' | 'origin' | 'firstSeenOn'>;

/** Opt-in recorder configuration. `record: true` is shorthand for `{}`. */
export interface RecorderOptions {
  /**
   * Persist detections in `sessionStorage` so they survive a page reload
   * during a debugging session. Hard-gated: only takes effect on dev/local
   * hostnames (see hostnameLooksLikeProduction). Default `false`.
   */
  persistInDev?: boolean;
  /**
   * Suppress the production-hostname `console.warn`. Use when intentionally
   * running the recorder on a production host (e.g., production-monitoring
   * pipeline per ADR-0004 section H). Default `false`.
   */
  silenceProductionWarning?: boolean;
  /** Cookie polling interval in ms. Default 1000. */
  cookieIntervalMs?: number;
  /**
   * Periodic `console.table` summary cadence in ms. Default 30000. Set to 0
   * to disable the periodic summary (per-detection logs still happen).
   */
  summaryIntervalMs?: number;
  /**
   * `storageName` used to namespace the optional `sessionStorage` entry.
   * Defaults to the consent storageName the recorder is bound to.
   */
  storageName?: string;
}

/**
 * Cookie matcher entries on a service. SimpleCMP accepts the shapes Klaro
 * already understands (string for exact match, RegExp, or
 * `[regexSourceString, ...]` tuple) — so a Klaro service config carries
 * over without modification.
 */
export type CookieMatcher = string | RegExp | [string, ...unknown[]];

/**
 * Origin matcher entries on a service. SimpleCMP-specific extension.
 * `string` = exact host match. `string` with leading `*.` = suffix match
 * (e.g., `*.google.com`). `RegExp` = test against host.
 */
export type OriginMatcher = string | RegExp;

/**
 * Subset of a Klaro/SimpleCMP service config that the classifier reads.
 * Other fields exist on the full service config; we only care about these
 * for matching.
 */
export interface ClassifierServiceConfig {
  name: string;
  cookies?: CookieMatcher[];
  /** SimpleCMP-specific. Hosts the service may load resources from. */
  origins?: OriginMatcher[];
}

/**
 * The classifier's only job: take a raw detection plus a service list and
 * return an enriched detection. Stable across phases — Phase 3 swaps the
 * implementation but not the interface.
 */
export interface Classifier {
  classify(raw: RawDetection): {
    matchedService?: string;
    matchedVendor?: string;
    status: DetectionStatus;
  };
}

/**
 * Watchers report observations to the recorder via this sink. The recorder
 * is responsible for de-duplication, classification, persistence, and
 * onward dispatch.
 */
export type DetectionSink = (raw: RawDetection) => void;

/** Common interface for the three watchers. */
export interface Watcher {
  start(): void;
  stop(): void;
}
