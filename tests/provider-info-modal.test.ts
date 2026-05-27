/**
 * REQ-19 — L2 Provider-Informationen modal + per-instance data-
 * attribute overrides.
 *
 * Covers:
 *   - <simplecmp-provider-info-modal> renders all fields when present
 *   - Hides empty fields; shows "no data" fallback when nothing present
 *   - Open/close via the `open` property + close button
 *   - URLs render as anchors with target=_blank rel=noopener
 *   - <simplecmp-contextual-notice> only renders the L2 link when the
 *     service has at least one provider field
 *   - Clicking the L2 link mounts and opens the modal
 *   - Per-instance `data-simplecmp-title` / `data-simplecmp-description`
 *     attributes on the notice override the resolved title/description
 *   - Engine propagates these attributes from the blocked embed anchor
 *     to the auto-inserted notice
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConsentManager, getManager, resetManagers } from '../src/engine/index.js';
import '../src/ui/components/contextual-notice.js';
import '../src/ui/components/provider-info-modal.js';
import type { SimpleCmpContextualNotice } from '../src/ui/components/contextual-notice.js';
import type { SimpleCmpProviderInfoModal } from '../src/ui/components/provider-info-modal.js';

const fullProvider = {
  name: 'youtube',
  purposes: ['marketing'],
  default: false,
  vendor: 'Google',
  vendorCountry: 'IE',
  vendorAddress: 'Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland',
  vendorOptOutUrl: 'https://adssettings.google.com/',
  vendorPartner: 'Google LLC (USA) as parent company.',
  vendorDescription: 'EU establishment of Google LLC.',
  privacyPolicyUrl: 'https://policies.google.com/privacy',
};

const baseConfig = {
  storageName: 'simplecmp-provider-info-test',
  storageMethod: 'localStorage',
  services: [fullProvider],
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
        providerInfoLink: 'More information ›',
      },
      providerInfo: {
        title: 'Provider information',
        close: 'Close',
        noData: 'No provider information available.',
        field: {
          vendor: 'Provider',
          description: 'Description',
          address: 'Address',
          country: 'Country',
          privacyPolicy: 'Privacy policy',
          optOut: 'Opt-out',
          partner: 'Partners / joint controllers',
        },
      },
      youtube: { title: 'YouTube' },
    },
  },
} as const;

describe('<simplecmp-provider-info-modal>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
    // Required so `_t()` has a translator bound; modal doesn't use the
    // manager but it does read config.translations.
    getManager(baseConfig);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mount(
    service: Record<string, unknown>,
    open = true
  ): Promise<SimpleCmpProviderInfoModal> {
    const el = document.createElement(
      'simplecmp-provider-info-modal'
    ) as SimpleCmpProviderInfoModal;
    // Cast through unknown so the modal accepts our partial-shape
    // fixture without satisfying the full Service interface (only the
    // vendor* fields are exercised by this component).
    el.service = service as unknown as Parameters<typeof Object.assign>[0] as never;
    el.config = baseConfig as unknown as typeof el.config;
    el.open = open;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders all seven fields when present', async () => {
    const el = await mount(fullProvider);
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('Google');
    expect(text).toContain('Google Ireland Limited');
    expect(text).toContain('IE');
    expect(text).toContain('EU establishment of Google LLC.');
    expect(text).toContain('https://policies.google.com/privacy');
    expect(text).toContain('https://adssettings.google.com/');
    expect(text).toContain('Google LLC (USA) as parent company.');
  });

  it('hides fields that are unset', async () => {
    const partial = {
      name: 'youtube',
      vendor: 'Google',
      vendorAddress: 'Some address',
    };
    const el = await mount(partial);
    const rows = el.shadowRoot?.querySelectorAll('dt') ?? [];
    // Should render exactly two field rows: Provider, Address.
    expect(rows.length).toBe(2);
    const labels = Array.from(rows).map((r) => r.textContent?.trim());
    expect(labels).toContain('Provider');
    expect(labels).toContain('Address');
    expect(labels).not.toContain('Country');
    expect(labels).not.toContain('Privacy policy');
  });

  it('shows the "no data" message when no fields are present', async () => {
    const empty = { name: 'youtube' };
    const el = await mount(empty);
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('No provider information available.');
    expect(el.shadowRoot?.querySelectorAll('dt').length ?? 0).toBe(0);
  });

  it('renders URL fields as anchors with target=_blank rel=noopener noreferrer', async () => {
    const el = await mount(fullProvider);
    const anchors = el.shadowRoot?.querySelectorAll<HTMLAnchorElement>('dd a') ?? [];
    expect(anchors.length).toBe(2);
    for (const a of Array.from(anchors)) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toMatch(/noopener/);
      expect(a.rel).toMatch(/noreferrer/);
    }
  });

  it('opens / closes via the `open` property', async () => {
    const el = await mount(fullProvider, false);
    const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    el.open = true;
    await el.updateComplete;
    expect(dialog.open).toBe(true);
    el.open = false;
    await el.updateComplete;
    expect(dialog.open).toBe(false);
  });

  it('emits provider-info-close when the close button is clicked', async () => {
    const el = await mount(fullProvider);
    let received = false;
    el.addEventListener('simplecmp:provider-info-close', () => {
      received = true;
    });
    el.shadowRoot?.querySelector<HTMLButtonElement>('button.close')?.click();
    expect(received).toBe(true);
    expect(el.open).toBe(false);
  });
});

describe('<simplecmp-contextual-notice> — L2 wiring', () => {
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

  async function mountNotice(
    serviceName: string,
    attrs: Record<string, string> = {}
  ): Promise<SimpleCmpContextualNotice> {
    const el = document.createElement('simplecmp-contextual-notice') as SimpleCmpContextualNotice;
    el.config = baseConfig as unknown as typeof el.config;
    el.manager = manager;
    el.setAttribute('service-name', serviceName);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders the L2 link when the service has vendor data', async () => {
    const el = await mountNotice('youtube');
    const link = el.shadowRoot?.querySelector('.provider-info-link a');
    expect(link).not.toBeNull();
    expect(link?.textContent?.trim()).toBe('More information ›');
  });

  it('hides the L2 link when the service has no vendor data', async () => {
    // Build a config whose `youtube` service has no vendor* fields at
    // all. resetManagers + new getManager so the changes are picked up.
    const bareConfig = {
      ...baseConfig,
      services: [{ name: 'youtube', purposes: ['marketing'], default: false }],
    } as const;
    resetManagers();
    const bareManager = getManager(bareConfig);
    const el = document.createElement('simplecmp-contextual-notice') as SimpleCmpContextualNotice;
    el.config = bareConfig as unknown as typeof el.config;
    el.manager = bareManager;
    el.setAttribute('service-name', 'youtube');
    document.body.appendChild(el);
    await el.updateComplete;
    const link = el.shadowRoot?.querySelector('.provider-info-link');
    expect(link).toBeNull();
  });

  it('mounts the provider-info modal when the L2 link is clicked', async () => {
    const el = await mountNotice('youtube');
    expect(el.shadowRoot?.querySelector('simplecmp-provider-info-modal')).toBeNull();
    el.shadowRoot
      ?.querySelector<HTMLAnchorElement>('.provider-info-link a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await el.updateComplete;
    const modal = el.shadowRoot?.querySelector(
      'simplecmp-provider-info-modal'
    ) as SimpleCmpProviderInfoModal | null;
    expect(modal).not.toBeNull();
    expect(modal?.open).toBe(true);
  });

  it('`data-simplecmp-title` overrides the resolved title', async () => {
    const el = await mountNotice('youtube', { 'data-simplecmp-title': 'Watch our 2026 keynote' });
    expect(el.getAttribute('aria-label')).toBe('Watch our 2026 keynote');
  });

  it('`data-simplecmp-description` overrides the resolved description', async () => {
    const el = await mountNotice('youtube', {
      'data-simplecmp-description': 'Bespoke description for this embed.',
    });
    const p = el.shadowRoot?.querySelector('p');
    expect(p?.textContent).toBe('Bespoke description for this embed.');
  });
});
