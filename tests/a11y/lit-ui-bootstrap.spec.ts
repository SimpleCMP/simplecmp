/**
 * a11y scan of Demo 5 — Lit UI under the Bootstrap theme adapter.
 *
 * Same components as Demo 4 but with `--simplecmp-*` tokens resolved
 * against `--bs-*`. Bootstrap's primary palette differs from our
 * default — this guards against a theme adapter accidentally producing
 * worse contrast or breaking focus rings.
 */
import { test } from '@playwright/test';
import { scanA11y, waitForLitElement } from './helpers.js';

test('demo 5 (lit-ui + bootstrap) — banner has no blocking violations', async ({ page }) => {
  await page.goto('/05-lit-bootstrap.html');
  await waitForLitElement(page, 'simplecmp-banner');
  await scanA11y(page);
});
