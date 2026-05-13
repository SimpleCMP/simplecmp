/**
 * a11y scan of Demo 1 — banner in its initial state.
 *
 * Smallest surface: privacy/imprint links, equal-prominence accept/decline,
 * floating trigger. The default rendering an integrator hits on first
 * page load — most representative of real-world usage.
 */
import { test } from '@playwright/test';
import { scanA11y, waitForLitElement } from './helpers.js';

test('demo 1 (basic) — banner has no blocking a11y violations', async ({ page }) => {
  await page.goto('/01-basic.html');
  await waitForLitElement(page, 'simplecmp-banner');
  await scanA11y(page);
});
