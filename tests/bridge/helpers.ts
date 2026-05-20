/**
 * Shared helpers for the CMS bridge Playwright suite.
 *
 * Each test uses the `/_test-bridge.html` fixture which loads the
 * bundle WITHOUT calling `init()` — tests drive the bridge with
 * per-test config via `page.evaluate(() => SimpleCMP.init({...}))`.
 *
 * Receiver-side is mocked via Playwright's `page.route()`. The mock
 * captures POST bodies into a shared array the test inspects.
 */
import type { Page, Route } from '@playwright/test';

export const FIXTURE_PATH = '/_test-bridge.html';
export const BRIDGE_URL = 'https://bridge.test/webhook';

export interface CapturedPost {
  url: string;
  body: unknown;
  /** Was the request sent via sendBeacon (Content-Type lacks JSON header)? */
  beacon: boolean;
}

/**
 * Mount a `page.route()` handler that intercepts every POST to the
 * bridge URL and stashes the body. The handler returns a 200 by
 * default; tests can override via `respond`.
 */
export async function captureBridgePosts(
  page: Page,
  options: { respond?: (route: Route) => Promise<void> } = {}
): Promise<CapturedPost[]> {
  const posts: CapturedPost[] = [];
  await page.route(BRIDGE_URL, async (route) => {
    const request = route.request();
    let body: unknown = null;
    try {
      body = JSON.parse(request.postData() ?? '');
    } catch {
      body = request.postData();
    }
    const contentType = request.headers()['content-type'] ?? '';
    posts.push({
      url: request.url(),
      body,
      beacon: !contentType.includes('application/json'),
    });
    if (options.respond) {
      await options.respond(route);
      return;
    }
    await route.fulfill({ status: 200, body: '' });
  });
  return posts;
}

/**
 * Type-erased shim of the bundle's init shape, scoped to what we
 * exercise from tests. The real type lives in `src/index.ts` but
 * pulling it into the Playwright runtime requires cross-context
 * imports we don't want here.
 */
interface TestInitOptions {
  storageName?: string;
  services?: unknown[];
  cmsBridgeUrl: string;
  cmsBridge?: {
    source?: string;
    dedupTtlMs?: number;
    crossSessionDedupMs?: number;
    flushDebounceMs?: number;
    maxBatchSize?: number;
    sampleRate?: number;
    respectDoNotTrack?: boolean;
  };
  record?: boolean | { silenceProductionWarning?: boolean };
}

/**
 * Mount the fixture and call `SimpleCMP.init({...})`. Returns once the
 * recorder is running so subsequent `document.cookie` writes are seen.
 *
 * `search` lets a test load the fixture with an additional query string
 * (e.g. `?simplecmp_discover=1`) so per-request behaviour gated on
 * `window.location.search` can be exercised.
 */
export async function initBridge(page: Page, opts: TestInitOptions, search = ''): Promise<void> {
  await page.goto(`${FIXTURE_PATH}${search}`);
  await page.evaluate(
    (options) => {
      type GlobalShape = { SimpleCMP: { init(o: unknown): void } };
      const g = window as unknown as GlobalShape;
      g.SimpleCMP.init(options);
    },
    opts as unknown as Record<string, unknown>
  );
}

/** Plant a cookie via document.cookie. Returns once the assignment landed. */
export async function plantCookie(page: Page, name: string, value = '1'): Promise<void> {
  await page.evaluate(
    ([n, v]) => {
      document.cookie = `${n}=${v}; path=/`;
    },
    [name, value] as const
  );
}

/**
 * Wait for the bridge's debounce timer to flush the in-flight batch.
 *
 * Cookie polling is 1000ms by default; combined with the smallest
 * debounce we use in tests (100ms) and Chromium's event-loop slack,
 * 3000ms is the minimum that's not flaky on a loaded test runner.
 */
export async function waitForFlush(page: Page, ms = 3000): Promise<void> {
  await page.waitForTimeout(ms);
}
