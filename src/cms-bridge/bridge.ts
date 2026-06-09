/**
 * CMS Bridge — REQ-9.
 *
 * Listens to recorder detection events and POSTs them as batches to the
 * configured `cmsBridgeUrl`. Both `status:'known'` and `status:'unknown'`
 * reach the receiver — the BE side decides what to do (e.g. render
 * library matches as "Erkannt" so the admin can adopt them; render
 * truly-unknown as "Unbekannt").
 *
 * Bandwidth controls, layered:
 *
 * 1. **`navigator.doNotTrack === '1'`** — skip all POSTs.
 * 2. **`sampleRate < 1`** — decided once per session; sampled-out
 *    sessions never POST.
 * 3. **In-memory dedup** — per `${source}:${kind}:${identifier}`, 1h
 *    TTL default. Survives SPA route changes within a tab.
 * 4. **Cross-session dedup** via `localStorage` — 7d TTL default.
 *    Returning visitors with stable trackers don't re-POST.
 * 5. **Batching** — detections queue in memory and flush either after
 *    a 1.5s debounce or via `navigator.sendBeacon` on `pagehide`.
 *    A typical page sends one POST regardless of detection count.
 *
 * Auth header, AbortController-timeout, and warn-once patterns lifted
 * from `ServiceDbClient` (REQ-8) — same shape so one Bearer token
 * works for both endpoints.
 */

import type { Detection } from '../recorder/types.js';
import type {
  BridgeDetection,
  CmsBridgeAuth,
  CmsBridgeOptions,
  CmsBridgePayload,
} from './types.js';

// VERSION is replaced at build time via esbuild's `define`. Same mechanism
// as `src/engine/index.ts`; vitest.config.ts provides the test-time value.
declare const VERSION: string;

const DEFAULT_DEDUP_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CROSS_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_FLUSH_DEBOUNCE_MS = 1500;
const DEFAULT_MAX_BATCH_SIZE = 25;
const DEFAULT_TIMEOUT_MS = 5000;
const CROSS_SESSION_PREFIX = 'simplecmp-reported:';

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
  private readonly crossSessionDedupMs: number;
  private readonly reportGeneration: number;
  private readonly flushDebounceMs: number;
  private readonly maxBatchSize: number;
  private readonly timeoutMs: number;
  private readonly respectDoNotTrack: boolean;
  private readonly sessionInScope: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  private readonly nav: CmsBridgeOptions['navigator'];
  /** `${kind}:${identifier}` → epoch ms of last successful (or queued) send. */
  private readonly lastSent = new Map<string, number>();
  /** Per-error-category warning gate so we don't spam the console. */
  private readonly warned = new Set<string>();

  private pending: BridgeDetection[] = [];
  /**
   * Detection keys queued in the current pending batch. Used to clear
   * the in-memory `lastSent` entries on transient failure so they
   * remain eligible for retry on a later event.
   */
  private pendingKeys: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once a `pagehide`/`visibilitychange` listener is attached. */
  private lifecycleHooked = false;

  constructor(options: CmsBridgeOptions) {
    this.url = options.url;
    this.host = (() => {
      try {
        // `hostname`, not `host`: detection origins reaching the recorder are
        // port-stripped (the watchers use `location.hostname`), so a bridge
        // URL on a non-default port (`cms.example:8443`) must compare against
        // the bare hostname or the self-post feedback-loop guard never matches.
        return new URL(options.url).hostname;
      } catch {
        return '';
      }
    })();
    this.auth = options.auth;
    this.source = options.source ?? 'default';
    this.dedupTtlMs = options.dedupTtlMs ?? DEFAULT_DEDUP_TTL_MS;
    this.crossSessionDedupMs = options.crossSessionDedupMs ?? DEFAULT_CROSS_SESSION_TTL_MS;
    // Negative/NaN would make every marker look "newer than current" and
    // wedge re-reporting off; clamp to a sane non-negative integer.
    this.reportGeneration = Math.max(0, Math.floor(options.reportGeneration ?? 0));
    this.flushDebounceMs = options.flushDebounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.respectDoNotTrack = options.respectDoNotTrack ?? true;
    this.fetchFn =
      options.fetch ??
      (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as never));
    this.now = options.now ?? (() => Date.now());
    if (options.storage !== undefined) {
      this.storage = options.storage;
    } else if (typeof localStorage !== 'undefined') {
      this.storage = localStorage;
    } else {
      this.storage = null;
    }
    this.nav = options.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);

    // Session sampling decided once at construction so a given visitor
    // is either in-scope or not for the whole session — avoids partial
    // signals where some detections POST and others don't.
    const sampleRate = options.sampleRate ?? 1;
    this.sessionInScope = sampleRate >= 1 || Math.random() < sampleRate;
  }

  /**
   * Subscribe target for `recorder.on('detection', ...)`. Accepts both
   * `known` and `unknown` detections — the BE state-derives at view
   * time from the registry + bundled library.
   */
  onDetection(d: Detection): void {
    if (!this.sessionInScope) return;
    if (this.respectDoNotTrack && this.nav?.doNotTrack === '1') return;
    if (this.host && d.origin === this.host) return;

    const key = `${d.kind}:${d.identifier}`;
    if (this._dedupHit(key)) return;

    // Mark sent BEFORE enqueue so re-entrant events from the same tick
    // don't double-enqueue. On transient failure we'll clear these entries
    // so a future event retries.
    const now = this.now();
    this.lastSent.set(key, now);
    this.pendingKeys.push(key);
    this.pending.push(this._toBridgeDetection(d));

    if (this.pending.length >= this.maxBatchSize) {
      this._flush();
      return;
    }
    this._scheduleFlush();
    this._hookLifecycle();
  }

  /**
   * Force-flush any queued detections. Called automatically on the
   * debounce timer and on `pagehide`, but exposed for tests + manual
   * shutdown.
   */
  flushNow(): Promise<void> {
    return this._flush();
  }

  // --- dedup ----------------------------------------------------------

  private _dedupHit(key: string): boolean {
    const now = this.now();
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < this.dedupTtlMs) return true;
    return this._crossSessionHit(key, now);
  }

  private _crossSessionHit(key: string, now: number): boolean {
    if (this.storage === null || this.crossSessionDedupMs <= 0) return false;
    const storageKey = `${CROSS_SESSION_PREFIX}${this.source}:${key}`;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(storageKey);
    } catch {
      // localStorage can throw (private browsing, quota) — treat as miss.
      return false;
    }
    if (raw === null) return false;
    const marker = this._parseMarker(raw);
    if (marker === null) return false;
    // Server bumped the generation since this marker was written (e.g. the
    // admin deleted the detection): treat as a miss so it re-POSTs, and
    // drop the stale marker. Legacy markers carry generation 0.
    if (marker.gen < this.reportGeneration) {
      try {
        this.storage.removeItem(storageKey);
      } catch {
        // ignore
      }
      return false;
    }
    if (now - marker.ts < this.crossSessionDedupMs) return true;
    // Expired — clear to keep storage tidy.
    try {
      this.storage.removeItem(storageKey);
    } catch {
      // ignore
    }
    return false;
  }

  private _markCrossSession(key: string, now: number): void {
    if (this.storage === null || this.crossSessionDedupMs <= 0) return;
    const storageKey = `${CROSS_SESSION_PREFIX}${this.source}:${key}`;
    try {
      // `<generation>.<timestampMs>` — the generation lets a later page
      // load detect a server-side reset and re-report (see _crossSessionHit).
      this.storage.setItem(storageKey, `${this.reportGeneration}.${now}`);
    } catch {
      // ignore — local cap behaviour is fine
    }
  }

  /**
   * Parse a cross-session marker value into `{ gen, ts }`. New markers are
   * `<gen>.<ts>`; legacy markers are a bare `<ts>` (read as generation 0,
   * so a non-zero current generation invalidates them). Returns null when
   * unparseable.
   */
  private _parseMarker(raw: string): { gen: number; ts: number } | null {
    const dot = raw.indexOf('.');
    if (dot === -1) {
      const ts = Number(raw);
      return Number.isFinite(ts) ? { gen: 0, ts } : null;
    }
    const gen = Number(raw.slice(0, dot));
    const ts = Number(raw.slice(dot + 1));
    if (!Number.isFinite(gen) || !Number.isFinite(ts)) return null;
    return { gen, ts };
  }

  // --- flush + lifecycle ----------------------------------------------

  private _scheduleFlush(): void {
    if (this.flushTimer !== null || typeof setTimeout === 'undefined') return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this._flush();
    }, this.flushDebounceMs);
  }

  private _hookLifecycle(): void {
    if (this.lifecycleHooked) return;
    if (typeof addEventListener === 'undefined') return;
    this.lifecycleHooked = true;
    const onUnload = (): void => {
      this._flushBeacon();
    };
    addEventListener('pagehide', onUnload, { capture: true });
    // visibilitychange catches the common mobile case where pagehide
    // fires unreliably (Safari bfcache, app-switch on iOS).
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'hidden') onUnload();
        },
        { capture: true }
      );
    }
  }

  private _flushBeacon(): void {
    if (this.pending.length === 0) return;
    if (typeof this.nav?.sendBeacon !== 'function') {
      // No beacon support — best effort fire-and-forget fetch with
      // keepalive: true. Returns a promise we don't await; the runtime
      // does its best to complete the request after navigation.
      void this._flush({ keepalive: true });
      return;
    }
    const payload = this._buildPayload(this.pending);
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    let sent = false;
    try {
      sent = this.nav.sendBeacon(this.url, blob);
    } catch {
      sent = false;
    }
    if (sent) {
      this._markBatchSent();
      this.pending = [];
      this.pendingKeys = [];
    } else {
      // Beacon failed (queue full, payload too large) — try a regular flush
      // synchronously with keepalive so the runtime keeps the request alive.
      void this._flush({ keepalive: true });
    }
  }

  private async _flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending;
    const keys = this.pendingKeys;
    this.pending = [];
    this.pendingKeys = [];
    try {
      await this._post(this._buildPayload(batch), options);
      const now = this.now();
      for (const key of keys) this._markCrossSession(key, now);
    } catch (err) {
      if (this._shouldClearOnError(err)) {
        // Transient — let future events retry these.
        for (const key of keys) this.lastSent.delete(key);
      }
      this._warnOnce('post', err);
    }
  }

  /** Mark every key in the current pending batch as cross-session-sent. */
  private _markBatchSent(): void {
    const now = this.now();
    for (const key of this.pendingKeys) this._markCrossSession(key, now);
  }

  // --- payload + POST -------------------------------------------------

  private _toBridgeDetection(d: Detection): BridgeDetection {
    const out: BridgeDetection = {
      kind: d.kind,
      identifier: d.identifier,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      count: d.count,
      status: d.status === 'known' ? 'known' : 'unknown',
    };
    if (d.origin !== undefined) out.origin = d.origin;
    if (d.firstSeenOn !== undefined) out.firstSeenOn = stripQuery(d.firstSeenOn);
    if (d.matchedService !== undefined) out.matchedService = d.matchedService;
    return out;
  }

  private _buildPayload(detections: BridgeDetection[]): CmsBridgePayload {
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
    return {
      schemaVersion: 2,
      source: this.source,
      sentAt: new Date(this.now()).toISOString(),
      page,
      library: { name: 'simplecmp', version: typeof VERSION === 'string' ? VERSION : '0.0.0' },
      detections,
    };
  }

  private async _post(payload: CmsBridgePayload, options: { keepalive?: boolean }): Promise<void> {
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
      const init: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller?.signal,
      };
      if (options.keepalive === true) init.keepalive = true;
      const res = await this.fetchFn(this.url, init);
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
      `SimpleCMP cms-bridge: ${category} failed (${message}). The bridge will keep trying on subsequent detection events; this warning fires once per error category per session.`
    );
  }
}
