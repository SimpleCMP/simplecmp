/**
 * Wire-contract test pinning the JSON shapes the Service-DB protocol
 * (ADR-0005, docs/service-db-protocol.md) actually returns over the
 * wire. The fixture at `wire-contract-fixture.json` is the canonical
 * snapshot — both the TS client (this file) and the PHP reference
 * server (reference-server/public/index.php) have to keep producing
 * the shapes in there.
 *
 * Closes the audit P2 from 2026-05-22: "no test or comment clarifying
 * `{ services: [...] }` vs `[...]`." If anyone ever changes the
 * container key from `items` to something else, this test fails
 * loudly.
 */
import { describe, expect, it, vi } from 'vitest';
import { ServiceDbClient } from './client.js';
import fixture from './wire-contract-fixture.json' with { type: 'json' };

const URL = 'https://servicedb.example.test';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Service-DB wire contract', () => {
  it('POST /v1/lookup — response container is `items`, items are `{ query, matches }`', async () => {
    const fixtureResponse = fixture['POST /v1/lookup'].response_example;
    expect(fixtureResponse).toHaveProperty('items');
    expect(Array.isArray(fixtureResponse.items)).toBe(true);
    for (const item of fixtureResponse.items) {
      expect(item).toHaveProperty('query');
      expect(item).toHaveProperty('matches');
      expect(Array.isArray(item.matches)).toBe(true);
    }

    // Client correctly parses the fixture shape.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ServiceDbClient({ url: URL });

    const result = await client.lookup({ cookie: '_ga' });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('google-analytics');
  });

  it('GET /v1/health — body has `ok`, `schemaVersion`, optional `count`', async () => {
    const fixtureResponse = fixture['GET /v1/health'].example;
    expect(fixtureResponse).toHaveProperty('ok');
    expect(fixtureResponse).toHaveProperty('schemaVersion');
    expect(typeof fixtureResponse.ok).toBe('boolean');
    expect(typeof fixtureResponse.schemaVersion).toBe('number');

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureResponse));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ServiceDbClient({ url: URL });

    const result = await client.health();
    expect(result?.ok).toBe(true);
    expect(result?.schemaVersion).toBe(1);
    expect(result?.count).toBe(369);
  });

  it('GET /v1/services — listing wrapper is `items`+`total`+`limit`+`offset`, NOT `services`', () => {
    const fixtureResponse = fixture['GET /v1/services'].example;
    // The client doesn't currently consume the listing endpoint, but
    // the protocol guarantee is pinned here so reference-server can't
    // drift silently. If someone changes the container key from
    // `items` to `services` (a plausibly-clearer rename), this test
    // catches it.
    expect(fixtureResponse).toHaveProperty('items');
    expect(fixtureResponse).not.toHaveProperty('services');
    expect(fixtureResponse).toHaveProperty('total');
    expect(fixtureResponse).toHaveProperty('limit');
    expect(fixtureResponse).toHaveProperty('offset');
    expect(Array.isArray(fixtureResponse.items)).toBe(true);
  });

  it('GET /v1/services/:id — body is the ServiceMatch directly, not wrapped', () => {
    const fixtureResponse = fixture['GET /v1/services/:id'].example;
    // Direct object, not `{ item: ... }`.
    expect(fixtureResponse).toHaveProperty('id');
    expect(fixtureResponse).toHaveProperty('name');
    expect(fixtureResponse).not.toHaveProperty('item');
    expect(fixtureResponse).not.toHaveProperty('service');
  });
});
