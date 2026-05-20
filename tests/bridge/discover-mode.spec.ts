/**
 * Discover-mode override (`?simplecmp_discover=1`).
 *
 * The BE-driven sitemap sweep loads each page in a hidden iframe with
 * `?simplecmp_discover=1` appended. The bridge should then ignore the
 * bandwidth controls that normally suppress repeat visits — cross-
 * session localStorage markers, sample rate, and Do-Not-Track — so the
 * sweep reliably populates the receiver's detection table.
 *
 * The visitor-facing default (no param, no flags) is unchanged.
 */
import { expect, test } from '@playwright/test';
import {
  BRIDGE_URL,
  captureBridgePosts,
  initBridge,
  plantCookie,
  waitForFlush,
} from './helpers.js';

test('?simplecmp_discover=1 bypasses cross-session localStorage dedup', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  const opts = {
    storageName: 'simplecmp-test-discover-xsession',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    // Explicit 7d setting — should be overridden to 0 by discover mode.
    cmsBridge: {
      source: 'discover-xsession',
      flushDebounceMs: 100,
      crossSessionDedupMs: 7 * 24 * 60 * 60 * 1000,
    },
    record: { silenceProductionWarning: true } as const,
  };
  await initBridge(page, opts, '?simplecmp_discover=1');
  await plantCookie(page, '_discover_xsession');
  await waitForFlush(page, 3000);

  expect(posts.length).toBe(1);
  const marker = await page.evaluate(() =>
    localStorage.getItem('simplecmp-reported:discover-xsession:cookie:_discover_xsession')
  );
  expect(marker).toBeNull();

  // Reload with the same discover param → re-POSTs because the marker
  // was never written.
  await initBridge(page, opts, '?simplecmp_discover=1');
  await plantCookie(page, '_discover_xsession');
  await waitForFlush(page, 3000);

  expect(posts.length).toBe(2);
});

test('?simplecmp_discover=1 ignores navigator.doNotTrack', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
  });
  const posts = await captureBridgePosts(page);
  await initBridge(
    page,
    {
      storageName: 'simplecmp-test-discover-dnt',
      services: [],
      cmsBridgeUrl: BRIDGE_URL,
      cmsBridge: { source: 'discover-dnt', flushDebounceMs: 100 },
      record: { silenceProductionWarning: true },
    },
    '?simplecmp_discover=1'
  );
  await plantCookie(page, '_discover_dnt');
  await waitForFlush(page, 3000);

  // Without discover mode, DNT would suppress the POST. The default
  // dnt.spec.ts test covers that path.
  expect(posts.length).toBe(1);
});

test('discover param has no effect when omitted (visitor default unchanged)', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  const opts = {
    storageName: 'simplecmp-test-discover-control',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'discover-control', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true } as const,
  };
  await initBridge(page, opts);
  await plantCookie(page, '_discover_control');
  await waitForFlush(page, 3000);

  expect(posts.length).toBe(1);
  const marker = await page.evaluate(() =>
    localStorage.getItem('simplecmp-reported:discover-control:cookie:_discover_control')
  );
  // Without the discover param, cross-session marker is written as usual.
  expect(marker).not.toBeNull();
});
