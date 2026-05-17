import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassifierServiceConfig } from '../recorder/types.js';
import { ServiceDbClient } from './client.js';
import { LayeredClassifier } from './layered-classifier.js';
import type { LookupResult, ServiceMatch } from './types.js';

const URL = 'https://servicedb.example.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const localServices: ClassifierServiceConfig[] = [
  { name: 'local-analytics', cookies: ['_locally_known'] },
];

const remoteMatch: ServiceMatch = {
  id: 'google-analytics',
  name: 'Google Analytics',
  vendor: 'Google LLC',
  purposes: ['analytics'],
};

const lookupOk = (matches: ServiceMatch[]): LookupResult => ({
  items: [{ query: { cookie: 'placeholder' }, matches }],
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('LayeredClassifier', () => {
  it('returns local match immediately and never calls the DB', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupOk([remoteMatch])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const classifier = new LayeredClassifier(client, localServices);

    const result = classifier.classify({
      kind: 'cookie',
      identifier: '_locally_known',
    });

    expect(result.status).toBe('known');
    expect(result.matchedService).toBe('local-analytics');
    // Give any erroneously-scheduled DB call a tick to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns unknown synchronously then enriches via DB lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupOk([remoteMatch])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const classifier = new LayeredClassifier(client, localServices);

    const enrichments: Array<{ id: string }> = [];
    classifier.onEnrichment((raw, enrichment) => {
      enrichments.push({ id: enrichment.matchedService });
      expect(raw.identifier).toBe('_ga');
      expect(enrichment.matchedVendor).toBe('Google LLC');
      expect(enrichment.status).toBe('known');
    });

    const sync = classifier.classify({ kind: 'cookie', identifier: '_ga' });
    expect(sync.status).toBe('unknown');

    // Wait for the background lookup to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(enrichments).toEqual([{ id: 'google-analytics' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not enrich when the DB returns no match', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupOk([])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const classifier = new LayeredClassifier(client, localServices);

    let calls = 0;
    classifier.onEnrichment(() => {
      calls++;
    });

    classifier.classify({ kind: 'cookie', identifier: '_unknown' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(0);
  });

  it('does not enrich when the DB request fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const classifier = new LayeredClassifier(client, localServices);

    let calls = 0;
    classifier.onEnrichment(() => {
      calls++;
    });

    classifier.classify({ kind: 'cookie', identifier: '_ga' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(0);
  });

  it('skips the DB lookup for non-cookie detections without origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupOk([])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const classifier = new LayeredClassifier(client, localServices);

    classifier.classify({ kind: 'script', identifier: 'inline-snippet' });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes listeners via offEnrichment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lookupOk([remoteMatch])));
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const classifier = new LayeredClassifier(client, localServices);

    let calls = 0;
    const listener = () => {
      calls++;
    };
    classifier.onEnrichment(listener);
    classifier.offEnrichment(listener);

    classifier.classify({ kind: 'cookie', identifier: '_ga' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(0);
  });

  // REQ-N7: two concurrent classify() calls each produce their own pending
  // promise that only resolves with their own enrichment. Even if the
  // underlying ServiceDbClient ever coalesces calls into one HTTP request,
  // each caller's `.then(...).catch(...)` chain is independent — the
  // resolved promise the caller observes must dispatch exactly one
  // enrichment to exactly the right key.
  it('handles concurrent classify() calls with independent pending promises', async () => {
    const matchA: ServiceMatch = {
      id: 'svc-a',
      name: 'Service A',
      purposes: ['analytics'],
    };
    const matchB: ServiceMatch = {
      id: 'svc-b',
      name: 'Service B',
      purposes: ['marketing'],
    };
    // Each lookup() is its own HTTP call (`{ items: [query] }`). Mock
    // returns the matching service for whichever cookie was queried.
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        items: Array<{ cookie?: string; origin?: string }>;
      };
      const items = body.items.map((q) => {
        if (q.cookie === '_a') return { query: q, matches: [matchA] };
        if (q.cookie === '_b') return { query: q, matches: [matchB] };
        return { query: q, matches: [] };
      });
      return jsonResponse({ items });
    });
    const client = new ServiceDbClient({ url: URL, fetch: fetchMock });
    const classifier = new LayeredClassifier(client, localServices);

    const enrichments: Array<{ key: string; id: string }> = [];
    classifier.onEnrichment((raw, enrichment) => {
      enrichments.push({
        key: `${raw.kind}:${raw.identifier}`,
        id: enrichment.matchedService,
      });
    });

    const a = classifier.classify({ kind: 'cookie', identifier: '_a' });
    const b = classifier.classify({ kind: 'cookie', identifier: '_b' });

    // Both return synchronously with status: unknown + pending.
    expect(a.status).toBe('unknown');
    expect(b.status).toBe('unknown');
    expect(a.pending).toBeInstanceOf(Promise);
    expect(b.pending).toBeInstanceOf(Promise);
    expect(a.pending).not.toBe(b.pending);

    await Promise.all([a.pending, b.pending]);

    // Each enrichment dispatched exactly once, to the right key.
    expect(enrichments).toHaveLength(2);
    const byKey = new Map(enrichments.map((e) => [e.key, e.id]));
    expect(byKey.get('cookie:_a')).toBe('svc-a');
    expect(byKey.get('cookie:_b')).toBe('svc-b');
  });
});
