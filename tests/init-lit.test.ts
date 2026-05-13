/**
 * D.5 — `initLit()` integration tests.
 *
 * Verifies the public mount entry point: banner appears for fresh users,
 * configure→modal wiring works, banner is dropped when consent is saved,
 * floating trigger wires through to the modal, and `destroy()` cleans up.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetManagers } from '../src/engine/index.js';
import { init as initLit } from '../src/index.js';

const baseConfig = {
  storageName: 'simplecmp-init-lit-test',
  storageMethod: 'localStorage' as const,
  services: [
    { name: 'analytics', purposes: ['analytics'], default: false },
    { name: 'ads', purposes: ['marketing'], default: false },
  ],
  translations: {
    en: {
      ok: 'Accept',
      decline: 'Decline',
      consentNotice: { description: 'We use cookies', learnMore: 'Configure' },
      consentModal: { title: 'Settings', description: 'Pick your services' },
      privacyPolicy: { name: 'Privacy' },
      acceptSelected: 'Save',
      save: 'Save',
      acceptAll: 'Accept all',
      close: 'Close',
      purposes: { analytics: { title: 'Analytics' }, marketing: { title: 'Marketing' } },
      service: { required: { title: 'required' }, optOut: { title: 'opt-out' } },
      purposeItem: { service: 'service', services: 'services' },
    },
  },
};

describe('initLit() — banner-modal wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts banner and modal on a fresh page', () => {
    const handle = initLit(baseConfig);
    expect(document.body.querySelector('simplecmp-banner')).not.toBeNull();
    expect(document.body.querySelector('simplecmp-modal')).not.toBeNull();
    expect(handle.manager.confirmed).toBe(false);
  });

  it('omits the banner when consent is already confirmed', () => {
    // Pre-confirm via a prior init+accept cycle.
    const first = initLit(baseConfig);
    first.manager.changeAll(true);
    first.manager.saveAndApplyConsents('test');
    first.destroy();
    resetManagers(); // refresh manager cache so next initLit reads from storage

    initLit(baseConfig);
    expect(document.body.querySelector('simplecmp-banner')).toBeNull();
    expect(document.body.querySelector('simplecmp-modal')).not.toBeNull();
  });

  it('opens the modal when the banner emits simplecmp:configure', async () => {
    initLit(baseConfig);
    const banner = document.body.querySelector('simplecmp-banner');
    const modal = document.body.querySelector('simplecmp-modal') as HTMLElement & { open: boolean };
    expect(modal.open).toBe(false);
    banner?.dispatchEvent(
      new CustomEvent('simplecmp:configure', { bubbles: true, composed: true })
    );
    expect(modal.open).toBe(true);
  });

  it('removes the banner once the manager fires saveConsents', async () => {
    const handle = initLit(baseConfig);
    expect(document.body.querySelector('simplecmp-banner')).not.toBeNull();
    handle.manager.changeAll(true);
    handle.manager.saveAndApplyConsents('test');
    expect(document.body.querySelector('simplecmp-banner')).toBeNull();
  });

  it('wires the trigger button to open the modal', () => {
    initLit({ ...baseConfig, floatingTrigger: true });
    const trigger = document.body.querySelector('simplecmp-trigger');
    const modal = document.body.querySelector('simplecmp-modal') as HTMLElement & { open: boolean };
    expect(trigger).not.toBeNull();
    trigger?.dispatchEvent(
      new CustomEvent('simplecmp:trigger-click', { bubbles: true, composed: true })
    );
    expect(modal.open).toBe(true);
  });

  it('handle.show() / handle.hide() control the modal', () => {
    const handle = initLit(baseConfig);
    const modal = document.body.querySelector('simplecmp-modal') as HTMLElement & { open: boolean };
    handle.show();
    expect(modal.open).toBe(true);
    handle.hide();
    expect(modal.open).toBe(false);
  });

  it('handle.destroy() removes all components', () => {
    const handle = initLit({ ...baseConfig, floatingTrigger: true });
    expect(document.body.querySelector('simplecmp-banner')).not.toBeNull();
    expect(document.body.querySelector('simplecmp-modal')).not.toBeNull();
    expect(document.body.querySelector('simplecmp-trigger')).not.toBeNull();
    handle.destroy();
    expect(document.body.querySelector('simplecmp-banner')).toBeNull();
    expect(document.body.querySelector('simplecmp-modal')).toBeNull();
    expect(document.body.querySelector('simplecmp-trigger')).toBeNull();
  });

  it('mustConsent opens the modal immediately', () => {
    initLit({ ...baseConfig, mustConsent: true });
    const modal = document.body.querySelector('simplecmp-modal') as HTMLElement & { open: boolean };
    expect(modal.open).toBe(true);
  });

  it('domMode: "light" mounts components without shadow roots', async () => {
    initLit({ ...baseConfig, domMode: 'light', floatingTrigger: true });
    const banner = document.body.querySelector('simplecmp-banner') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    const modal = document.body.querySelector('simplecmp-modal');
    const trigger = document.body.querySelector('simplecmp-trigger');
    expect(banner?.shadowRoot).toBeNull();
    expect(modal?.shadowRoot).toBeNull();
    expect(trigger?.shadowRoot).toBeNull();
    // Wait for Lit's first render before querying for content.
    await banner.updateComplete;
    expect(banner.querySelector('.cn-body')).not.toBeNull();
  });
});
