/**
 * CMS Bridge types — REQ-9.
 *
 * The bridge POSTs a JSON webhook to a configurable URL whenever the
 * Recorder encounters a tracker that classifies as `status: 'unknown'`
 * (no local services match, no Service-DB hit). The payload schema is the
 * **public contract** consumed by CMS plugins (Phase 5) and any custom
 * webhook receiver — see `docs/cms-bridge-webhook.md`.
 */

import type { Detection } from '../recorder/types.js';
import type { ServiceDbAuth } from '../service-db/types.js';

/**
 * Auth header configuration. Structurally identical to `ServiceDbAuth` —
 * Bearer-by-default with optional custom header name and scheme. Aliased
 * here so the CMS-bridge surface reads as its own type in editor tooltips.
 */
export type CmsBridgeAuth = ServiceDbAuth;

/** CmsBridge construction options. */
export interface CmsBridgeOptions {
  /** Webhook URL. Required. */
  url: string;
  /** Optional auth header (Bearer by default). */
  auth?: CmsBridgeAuth;
  /** `source` field on payloads. Defaults to `storageName` or `'default'`. */
  source?: string;
  /**
   * Minimum time between webhooks for the same `${kind}:${identifier}`,
   * in ms. Default `3_600_000` (1 hour). Use to throttle repeat alerts
   * from long-running sessions.
   */
  dedupTtlMs?: number;
  /** Network timeout per POST, in ms. Default `5000`. */
  timeoutMs?: number;
  /** Override `globalThis.fetch`. Tests inject; runtime uses the global. */
  fetch?: typeof fetch;
  /** Override `Date.now`. Tests inject; runtime uses the global. */
  now?: () => number;
}

/**
 * Webhook payload — the public contract. Bump `schemaVersion` on any
 * breaking change. Documented in `docs/cms-bridge-webhook.md`.
 */
export interface CmsBridgePayload {
  /** Schema version. Receivers MUST tolerate higher minor changes. */
  schemaVersion: 1;
  /**
   * Bridge-side identifier — lets a CMS receiving webhooks from multiple
   * SimpleCMP installations disambiguate them. Defaults to `storageName`.
   */
  source: string;
  /** ISO-8601 UTC timestamp when the bridge fired. */
  sentAt: string;
  /** Page context at the time of detection. URLs are scrubbed of query strings. */
  page: {
    /** `location.href` with query string and fragment stripped. */
    url: string;
    /** `document.referrer`, omitted if empty. */
    referrer?: string;
    /** `navigator.userAgent`, omitted if not available. */
    userAgent?: string;
  };
  /** Source library identity — match against the SimpleCMP changelog. */
  library: {
    name: 'simplecmp';
    version: string;
  };
  /** The unknown detection. Mirrors `Detection` from the recorder. */
  detection: Pick<
    Detection,
    'kind' | 'identifier' | 'origin' | 'firstSeen' | 'lastSeen' | 'count'
  > & {
    /** Page pathname at first sighting (query stripped). Omitted if not captured. */
    firstSeenOn?: string;
    /** Always `'unknown'` for bridge events. */
    status: 'unknown';
  };
}
