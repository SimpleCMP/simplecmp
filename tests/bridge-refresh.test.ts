import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CmsBridge } from '../src/cms-bridge/index.js';
import type { Detection } from '../src/recorder/types.js';

/**
 * Vitest unit tests for the bridge's refresh-on-401 behaviour
 * (REQ-N9). End-to-end browser coverage lives in `tests/bridge/*.spec.ts`
 * (Playwright); here we exercise the `_post` retry path with a mocked
 * fetch so the in-flight guard and `retried` flag are testable without
 * a real receiver.
 */

const BRIDGE_URL = 'https://bridge.test/webhook';
const REFRESH_URL = 'https://bridge.test/refresh';

interface FetchCall {
  url: string;
  method: string;
}

function makeDetection(identifier: string): Detection {
  return {
    kind: 'cookie',
    identifier,
    firstSeen: 1,
    lastSeen: 1,
    count: 1,
    status: 'unknown',
  };
}

describe('CmsBridge — refresh-on-401', () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws on 401 when no refreshUrl is configured (legacy behaviour)', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      calls.push({ url, method: 'POST' });
      return new Response('', { status: 401 });
    });
    const bridge = new CmsBridge({
      url: BRIDGE_URL,
      auth: { token: 'stale' },
      flushDebounceMs: 0,
      crossSessionDedupMs: 0,
      fetch: fetchFn as unknown as typeof fetch,
      storage: null,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      bridge.onDetection(makeDetection('a'));
      await bridge.flushNow();
      // Single POST, no refresh attempt.
      expect(calls).toEqual([{ url: BRIDGE_URL, method: 'POST' }]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('on 401 with refreshUrl: fetches new token and retries the POST', async () => {
    let bridgePosts = 0;
    const fetchFn = vi.fn(async (url: string) => {
      calls.push({ url, method: url === REFRESH_URL ? 'GET' : 'POST' });
      if (url === REFRESH_URL) {
        return new Response(JSON.stringify({ token: 'fresh-abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      bridgePosts += 1;
      // First POST: 401 (stale token). Second POST: 200 (refreshed).
      return new Response('', { status: bridgePosts === 1 ? 401 : 200 });
    });
    const bridge = new CmsBridge({
      url: BRIDGE_URL,
      auth: { token: 'stale', refreshUrl: REFRESH_URL },
      flushDebounceMs: 0,
      crossSessionDedupMs: 0,
      fetch: fetchFn as unknown as typeof fetch,
      storage: null,
    });
    bridge.onDetection(makeDetection('a'));
    await bridge.flushNow();
    expect(calls).toEqual([
      { url: BRIDGE_URL, method: 'POST' },
      { url: REFRESH_URL, method: 'GET' },
      { url: BRIDGE_URL, method: 'POST' },
    ]);
  });

  it('on 401 + refresh 500: propagates the original 401', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      calls.push({ url, method: url === REFRESH_URL ? 'GET' : 'POST' });
      if (url === REFRESH_URL) {
        return new Response('', { status: 500 });
      }
      return new Response('', { status: 401 });
    });
    const bridge = new CmsBridge({
      url: BRIDGE_URL,
      auth: { token: 'stale', refreshUrl: REFRESH_URL },
      flushDebounceMs: 0,
      crossSessionDedupMs: 0,
      fetch: fetchFn as unknown as typeof fetch,
      storage: null,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      bridge.onDetection(makeDetection('a'));
      await bridge.flushNow();
      expect(calls).toEqual([
        { url: BRIDGE_URL, method: 'POST' },
        { url: REFRESH_URL, method: 'GET' },
      ]);
      // Both the tokenRefresh failure AND the original 401 are warn-once
      // categories; both should have triggered at least once.
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('on 401 + refresh response missing token: propagates the original 401', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      calls.push({ url, method: url === REFRESH_URL ? 'GET' : 'POST' });
      if (url === REFRESH_URL) {
        return new Response(JSON.stringify({ wrongField: 'x' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 401 });
    });
    const bridge = new CmsBridge({
      url: BRIDGE_URL,
      auth: { token: 'stale', refreshUrl: REFRESH_URL },
      flushDebounceMs: 0,
      crossSessionDedupMs: 0,
      fetch: fetchFn as unknown as typeof fetch,
      storage: null,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      bridge.onDetection(makeDetection('a'));
      await bridge.flushNow();
      // No retry POST — refresh result was structurally invalid.
      expect(calls.filter((c) => c.url === BRIDGE_URL)).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('retried flag prevents loops — refresh once even if second POST also 401s', async () => {
    let refreshes = 0;
    const fetchFn = vi.fn(async (url: string) => {
      calls.push({ url, method: url === REFRESH_URL ? 'GET' : 'POST' });
      if (url === REFRESH_URL) {
        refreshes += 1;
        return new Response(JSON.stringify({ token: `new-${refreshes}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Bridge keeps rejecting — receiver is genuinely down.
      return new Response('', { status: 401 });
    });
    const bridge = new CmsBridge({
      url: BRIDGE_URL,
      auth: { token: 'stale', refreshUrl: REFRESH_URL },
      flushDebounceMs: 0,
      crossSessionDedupMs: 0,
      fetch: fetchFn as unknown as typeof fetch,
      storage: null,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      bridge.onDetection(makeDetection('a'));
      await bridge.flushNow();
      expect(refreshes).toBe(1);
      expect(calls.filter((c) => c.url === BRIDGE_URL)).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('subsequent POSTs use the refreshed token without re-fetching', async () => {
    let bridgePosts = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? {});
      calls.push({
        url,
        method: (init?.method as string) ?? (url === REFRESH_URL ? 'GET' : 'POST'),
      });
      if (url === REFRESH_URL) {
        return new Response(JSON.stringify({ token: 'fresh' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      bridgePosts += 1;
      const auth = headers.get('Authorization');
      if (bridgePosts === 1) {
        // First POST carries the stale token → 401.
        expect(auth).toBe('Bearer stale');
        return new Response('', { status: 401 });
      }
      // Retry + every subsequent POST should carry the refreshed token.
      expect(auth).toBe('Bearer fresh');
      return new Response('', { status: 200 });
    });
    const bridge = new CmsBridge({
      url: BRIDGE_URL,
      auth: { token: 'stale', refreshUrl: REFRESH_URL },
      flushDebounceMs: 0,
      crossSessionDedupMs: 0,
      fetch: fetchFn as unknown as typeof fetch,
      storage: null,
    });
    bridge.onDetection(makeDetection('a'));
    await bridge.flushNow();
    bridge.onDetection(makeDetection('b'));
    await bridge.flushNow();
    const refreshCalls = calls.filter((c) => c.url === REFRESH_URL);
    expect(refreshCalls).toHaveLength(1);
    const postCalls = calls.filter((c) => c.url === BRIDGE_URL);
    // Two flushes, one of them with a retry — three bridge POSTs total.
    expect(postCalls).toHaveLength(3);
  });
});
