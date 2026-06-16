import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentLogger } from '../src/consent-log/index.js';
import {
  getOrCreateVisitorUuid,
  visitorIdStorageKey,
} from '../src/consent-log/visitor-id.js';

/**
 * Phase 2 audit-trail unit tests — the ConsentLogger watcher contract
 * (skip on no-op re-confirms, POST shape, 401-refresh-and-retry,
 * pseudonymized via the host's HMAC NOT here in the bundle) plus the
 * visitor-id helper's localStorage roundtrip.
 *
 * End-to-end DOM coverage lives in the t3bootstrap14 backend test
 * (chrome-devtools-mcp); the assertions here lock the wire contract.
 */

const URL = 'https://host.test/api/simplecmp/v1/consent-log';
const REFRESH_URL = 'https://host.test/api/simplecmp/v1/bridge-nonce?source=default';

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
  authHeader: string | null;
}

function makeLogger(opts: {
  fetchFn: typeof fetch;
  auth?: { token: string; refreshUrl?: string };
  visitorUuid?: string;
  configVersion?: string;
  location?: { hostname: string };
  navigator?: { userAgent: string };
}): ConsentLogger {
  return new ConsentLogger({
    url: URL,
    source: 'simplecmp-default',
    auth: opts.auth,
    configVersion: opts.configVersion ?? 'a'.repeat(64),
    visitorUuid: opts.visitorUuid ?? 'e8400000-1234-4abc-9def-1234567890ab',
    fetch: opts.fetchFn,
    location: opts.location ?? { hostname: 'example.com' },
    navigator: opts.navigator ?? { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0' },
  });
}

function makeSaveConsentsData(
  consents: Record<string, boolean>,
  type = 'accept',
  changes?: Record<string, boolean>,
): { changes: Record<string, boolean>; consents: Record<string, boolean>; type: string } {
  return {
    changes: changes ?? consents,
    consents,
    type,
  };
}

describe('ConsentLogger — Phase 2 audit trail', () => {
  let calls: FetchCall[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    calls = [];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.clear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('POSTs on the first saveConsents notification with the expected shape', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: (init?.method as string) ?? 'GET',
        body: init?.body as string ?? null,
        authHeader: new Headers(init?.headers ?? {}).get('Authorization'),
      });
      return new Response('{"ok":true}', { status: 200 });
    });
    const logger = makeLogger({
      fetchFn: fetchFn as unknown as typeof fetch,
      auth: { token: 'stale' },
    });
    logger.update({}, 'saveConsents', makeSaveConsentsData({ matomo: true, youtube: false }, 'partial'));
    // Let the void-Promise inside update() settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(URL);
    expect(calls[0]!.authHeader).toBe('Bearer stale');
    const body = JSON.parse(calls[0]!.body ?? '{}');
    expect(body.schemaVersion).toBe(1);
    expect(body.source).toBe('simplecmp-default');
    expect(body.versionHash).toBe('a'.repeat(64));
    expect(body.visitorUuid).toBe('e8400000-1234-4abc-9def-1234567890ab');
    expect(body.decisions).toEqual({ matomo: true, youtube: false });
    // Heterogeneous decisions → re-classified to 'partial' regardless of `type`.
    expect(body.decisionType).toBe('partial');
    expect(body.pageHost).toBe('example.com');
    expect(body.uaFamily).toBe('chrome');
  });

  it('skips notifications other than saveConsents', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const logger = makeLogger({ fetchFn: fetchFn as unknown as typeof fetch });
    logger.update({}, 'consents', { matomo: true });
    logger.update({}, 'somethingElse', { foo: 'bar' });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips no-op re-confirms (no changes) after the first confirm', async () => {
    const fetchFn = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const logger = makeLogger({ fetchFn: fetchFn as unknown as typeof fetch });
    // First confirm — changes can be empty but it's the first time
    // the visitor confirms anything, so it MUST POST.
    logger.update({}, 'saveConsents', { changes: {}, consents: { matomo: true }, type: 'script' });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Re-open modal, click Save without flipping anything — `changes`
    // empty + alreadyConfirmed → skip.
    logger.update({}, 'saveConsents', { changes: {}, consents: { matomo: true }, type: 'script' });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Genuine change → posts again.
    logger.update({}, 'saveConsents', { changes: { matomo: false }, consents: { matomo: false }, type: 'decline' });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reclassifies fully-true / fully-false consent states as accept / decline', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse((init?.body as string) ?? '{}'));
      return new Response('{"ok":true}', { status: 200 });
    });
    const logger = makeLogger({ fetchFn: fetchFn as unknown as typeof fetch });

    logger.update({}, 'saveConsents', makeSaveConsentsData({ a: true, b: true }, 'accept'));
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies[0]!.decisionType).toBe('accept');

    logger.update({}, 'saveConsents', makeSaveConsentsData({ a: false, b: false }, 'decline', { a: false, b: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies[1]!.decisionType).toBe('decline');
  });

  it('refreshes the token on 401 and retries the POST exactly once', async () => {
    let postCount = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method as string) ?? 'GET';
      calls.push({
        url,
        method,
        body: (init?.body as string) ?? null,
        authHeader: new Headers(init?.headers ?? {}).get('Authorization'),
      });
      if (url === REFRESH_URL) {
        return new Response(JSON.stringify({ token: 'fresh-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      postCount += 1;
      // First POST: stale token → 401. Second POST: 200.
      return new Response('', { status: postCount === 1 ? 401 : 200 });
    });
    const logger = makeLogger({
      fetchFn: fetchFn as unknown as typeof fetch,
      auth: { token: 'stale', refreshUrl: REFRESH_URL },
    });
    logger.update({}, 'saveConsents', makeSaveConsentsData({ matomo: true }, 'accept'));
    await new Promise((r) => setTimeout(r, 10));

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${URL}`,
      `GET ${REFRESH_URL}`,
      `POST ${URL}`,
    ]);
    // Retry POST carries the refreshed token.
    expect(calls[2]!.authHeader).toBe('Bearer fresh-token');
  });

  it('warns and stops on refresh failure (no infinite retry)', async () => {
    let postCount = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url === REFRESH_URL) {
        return new Response('', { status: 500 });
      }
      postCount += 1;
      return new Response('', { status: 401 });
    });
    const logger = makeLogger({
      fetchFn: fetchFn as unknown as typeof fetch,
      auth: { token: 'stale', refreshUrl: REFRESH_URL },
    });
    logger.update({}, 'saveConsents', makeSaveConsentsData({ matomo: true }, 'accept'));
    await new Promise((r) => setTimeout(r, 10));

    // 1 POST (401) + 1 refresh (500) + no retry.
    expect(postCount).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('getOrCreateVisitorUuid', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates a fresh UUID v4 on first call', () => {
    const uuid = getOrCreateVisitorUuid('simplecmp-test');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('persists the UUID in localStorage under <storageName>-visitor-uuid', () => {
    const uuid = getOrCreateVisitorUuid('simplecmp-mysite');
    expect(localStorage.getItem('simplecmp-mysite-visitor-uuid')).toBe(uuid);
  });

  it('returns the same UUID on subsequent calls with the same storage name', () => {
    const a = getOrCreateVisitorUuid('simplecmp-test');
    const b = getOrCreateVisitorUuid('simplecmp-test');
    expect(a).toBe(b);
  });

  it('issues distinct UUIDs across storage names', () => {
    const a = getOrCreateVisitorUuid('simplecmp-site-a');
    const b = getOrCreateVisitorUuid('simplecmp-site-b');
    expect(a).not.toBe(b);
  });

  it('exposes the storage-key derivation for DSGVO-Auskunft workflows', () => {
    expect(visitorIdStorageKey('simplecmp-default')).toBe('simplecmp-default-visitor-uuid');
  });

  it('regenerates when stored value is malformed', () => {
    localStorage.setItem('simplecmp-test-visitor-uuid', 'not-a-uuid');
    const uuid = getOrCreateVisitorUuid('simplecmp-test');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(localStorage.getItem('simplecmp-test-visitor-uuid')).toBe(uuid);
  });
});
