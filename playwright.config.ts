import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration — used ONLY by the a11y suite (REQ-6).
 *
 * Vitest (with happy-dom) remains the runner for the regular test suite;
 * Playwright exists because axe-core needs a real browser to evaluate
 * computed styles, focus order, and ARIA attribute resolution — none of
 * which happy-dom provides faithfully.
 *
 * Chromium only. axe-core's ruleset is browser-consistent for the things
 * we care about; running across three browsers would triple CI time for
 * essentially no signal.
 */
export default defineConfig({
  testDir: './tests/a11y',
  testMatch: '**/*.spec.ts',
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
