/**
 * CmsBridge unit tests — REQ-9.
 *
 * Mock-fetch driven; mock `now()` for deterministic dedup-window tests.
 * Pattern lifted from `src/service-db/client.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detection } from '../recorder/types.js';
import { CmsBridge } from './bridge.js';

const URL = 'https://cms.example.test/webhook';

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    kind: 'cookie',
    identifier: '_unknown_tracker',
    firstSeen: 1_700_000_000_000,
    lastSeen: 1_700_000_000_000,
    count: 1,
    status: 'unknown',
    ...overrides,
  };
}

function okResponse(status = 200): Response {
  return new Response('', { status });
}

beforeEach(() => {
  // happy-dom keeps a stable location/href across tests; nothing to reset.
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CmsBridge — payload', () => {
  it('posts JSON with the documented schema on an unknown detection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({ url: URL, fetch: fetchMock, source: 'site-a' });

    bridge.onDetection(makeDetection({ origin: 'analytics.example.com' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe(URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.schemaVersion).toBe(1);
    expect(body.source).toBe('site-a');
    expect(body.library).toEqual({ name: 'simplecmp', version: expect.any(String) });
    expect(body.detection).toEqual({
      kind: 'cookie',
      identifier: '_unknown_tracker',
      origin: 'analytics.example.com',
      firstSeen: 1_700_000_000_000,
      lastSeen: 1_700_000_000_000,
      count: 1,
      status: 'unknown',
    });
    expect(typeof body.sentAt).toBe('string');
    expect(body.page.url).toBeDefined();
  });

  it("does not post when detection status is 'known'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({ url: URL, fetch: fetchMock });

    bridge.onDetection(makeDetection({ status: 'known', matchedService: 'analytics' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppresses detections of the bridge's own host (feedback loop prevention)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({ url: 'https://cms.example.test/webhook', fetch: fetchMock });

    // The recorder catches the bridge's own POST (and any sibling polls
    // on the same host) as `kind: 'request'` detections with origin
    // matching the bridge's host. The bridge must not re-fire for these.
    bridge.onDetection(
      makeDetection({
        kind: 'request',
        identifier: 'https://cms.example.test/webhook',
        origin: 'cms.example.test',
      })
    );
    bridge.onDetection(
      makeDetection({
        kind: 'request',
        identifier: 'https://cms.example.test/healthcheck',
        origin: 'cms.example.test',
      })
    );
    // But a detection on a different host should still fire.
    bridge.onDetection(
      makeDetection({
        kind: 'request',
        identifier: 'https://other-tracker.example.com/beacon',
        origin: 'other-tracker.example.com',
      })
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
    expect(body.detection.origin).toBe('other-tracker.example.com');
  });

  it('strips query strings and fragments from page.url and firstSeenOn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({ url: URL, fetch: fetchMock });
    // happy-dom default location is http://localhost/ — nudge it.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: 'https://www.example.de/produkte/foo?session=secret#hash' },
    });

    bridge.onDetection(makeDetection({ firstSeenOn: '/produkte/foo?session=secret' }));
    await new Promise((r) => setTimeout(r, 0));

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
    expect(body.page.url).toBe('https://www.example.de/produkte/foo');
    expect(body.detection.firstSeenOn).toBe('/produkte/foo');
  });
});

describe('CmsBridge — dedup', () => {
  it('dedupes the same kind+identifier within the TTL window', async () => {
    let now = 0;
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({
      url: URL,
      fetch: fetchMock,
      now: () => now,
      dedupTtlMs: 60_000,
    });

    bridge.onDetection(makeDetection());
    now = 30_000; // within TTL
    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fires after the TTL window expires', async () => {
    let now = 0;
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({
      url: URL,
      fetch: fetchMock,
      now: () => now,
      dedupTtlMs: 60_000,
    });

    bridge.onDetection(makeDetection());
    now = 60_001; // just past TTL
    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats different kind+identifier pairs as separate dedup entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({ url: URL, fetch: fetchMock });

    bridge.onDetection(makeDetection({ kind: 'cookie', identifier: '_a' }));
    bridge.onDetection(makeDetection({ kind: 'cookie', identifier: '_b' }));
    bridge.onDetection(makeDetection({ kind: 'script', identifier: '_a' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('CmsBridge — auth', () => {
  it('sends Authorization: Bearer when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({ url: URL, fetch: fetchMock, auth: { token: 'abc123' } });

    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));

    const init = fetchMock.mock.calls[0]?.[1];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer abc123');
  });

  it('respects custom header and scheme', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = new CmsBridge({
      url: URL,
      fetch: fetchMock,
      auth: { token: 'tok', header: 'X-CMS-Token', scheme: '' },
    });

    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));

    const init = fetchMock.mock.calls[0]?.[1];
    expect((init.headers as Headers).get('X-CMS-Token')).toBe('tok');
  });
});

describe('CmsBridge — failure modes', () => {
  it('warns once on a network failure and clears dedup so a future event retries', async () => {
    let attempt = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error('net'));
      return Promise.resolve(okResponse());
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = 0;
    const bridge = new CmsBridge({
      url: URL,
      fetch: fetchMock,
      now: () => now,
      dedupTtlMs: 60_000,
    });

    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);

    // Same item should be eligible again because the failure cleared dedup.
    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Warning gate: subsequent failures don't re-warn.
    fetchMock.mockRejectedValueOnce(new Error('net'));
    bridge.onDetection(makeDetection({ identifier: '_other' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns once on 4xx and keeps dedup (no retry)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(403));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = 0;
    const bridge = new CmsBridge({
      url: URL,
      fetch: fetchMock,
      now: () => now,
      dedupTtlMs: 60_000,
    });

    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);

    // Receiver said no — don't keep hammering them. Dedup entry is kept.
    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns once on 5xx and clears dedup so a future event retries', async () => {
    let attempt = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.resolve(okResponse(503));
      return Promise.resolve(okResponse());
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = 0;
    const bridge = new CmsBridge({
      url: URL,
      fetch: fetchMock,
      now: () => now,
      dedupTtlMs: 60_000,
    });

    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);

    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts the request after timeoutMs', async () => {
    let abortSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      abortSignal = init.signal as AbortSignal;
      return new Promise<Response>((_, reject) => {
        abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = new CmsBridge({ url: URL, fetch: fetchMock, timeoutMs: 5 });

    bridge.onDetection(makeDetection());
    await new Promise((r) => setTimeout(r, 30));

    expect(abortSignal?.aborted).toBe(true);
  });
});
