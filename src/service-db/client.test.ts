import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceDbClient } from './client.js';
import type { LookupResult, ServiceMatch } from './types.js';

const URL = 'https://servicedb.example.test';

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

const gaMatch: ServiceMatch = {
  id: 'google-analytics',
  name: 'Google Analytics',
  purposes: ['analytics'],
};

function lookupResponse(matches: ServiceMatch[]): LookupResult {
  return { items: [{ query: { cookie: '_ga' }, matches }] };
}

// Shared cleanup so every describe block sees a clean cache. Auth and health
// tests don't otherwise repeat-clear themselves; without this, an earlier
// test would prime the cache and a later lookup would skip the fetch.
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ServiceDbClient — lookup', () => {
  it('returns the first match for a known cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupResponse([gaMatch])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });

    const result = await client.lookup({ cookie: '_ga' });

    expect(result?.id).toBe('google-analytics');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe(`${URL}/v1/lookup`);
    expect(init.method).toBe('POST');
  });

  it('returns null for unknown queries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupResponse([])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const result = await client.lookup({ cookie: '_unknown' });
    expect(result).toBeNull();
  });

  it('caches in localStorage and serves from cache without re-fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupResponse([gaMatch])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    await client.lookup({ cookie: '_ga' });
    await client.lookup({ cookie: '_ga' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to null on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('net'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const result = await client.lookup({ cookie: '_ga' });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back to null on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'down' }, { status: 503 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    expect(await client.lookup({ cookie: '_ga' })).toBeNull();
  });

  it('returns stale cached entry while revalidating', async () => {
    let now = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(lookupResponse([gaMatch])))
      .mockResolvedValueOnce(
        jsonResponse(lookupResponse([{ ...gaMatch, name: 'Google Analytics (updated)' }]))
      );
    const client = new ServiceDbClient({
      url: URL,
      fetch: fetchMock,
      now: () => now,
      cacheTtlMs: 1000,
    });

    await client.lookup({ cookie: '_ga' }); // fetch 1
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now = 2000; // past TTL
    const stale = await client.lookup({ cookie: '_ga' });
    expect(stale?.name).toBe('Google Analytics'); // stale value returned

    // background revalidate has been kicked off; settle promises
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('ServiceDbClient — lookupBatch', () => {
  it('issues one HTTP request for multiple queries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          { query: { cookie: '_ga' }, matches: [gaMatch] },
          { query: { cookie: '_unknown' }, matches: [] },
        ],
      })
    );
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const results = await client.lookupBatch([{ cookie: '_ga' }, { cookie: '_unknown' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0]?.id).toBe('google-analytics');
    expect(results[1]).toBeNull();
  });

  it('skips already-cached queries', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(lookupResponse([gaMatch])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });

    await client.lookup({ cookie: '_ga' }); // primes cache

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [{ query: { cookie: '_other' }, matches: [] }],
      })
    );
    await client.lookupBatch([{ cookie: '_ga' }, { cookie: '_other' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // first single, second batch (only the un-cached)
    const [, batchInit] = fetchMock.mock.calls[1] ?? [];
    const sent = JSON.parse(batchInit.body);
    expect(sent.items).toEqual([{ cookie: '_other' }]);
  });
});

describe('ServiceDbClient — auth', () => {
  it('sends Authorization: Bearer when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupResponse([gaMatch])));
    const client = new ServiceDbClient({
      url: URL,
      fetch: fetchMock,
      auth: { token: 'abc123' },
    });
    await client.lookup({ cookie: '_ga' });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer abc123');
  });

  it('respects custom header and scheme', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupResponse([])));
    const client = new ServiceDbClient({
      url: URL,
      fetch: fetchMock,
      auth: { token: 'tok', header: 'X-API-Key', scheme: '' },
    });
    await client.lookup({ cookie: '_ga' });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    // scheme '' → header value is just the token (with whitespace trimmed)
    expect((init.headers as Headers).get('X-API-Key')).toBe('tok');
  });
});

describe('ServiceDbClient — health', () => {
  it('returns parsed health response on 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, schemaVersion: 1, count: 42 }));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const h = await client.health();
    expect(h?.ok).toBe(true);
    expect(h?.schemaVersion).toBe(1);
    expect(h?.count).toBe(42);
  });

  it('returns null on backend down', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    expect(await client.health()).toBeNull();
  });
});
