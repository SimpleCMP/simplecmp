/**
 * REQ-N8 Phase A — third-party stylesheet block-and-reinject.
 *
 * The universal-blocking rewriter (TYPO3 side, Phase B) neutralises a
 * third-party `<link rel="stylesheet" href>` by moving the URL to `data-href`
 * and tagging it `data-name="<service>"` — the `href` is stripped, so the
 * browser never loads it. The engine must keep it blocked until consent, then
 * restore `href` from `data-href`. This locks the engine half of the contract
 * (the `<link>`/`href` path in `updateServiceElements`) that Phase B depends on.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConsentConfig } from '../src/engine/index.js';
import { getManager, resetManagers } from '../src/engine/index.js';

const SERVICE = 'fonts.googleapis.com';
const HREF = 'https://fonts.googleapis.com/css2?family=Roboto&display=swap';

function config(): ConsentConfig {
  return {
    storageName: 'simplecmp-stylesheet-test',
    storageMethod: 'localStorage',
    services: [{ name: SERVICE, purposes: ['marketing'], default: false }],
    // Keep the DOM assertions focused on the <link>; no inline notice.
    autoContextualPlaceholder: false,
  };
}

/** A stylesheet as the rewriter emits it: tagged, href stripped to data-href. */
function blockedStylesheet(): void {
  const link = document.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('data-name', SERVICE);
  link.setAttribute('data-href', HREF);
  // href intentionally absent — the rewriter strips it so it never loads.
  document.head.appendChild(link);
}

function liveLink(): HTMLLinkElement | null {
  return document.querySelector(`link[data-name="${SERVICE}"]`);
}

describe('REQ-N8 stylesheet block-and-reinject', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetManagers();
    localStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('keeps a third-party stylesheet blocked without consent (no live href)', () => {
    blockedStylesheet();
    const manager = getManager(config());
    manager.applyConsents();

    const link = liveLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBeNull(); // still blocked
    expect(link?.getAttribute('data-href')).toBe(HREF); // recovery value preserved
  });

  it('reinjects the stylesheet href on consent', () => {
    blockedStylesheet();
    const manager = getManager(config());
    manager.updateConsent(SERVICE, true);
    // interactive=true → the consent counts as confirmed, so it applies.
    manager.applyConsents(false, true);

    const link = liveLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(HREF); // restored
  });

  it('re-blocks the stylesheet when consent is withdrawn', () => {
    blockedStylesheet();
    const manager = getManager(config());

    manager.updateConsent(SERVICE, true);
    manager.applyConsents(false, true);
    expect(liveLink()?.getAttribute('href')).toBe(HREF);

    manager.updateConsent(SERVICE, false);
    manager.applyConsents(false, true);
    expect(liveLink()?.getAttribute('href')).toBeNull(); // blocked again
    expect(liveLink()?.getAttribute('data-href')).toBe(HREF);
  });
});
