/**
 * DOM-level compliance audit.
 *
 * Complements `src/audit/index.ts` (which grades a config) by running
 * against a mounted banner DOM. Some compliance checks are only
 * meaningful once the banner is rendered:
 *
 *   - WCAG contrast — needs computed `color` / `background-color` of
 *     each visible button.
 *   - Equal-prominence styling — needs to compare the computed style
 *     of every Accept / Decline / Configure button against each other,
 *     not just trust that the bundle's CSS does the right thing.
 *   - Element-type check — confirms reject is an actual `<button>`,
 *     not a styled `<a>` (a Skipping dark-pattern per EDPB 03/2022).
 *
 * Like the config audit, this module is pure (no side effects, no
 * network) and returns the same `AuditResult` shape so integrators
 * can merge DOM and config findings into a single view.
 *
 * Walks shadow roots — SimpleCMP renders into Shadow DOM by default,
 * so `document.querySelectorAll('button')` from light DOM finds
 * nothing. The audit explicitly steps into each `simplecmp-banner`'s
 * shadow root and reads computed styles from there.
 */

import type { AuditResult } from './index.js';

/**
 * Run all DOM-level checks against a document (or shadow root) and
 * return per-check findings. Defaults to the global `document` so a
 * dev-mode caller can run `simplecmp.auditDom()` with no arguments
 * from the console.
 */
export function auditDom(root: Document | ShadowRoot = document): AuditResult[] {
  const buttons = collectBannerButtons(root);
  return [
    checkButtonsAreButtons(buttons),
    checkButtonsEqualStyling(buttons),
    checkButtonsWcagContrast(buttons),
    // Appended (not reordered) so server-side mirrors that match by index
    // keep working (see src/audit/index.ts).
    checkAccessibleNames(root),
  ];
}

/**
 * Name contributed by `aria-label` / `aria-labelledby` (resolved within the
 * same root). A `region` derives its name *only* from these — its contents do
 * not contribute — so this is the correct name source for the banner landmark.
 * Not the full ARIA accname algorithm; just enough to catch a *missing* name
 * (WCAG 4.1.2 / 2.4.6 / region-name).
 */
function ariaName(el: Element, root: ParentNode): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby !== null && labelledby.trim() !== '') {
    return labelledby
      .split(/\s+/)
      .map((id) => root.querySelector(`[id="${id}"]`)?.textContent?.trim() ?? '')
      .filter((t) => t !== '')
      .join(' ')
      .trim();
  }
  return '';
}

/**
 * Accessible name for a control (e.g. a `<button>`): an explicit aria name, or
 * — unlike a region — its visible text content, which buttons name themselves
 * with.
 */
function controlName(el: Element, root: ParentNode): string {
  const aria = ariaName(el, root);
  if (aria !== '') return aria;
  return (el.textContent ?? '').trim();
}

/**
 * REQ-N11: the banner is a labelled `region` and every action is a labelled
 * control. A missing accessible name means screen-reader users can't identify
 * the consent UI or its buttons — and consent that can't be perceived isn't
 * valid consent.
 */
function checkAccessibleNames(root: Document | ShadowRoot): AuditResult {
  const id = 'dom-accessible-names';
  const section = '2.2';
  const title = 'Banner region and actions have accessible names';
  const banners = Array.from(root.querySelectorAll('simplecmp-banner'));
  if (banners.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail: 'No banner is currently mounted — DOM check skipped.',
      passed: true,
    };
  }
  const missing: string[] = [];
  for (const banner of banners) {
    const shadow = (banner as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow === null) continue;
    const region = shadow.querySelector('.cn-body');
    if (region !== null && ariaName(region, shadow) === '') {
      missing.push('the banner region has no accessible name (add aria-label or aria-labelledby)');
    }
    const actions = Array.from(shadow.querySelectorAll('.cn-buttons > *'));
    actions.forEach((el, idx) => {
      if (controlName(el, shadow) === '') {
        missing.push(`banner action ${idx + 1} has no accessible name`);
      }
    });
  }
  if (missing.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail: 'The banner region and every action button expose an accessible name.',
      passed: true,
    };
  }
  return {
    id,
    section,
    severity: 'critical',
    title,
    detail: `WCAG 4.1.2 / 2.4.6: assistive tech can't name part of the consent UI, so screen-reader users can't identify or operate it — consent that can't be perceived isn't valid. Unnamed:\n  - ${missing.join('\n  - ')}`,
    passed: false,
  };
}

/**
 * Find every visible action button across all `simplecmp-banner`
 * instances in the document. Returns an empty list when no banner
 * is currently mounted — checks then surface that explicitly rather
 * than asserting against nothing.
 */
function collectBannerButtons(root: Document | ShadowRoot): HTMLElement[] {
  const banners = root.querySelectorAll('simplecmp-banner');
  const out: HTMLElement[] = [];
  for (const banner of Array.from(banners)) {
    const shadow = (banner as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow === null) continue;
    // The render order is Configure | Decline | Accept (or a subset
    // depending on `config.layout` / hide flags). All are HTMLButtonElements
    // when the bundle is healthy; anything else is a finding for
    // `checkButtonsAreButtons` to catch.
    const elements = shadow.querySelectorAll('.cn-buttons > *');
    for (const el of Array.from(elements)) {
      if (el instanceof HTMLElement) out.push(el);
    }
  }
  return out;
}

function checkButtonsAreButtons(buttons: readonly HTMLElement[]): AuditResult {
  const id = 'dom-buttons-are-buttons';
  const section = '2.2';
  const title = 'Banner actions are real button elements';
  if (buttons.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail: 'No banner is currently mounted — DOM check skipped.',
      passed: true,
    };
  }
  const offenders = buttons
    .filter((b) => b.tagName !== 'BUTTON')
    .map((b) => b.tagName.toLowerCase());
  if (offenders.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail: 'All banner action elements are <button> tags.',
      passed: true,
    };
  }
  return {
    id,
    section,
    severity: 'critical',
    title,
    detail: `Found ${offenders.length} action element(s) rendered as <${offenders.join(', ')}> instead of <button>. EDPB 03/2022 § Skipping flags reject-as-link as a deceptive design pattern — actions must be real buttons so visitors (and assistive tech) treat them as equivalent affordances. Don't override the bundle's button render.`,
    passed: false,
  };
}

function checkButtonsEqualStyling(buttons: readonly HTMLElement[]): AuditResult {
  const id = 'dom-buttons-equal-styling';
  const section = '1.2';
  const title = 'Banner buttons are styled identically';
  const [first, ...rest] = buttons;
  if (first === undefined || rest.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail:
        first === undefined
          ? 'No banner is currently mounted — DOM check skipped.'
          : 'Only one button rendered — equal-styling check requires at least two.',
      passed: true,
    };
  }
  // Compare each subsequent button against the first. The properties
  // we care about are the ones that visually weight a button: the
  // background and text color (anti-Stirring), the font weight (anti-
  // Stirring), the border (so a "ghost outline" decline doesn't slip
  // past a filled-primary accept).
  const ref = readStyleSignature(first);
  const issues: string[] = [];
  rest.forEach((button, idx) => {
    const sig = readStyleSignature(button);
    for (const key of STYLE_KEYS) {
      if (sig[key] !== ref[key]) {
        issues.push(`button ${idx + 2} ${key}: ${sig[key]} (button 1: ${ref[key]})`);
      }
    }
  });
  if (issues.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail: 'All visible buttons share the same color, weight, and border styling.',
      passed: true,
    };
  }
  return {
    id,
    section,
    severity: 'critical',
    title,
    detail: `Banner buttons differ in styling beyond their labels — this is a Stirring dark pattern (BGH I ZR 7/16, DSB D124.0507/24, EDPB 03/2022). Buttons must share identical color, weight and border treatment. Mismatched properties:\n  - ${issues.slice(0, 6).join('\n  - ')}${issues.length > 6 ? `\n  - (… ${issues.length - 6} more)` : ''}`,
    passed: false,
  };
}

function checkButtonsWcagContrast(buttons: readonly HTMLElement[]): AuditResult {
  const id = 'dom-buttons-wcag-contrast';
  const section = '1.2';
  const title = 'Banner buttons meet WCAG AA contrast (≥ 4.5:1)';
  if (buttons.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail: 'No banner is currently mounted — DOM check skipped.',
      passed: true,
    };
  }
  const failures: string[] = [];
  buttons.forEach((button, idx) => {
    const cs = getComputedStyle(button);
    const fg = parseRgb(cs.color);
    const bg = effectiveBackground(button);
    if (fg === null || bg === null) return;
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) {
      failures.push(`button ${idx + 1}: contrast ${ratio.toFixed(2)}:1 (needs ≥ 4.5:1)`);
    }
  });
  if (failures.length === 0) {
    return {
      id,
      section,
      severity: 'info',
      title,
      detail: 'All button text meets WCAG AA contrast against its background.',
      passed: true,
    };
  }
  return {
    id,
    section,
    severity: 'critical',
    title,
    detail: `One or more banner buttons fall below the WCAG AA text-contrast threshold of 4.5:1. The Austrian DSB (D124.0507/24) explicitly cited insufficient contrast as a manipulative design choice. Failing buttons:\n  - ${failures.join('\n  - ')}`,
    passed: false,
  };
}

/** Computed-style properties that should match across all banner buttons. */
const STYLE_KEYS = [
  'backgroundColor',
  'color',
  'fontWeight',
  'borderTopWidth',
  'borderTopStyle',
  'borderTopColor',
] as const;

type StyleSignature = Record<(typeof STYLE_KEYS)[number], string>;

function readStyleSignature(el: HTMLElement): StyleSignature {
  const cs = getComputedStyle(el);
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontWeight: cs.fontWeight,
    borderTopWidth: cs.borderTopWidth,
    borderTopStyle: cs.borderTopStyle,
    borderTopColor: cs.borderTopColor,
  };
}

/**
 * Walk up the DOM (across shadow boundaries) until we find an element
 * with a non-transparent background color. Browser `getComputedStyle`
 * returns `rgba(0,0,0,0)` for transparent — useless for contrast
 * calculation. Inheriting up gives the actual visual background the
 * button sits on.
 */
function effectiveBackground(el: HTMLElement): RGB | null {
  let current: HTMLElement | null = el;
  while (current !== null) {
    const cs = getComputedStyle(current);
    const rgb = parseRgb(cs.backgroundColor);
    if (rgb !== null && !isTransparent(cs.backgroundColor)) return rgb;
    // Cross shadow-DOM boundary upwards.
    const parent: Node | null =
      current.parentNode ?? (current.getRootNode() as ShadowRoot).host ?? null;
    current = parent instanceof HTMLElement ? parent : null;
  }
  // Last-resort: assume body / white. Worse than nothing for some
  // dark-mode sites, but the alternative (skipping the check) is
  // worse since contrast issues silently disappear from the audit.
  return [255, 255, 255];
}

type RGB = [number, number, number];

function parseRgb(value: string): RGB | null {
  const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isTransparent(value: string): boolean {
  if (value === 'transparent') return true;
  const match = value.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d*\.?\d+)\s*\)/);
  return match !== null && Number(match[1]) === 0;
}

/** Relative luminance per WCAG 2.1, accurate enough for AA threshold checks. */
function relativeLuminance([r, g, b]: RGB): number {
  const channel = (c: number): number => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}
