/**
 * D.4 — `<simplecmp-trigger>`, `<simplecmp-policy-links>`,
 * `<simplecmp-contextual-notice>` smoke tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConsentManager, getManager, resetManagers } from '../src/engine/index.js';
import '../src/ui/components/contextual-notice.js';
import '../src/ui/components/policy-links.js';
import '../src/ui/components/trigger.js';
import type { SimpleCmpContextualNotice } from '../src/ui/components/contextual-notice.js';
import type { SimpleCmpPolicyLinks } from '../src/ui/components/policy-links.js';
import type { SimpleCmpTrigger } from '../src/ui/components/trigger.js';

const baseConfig = {
  storageName: 'simplecmp-aux-test',
  storageMethod: 'localStorage',
  services: [{ name: 'youtube', purposes: ['marketing'], default: false }],
  privacyPolicy: 'https://example.com/privacy',
  imprint: 'https://example.com/imprint',
  translations: {
    en: {
      privacyPolicy: { name: 'Privacy Policy' },
      imprint: { name: 'Imprint' },
      contextualConsent: {
        description: 'Enable {title} to view this content',
        acceptOnce: 'Show once',
        acceptAlways: 'Always show',
        modalLinkText: 'Open settings',
      },
      floatingTrigger: { label: 'Cookie settings' },
      youtube: { title: 'YouTube' },
    },
  },
} as const;

describe('<simplecmp-trigger>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a button with the default label when no config is given', async () => {
    const el = document.createElement('simplecmp-trigger') as SimpleCmpTrigger;
    document.body.appendChild(el);
    await el.updateComplete;
    const button = el.shadowRoot?.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Cookie settings');
  });

  it('uses the explicit label property when set', async () => {
    const el = document.createElement('simplecmp-trigger') as SimpleCmpTrigger;
    el.label = 'Datenschutz-Einstellungen';
    document.body.appendChild(el);
    await el.updateComplete;
    const button = el.shadowRoot?.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Datenschutz-Einstellungen');
  });

  it('reads the label from translations when only config is given', async () => {
    const el = document.createElement('simplecmp-trigger') as SimpleCmpTrigger;
    el.config = baseConfig;
    document.body.appendChild(el);
    await el.updateComplete;
    const button = el.shadowRoot?.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Cookie settings');
  });

  it('emits simplecmp:trigger-click when activated', async () => {
    const el = document.createElement('simplecmp-trigger') as SimpleCmpTrigger;
    document.body.appendChild(el);
    await el.updateComplete;
    let received = false;
    el.addEventListener('simplecmp:trigger-click', () => {
      received = true;
    });
    el.shadowRoot?.querySelector('button')?.click();
    expect(received).toBe(true);
  });

  it('reflects the position attribute for CSS targeting', async () => {
    const el = document.createElement('simplecmp-trigger') as SimpleCmpTrigger;
    el.position = 'top-left';
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.getAttribute('position')).toBe('top-left');
  });
});

describe('<simplecmp-policy-links>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders both privacy and imprint links from config', async () => {
    const el = document.createElement('simplecmp-policy-links') as SimpleCmpPolicyLinks;
    el.config = baseConfig;
    document.body.appendChild(el);
    await el.updateComplete;
    const links = el.shadowRoot?.querySelectorAll('a') ?? [];
    expect(links.length).toBe(2);
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://example.com/privacy');
    expect(hrefs).toContain('https://example.com/imprint');
  });

  it('renders nothing when neither URL resolves', async () => {
    const el = document.createElement('simplecmp-policy-links') as SimpleCmpPolicyLinks;
    el.config = { storageName: 'no-policy', services: [], translations: {} };
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('a')).toBeNull();
  });

  it('falls back to translation keys for URLs', async () => {
    const el = document.createElement('simplecmp-policy-links') as SimpleCmpPolicyLinks;
    el.config = {
      storageName: 'translated-policy',
      services: [],
      translations: {
        en: {
          privacyPolicyUrl: 'https://example.org/datenschutz',
          imprintUrl: 'https://example.org/impressum',
          privacyPolicy: { name: 'Privacy' },
        },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    const hrefs = Array.from(el.shadowRoot?.querySelectorAll('a') ?? []).map((a) =>
      a.getAttribute('href')
    );
    expect(hrefs).toContain('https://example.org/datenschutz');
    expect(hrefs).toContain('https://example.org/impressum');
  });
});

describe('<simplecmp-contextual-notice>', () => {
  let manager: ConsentManager;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
    manager = getManager(baseConfig);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mount(): Promise<SimpleCmpContextualNotice> {
    const el = document.createElement('simplecmp-contextual-notice') as SimpleCmpContextualNotice;
    el.config = baseConfig;
    el.manager = manager;
    el.setAttribute('service-name', 'youtube');
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders three buttons when stored consent exists', async () => {
    manager.changeAll(true);
    manager.saveAndApplyConsents('test');
    manager.changeAll(false);
    manager.saveAndApplyConsents('test');
    const el = await mount();
    const labels = Array.from(el.shadowRoot?.querySelectorAll('button') ?? []).map((b) =>
      b.textContent?.trim()
    );
    expect(labels).toContain('Show once');
    expect(labels).toContain('Always show');
    expect(labels).toContain('Open settings');
  });

  it('hides the always-show button when there is no stored consent', async () => {
    const el = await mount();
    const labels = Array.from(el.shadowRoot?.querySelectorAll('button') ?? []).map((b) =>
      b.textContent?.trim()
    );
    expect(labels).toContain('Show once');
    expect(labels).not.toContain('Always show');
  });

  it('emits configure event on the open-settings button', async () => {
    const el = await mount();
    let received = false;
    el.addEventListener('simplecmp:configure', () => {
      received = true;
    });
    const button = el.shadowRoot?.querySelector<HTMLButtonElement>('button.configure');
    button?.click();
    expect(received).toBe(true);
  });

  it('Show once temporarily applies consent without persisting', async () => {
    const el = await mount();
    let received = false;
    el.addEventListener('simplecmp:contextual-accept-once', () => {
      received = true;
    });
    el.shadowRoot?.querySelector<HTMLButtonElement>('button.accept-once')?.click();
    expect(received).toBe(true);
    // Final state: consent flag is back to false (the click flow flips it
    // on, applies, then flips back off). The Klaro applyConsents side-effect
    // is what actually loaded the embed; consent storage is unchanged.
    expect(manager.consents.youtube).toBe(false);
  });

  it('sets role="region" on the host element', async () => {
    const el = await mount();
    expect(el.getAttribute('role')).toBe('region');
  });

  it('uses service.placeholderTitle as the aria-label when set', async () => {
    const config = {
      ...baseConfig,
      services: [
        {
          name: 'youtube',
          purposes: ['marketing'],
          default: false,
          placeholderTitle: 'YouTube videos',
        },
      ],
    } as const;
    resetManagers();
    const customManager = getManager(config);
    const el = document.createElement('simplecmp-contextual-notice') as SimpleCmpContextualNotice;
    el.config = config;
    el.manager = customManager;
    el.setAttribute('service-name', 'youtube');
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.getAttribute('aria-label')).toBe('YouTube videos');
  });

  it('uses service.placeholderDescription instead of the default i18n description', async () => {
    const config = {
      ...baseConfig,
      services: [
        {
          name: 'youtube',
          purposes: ['marketing'],
          default: false,
          placeholderDescription: 'This embed needs YouTube to load.',
        },
      ],
    } as const;
    resetManagers();
    const customManager = getManager(config);
    const el = document.createElement('simplecmp-contextual-notice') as SimpleCmpContextualNotice;
    el.config = config;
    el.manager = customManager;
    el.setAttribute('service-name', 'youtube');
    document.body.appendChild(el);
    await el.updateComplete;

    const description = el.shadowRoot?.querySelector('p')?.textContent?.trim();
    expect(description).toBe('This embed needs YouTube to load.');
  });

  it('focuses the first action button when auto-inserted by the engine', async () => {
    const el = document.createElement('simplecmp-contextual-notice') as SimpleCmpContextualNotice;
    el.config = baseConfig;
    el.manager = manager;
    el.setAttribute('service-name', 'youtube');
    el.setAttribute('data-simplecmp-auto-placeholder', '');
    document.body.appendChild(el);
    await el.updateComplete;
    // Give Lit one extra tick for the focus call inside firstUpdated.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const focused = el.shadowRoot?.activeElement;
    expect(focused?.tagName.toLowerCase()).toBe('button');
  });

  it('does not steal focus when authored by the integrator (no auto-placeholder marker)', async () => {
    // Mount a control element that already has focus before the notice
    // appears. An integrator-authored notice (no data-simplecmp-auto-
    // placeholder) should leave that focus alone.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const el = await mount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).toBe(input);
    expect(el.shadowRoot?.activeElement).toBeNull();
  });

  it('reopens the provider-info modal after it has been closed once', async () => {
    // Regression: the close event from <simplecmp-provider-info-modal> is
    // emitted as `simplecmp:provider-info-close` (via _emit's namespace
    // prefix). A bare `@provider-info-close=` listener missed it, so
    // _providerInfoOpen stayed true after the first close and subsequent
    // link clicks were silent no-ops.
    const config = {
      ...baseConfig,
      services: [
        {
          name: 'youtube',
          purposes: ['marketing'],
          default: false,
          vendor: 'Google Ireland Ltd.',
          privacyPolicyUrl: 'https://policies.google.com/privacy',
        },
      ],
    } as const;
    resetManagers();
    const customManager = getManager(config);
    const el = document.createElement('simplecmp-contextual-notice') as SimpleCmpContextualNotice;
    el.config = config;
    el.manager = customManager;
    el.setAttribute('service-name', 'youtube');
    document.body.appendChild(el);
    await el.updateComplete;

    const link = el.shadowRoot?.querySelector<HTMLAnchorElement>('.provider-info-link a');
    expect(link, 'provider-info link should render when vendor data is present').toBeTruthy();

    link?.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('simplecmp-provider-info-modal')).toBeTruthy();

    const modal = el.shadowRoot?.querySelector('simplecmp-provider-info-modal');
    modal?.dispatchEvent(
      new CustomEvent('simplecmp:provider-info-close', { bubbles: true, composed: true })
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('simplecmp-provider-info-modal')).toBeFalsy();

    link?.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('simplecmp-provider-info-modal')).toBeTruthy();
  });
});
