/**
 * D.3 — `<simplecmp-modal>`, `<simplecmp-purpose-group>`,
 * `<simplecmp-service-toggle>` smoke tests.
 *
 * Verifies the modal opens via `dialog.showModal()`, button flows mutate
 * the engine ConsentManager, mustConsent suppresses Escape/backdrop close,
 * and per-service toggles update consents.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConsentManager, getManager, resetManagers } from '../src/engine/index.js';
import '../src/ui/components/modal.js';
import type { SimpleCmpModal } from '../src/ui/components/modal.js';
import type { SimpleCmpPurposeGroup } from '../src/ui/components/purpose-group.js';
import type { SimpleCmpServiceToggle } from '../src/ui/components/service-toggle.js';

const baseConfig = {
  storageName: 'simplecmp-modal-test',
  storageMethod: 'localStorage',
  acceptAll: true,
  groupByPurpose: true,
  services: [
    { name: 'analytics', purposes: ['analytics'], default: false },
    { name: 'ads', purposes: ['marketing'], default: false },
    { name: 'gtag', purposes: ['analytics'], default: false },
  ],
  translations: {
    en: {
      ok: 'Save',
      save: 'Save',
      decline: 'Decline',
      acceptAll: 'Accept All',
      acceptSelected: 'Save Selection',
      close: 'Close',
      consentModal: {
        title: 'Cookie Settings',
        description: 'We use cookies. Configure below.',
      },
      privacyPolicy: { name: 'Privacy Policy' },
      purposes: {
        analytics: { title: 'Analytics', description: 'Tracking and stats' },
        marketing: { title: 'Marketing', description: 'Ads' },
      },
      service: {
        required: { title: 'required' },
        optOut: { title: 'opt-out' },
      },
      purposeItem: { service: 'service', services: 'services' },
    },
  },
} as const;

interface MountedModal {
  el: SimpleCmpModal;
  manager: ConsentManager;
}

async function mountModal(extra: Record<string, unknown> = {}): Promise<MountedModal> {
  const config = { ...baseConfig, ...extra };
  const manager = getManager(config);
  const el = document.createElement('simplecmp-modal') as SimpleCmpModal;
  el.config = config;
  el.manager = manager;
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, manager };
}

function getButton(el: SimpleCmpModal, selector: string): HTMLButtonElement {
  const root = el.shadowRoot;
  if (root === null) throw new Error('Expected shadow root');
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (button === null) throw new Error(`Expected button "${selector}"`);
  return button;
}

describe('<simplecmp-modal>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a <dialog> element with header/body/footer', async () => {
    const { el } = await mountModal();
    const dialog = el.shadowRoot?.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(el.shadowRoot?.querySelector('.header')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('.body')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('.footer')).not.toBeNull();
  });

  it('dialog carries aria-labelledby pointing to the title heading', async () => {
    const { el } = await mountModal();
    const dialog = el.shadowRoot?.querySelector('dialog');
    const title = el.shadowRoot?.querySelector('h1');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('simplecmp-modal-title');
    expect(title?.id).toBe('simplecmp-modal-title');
  });

  it('Tab on the last focusable wraps focus back to the first (focus trap)', async () => {
    const { el } = await mountModal();
    const dialog = el.shadowRoot?.querySelector('dialog');
    if (dialog === null || dialog === undefined) throw new Error('Expected dialog');
    const close = getButton(el, 'button.close');
    const acceptAll = getButton(el, 'button.accept-all');
    acceptAll.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(el.shadowRoot?.activeElement).toBe(close);
  });

  it('Shift+Tab on the first focusable wraps focus to the last', async () => {
    const { el } = await mountModal();
    const dialog = el.shadowRoot?.querySelector('dialog');
    if (dialog === null || dialog === undefined) throw new Error('Expected dialog');
    const close = getButton(el, 'button.close');
    const acceptAll = getButton(el, 'button.accept-all');
    close.focus();
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(el.shadowRoot?.activeElement).toBe(acceptAll);
  });

  it('groups services by purpose when groupByPurpose=true', async () => {
    const { el } = await mountModal();
    const groups = el.shadowRoot?.querySelectorAll('simplecmp-purpose-group') ?? [];
    expect(groups.length).toBe(2); // analytics + marketing
  });

  it('renders a flat service list when groupByPurpose=false', async () => {
    const { el } = await mountModal({ groupByPurpose: false });
    const toggles = el.shadowRoot?.querySelectorAll('simplecmp-service-toggle') ?? [];
    expect(toggles.length).toBe(3);
    expect(el.shadowRoot?.querySelector('simplecmp-purpose-group')).toBeNull();
  });

  it('AcceptAll button confirms and saves all consents', async () => {
    const { el, manager } = await mountModal();
    let received: CustomEvent | null = null;
    el.addEventListener('simplecmp:accept', (e) => {
      received = e as CustomEvent;
    });
    getButton(el, 'button.accept-all').click();
    expect(received).not.toBeNull();
    expect(manager.confirmed).toBe(true);
    expect(manager.consents.analytics).toBe(true);
    expect(manager.consents.ads).toBe(true);
  });

  it('Decline button confirms with all consents off', async () => {
    const { el, manager } = await mountModal();
    let received: CustomEvent | null = null;
    el.addEventListener('simplecmp:decline', (e) => {
      received = e as CustomEvent;
    });
    getButton(el, 'button.decline').click();
    expect(received).not.toBeNull();
    expect(manager.confirmed).toBe(true);
    expect(manager.consents.analytics).toBe(false);
  });

  it('Save button persists current selection only', async () => {
    const { el, manager } = await mountModal();
    manager.updateConsent('analytics', true);
    let received: CustomEvent | null = null;
    el.addEventListener('simplecmp:save', (e) => {
      received = e as CustomEvent;
    });
    getButton(el, 'button.save').click();
    expect(received).not.toBeNull();
    expect(manager.confirmed).toBe(true);
    expect(manager.consents.analytics).toBe(true);
    expect(manager.consents.ads).toBe(false);
  });

  it('keeps decline + accept-all visible after confirmation (re-opened via trigger)', async () => {
    const { el, manager } = await mountModal();
    getButton(el, 'button.accept-all').click();
    expect(manager.confirmed).toBe(true);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('button.decline')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('button.accept-all')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('button.save')).not.toBeNull();
  });

  it('hides the close button when mustConsent=true', async () => {
    const { el } = await mountModal({ mustConsent: true });
    expect(el.shadowRoot?.querySelector('button.close')).toBeNull();
  });

  it('shows the close button when mustConsent is false', async () => {
    const { el } = await mountModal();
    expect(el.shadowRoot?.querySelector('button.close')).not.toBeNull();
  });

  it('emits simplecmp:modal-close exactly once when the close button is clicked', async () => {
    const { el } = await mountModal();
    el.open = true;
    await el.updateComplete;
    let count = 0;
    el.addEventListener('simplecmp:modal-close', () => {
      count++;
    });
    getButton(el, 'button.close').click();
    await el.updateComplete;
    expect(count).toBe(1);
  });

  it('emits simplecmp:modal-close exactly once on a backdrop click', async () => {
    const { el } = await mountModal();
    el.open = true;
    await el.updateComplete;
    let count = 0;
    el.addEventListener('simplecmp:modal-close', () => {
      count++;
    });
    const dialog = el.shadowRoot?.querySelector('dialog');
    if (dialog === null || dialog === undefined) throw new Error('Expected dialog');
    // Backdrop click = a click whose target is the dialog element itself.
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    expect(count).toBe(1);
  });

  it('mustConsent prevents the cancel event from closing', async () => {
    const { el } = await mountModal({ mustConsent: true });
    el.open = true;
    await el.updateComplete;
    const dialog = el.shadowRoot?.querySelector('dialog');
    if (dialog === null || dialog === undefined) throw new Error('Expected dialog');
    const cancel = new Event('cancel', { cancelable: true, bubbles: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });
});

describe('<simplecmp-service-toggle>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
  });

  async function getCheckbox(toggle: SimpleCmpServiceToggle): Promise<HTMLInputElement> {
    await toggle.updateComplete;
    const cb = toggle.shadowRoot?.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (cb === null || cb === undefined) throw new Error('Expected checkbox');
    return cb;
  }

  it('updates consent on toggle', async () => {
    const { el, manager } = await mountModal({ groupByPurpose: false });
    const toggle = el.shadowRoot?.querySelector<SimpleCmpServiceToggle>('simplecmp-service-toggle');
    if (toggle === null || toggle === undefined) throw new Error('Expected toggle');
    const checkbox = await getCheckbox(toggle);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(manager.consents.analytics).toBe(true);
  });

  it('disables the checkbox when service.required is true', async () => {
    const { el } = await mountModal({
      groupByPurpose: false,
      services: [{ name: 'session', purposes: ['functional'], required: true }],
    });
    const toggle = el.shadowRoot?.querySelector<SimpleCmpServiceToggle>('simplecmp-service-toggle');
    if (toggle === null || toggle === undefined) throw new Error('Expected toggle');
    const checkbox = await getCheckbox(toggle);
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(true);
  });
});

describe('<simplecmp-purpose-group>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
  });

  it('master toggle flips all services in the purpose', async () => {
    const { el, manager } = await mountModal();
    const group = el.shadowRoot?.querySelector<SimpleCmpPurposeGroup>('simplecmp-purpose-group');
    if (group === null || group === undefined) throw new Error('Expected purpose-group');
    await group.updateComplete;
    const checkbox = group.shadowRoot?.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (checkbox === null || checkbox === undefined) throw new Error('Expected checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    // The 'analytics' purpose has analytics + gtag services
    expect(manager.consents.analytics).toBe(true);
    expect(manager.consents.gtag).toBe(true);
    expect(manager.consents.ads).toBe(false); // marketing is a different purpose
  });
});
