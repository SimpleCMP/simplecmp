/**
 * Click-to-enable / auto-placeholder behaviour.
 *
 * When a `[data-name="<service>"]` element is blocked by absent consent,
 * the engine auto-inserts a `<simplecmp-contextual-notice>` as its
 * immediate following sibling so the visitor can grant consent inline.
 * On consent flip, the notice is removed. The Service-level
 * `noAutoPlaceholder`, the global `config.autoContextualPlaceholder`,
 * and the element-level `data-no-placeholder` all opt out.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConsentConfig } from '../src/engine/index.js';
import { getManager, resetManagers } from '../src/engine/index.js';
// Side-effect import registers <simplecmp-contextual-notice> so the
// engine's auto-placeholder logic (and the per-state render tests
// below) have a real custom element to upgrade. Mirrors the
// `src/ui/init.ts` runtime path. See `memory/lit_component_engine_creation.md`
// for the durable lesson.
import '../src/ui/components/contextual-notice.js';

function makeConfig(extra: Partial<ConsentConfig> = {}): ConsentConfig {
  return {
    storageName: 'simplecmp-auto-placeholder-test',
    storageMethod: 'localStorage',
    services: [
      {
        name: 'youtube',
        purposes: ['marketing'],
        default: false,
        placeholderTitle: 'YouTube',
      },
    ],
    ...extra,
  };
}

function makeBlockedIframe(serviceName: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-name', serviceName);
  iframe.setAttribute('data-src', 'https://www.youtube.com/embed/test');
  document.body.appendChild(iframe);
  return iframe;
}

function autoPlaceholderFor(serviceName: string): Element | null {
  return document.querySelector(
    `[data-simplecmp-auto-placeholder][data-simplecmp-for="${serviceName}"]`
  );
}

describe('auto-placeholder click-to-enable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetManagers();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('inserts a contextual notice next to a blocked iframe', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    const notice = autoPlaceholderFor('youtube');
    expect(notice).not.toBeNull();
    expect(notice?.tagName.toLowerCase()).toBe('simplecmp-contextual-notice');
    expect(notice?.getAttribute('service-name')).toBe('youtube');
  });

  it('removes the notice when consent flips to true', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();
    expect(autoPlaceholderFor('youtube')).not.toBeNull();

    // Mirror what `<simplecmp-contextual-notice>` does on Accept:
    // updateConsent + interactive applyConsents scoped to the service.
    manager.updateConsent('youtube', true);
    manager.applyConsents(false, true, 'youtube');

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('is idempotent — repeated applyConsents with consent:false does not stack notices', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();
    manager.applyConsents();
    manager.applyConsents();

    const notices = document.querySelectorAll(
      '[data-simplecmp-auto-placeholder][data-simplecmp-for="youtube"]'
    );
    expect(notices.length).toBe(1);
  });

  it('skips when service.noAutoPlaceholder is true', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(
      makeConfig({
        services: [
          {
            name: 'youtube',
            purposes: ['marketing'],
            default: false,
            noAutoPlaceholder: true,
          },
        ],
      })
    );
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('skips when config.autoContextualPlaceholder is false', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig({ autoContextualPlaceholder: false }));
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('skips when the element has data-no-placeholder', () => {
    const iframe = makeBlockedIframe('youtube');
    iframe.setAttribute('data-no-placeholder', '');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('inserts one notice per blocked element on the page', () => {
    makeBlockedIframe('youtube');
    makeBlockedIframe('youtube');
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    const notices = document.querySelectorAll(
      '[data-simplecmp-auto-placeholder][data-simplecmp-for="youtube"]'
    );
    expect(notices.length).toBe(3);
  });

  it('does not auto-insert next to an integrator-authored placeholder element (data-type="placeholder")', () => {
    const div = document.createElement('div');
    div.setAttribute('data-name', 'youtube');
    div.setAttribute('data-type', 'placeholder');
    document.body.appendChild(div);
    const manager = getManager(makeConfig());
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('sets blocked iframe src to about:blank, not the empty string', () => {
    // Regression for the Klaro-heritage bug where src="" was treated by
    // browsers as a relative URL pointing to the current page — the
    // blocked iframe would load the host page recursively inside
    // itself. about:blank is the standard "explicitly empty document"
    // URL and doesn't trigger any network request.
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-name="youtube"]');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('about:blank');
  });

  it('inserts a notice next to a blocked <script> element', () => {
    const script = document.createElement('script');
    script.setAttribute('data-name', 'youtube');
    script.setAttribute('data-src', 'https://example.com/analytics.js');
    script.setAttribute('data-type', 'text/javascript');
    document.body.appendChild(script);

    const manager = getManager(makeConfig());
    manager.applyConsents();

    const notice = autoPlaceholderFor('youtube');
    expect(notice).not.toBeNull();
    expect(notice?.previousElementSibling?.tagName.toLowerCase()).toBe('script');
  });

  // --- ADR-0013 Phase 4 step 4c: three-state notice rendering ----------
  //
  // The Phase 1 server-side rewriter can produce `[data-name]` elements
  // for services NOT in `config.services` — either library-known (`data-
  // blocked-source="library"`) or universalBlock-derived (`data-blocked-
  // source="host"`). The notice has three render modes; these tests lock
  // the button visibility per mode.

  it('state 2 (library, not in config) — renders accept-once only, hides Immer + Cookie-Einstellungen', async () => {
    // Service NOT in config.services but Phase 1 marked the host as
    // library-known. Visitor recognises the brand → "Ja" is informed.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-name', 'unknown-but-library-known');
    iframe.setAttribute('data-src', 'https://library-known.example/embed');
    iframe.setAttribute('data-blocked-source', 'library');
    document.body.appendChild(iframe);

    // Manually insert a contextual notice with the same data-name. The
    // engine's auto-placeholder skips unknown services (legitimate
    // legacy behavior); here we exercise the notice's own render-mode
    // logic in isolation.
    const notice = document.createElement('simplecmp-contextual-notice');
    notice.setAttribute('service-name', 'unknown-but-library-known');
    notice.setAttribute('data-blocked-source', 'library');
    (
      notice as unknown as { config: ConsentConfig; manager: ReturnType<typeof getManager> }
    ).config = makeConfig();
    (notice as unknown as { manager: ReturnType<typeof getManager> }).manager = getManager(
      makeConfig()
    );
    document.body.appendChild(notice);
    await (notice as unknown as { updateComplete: Promise<void> }).updateComplete;

    const shadow = notice.shadowRoot;
    expect(shadow).not.toBeNull();
    const buttons = Array.from(shadow?.querySelectorAll('button') ?? []);
    const classes = buttons.map((b) => b.className);
    // Exactly one button — the accept-once. (Asserting on CSS class
    // rather than label so the test doesn't depend on translation data
    // being wired up in this test config.)
    expect(buttons).toHaveLength(1);
    expect(classes).toEqual(['accept-once']);
  });

  it('state 3 (host-derived) — renders informational notice with NO buttons', async () => {
    // Universal-block caught an unknown third-party host. Visitor has
    // no basis to grant informed consent → admin contact is the only
    // path forward.
    const notice = document.createElement('simplecmp-contextual-notice');
    notice.setAttribute('service-name', 'random-tracker.example');
    notice.setAttribute('data-blocked-source', 'host');
    (
      notice as unknown as { config: ConsentConfig; manager: ReturnType<typeof getManager> }
    ).config = makeConfig();
    (notice as unknown as { manager: ReturnType<typeof getManager> }).manager = getManager(
      makeConfig()
    );
    document.body.appendChild(notice);
    await (notice as unknown as { updateComplete: Promise<void> }).updateComplete;

    const shadow = notice.shadowRoot;
    expect(shadow).not.toBeNull();
    // The key property of state 3: NO consent buttons. Visitor has no
    // basis for informed consent — admin contact is the only path.
    expect(shadow?.querySelectorAll('button')).toHaveLength(0);
    // The notice renders an informational `<p>` (the description).
    // The translation lookup itself depends on the engine's i18n table
    // being wired into the test config, which isn't done here; the
    // engine-level i18n tests cover that path.
    expect(shadow?.querySelector('p')).not.toBeNull();
  });

  it('state 1 (in config) — renders full set: accept-once + Immer (if stored) + Cookie-Einstellungen', async () => {
    // The existing baseline — make sure my render-mode refactor didn't
    // regress the configured-service path.
    const notice = document.createElement('simplecmp-contextual-notice');
    notice.setAttribute('service-name', 'youtube');
    (
      notice as unknown as { config: ConsentConfig; manager: ReturnType<typeof getManager> }
    ).config = makeConfig();
    const manager = getManager(makeConfig());
    // Mark store as having a saved consent so the "Always" button shows.
    manager.saveConsents('initial-test');
    (notice as unknown as { manager: ReturnType<typeof getManager> }).manager = manager;
    document.body.appendChild(notice);
    await (notice as unknown as { updateComplete: Promise<void> }).updateComplete;

    const buttons = Array.from(notice.shadowRoot?.querySelectorAll('button') ?? []);
    const classes = buttons.map((b) => b.className).sort();
    // All three button classes present (asserting on CSS class — the
    // labels would require the engine's translation tables to be wired
    // into the test config).
    expect(classes).toEqual(['accept', 'accept-once', 'configure']);
  });
});
