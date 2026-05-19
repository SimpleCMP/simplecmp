/**
 * CMS Bridge types — REQ-9.
 *
 * The bridge POSTs a JSON webhook to a configurable URL with detections
 * the Recorder produced — both `status: 'unknown'` (genuinely novel)
 * and `status: 'known'` (matched the local services list or the
 * Service-DB middleware). The receiver disambiguates at storage time.
 *
 * Detections are batched: one POST per page (with a debounced trickle
 * for long-running pages and a `navigator.sendBeacon` flush on
 * `pagehide`). Cross-session dedup via `localStorage` keeps return-
 * visitor traffic near zero. `navigator.doNotTrack === '1'` suppresses
 * all POSTs.
 *
 * The payload schema is the **public contract** consumed by CMS plugins
 * (Phase 5) and any custom webhook receiver — see
 * `docs/cms-bridge-webhook.md`.
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
   * In-memory dedup window (per `${source}:${kind}:${identifier}`),
   * in ms. Default `3_600_000` (1 hour). Survives SPA route changes
   * within a tab; reset on hard navigation. The cross-session marker
   * (separate `crossSessionDedupMs`) catches what survives a reload.
   */
  dedupTtlMs?: number;
  /**
   * Cross-session dedup TTL, in ms. Backed by `localStorage` under
   * the key `simplecmp-reported:${source}:${kind}:${identifier}`.
   * Default `7 * 24 * 3_600_000` (7 days). Zero disables the
   * cross-session layer (in-memory dedup still applies).
   */
  crossSessionDedupMs?: number;
  /**
   * Debounce delay before flushing the in-flight batch, in ms.
   * Default `1500`. A `pagehide` event force-flushes via
   * `navigator.sendBeacon` regardless of the debounce.
   */
  flushDebounceMs?: number;
  /**
   * Maximum number of detections queued before forcing a flush even
   * if the debounce timer hasn't elapsed. Default `25`. Prevents
   * pathological queues on detection-heavy pages.
   */
  maxBatchSize?: number;
  /**
   * Fraction of visitor sessions that POST detections. Range
   * `[0, 1]`, default `1.0`. Useful for very-high-traffic sites
   * where the discovery signal is already strong at 10-20% sampling.
   * Decision is per-session (sampled at construction).
   */
  sampleRate?: number;
  /**
   * When `true` (the default), skip all POSTs if
   * `navigator.doNotTrack === '1'`. Set `false` only if you have
   * an explicit legal basis to record traffic from DNT users.
   */
  respectDoNotTrack?: boolean;
  /** Network timeout per POST, in ms. Default `5000`. */
  timeoutMs?: number;
  /** Override `globalThis.fetch`. Tests inject; runtime uses the global. */
  fetch?: typeof fetch;
  /** Override `Date.now`. Tests inject; runtime uses the global. */
  now?: () => number;
  /**
   * Tests pass a synthetic storage; runtime uses `globalThis.localStorage`.
   * Set to `null` to disable cross-session dedup explicitly.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /**
   * Tests pass a stub navigator; runtime uses `globalThis.navigator`.
   */
  navigator?: {
    doNotTrack?: string | null;
    sendBeacon?: (url: string, data?: BodyInit) => boolean;
  };
}

/**
 * Webhook payload — the public contract.
 *
 * Schema v2 batches multiple detections per POST. Receivers should
 * iterate `detections[]` and apply existing dedup logic per item.
 *
 * Documented in `docs/cms-bridge-webhook.md`.
 */
export interface CmsBridgePayload {
  /** Schema version. v2 batches detections; v1 was single-detection. */
  schemaVersion: 2;
  /**
   * Bridge-side identifier — lets a CMS receiving webhooks from multiple
   * SimpleCMP installations disambiguate them. Defaults to `storageName`.
   */
  source: string;
  /** ISO-8601 UTC timestamp when the bridge flushed this batch. */
  sentAt: string;
  /** Page context for the batch. All detections in `detections[]` were observed on this page. */
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
  /** Detections observed during this batch window. */
  detections: BridgeDetection[];
}

/**
 * One detection entry in a batched payload. Mirrors `Detection` from
 * the recorder plus the resolved `status` (`'known'` if the local
 * classifier or Service-DB middleware matched; `'unknown'` otherwise).
 */
export type BridgeDetection = Pick<
  Detection,
  'kind' | 'identifier' | 'origin' | 'firstSeen' | 'lastSeen' | 'count'
> & {
  /** Page pathname at first sighting (query stripped). Omitted if not captured. */
  firstSeenOn?: string;
  /** Resolved status — `'known'` for library/registry matches, `'unknown'` otherwise. */
  status: 'known' | 'unknown';
  /** Service id matched by the classifier, if any. */
  matchedService?: string;
};
