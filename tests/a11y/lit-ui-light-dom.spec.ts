/**
 * a11y scan of Demo 6 — Lit UI in light-DOM mode.
 *
 * Shadow-DOM tests can't catch CSS-leak issues — host CSS doesn't reach
 * the shadow root. Light-DOM mode renders everything into the host
 * document, so host `default.css` is the only thing styling the
 * components. If a future style change drops focus indication or
 * contrast in this path, this is the scan that catches it.
 */
import { test } from '@playwright/test';
import { scanA11y, waitForLitElement } from './helpers.js';

test('demo 6 (lit-ui light-DOM) — banner has no blocking violations', async ({ page }) => {
  await page.goto('/06-lit-light-dom.html');
  await waitForLitElement(page, 'simplecmp-banner');
  await scanA11y(page);
});
