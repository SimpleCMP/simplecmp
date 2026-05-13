/**
 * CMS Bridge — REQ-9.
 *
 * Listens for unknown trackers from the Recorder and POSTs a JSON webhook
 * per item to the configured `cmsBridgeUrl`. Production-oriented telemetry
 * so CMS admins are alerted to new trackers before compliance issues
 * compound.
 *
 * Dedup is per `${kind}:${identifier}` with a TTL window (default 1h) so
 * the same item doesn't spam the webhook on every page navigation. The
 * dedup map lives in memory only — survives SPA route changes within a
 * tab, resets on hard navigation or `init()` re-call.
 *
 * Auth header, AbortController-timeout, and warn-once patterns lifted from
 * `ServiceDbClient` (REQ-8) — same shape so a CMS plugin can use one
 * Bearer token for both endpoints.
 */

import type { Detection } from '../recorder/types.js';
import type { CmsBridgeAuth, CmsBridgeOptions, CmsBridgePayload } from './types.js';

// VERSION is replaced at build time via esbuild's `define`. Same mechanism
// as `src/engine/index.ts`; vitest.config.ts provides the test-time value.
declare const VERSION: string;

const DEFAULT_DEDUP_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

/** Strip query string and fragment from a URL-like string. */
function stripQuery(url: string): string {
  const queryAt = url.indexOf('?');
  const fragmentAt = url.indexOf('#');
  const cuts = [queryAt, fragmentAt].filter((n) => n >= 0);
  if (cuts.length === 0) return url;
  return url.slice(0, Math.min(...cuts));
}

export class CmsBridge {
  private readonly url: string;
  /**
   * Host of `url` — used to suppress detections of the bridge's own
   * traffic. Without this, every webhook POST would itself be observed
   * by the recorder's PerformanceObserver as an unknown `request`
   * detection and re-fire the bridge for the bridge URL. The dedup map
   * prevents an actual loop, but each polling/POST URL still produces
   * one noise entry. Empty when `url` isn't parseable.
   */
  private readonly host: string;
  private readonly auth?: CmsBridgeAuth;
  private readonly source: string;
  private readonly dedupTtlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  /** `${kind}:${identifier}` → epoch ms of last successful (or queued) send. */
  private readonly lastSent = new Map<string, number>();
  /** Per-error-category warning gate so we don't spam the console. */
  private readonly warned = new Set<string>();

  constructor(options: CmsBridgeOptions) {
    this.url = options.url;
    this.host = (() => {
      try {
        return new URL(options.url).host;
      } catch {
        return '';
      }
    })();
    this.auth = options.auth;
    this.source = options.source ?? 'default';
    this.dedupTtlMs = options.dedupTtlMs ?? DEFAULT_DEDUP_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn =
      options.fetch ??
      (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as never));
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Subscribe target for `recorder.on('detection', ...)`. Filters out
   * everything except `status: 'unknown'`, dedupes by detection key with
   * the configured TTL window, and fires a fetch in the background. Never
   * throws — failures degrade to `console.warn` (once per error category).
   */
  onDetection(d: Detection): void {
    if (d.status !== 'unknown') return;
    // Feedback suppression: don't fire for detections of the bridge's own
    // HTTP traffic. Every POST + any neighboring requests on the same host
    // (e.g. health checks, batched receivers) would otherwise generate
    // synthetic "unknown tracker" alerts about the bridge itself.
    if (this.host && d.origin === this.host) return;
    const key = `${d.kind}:${d.identifier}`;
    const now = this.now();
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < this.dedupTtlMs) return;
    // Mark as sent BEFORE the fetch so re-entrant events don't double-send.
    // On 5xx / network error we'll clear the entry so a future event retries.
    this.lastSent.set(key, now);
    void this._post(this._buildPayload(d)).catch((err) => {
      if (this._shouldClearOnError(err)) this.lastSent.delete(key);
      this._warnOnce('post', err);
    });
  }

  private _buildPayload(d: Detection): CmsBridgePayload {
    const loc = typeof location !== 'undefined' ? location : undefined;
    const doc = typeof document !== 'undefined' ? document : undefined;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const page: CmsBridgePayload['page'] = {
      url: loc ? stripQuery(loc.href) : '',
    };
    const referrer = doc?.referrer;
    if (referrer) page.referrer = referrer;
    const userAgent = nav?.userAgent;
    if (userAgent) page.userAgent = userAgent;
    const detection: CmsBridgePayload['detection'] = {
      kind: d.kind,
      identifier: d.identifier,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      count: d.count,
      status: 'unknown',
    };
    if (d.origin !== undefined) detection.origin = d.origin;
    if (d.firstSeenOn !== undefined) detection.firstSeenOn = stripQuery(d.firstSeenOn);
    return {
      schemaVersion: 1,
      source: this.source,
      sentAt: new Date(this.now()).toISOString(),
      page,
      library: { name: 'simplecmp', version: typeof VERSION === 'string' ? VERSION : '0.0.0' },
      detection,
    };
  }

  private async _post(payload: CmsBridgePayload): Promise<void> {
    if (!this.fetchFn) throw new Error('fetch is unavailable');
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (this.auth) {
      const headerName = this.auth.header ?? 'Authorization';
      const scheme = this.auth.scheme ?? 'Bearer';
      headers.set(headerName, `${scheme} ${this.auth.token}`.trim());
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer =
      controller && typeof setTimeout !== 'undefined'
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;
    try {
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });
      if (!res.ok) throw new Error(`CMS bridge POST responded ${res.status}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Whether a failure should clear the dedup entry so a later event can
   * retry. Network/abort/5xx → clear (transient, worth retrying). 4xx →
   * keep (the receiver explicitly rejected this; don't keep hammering).
   */
  private _shouldClearOnError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    const status4xx = /responded 4\d\d/.exec(message);
    return status4xx === null;
  }

  private _warnOnce(category: string, err: unknown): void {
    if (this.warned.has(category)) return;
    this.warned.add(category);
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `SimpleCMP cms-bridge: ${category} failed (${message}). The bridge will keep trying on subsequent unknown detections; this warning fires once per error category per session.`
    );
  }
}
