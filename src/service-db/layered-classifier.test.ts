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
});
