/**
 * CmsBridge unit tests — REQ-9.
 *
 * Batched POSTs, cross-session dedup (localStorage), DNT skip, sample
 * rate, sendBeacon on pagehide. Mocks: fetch, navigator subset, storage
 * (in-memory map), Date.now (deterministic dedup-window tests).
 *
 * Most tests pass `flushDebounceMs: 0` and either call `flushNow()` or
 * await a microtask so the debounce timer fires synchronously.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Detection } from '../recorder/types.js';
import { CmsBridge } from './bridge.js';
import type { CmsBridgeOptions } from './types.js';

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

/** In-memory Storage stub. */
function memStorage(): NonNullable<CmsBridgeOptions['storage']> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function bridgeWith(opts: Partial<CmsBridgeOptions> & { fetch: typeof fetch }): CmsBridge {
  return new CmsBridge({
    url: URL,
    flushDebounceMs: 0,
    storage: opts.storage ?? memStorage(),
    navigator: opts.navigator ?? {},
    ...opts,
  });
}

async function tick(): Promise<void> {
  // Two microtasks: one for the debounced setTimeout(fn, 0), one for the
  // awaited fetch inside _flush.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CmsBridge — payload (schema v2, batched)', () => {
  it('emits schemaVersion 2 with a detections[] array on flush', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, source: 'site-a' });

    bridge.onDetection(makeDetection({ origin: 'analytics.example.com' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(init.body as string);
    expect(body.schemaVersion).toBe(2);
    expect(body.source).toBe('site-a');
    expect(body.library).toEqual({ name: 'simplecmp', version: expect.any(String) });
    expect(body.detections).toEqual([
      {
        kind: 'cookie',
        identifier: '_unknown_tracker',
        origin: 'analytics.example.com',
        firstSeen: 1_700_000_000_000,
        lastSeen: 1_700_000_000_000,
        count: 1,
        status: 'unknown',
      },
    ]);
  });

  it('forwards `known` detections too (no longer unknown-only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock });

    bridge.onDetection(
      makeDetection({ status: 'known', matchedService: 'google-analytics', identifier: '_ga' })
    );
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
    expect(body.detections[0]).toMatchObject({
      identifier: '_ga',
      status: 'known',
      matchedService: 'google-analytics',
    });
  });

  it("suppresses detections of the bridge's own host (feedback loop prevention)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock });

    bridge.onDetection(makeDetection({ kind: 'request', origin: 'cms.example.test' }));
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('CmsBridge — batching', () => {
  it('batches multiple detections from the same debounce window into one POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    bridge.onDetection(makeDetection({ identifier: 'b' }));
    bridge.onDetection(makeDetection({ identifier: 'c' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
    expect(body.detections.map((d: { identifier: string }) => d.identifier)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('force-flushes when the batch hits maxBatchSize without waiting for the debounce', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      flushDebounceMs: 10_000, // long debounce — must NOT be what triggers flush
      maxBatchSize: 2,
    });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    bridge.onDetection(makeDetection({ identifier: 'b' }));
    // No tick needed — the second detection trips the size cap synchronously.
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
    expect(body.detections).toHaveLength(2);
  });

  it('flushNow() drains the queue on demand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, flushDebounceMs: 60_000 });

    bridge.onDetection(makeDetection({ identifier: 'x' }));
    await bridge.flushNow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CmsBridge — in-memory dedup', () => {
  it('does not re-send the same key within the TTL window', async () => {
    let now = 1_700_000_000_000;
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, now: () => now, dedupTtlMs: 60_000 });

    bridge.onDetection(makeDetection({ identifier: 'dup' }));
    await tick();
    now += 1_000;
    bridge.onDetection(makeDetection({ identifier: 'dup' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-sends the same key once the TTL window has elapsed', async () => {
    // Disable cross-session dedup so this test exercises just the
    // in-memory TTL layer — otherwise the localStorage marker (7d TTL
    // by default) blocks the retry independently.
    let now = 1_700_000_000_000;
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      dedupTtlMs: 60_000,
      storage: null,
    });

    bridge.onDetection(makeDetection({ identifier: 'dup' }));
    await tick();
    now += 61_000;
    bridge.onDetection(makeDetection({ identifier: 'dup' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('CmsBridge — cross-session dedup (localStorage)', () => {
  it('skips a detection whose marker is fresh in storage', async () => {
    const storage = memStorage();
    // Pre-seed the marker, value = recent.
    const now = 1_700_000_000_000;
    storage.setItem('simplecmp-reported:default:cookie:_ga', String(now - 1000));

    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage,
      crossSessionDedupMs: 7 * 24 * 60 * 60 * 1000,
    });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes the marker after a successful flush', async () => {
    const storage = memStorage();
    const now = 1_700_000_000_000;
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage,
    });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    // Marker now carries the report generation: `<gen>.<ts>` (gen 0 by default).
    expect(storage.getItem('simplecmp-reported:default:cookie:_ga')).toBe(`0.${now}`);
  });

  it('treats an expired marker as a miss + clears it', async () => {
    const storage = memStorage();
    const now = 1_700_000_000_000;
    storage.setItem(
      'simplecmp-reported:default:cookie:_ga',
      String(now - 8 * 24 * 60 * 60 * 1000) // 8 days old, beyond default 7d TTL
    );

    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, now: () => now, storage });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('crossSessionDedupMs=0 disables the cross-session layer', async () => {
    const storage = memStorage();
    const now = 1_700_000_000_000;
    storage.setItem('simplecmp-reported:default:cookie:_ga', String(now - 1000));

    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage,
      crossSessionDedupMs: 0,
    });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('storage = null disables the cross-session layer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, storage: null });

    bridge.onDetection(makeDetection());
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CmsBridge — report generation (server-side reset / re-detect)', () => {
  it('re-POSTs when the marker generation is older than the current generation', async () => {
    // Admin deleted the detection → server bumped generation to 1. A fresh
    // marker written under gen 0 must NOT suppress the re-report.
    const storage = memStorage();
    const now = 1_700_000_000_000;
    storage.setItem('simplecmp-reported:default:cookie:_ga', `0.${now - 1000}`);

    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage,
      crossSessionDedupMs: 7 * 24 * 60 * 60 * 1000,
      reportGeneration: 1,
    });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Re-written under the current generation.
    expect(storage.getItem('simplecmp-reported:default:cookie:_ga')).toBe(`1.${now}`);
  });

  it('still skips when the marker generation matches the current generation', async () => {
    const storage = memStorage();
    const now = 1_700_000_000_000;
    storage.setItem('simplecmp-reported:default:cookie:_ga', `1.${now - 1000}`);

    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage,
      crossSessionDedupMs: 7 * 24 * 60 * 60 * 1000,
      reportGeneration: 1,
    });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalidates a legacy (generation-less) marker once the generation is bumped', async () => {
    const storage = memStorage();
    const now = 1_700_000_000_000;
    // Pre-generation marker: a bare timestamp, reads as generation 0.
    storage.setItem('simplecmp-reported:default:cookie:_ga', String(now - 1000));

    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage,
      crossSessionDedupMs: 7 * 24 * 60 * 60 * 1000,
      reportGeneration: 1,
    });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a legacy marker is still honoured when the generation is unchanged (0)', async () => {
    const storage = memStorage();
    const now = 1_700_000_000_000;
    storage.setItem('simplecmp-reported:default:cookie:_ga', String(now - 1000));

    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage,
      crossSessionDedupMs: 7 * 24 * 60 * 60 * 1000,
      // reportGeneration defaults to 0 — no reset.
    });

    bridge.onDetection(makeDetection({ identifier: '_ga' }));
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('CmsBridge — privacy + sampling', () => {
  it('skips all POSTs when navigator.doNotTrack === "1"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, navigator: { doNotTrack: '1' } });

    bridge.onDetection(makeDetection());
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respectDoNotTrack=false ignores the DNT signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      navigator: { doNotTrack: '1' },
      respectDoNotTrack: false,
    });

    bridge.onDetection(makeDetection());
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sampleRate=0 puts the session out of scope (no POSTs)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, sampleRate: 0 });

    bridge.onDetection(makeDetection());
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sampleRate=1 (default) always posts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({ fetch: fetchMock, sampleRate: 1 });

    bridge.onDetection(makeDetection());
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CmsBridge — failure handling', () => {
  it('clears the in-memory dedup on 5xx so a later event retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValue(okResponse());
    let now = 1_700_000_000_000;
    const bridge = bridgeWith({
      fetch: fetchMock,
      now: () => now,
      storage: null, // simplify: only test in-memory clear
    });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    await tick();
    now += 1_000;
    bridge.onDetection(makeDetection({ identifier: 'a' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the dedup on 4xx (receiver said no, do not hammer)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(403));
    let now = 1_700_000_000_000;
    const bridge = bridgeWith({ fetch: fetchMock, now: () => now, storage: null });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    await tick();
    now += 1_000;
    bridge.onDetection(makeDetection({ identifier: 'a' }));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns to console only once per error category', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(500));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 1_700_000_000_000;
    const bridge = bridgeWith({ fetch: fetchMock, now: () => now, storage: null });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    await tick();
    now += 10_000;
    bridge.onDetection(makeDetection({ identifier: 'b' }));
    await tick();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('CmsBridge — pagehide flush via sendBeacon', () => {
  it('calls navigator.sendBeacon when pagehide fires with pending detections', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      flushDebounceMs: 60_000,
      navigator: { sendBeacon },
    });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    // Don't await — keep the detection in pending.
    dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [calledUrl, blob] = sendBeacon.mock.calls[0] ?? [];
    expect(calledUrl).toBe(URL);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('marks cross-session dedup after a successful beacon send', async () => {
    const storage = memStorage();
    const sendBeacon = vi.fn().mockReturnValue(true);
    const bridge = bridgeWith({
      fetch: vi.fn().mockResolvedValue(okResponse()),
      flushDebounceMs: 60_000,
      navigator: { sendBeacon },
      storage,
    });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    dispatchEvent(new Event('pagehide'));

    expect(storage.getItem('simplecmp-reported:default:cookie:a')).not.toBeNull();
  });

  it('falls back to keepalive fetch when sendBeacon fails (returns false)', async () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const bridge = bridgeWith({
      fetch: fetchMock,
      flushDebounceMs: 60_000,
      navigator: { sendBeacon },
    });

    bridge.onDetection(makeDetection({ identifier: 'a' }));
    dispatchEvent(new Event('pagehide'));
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1].keepalive).toBe(true);
  });
});
