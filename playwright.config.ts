import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration — used by:
 * - `tests/a11y/` (REQ-6) — axe-core scans against the demo pages.
 * - `tests/bridge/` — bridge wire-contract tests (schema v2, batching,
 *   localStorage dedup, DNT, pagehide → sendBeacon) running in a real
 *   browser. Receiver-side is mocked via `page.route()`.
 *
 * Vitest (with happy-dom) remains the runner for the regular test
 * suite. Playwright runs the cases that need a real browser: axe-core
 * (computed styles + focus order), the bridge's lifecycle hooks
 * (`pagehide`, `navigator.sendBeacon`), and localStorage persistence
 * across navigations.
 *
 * Chromium only — same rationale as the a11y suite.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['a11y/**/*.spec.ts', 'bridge/**/*.spec.ts'],
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Boot the demo server for tests. The demo's recorder fires console.info
  // logs that flood the runner log — that's why the static-server start is
  // explicit here rather than relying on the developer to start it
  // manually. `--no-backend` and `--no-receiver` skip the ddev / Phase-4
  // child processes; the a11y suite scans demos 1/4/5/6, none of which
  // need either backend.
  webServer: {
    command: 'node demos/serve.mjs --no-backend --no-receiver',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
