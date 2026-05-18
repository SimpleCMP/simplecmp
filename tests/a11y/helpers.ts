/**
 * Shared helpers for the axe-core a11y suite (REQ-6).
 *
 * Wraps `@axe-core/playwright` with project-wide configuration:
 * - WCAG 2.1 AA ruleset
 * - Fail on `serious` / `critical`; surface `moderate` / `minor` as
 *   non-blocking warnings.
 * - Document brand-decision exception for the `green1` button color
 *   (3.5:1 contrast — passes UI 3:1, fails text 4.5:1). Tracked in
 *   `docs/accessibility.md`.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

export interface ScanOptions {
  /** Optional CSS selector to scope the scan. Defaults to entire page. */
  include?: string;
  /**
   * When `true`, also fail on `moderate` violations. Default is to fail
   * only on `serious` / `critical` so the suite isn't held hostage by
   * lower-severity false positives.
   */
  strict?: boolean;
}

/**
 * Run axe against the given page and assert no blocking violations.
 *
 * Note: rule disables here are documented brand decisions, not bugs.
 * Adding to this list requires a paper trail in `docs/accessibility.md`.
 */
export async function scanA11y(page: Page, options: ScanOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);

  if (options.include) {
    builder = builder.include(options.include);
  }

  const results = await builder.analyze();

  const blocking = results.violations.filter((v) => {
    if (options.strict) return v.impact !== 'minor';
    return v.impact === 'serious' || v.impact === 'critical';
  });

  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `  [${v.impact}] ${v.id}: ${v.description}\n    nodes: ${v.nodes.length}`)
      .join('\n');
    throw new Error(`axe-core found ${blocking.length} blocking violation(s):\n${summary}`);
  }

  // Surface non-blocking violations so we can see them in the log
  // without failing the run.
  const nonBlocking = results.violations.filter((v) => !blocking.includes(v));
  if (nonBlocking.length > 0) {
    console.log(
      `[a11y] ${nonBlocking.length} non-blocking violation(s):`,
      nonBlocking.map((v) => `${v.impact}/${v.id}`).join(', ')
    );
  }
  // Anchor a pass so reporters show the assertion count.
  expect(blocking).toHaveLength(0);
}

/**
 * Wait for a SimpleCMP custom element to mount and render its first paint.
 * Lit's `updateComplete` resolves after the first render cycle; we await
 * it to make sure the element's shadow DOM is populated before axe scans.
 */
export async function waitForLitElement(page: Page, selector: string): Promise<void> {
  // `state: 'attached'` rather than the default 'visible': the visible
  // content of our Lit components lives in shadow DOM, and Playwright's
  // visibility heuristic treats shadow-host elements as hidden even when
  // the user can see them.
  await page.waitForSelector(selector, { state: 'attached' });
  await page.evaluate(async (sel: string) => {
    const el = document.querySelector(sel) as
      | (Element & { updateComplete?: Promise<unknown> })
      | null;
    if (el?.updateComplete) await el.updateComplete;
  }, selector);
}
