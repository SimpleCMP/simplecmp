/**
 * Bridge payload shape — schema v2.
 *
 * Locks in the wire contract: batched `detections[]` array, both
 * `status:'known'` and `status:'unknown'` reach the receiver,
 * `matchedService` is present on known detections.
 */
import { expect, test } from '@playwright/test';
import {
  BRIDGE_URL,
  captureBridgePosts,
  initBridge,
  plantCookie,
  waitForFlush,
} from './helpers.js';

test('POSTs schema v2 with detections[] array on flush', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-payload-shape',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'test-shape', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_payload_shape_unknown');
  await waitForFlush(page, 3000);

  expect(posts.length).toBeGreaterThanOrEqual(1);
  const body = posts[0]?.body as {
    schemaVersion: number;
    detections: Array<{ kind: string; identifier: string; status: string }>;
  };
  expect(body.schemaVersion).toBe(2);
  expect(Array.isArray(body.detections)).toBe(true);
  expect(body.detections.length).toBeGreaterThanOrEqual(1);
  const planted = body.detections.find((d) => d.identifier === '_payload_shape_unknown');
  expect(planted?.kind).toBe('cookie');
  expect(planted?.status).toBe('unknown');
});

test('POSTs status:known detections with matchedService when local services match', async ({
  page,
}) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-known',
    // Define a local service that matches our planted cookie so the
    // local classifier returns `known` immediately — no Service-DB
    // round-trip needed.
    services: [
      {
        name: 'fixture-stripe',
        purposes: ['payment'],
        cookies: ['__test_known_cookie'],
      },
    ],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'test-known', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '__test_known_cookie');
  await waitForFlush(page, 3000);

  expect(posts.length).toBeGreaterThanOrEqual(1);
  const body = posts[0]?.body as {
    detections: Array<{ identifier: string; status: string; matchedService?: string }>;
  };
  const known = body.detections.find((d) => d.identifier === '__test_known_cookie');
  expect(known?.status).toBe('known');
  expect(known?.matchedService).toBe('fixture-stripe');
});

test('emits envelope fields: source, sentAt, page.url, library', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-envelope',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'test-envelope', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_envelope_check');
  await waitForFlush(page, 3000);

  const body = posts[0]?.body as {
    source: string;
    sentAt: string;
    page: { url: string };
    library: { name: string; version: string };
  };
  expect(body.source).toBe('test-envelope');
  expect(body.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(body.page.url).toContain('_test-bridge.html');
  expect(body.library.name).toBe('simplecmp');
  expect(typeof body.library.version).toBe('string');
});
