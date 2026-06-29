/**
 * Consent-Log POST sender — Phase 2 audit trail.
 *
 * Implements the engine's `ConsentWatcher` interface so the
 * `ConsentManager.notify('saveConsents', …)` event funnels through
 * here. Every accept / decline / save-selected click that mutates
 * consent state produces one POST to the configured host endpoint.
 *
 * Skipped intentionally: notifications where `changes === {}` AND
 * the visitor has already confirmed before this session (no-op
 * re-confirm — already in the audit log). The very first confirm of
 * the session ALWAYS POSTs even when nothing technically changed,
 * because the audit trail needs an explicit "I made this decision"
 * record for the visitor's first interaction.
 *
 * 401 + token-refresh logic mirrors the `CmsBridge` REQ-N9 pattern
 * (shared auth-object semantics: a refresh mutates `this.auth.token`
 * in place so a bridge sharing the same auth object also picks up
 * the new token). Concurrent POSTs share an in-flight refresh
 * promise so a stale-token page only triggers ONE refresh roundtrip
 * regardless of how many decisions fire.
 */

import type { CmsBridgeAuth } from '../cms-bridge/types.js';
import type { ConsentLogOptions, ConsentLogPayload, SaveConsentsNotification } from './types.js';

// We never call manager methods, only inspect notification args.
type ConsentManagerLike = unknown;

interface ConsentWatcherShape {
  update(manager: ConsentManagerLike, name: string, data: unknown): void;
}

const DEFAULT_TIMEOUT_MS = 5000;
const REFRESH_TIMEOUT_MS = 2000;

/**
 * Watcher that POSTs each confirmed consent change to the host's
 * consent-log endpoint. Constructed lazily by {@link init} only when
 * `config.consentLog?.url` is set; otherwise zero overhead.
 */
export class ConsentLogger implements ConsentWatcherShape {
  private readonly url: string;
  private readonly source: string;
  private readonly versionHash: string;
  private readonly visitorUuid: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pageHost: string | undefined;
  private readonly uaFamily: ConsentLogPayload['uaFamily'] | undefined;
  /**
   * Shared with any CmsBridge using the same auth object — a refresh
   * mutates `auth.token` in place so both endpoints pick up the new
   * value without another roundtrip.
   */
  private auth: CmsBridgeAuth | undefined;
  /**
   * Concurrent decisions sharing one refresh promise so a single
   * stale-token page produces ONE refresh roundtrip, not N.
   */
  private refreshInFlight: Promise<string | null> | null = null;
  /** Once-per-category warning gate to keep the console quiet. */
  private readonly warned = new Set<string>();
  /**
   * Flips to true after the first `saveConsents` notification — used
   * to skip no-op re-confirms that don't change anything (visitor
   * re-opens the modal, hits Save without flipping a toggle).
   */
  private alreadyConfirmed = false;

  constructor(options: ConsentLogOptions) {
    this.url = options.url;
    this.source = options.source ?? 'default';
    this.versionHash = options.configVersion ?? '';
    this.visitorUuid = options.visitorUuid;
    this.auth = options.auth ? { ...options.auth } : undefined;
    this.fetchFn =
      options.fetch ??
      (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as never));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pageHost = derivePageHost(options.location);
    this.uaFamily = deriveUaFamily(options.navigator);
  }

  /**
   * Implements `ConsentWatcher`. Called by the engine's
   * `manager.notify(name, data)` on every state change. We act only
   * on `'saveConsents'` (final confirmations); `'consents'`
   * notifications during modal interactions are ignored — they fire
   * BEFORE the visitor clicks Save.
   */
  update(_manager: ConsentManagerLike, name: string, data: unknown): void {
    if (name !== 'saveConsents') return;
    const payload = data as SaveConsentsNotification;
    if (!payload || typeof payload !== 'object') return;

    const consents = isStringBoolMap(payload.consents) ? payload.consents : {};
    const changes = isStringBoolMap(payload.changes) ? payload.changes : {};
    const isFirstConfirm = !this.alreadyConfirmed;
    if (!isFirstConfirm && Object.keys(changes).length === 0) {
      // No-op re-confirm after the first one is already in the audit
      // log — would only produce a duplicate row (the host's UNIQUE
      // constraint would catch it, but no point in the round-trip).
      return;
    }
    this.alreadyConfirmed = true;

    const body: ConsentLogPayload = {
      schemaVersion: 1,
      source: this.source,
      versionHash: this.versionHash,
      visitorUuid: this.visitorUuid,
      decisions: consents,
      decisionType: normalizeDecisionType(payload.type, changes, consents),
    };
    if (this.pageHost !== undefined) body.pageHost = this.pageHost;
    if (this.uaFamily !== undefined) body.uaFamily = this.uaFamily;

    void this._post(body, { retried: false });
  }

  private async _post(body: ConsentLogPayload, options: { retried: boolean }): Promise<void> {
    if (!this.fetchFn) {
      this._warnOnce('post', new Error('fetch is unavailable'));
      return;
    }
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
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
      if (
        res.status === 401 &&
        !options.retried &&
        this.auth?.refreshUrl &&
        this.auth.token !== undefined
      ) {
        const newToken = await this._refreshToken();
        if (newToken !== null && this.auth) {
          this.auth.token = newToken;
          return this._post(body, { retried: true });
        }
        this._warnOnce('post', new Error('consent-log POST responded 401'));
        return;
      }
      if (!res.ok) {
        this._warnOnce('post', new Error(`consent-log POST responded ${res.status}`));
      }
    } catch (err) {
      this._warnOnce('post', err);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Single in-flight token refresh — mirrors the CmsBridge logic but
   * scoped to this logger. When the same auth-object is shared with
   * a CmsBridge, the bridge sees the mutated token immediately
   * without another fetch (because `this.auth` is the same reference
   * after `{ ...options.auth }` copy at construction — note: it is
   * NOT shared by default; sharing is opt-in via host-side wiring).
   */
  private async _refreshToken(): Promise<string | null> {
    const refreshUrl = this.auth?.refreshUrl;
    if (!refreshUrl || !this.fetchFn) return null;
    if (this.refreshInFlight !== null) {
      try {
        return await this.refreshInFlight;
      } catch {
        return null;
      }
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = Math.min(REFRESH_TIMEOUT_MS, this.timeoutMs);
    const timer =
      controller && typeof setTimeout !== 'undefined'
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;
    const fetchFn = this.fetchFn;
    this.refreshInFlight = (async () => {
      try {
        const res = await fetchFn(refreshUrl, {
          method: 'GET',
          signal: controller?.signal,
        });
        if (!res.ok) {
          throw new Error(`refresh responded ${res.status}`);
        }
        const data = (await res.json()) as { token?: unknown };
        if (typeof data?.token !== 'string' || data.token === '') {
          throw new Error('refresh response missing token');
        }
        return data.token;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })();
    try {
      return await this.refreshInFlight;
    } catch (err) {
      this._warnOnce('tokenRefresh', err);
      return null;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private _warnOnce(category: string, err: unknown): void {
    if (this.warned.has(category)) return;
    this.warned.add(category);
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `SimpleCMP consent-log: ${category} failed (${message}). Subsequent failures of this category will be silent.`
    );
  }
}

function isStringBoolMap(value: unknown): value is Record<string, boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'boolean') return false;
  }
  return true;
}

/**
 * Engine's notification `type` is `'accept' | 'decline' | 'script'`
 * — but a "Save selected" mid-state lands as either accept or
 * decline depending on internal heuristics. Re-classify as
 * `'partial'` when there's any heterogeneity (some accepted + some
 * declined) so the audit log reflects "the visitor made a real
 * choice", not a bulk action.
 */
function normalizeDecisionType(
  rawType: unknown,
  _changes: Record<string, boolean>,
  consents: Record<string, boolean>
): ConsentLogPayload['decisionType'] {
  const values = Object.values(consents);
  if (values.length > 0) {
    const hasAccept = values.includes(true);
    const hasDecline = values.includes(false);
    if (hasAccept && hasDecline) return 'partial';
  }
  if (rawType === 'accept' || rawType === 'decline' || rawType === 'script') {
    return rawType;
  }
  return 'script';
}

function derivePageHost(loc: ConsentLogOptions['location'] | undefined): string | undefined {
  const target = loc ?? (typeof location !== 'undefined' ? location : undefined);
  if (!target || typeof target.hostname !== 'string' || target.hostname === '') return undefined;
  return target.hostname.toLowerCase();
}

function deriveUaFamily(
  nav: ConsentLogOptions['navigator'] | undefined
): ConsentLogPayload['uaFamily'] | undefined {
  const target = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const ua = target?.userAgent;
  if (typeof ua !== 'string' || ua === '') return undefined;
  const lower = ua.toLowerCase();
  // Order matters: edge / opera embed the chrome substring in their
  // UA, so check them first.
  if (lower.includes('edg/') || lower.includes('edge')) return 'edge';
  if (lower.includes('opr/') || lower.includes('opera')) return 'opera';
  if (lower.includes('firefox')) return 'firefox';
  if (lower.includes('chrome')) return 'chrome';
  if (lower.includes('safari')) return 'safari';
  return 'other';
}
