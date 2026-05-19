/**
 * Do-Not-Track suppression.
 *
 * `navigator.doNotTrack === '1'` must short-circuit every POST. The
 * test patches the navigator property via `addInitScript` BEFORE the
 * bundle boots so the bridge's session-level sampling sees the flag.
 */
import { expect, test } from '@playwright/test';
import { BRIDGE_URL, captureBridgePosts, initBridge, plantCookie } from './helpers.js';

test('navigator.doNotTrack === "1" suppresses all POSTs', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true,
      get: () => '1',
    });
  });
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-dnt-on',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'dnt-on', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_dnt_cookie');
  await page.waitForTimeout(3000);

  expect(posts).toHaveLength(0);
});

test('respectDoNotTrack=false ignores the DNT signal', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true,
      get: () => '1',
    });
  });
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-dnt-off',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: {
      source: 'dnt-off',
      flushDebounceMs: 100,
      respectDoNotTrack: false,
    },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_dnt_cookie');
  await page.waitForTimeout(3000);

  expect(posts.length).toBeGreaterThanOrEqual(1);
});
