/**
 * Bridge batching behaviour.
 *
 * Verifies that multiple detections within the debounce window are
 * collapsed into a single POST, that `maxBatchSize` force-flushes
 * early, and that `pagehide` triggers a `sendBeacon` flush (or a
 * keepalive-fetch fallback when sendBeacon isn't available).
 */
import { expect, test } from '@playwright/test';
import {
  BRIDGE_URL,
  captureBridgePosts,
  initBridge,
  plantCookie,
  waitForFlush,
} from './helpers.js';

test('multiple detections within the debounce window collapse to one POST', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-batch-coalesce',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'test-batch', flushDebounceMs: 800 },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_batch_a');
  await plantCookie(page, '_batch_b');
  await plantCookie(page, '_batch_c');
  await waitForFlush(page, 2500);

  expect(posts.length).toBe(1);
  const body = posts[0]?.body as { detections: Array<{ identifier: string }> };
  const ids = body.detections.map((d) => d.identifier);
  expect(ids).toEqual(expect.arrayContaining(['_batch_a', '_batch_b', '_batch_c']));
});

test('maxBatchSize force-flushes before the debounce timer fires', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-batch-size',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: {
      source: 'test-batch-size',
      flushDebounceMs: 10_000, // long; must NOT be what triggers the flush
      maxBatchSize: 3,
    },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_size_a');
  await plantCookie(page, '_size_b');
  await plantCookie(page, '_size_c');
  // Recorder polling adds ~1s before the detection events fire; give it
  // a beat to hit the size cap then a short window for the immediate flush.
  await page.waitForTimeout(3500);

  expect(posts.length).toBeGreaterThanOrEqual(1);
  const body = posts[0]?.body as { detections: Array<{ identifier: string }> };
  expect(body.detections.length).toBeGreaterThanOrEqual(3);
});

test('pagehide flushes the queue via the lifecycle hook', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-pagehide',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: {
      source: 'test-pagehide',
      flushDebounceMs: 60_000, // way past the test deadline — flush MUST come from pagehide
    },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_pagehide_check');
  // Let the recorder pick up the cookie + enqueue the detection.
  await page.waitForTimeout(2500);
  // No post yet — debounce is 60s.
  expect(posts.length).toBe(0);
  // Dispatch pagehide in-page so the route handler stays alive and
  // sendBeacon (or its keepalive-fetch fallback) is intercepted by
  // page.route(). Real navigation tears down the page context before
  // Playwright finishes recording the beacon, which made this flaky.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(500);

  expect(posts.length).toBeGreaterThanOrEqual(1);
  const body = posts[0]?.body as { detections: Array<{ identifier: string }> };
  const ids = body.detections.map((d) => d.identifier);
  expect(ids).toContain('_pagehide_check');
});
