/**
 * a11y scan of Demo 4 — Lit UI default theme, banner + opened modal.
 *
 * Modal scanning is the higher-value path: focus trap, dialog ARIA,
 * service toggles are all only present when the modal is opened.
 */
import { test } from '@playwright/test';
import { scanA11y, waitForLitElement } from './helpers.js';

test('demo 4 (lit-ui default) — banner closed has no blocking violations', async ({ page }) => {
  await page.goto('/04-lit-ui.html');
  await waitForLitElement(page, 'simplecmp-banner');
  await scanA11y(page);
});

test('demo 4 (lit-ui default) — modal opened has no blocking violations', async ({ page }) => {
  await page.goto('/04-lit-ui.html');
  await waitForLitElement(page, 'simplecmp-banner');
  // Demo 4 exposes the init handle as `window.simplecmpHandle` (or
  // similar) — the cleanest path to open the modal in tests is to invoke
  // the global `SimpleCMP.show()` helper which dispatches via the active
  // handle.
  await page.evaluate(() => {
    const SimpleCMP = (window as unknown as { SimpleCMP: { show(): void } }).SimpleCMP;
    SimpleCMP.show();
  });
  await waitForLitElement(page, 'simplecmp-modal');
  // Wait one tick for the native <dialog> open animation to settle.
  await page.waitForTimeout(50);
  await scanA11y(page);
});
