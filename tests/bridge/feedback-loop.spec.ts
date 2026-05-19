/**
 * Feedback-loop suppression.
 *
 * The recorder's PerformanceObserver watches every outgoing network
 * request, including the bridge's own POST. Without explicit
 * suppression, every POST would itself be classified as an unknown
 * `request` detection and re-fire the bridge for the bridge URL.
 *
 * The bridge holds its own host (`host` derived from `cmsBridgeUrl`)
 * and short-circuits any detection whose `origin` matches.
 */
import { expect, test } from '@playwright/test';
import { BRIDGE_URL, captureBridgePosts, initBridge, plantCookie, waitForFlush } from './helpers.js';

test('detection for the bridge URL itself is suppressed', async ({ page }) => {
  const posts = await captureBridgePosts(page);
  await initBridge(page, {
    storageName: 'simplecmp-test-feedback-loop',
    services: [],
    cmsBridgeUrl: BRIDGE_URL,
    cmsBridge: { source: 'feedback', flushDebounceMs: 100 },
    record: { silenceProductionWarning: true },
  });
  // Plant a normal cookie so the bridge has SOMETHING to POST; the
  // mocked receiver will fire a synthetic-fetch which the recorder's
  // PerformanceObserver would catch — but the bridge filters those
  // out at `onDetection` time.
  await plantCookie(page, '_feedback_seed');
  await waitForFlush(page, 3000);

  // The body of the captured POST(s) must never contain a detection
  // whose identifier looks like the bridge URL or whose origin matches
  // bridge.test.
  for (const post of posts) {
    const body = post.body as { detections: Array<{ identifier: string; origin?: string }> };
    for (const d of body.detections) {
      expect(d.identifier).not.toContain('bridge.test');
      expect(d.origin ?? '').not.toBe('bridge.test');
    }
  }
});
