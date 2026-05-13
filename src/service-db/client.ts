/**
 * Service DB frontend client — REQ-8 / ADR-0005 section G.
 *
 * Speaks the protocol from `docs/service-db-protocol.md` against any
 * conformant backend (the PHP+SQLite reference, a CMS plugin, or a
 * community-hosted DB). Caches lookups in `localStorage` with TTL +
 * stale-while-revalidate; falls back to `null` on any failure so the
 * recorder can degrade to its `LocalClassifier` without breaking.
 */

import type {
  HealthResponse,
  LookupQuery,
  LookupResult,
  ServiceDbClientOptions,
  ServiceMatch,
} from './types.js';

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3000;
const STORAGE_PREFIX = 'simplecmp.servicedb.';

interface CachedEntry {
  /** Match found at the given query, or `null` for a cached miss. */
  match: ServiceMatch | null;
  /** `Date.now()` at storage time. */
  storedAt: number;
  /** Effective max-age in ms (TTL or `Cache-Control` override). */
  maxAgeMs: number;
}

/** Build the localStorage key for a lookup query. Stable per host + query. */
function cacheKey(host: string, query: LookupQuery): string {
  const part = query.cookie ? `c:${query.cookie}` : `o:${query.origin ?? ''}`;
  return `${STORAGE_PREFIX}${host}.${part}`;
}

/** Parse a `Cache-Control` header for `max-age=<seconds>`, fallback to default. */
function parseMaxAge(headers: Headers, defaultMs: number): number {
  const cc = headers.get('Cache-Control');
  if (!cc) return defaultMs;
  const match = /max-age=(\d+)/.exec(cc);
  if (!match || !match[1]) return defaultMs;
  const seconds = Number.parseInt(match[1], 10);
  if (Number.isNaN(seconds) || seconds < 0) return defaultMs;
  return seconds * 1000;
}

export class ServiceDbClient {
  private readonly url: string;
  private readonly host: string;
  private readonly auth?: ServiceDbClientOptions['auth'];
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly apiVersion: string;
  private readonly fetchFn: typeof fetch;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly now: () => number;
  /** In-flight revalidations, keyed by cache key. Avoids duplicate concurrent fetches. */
  private readonly inflight = new Map<string, Promise<ServiceMatch | null>>();
  /** Per-error-type warning gate so we don't spam the console. */
  private readonly warned = new Set<string>();

  constructor(options: ServiceDbClientOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.host = (() => {
      try {
        return new URL(this.url).host;
      } catch {
        return this.url;
      }
    })();
    this.auth = options.auth;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.apiVersion = options.apiVersion ?? 'v1';
    this.fetchFn =
      options.fetch ??
      (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as never));
    this.storage =
      options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    this.now = options.now ?? (() => Date.now());
  }

  /** Look up a single detection. Cached; falls back to `null` on any failure. */
  async lookup(query: LookupQuery): Promise<ServiceMatch | null> {
    const key = cacheKey(this.host, query);

    const cached = this._readCache(key);
    if (cached !== undefined) {
      const isFresh = this.now() - cached.storedAt < cached.maxAgeMs;
      if (isFresh) return cached.match;
      // Stale-while-revalidate: kick off a background refresh, return stale.
      void this._revalidate(key, query);
      return cached.match;
    }

    return this._fetchAndCache(key, query);
  }

  /** Batched lookup — single HTTP request for all queries. */
  async lookupBatch(queries: LookupQuery[]): Promise<Array<ServiceMatch | null>> {
    if (queries.length === 0) return [];

    // Serve from cache where possible; collect the rest into a single batch.
    const results: Array<ServiceMatch | null | undefined> = new Array(queries.length).fill(
      undefined
    );
    const missing: { index: number; query: LookupQuery }[] = [];
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      if (!q) continue;
      const key = cacheKey(this.host, q);
      const cached = this._readCache(key);
      if (cached !== undefined && this.now() - cached.storedAt < cached.maxAgeMs) {
        results[i] = cached.match;
      } else {
        missing.push({ index: i, query: q });
      }
    }

    if (missing.length === 0) {
      return results.map((r) => r ?? null);
    }

    try {
      const body = JSON.stringify({ items: missing.map((m) => m.query) });
      const res = await this._request<LookupResult>(`/${this.apiVersion}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const items = res?.items ?? [];
      for (let i = 0; i < missing.length; i++) {
        const slot = missing[i];
        const item = items[i];
        if (!slot) continue;
        const match = item?.matches?.[0] ?? null;
        const key = cacheKey(this.host, slot.query);
        this._writeCache(key, match, this.cacheTtlMs);
        results[slot.index] = match;
      }
    } catch (err) {
      this._warnOnce('batch-lookup', err);
      // Stale or null for everything we couldn't resolve.
      for (const slot of missing) {
        results[slot.index] = null;
      }
    }

    return results.map((r) => r ?? null);
  }

  /** Drop all cached entries for this host. */
  clearCache(): void {
    if (!this.storage) return;
    // Best-effort scan — `Storage` exposes `.length` and `.key(i)` if it's
    // the real localStorage. If we have a stub without those, no-op.
    const real = this.storage as Storage;
    if (typeof real.length !== 'number' || typeof real.key !== 'function') return;
    const prefix = `${STORAGE_PREFIX}${this.host}.`;
    const toRemove: string[] = [];
    for (let i = 0; i < real.length; i++) {
      const k = real.key(i);
      if (k?.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) this.storage.removeItem(k);
  }

  /** Probe the backend. Returns null on failure. */
  async health(): Promise<HealthResponse | null> {
    try {
      return await this._request<HealthResponse>(`/${this.apiVersion}/health`, { method: 'GET' });
    } catch {
      return null;
    }
  }

  // --- internals ---------------------------------------------------------

  private async _fetchAndCache(key: string, query: LookupQuery): Promise<ServiceMatch | null> {
    // Coalesce concurrent fetches for the same key.
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = (async () => {
      try {
        const res = await this._request<LookupResult>(`/${this.apiVersion}/lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [query] }),
        });
        const match = res?.items?.[0]?.matches?.[0] ?? null;
        this._writeCache(key, match, this.cacheTtlMs);
        return match;
      } catch (err) {
        this._warnOnce('lookup', err);
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  private async _revalidate(key: string, query: LookupQuery): Promise<void> {
    if (this.inflight.has(key)) return;
    await this._fetchAndCache(key, query).catch(() => undefined);
  }

  private async _request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.fetchFn) throw new Error('fetch is unavailable');
    const headers = new Headers(init.headers);
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
      const res = await this.fetchFn(`${this.url}${path}`, {
        ...init,
        headers,
        signal: controller?.signal,
      });
      if (!res.ok) throw new Error(`Service DB ${path} responded ${res.status}`);
      const data = (await res.json()) as T;
      return data;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private _readCache(key: string): CachedEntry | undefined {
    if (!this.storage) return undefined;
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as CachedEntry;
      if (typeof parsed.storedAt !== 'number' || typeof parsed.maxAgeMs !== 'number') {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private _writeCache(key: string, match: ServiceMatch | null, maxAgeMs: number): void {
    if (!this.storage) return;
    try {
      const entry: CachedEntry = { match, storedAt: this.now(), maxAgeMs };
      this.storage.setItem(key, JSON.stringify(entry));
    } catch {
      // Quota / privacy mode → no-op
    }
  }

  /** Public for tests; lets us write a successful response into the cache. */
  _absorbCacheControl(headers: Headers): number {
    return parseMaxAge(headers, this.cacheTtlMs);
  }

  private _warnOnce(category: string, err: unknown): void {
    if (this.warned.has(category)) return;
    this.warned.add(category);
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `SimpleCMP service-db: ${category} failed (${message}). Falling back to local classification for this session category.`
    );
  }
}
