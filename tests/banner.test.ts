/**
 * D.2 — `<simplecmp-banner>` smoke tests.
 *
 * Verifies the banner renders, dispatches `simplecmp:*` events, and
 * mutates the engine ConsentManager state on Accept/Decline. The modal
 * route ('configure' click) is just an event check — the actual modal
 * lives in D.3.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConsentManager, getManager, resetManagers } from '../src/engine/index.js';
import '../src/ui/components/banner.js';
import type { SimpleCmpBanner } from '../src/ui/components/banner.js';

const baseConfig = {
  storageName: 'simplecmp-banner-test',
  storageMethod: 'localStorage',
  services: [
    { name: 'analytics', purposes: ['analytics'], default: false },
    { name: 'ads', purposes: ['marketing'], default: false },
  ],
  translations: {
    en: {
      ok: 'Accept',
      decline: 'Decline',
      consentNotice: {
        description: 'We use {purposes}. {learnMoreLink}',
        learnMore: 'Configure',
        changeDescription: 'Your choice has changed.',
      },
      privacyPolicy: { name: 'Privacy Policy' },
      purposes: {
        analytics: { title: 'Analytics' },
        marketing: { title: 'Marketing' },
      },
    },
  },
} as const;

interface MountedBanner {
  el: SimpleCmpBanner;
  manager: ConsentManager;
}

async function mountBanner(extra: Record<string, unknown> = {}): Promise<MountedBanner> {
  const config = { ...baseConfig, ...extra };
  const manager = getManager(config);
  const el = document.createElement('simplecmp-banner') as SimpleCmpBanner;
  el.config = config;
  el.manager = manager;
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, manager };
}

function getButton(el: SimpleCmpBanner, selector: string): HTMLButtonElement {
  const root = el.shadowRoot ?? el;
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (button === null) {
    throw new Error(`Expected button "${selector}" to be present`);
  }
  return button;
}

describe('<simplecmp-banner>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('upgrades to the Lit class', async () => {
    const { el } = await mountBanner();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.shadowRoot).not.toBeNull();
  });

  it('renders Accept and Decline buttons by default', async () => {
    const { el } = await mountBanner();
    const buttons = el.shadowRoot?.querySelectorAll('button') ?? [];
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).toContain('Accept');
    expect(labels).toContain('Decline');
  });

  it('hides the Decline button when hideDeclineAll is true', async () => {
    const { el } = await mountBanner({ hideDeclineAll: true });
    const buttons = el.shadowRoot?.querySelectorAll('button') ?? [];
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Decline');
  });

  it('dispatches simplecmp:accept and saves consents on Accept click', async () => {
    const { el, manager } = await mountBanner();
    let received: CustomEvent | null = null;
    el.addEventListener('simplecmp:accept', (e) => {
      received = e as CustomEvent;
    });
    getButton(el, 'button.cn-accept').click();
    expect(received).not.toBeNull();
    expect(manager.confirmed).toBe(true);
    expect(manager.consents.analytics).toBe(true);
    expect(manager.consents.ads).toBe(true);
  });

  it('dispatches simplecmp:decline and saves zeroed consents on Decline click', async () => {
    const { el, manager } = await mountBanner();
    let received: CustomEvent | null = null;
    el.addEventListener('simplecmp:decline', (e) => {
      received = e as CustomEvent;
    });
    getButton(el, 'button.cn-decline').click();
    expect(received).not.toBeNull();
    expect(manager.confirmed).toBe(true);
    expect(manager.consents.analytics).toBe(false);
  });

  it('dispatches simplecmp:configure on the Configure button click without saving', async () => {
    const { el, manager } = await mountBanner();
    let received: CustomEvent | null = null;
    el.addEventListener('simplecmp:configure', (e) => {
      received = e as CustomEvent;
    });
    getButton(el, 'button.cn-configure').click();
    expect(received).not.toBeNull();
    expect(manager.confirmed).toBe(false);
  });

  it('renders nothing when consent is already confirmed', async () => {
    const { el, manager } = await mountBanner();
    manager.changeAll(true);
    manager.saveAndApplyConsents('test');
    el.requestUpdate();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.cn-body')).toBeNull();
  });

  it('still renders in testing mode after confirmation', async () => {
    const { el, manager } = await mountBanner();
    manager.changeAll(true);
    manager.saveAndApplyConsents('test');
    el.testing = true;
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.cn-body')).not.toBeNull();
  });

  it('mode="light" renders into Light DOM (no shadowRoot)', async () => {
    const config = { ...baseConfig };
    const manager = getManager(config);
    const el = document.createElement('simplecmp-banner') as SimpleCmpBanner;
    el.setAttribute('mode', 'light');
    el.config = config;
    el.manager = manager;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector('.cn-body')).not.toBeNull();
  });
});
