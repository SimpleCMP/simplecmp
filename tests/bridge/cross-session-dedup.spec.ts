/**
 * Cross-session dedup via `localStorage` markers.
 *
 * Once a `(source, kind, identifier)` POST has succeeded, the bridge
 * writes `simplecmp-reported:${source}:${kind}:${identifier}` to
 * localStorage with the current timestamp. Subsequent sessions
 * (reloads, new tabs in the same origin) skip the POST while the
 * marker is fresh.
 */
import { expect, test } from '@playwright/test';
import {
  BRIDGE_URL,
  captureBridgePosts,
  initBridge,
  plantCookie,
  waitForFlush,
} from './helpers.js';

test('first POST writes the marker, reload skips re-POST', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-xsession-first',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'xsession', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true },
  });
  await plantCookie(page, '_xsession_cookie');
  await waitForFlush(page, 3000);

  expect(posts.length).toBe(1);
  const marker = await page.evaluate(() =>
    localStorage.getItem('simplecmp-reported:xsession:cookie:_xsession_cookie')
  );
  expect(marker).not.toBeNull();

  // Reload — same cookie still planted, marker still in localStorage.
  await initBridge(page, {
    storageName: 'simplecmp-test-xsession-first',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'xsession', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true },
  });
  // Re-plant in case the navigation cleared the original (path-bound).
  await plantCookie(page, '_xsession_cookie');
  await waitForFlush(page, 3000);

  // No additional POST — marker blocked the second one.
  expect(posts.length).toBe(1);
});

test('crossSessionDedupMs=0 disables the marker; reload re-POSTs', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  const opts = {
    storageName: 'simplecmp-test-xsession-off',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: {
      source: 'xsession-off',
      flushDebounceMs: 100,
      crossSessionDedupMs: 0,
    },
    record: { silenceProductionWarning: true } as const,
  };
  await initBridge(page, opts);
  await plantCookie(page, '_xsession_off');
  await waitForFlush(page, 3000);

  expect(posts.length).toBe(1);
  const marker = await page.evaluate(() =>
    localStorage.getItem('simplecmp-reported:xsession-off:cookie:_xsession_off')
  );
  // crossSessionDedupMs=0 means marker is never written.
  expect(marker).toBeNull();

  await initBridge(page, opts);
  await plantCookie(page, '_xsession_off');
  await waitForFlush(page, 3000);

  // With cross-session dedup off, the second visit also POSTs.
  expect(posts.length).toBe(2);
});
