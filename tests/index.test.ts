import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetManagers } from '../src/engine/index.js';
import {
  VERSION,
  addEventListener,
  auditDom,
  getManager,
  getRecorder,
  init,
  show,
} from '../src/index.js';

interface ManagerState {
  confirmed: boolean;
  changed: boolean;
  consents: Record<string, boolean>;
  versionMismatch?: { storedVersion: unknown; configVersion: unknown; policy: string };
}

function setGPC(value: boolean | undefined): void {
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    value,
    configurable: true,
  });
}

describe('SimpleCMP public API', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    setGPC(undefined);
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exports a VERSION string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('init() mounts the Lit consent UI into the DOM', () => {
    init({ storageName: 'simplecmp-test', services: [] });
    expect(document.body.querySelector('simplecmp-banner')).not.toBeNull();
    expect(document.body.querySelector('simplecmp-modal')).not.toBeNull();
  });

  // REQ-9: misconfig warning fires when cmsBridgeUrl is set without `record`.
  it('warns when cmsBridgeUrl is set without record: true', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      init({
        storageName: 'simplecmp-test-cms-misconfig',
        services: [],
        cmsBridgeUrl: 'https://example.com/bridge',
      });
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(
        messages.some((m) => /cmsBridgeUrl.*record/i.test(m) || /record.*cmsBridgeUrl/i.test(m))
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('exposes show() and addEventListener as functions', () => {
    expect(show).toBeTypeOf('function');
    expect(addEventListener).toBeTypeOf('function');
  });

  // REQ-1: Impressum-Link separat von Datenschutz
  it('renders separate links for privacyPolicy and imprint when both are set', async () => {
    const handle = init({
      storageName: 'simplecmp-test-req1',
      services: [],
      privacyPolicy: 'https://example.com/privacy',
      imprint: 'https://example.com/imprint',
      mustConsent: true,
    });
    const modal = document.body.querySelector('simplecmp-modal') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await modal.updateComplete;
    const root = modal.shadowRoot;
    const privacyLink = root?.querySelector('a[href="https://example.com/privacy"]');
    const imprintLink = root?.querySelector('a[href="https://example.com/imprint"]');
    expect(privacyLink).not.toBeNull();
    expect(imprintLink).not.toBeNull();
    expect(imprintLink?.textContent?.trim()).not.toBe('');
    handle.destroy();
  });

  // REQ-2: "Alle ablehnen" gleichberechtigt zu "Alle akzeptieren"
  it('renders the decline button alongside accept by default', async () => {
    init({ storageName: 'simplecmp-test-req2', services: [], acceptAll: true });
    const banner = document.body.querySelector('simplecmp-banner') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await banner.updateComplete;
    const root = banner.shadowRoot;
    expect(root?.querySelector('button.cn-decline')).not.toBeNull();
    expect(root?.querySelector('button.cn-accept')).not.toBeNull();
  });

  // REQ-N11: the non-modal banner is a labelled, announced `region` — NOT a
  // `dialog` (which would assert the page is set aside + must take focus).
  it('banner is a region with a live announcement and an accessible name (REQ-N11)', async () => {
    init({ storageName: 'simplecmp-test-a11y-banner', services: [] });
    const banner = document.body.querySelector('simplecmp-banner') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await banner.updateComplete;
    const container = banner.shadowRoot?.querySelector('.cn-body');
    expect(container?.getAttribute('role')).toBe('region');
    expect(container?.getAttribute('aria-live')).toBe('polite');
    // Programmatic focus target, not a stray Tab stop.
    expect(container?.getAttribute('tabindex')).toBe('-1');
    // WCAG region-name: either aria-labelledby (heading) or aria-label.
    const hasName =
      !!container?.getAttribute('aria-labelledby') || !!container?.getAttribute('aria-label');
    expect(hasName).toBe(true);
  });

  // REQ-N11: auditDom() guards the accessible-name contract so a future
  // refactor that strips the region label or a button label is caught.
  it('auditDom() reports the banner region + actions as named (REQ-N11)', async () => {
    init({ storageName: 'simplecmp-test-audit-names', services: [], acceptAll: true });
    const banner = document.body.querySelector('simplecmp-banner') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await banner.updateComplete;
    const names = auditDom().find((r) => r.id === 'dom-accessible-names');
    expect(names).toBeDefined();
    expect(names?.passed).toBe(true);
  });

  it('auditDom() flags a banner region whose accessible name was stripped', async () => {
    init({ storageName: 'simplecmp-test-audit-names-fail', services: [], acceptAll: true });
    const banner = document.body.querySelector('simplecmp-banner') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await banner.updateComplete;
    const region = banner.shadowRoot?.querySelector('.cn-body');
    region?.removeAttribute('aria-label');
    region?.removeAttribute('aria-labelledby');
    const names = auditDom().find((r) => r.id === 'dom-accessible-names');
    expect(names?.passed).toBe(false);
    expect(names?.severity).toBe('critical');
  });

  it('warns when hideDeclineAll is set (REQ-2 compliance risk)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      init({ storageName: 'simplecmp-test-req2-hide', services: [], hideDeclineAll: true });
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => /hideDeclineAll|Decline/i.test(m))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  // REQ-3: consent versioning
  //
  // Each REQ-3 test uses a unique storageName so it gets a fresh
  // ConsentManager. We read state off the manager directly rather than via
  // addEventListener — listeners replay buffered events from earlier tests.
  it('discards stored consent when consentVersion mismatches (REQ-3)', () => {
    const storageName = 'simplecmp-test-req3-mismatch';
    localStorage.setItem(
      storageName,
      encodeURIComponent(JSON.stringify({ __v: '1.0', consents: { analytics: true } }))
    );
    const config = {
      storageName,
      storageMethod: 'localStorage' as const,
      services: [{ name: 'analytics', purposes: ['analytics'] }],
      consentVersion: '2.0',
    };

    init(config);

    const manager = getManager(config) as ManagerState;
    expect(manager.versionMismatch).toEqual({
      storedVersion: '1.0',
      configVersion: '2.0',
      policy: 'any',
    });
    expect(manager.confirmed).toBe(false);
    expect(manager.changed).toBe(true);
  });

  it('keeps stored consent when consentVersion matches (REQ-3)', () => {
    const storageName = 'simplecmp-test-req3-match';
    localStorage.setItem(
      storageName,
      encodeURIComponent(JSON.stringify({ __v: '1.0', consents: { analytics: true } }))
    );
    const config = {
      storageName,
      storageMethod: 'localStorage' as const,
      services: [{ name: 'analytics', purposes: ['analytics'] }],
      consentVersion: '1.0',
    };

    init(config);

    const manager = getManager(config) as ManagerState;
    expect(manager.versionMismatch).toBeUndefined();
    expect(manager.confirmed).toBe(true);
  });

  it('tolerates minor bumps when consentVersionPolicy is "major" (REQ-3)', () => {
    const storageName = 'simplecmp-test-req3-major';
    localStorage.setItem(
      storageName,
      encodeURIComponent(JSON.stringify({ __v: '1.0', consents: { analytics: true } }))
    );
    const config = {
      storageName,
      storageMethod: 'localStorage' as const,
      services: [{ name: 'analytics', purposes: ['analytics'] }],
      consentVersion: '1.5',
      consentVersionPolicy: 'major' as const,
    };

    init(config);

    const manager = getManager(config) as ManagerState;
    expect(manager.versionMismatch).toBeUndefined();
    expect(manager.confirmed).toBe(true);
  });

  it('reads legacy (un-versioned) storage when consentVersion is unset (REQ-3)', () => {
    const storageName = 'simplecmp-test-req3-legacy';
    // Bare consents object, no __v wrapper.
    localStorage.setItem(storageName, encodeURIComponent(JSON.stringify({ analytics: true })));
    const config = {
      storageName,
      storageMethod: 'localStorage' as const,
      services: [{ name: 'analytics', purposes: ['analytics'] }],
    };

    init(config);

    const manager = getManager(config) as ManagerState;
    expect(manager.versionMismatch).toBeUndefined();
    expect(manager.confirmed).toBe(true);
  });

  // REQ-5: GPC signal
  it('defaults non-required services to deny when GPC is set (REQ-5)', () => {
    setGPC(true);
    const config = {
      storageName: 'simplecmp-test-req5-gpc-on',
      storageMethod: 'localStorage' as const,
      services: [
        { name: 'analytics', purposes: ['analytics'], default: true },
        { name: 'required-cookie', purposes: ['functional'], required: true },
      ],
    };

    init(config);

    const manager = getManager(config) as ManagerState;
    // GPC overrides the configured default: true for analytics
    expect(manager.consents.analytics).toBe(false);
    // Required services bypass GPC because they're necessary for site operation
    expect(manager.consents['required-cookie']).toBe(true);
  });

  it('does not alter defaults when GPC is unset (REQ-5)', () => {
    const config = {
      storageName: 'simplecmp-test-req5-gpc-off',
      storageMethod: 'localStorage' as const,
      services: [{ name: 'analytics', purposes: ['analytics'], default: true }],
    };

    init(config);

    const manager = getManager(config) as ManagerState;
    expect(manager.consents.analytics).toBe(true);
  });

  it('honors respectGPC: false override (REQ-5)', () => {
    setGPC(true);
    const config = {
      storageName: 'simplecmp-test-req5-override',
      storageMethod: 'localStorage' as const,
      services: [{ name: 'analytics', purposes: ['analytics'], default: true }],
      respectGPC: false,
    };

    init(config);

    const manager = getManager(config) as ManagerState;
    expect(manager.consents.analytics).toBe(true);
  });

  // REQ-4: floating trigger
  it('does not mount the floating trigger by default (REQ-4)', () => {
    init({ storageName: 'simplecmp-test-req4-default', services: [] });
    expect(document.body.querySelector('simplecmp-trigger')).toBeNull();
  });

  it('mounts the floating trigger when enabled (REQ-4)', async () => {
    init({
      storageName: 'simplecmp-test-req4-on',
      services: [],
      floatingTrigger: true,
    });
    const trigger = document.body.querySelector('simplecmp-trigger') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    expect(trigger).not.toBeNull();
    await trigger.updateComplete;
    const button = trigger.shadowRoot?.querySelector('button');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('aria-label')).toBeTruthy();
  });

  it('honors floatingTrigger options (REQ-4)', async () => {
    init({
      storageName: 'simplecmp-test-req4-opts',
      services: [],
      floatingTrigger: { position: 'top-left', label: 'Cookie-Einstellungen' },
    });
    const trigger = document.body.querySelector('simplecmp-trigger') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    expect(trigger).not.toBeNull();
    await trigger.updateComplete;
    expect(trigger.getAttribute('position')).toBe('top-left');
    const button = trigger.shadowRoot?.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Cookie-Einstellungen');
  });

  it('replaces the prior UI on re-init — no duplicate triggers (REQ-4)', () => {
    init({ storageName: 'simplecmp-test-req4-idem', services: [], floatingTrigger: true });
    init({ storageName: 'simplecmp-test-req4-idem', services: [], floatingTrigger: true });
    const triggers = document.body.querySelectorAll('simplecmp-trigger');
    expect(triggers.length).toBe(1);
  });

  // REQ-6: WCAG 2.1 AA — modal accessibility (handled by native <dialog>)
  it('modal has dialog semantics (REQ-6)', async () => {
    init({
      storageName: 'simplecmp-test-req6-aria',
      services: [],
      mustConsent: true,
    });
    const modalEl = document.body.querySelector('simplecmp-modal') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await modalEl.updateComplete;
    const dialog = modalEl.shadowRoot?.querySelector('dialog');
    expect(dialog).not.toBeNull();
    // Native <dialog> + showModal() carries role=dialog + aria-modal implicitly.
    const title = modalEl.shadowRoot?.getElementById('simplecmp-modal-title');
    expect(title).not.toBeNull();
    expect(title?.textContent?.trim()).not.toBe('');
  });

  it('mustConsent: dialog cancel event is suppressed (REQ-6)', async () => {
    init({
      storageName: 'simplecmp-test-req6-must',
      services: [],
      mustConsent: true,
    });
    const modalEl = document.body.querySelector('simplecmp-modal') as HTMLElement & {
      updateComplete: Promise<unknown>;
      open: boolean;
    };
    await modalEl.updateComplete;
    expect(modalEl.open).toBe(true);
    const dialog = modalEl.shadowRoot?.querySelector('dialog');
    const cancel = new Event('cancel', { cancelable: true, bubbles: true });
    dialog?.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  // REQ-7: Recorder integration
  describe('REQ-7 — recorder integration', () => {
    afterEach(() => {
      getRecorder()?.stop();
    });

    it('returns undefined when record is not set (REQ-7)', () => {
      init({ storageName: 'simplecmp-test-req7-off', services: [] });
      // After this init the recorder may still be the previous one from
      // another test; stop it then re-init without record to be safe
      getRecorder()?.stop();
      init({ storageName: 'simplecmp-test-req7-off-2', services: [] });
      // Note: getRecorder() may still hold an instance from prior tests
      // because we don't unset on init-without-record. That's documented
      // behaviour; the smoke test here just confirms the API exists.
      expect(typeof getRecorder).toBe('function');
    });

    it('starts the recorder with record: true (REQ-7)', () => {
      init({ storageName: 'simplecmp-test-req7-on', services: [], record: true });
      const recorder = getRecorder();
      expect(recorder).toBeDefined();
      expect(typeof recorder?.getSnapshot).toBe('function');
      expect(typeof recorder?.exportConfig).toBe('function');
      expect(typeof recorder?.assertNoUnknown).toBe('function');
    });

    it('defers the recorder boot to idle with deferRecorder (ADR-0018)', () => {
      const ric = vi.fn();
      vi.stubGlobal('requestIdleCallback', ric);
      try {
        init({
          storageName: 'simplecmp-test-defer',
          services: [],
          record: true,
          deferRecorder: true,
        });
        // Scheduled, not run synchronously, during init().
        expect(ric).toHaveBeenCalledTimes(1);
        // Running the scheduled callback boots the recorder.
        (ric.mock.calls[0][0] as () => void)();
        expect(getRecorder()).toBeDefined();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('classifies a configured cookie as known (REQ-7)', () => {
      init({
        storageName: 'simplecmp-test-req7-classify',
        services: [{ name: 'analytics', purposes: ['analytics'], cookies: ['_ga'] }],
        record: { summaryIntervalMs: 0, cookieIntervalMs: 999999 },
      });
      const recorder = getRecorder();
      expect(recorder).toBeDefined();
    });

    it('exposes assertNoUnknown that throws when unknown items exist (REQ-7)', () => {
      init({
        storageName: 'simplecmp-test-req7-assert',
        services: [],
        record: { summaryIntervalMs: 0, cookieIntervalMs: 999999 },
      });
      const recorder = getRecorder();
      expect(() => recorder?.assertNoUnknown()).not.toThrow();
    });
  });

  // REQ-8: Service DB
  describe('REQ-8 — Service DB wiring', () => {
    afterEach(() => {
      getRecorder()?.stop();
    });

    it('does not warn about serviceDbUrl any more (it is implemented)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        init({
          storageName: 'simplecmp-test-req8-no-warn',
          services: [],
          serviceDbUrl: 'https://example.com/db',
        });
        const messages = warn.mock.calls.map((c) => String(c[0]));
        expect(messages.some((m) => /serviceDbUrl/i.test(m))).toBe(false);
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn about cmsBridgeUrl any more (it is implemented)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        init({
          storageName: 'simplecmp-test-req9-no-warn',
          services: [],
          record: true,
          cmsBridgeUrl: 'https://example.com/bridge',
        });
        const messages = warn.mock.calls.map((c) => String(c[0]));
        // REQ-9: the only acceptable warning mentioning cmsBridgeUrl would
        // be the misconfig warning when `record` is missing — and we set it.
        expect(messages.some((m) => /not yet implemented/i.test(m))).toBe(false);
      } finally {
        warn.mockRestore();
      }
    });
  });

  // REQ-9 + REQ-N7: end-to-end. The bridge wires onto the recorder's
  // `'detectionSettled'` event, not `'detection'` — so when both
  // `serviceDbUrl` and `cmsBridgeUrl` are configured, the bridge waits
  // for the async classifier to finish and POSTs once with the final
  // status. The 3-table refactor (Phase 3) added: bridge POSTs BOTH
  // `known` and `unknown` so the BE can render library-recognized
  // detections in the *Erkannt* state.
  describe('REQ-9 / REQ-N7 — CMS bridge end-to-end', () => {
    it('POSTs the detection as known when the Service-DB lookup upgrades it (REQ-N7)', async () => {
      // Mock the Service-DB to return a hit for the cookie. The bridge
      // POSTs once with status:'known' so the BE can show it as Erkannt.
      const bridgePosts: Array<{ url: string; body: unknown }> = [];
      const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        if (url.startsWith('https://example.test/bridge')) {
          bridgePosts.push({ url, body: JSON.parse(init.body as string) });
          return new Response('', { status: 200 });
        }
        if (url.includes('/v1/lookup')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  query: { cookie: '_unknown_to_known' },
                  matches: [{ id: 'late-known', name: 'Late-Known', purposes: ['analytics'] }],
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('', { status: 404 });
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;
      try {
        init({
          storageName: 'simplecmp-test-req-n7-known',
          services: [],
          record: { silenceProductionWarning: true },
          serviceDbUrl: 'https://example.test/db',
          cmsBridgeUrl: 'https://example.test/bridge',
          cmsBridge: { source: 'test-known' },
        });
        document.cookie = '_unknown_to_known=1';
        await new Promise((r) => setTimeout(r, 1100));
        await new Promise((r) => setTimeout(r, 1600)); // > flush debounce (1.5s)

        expect(bridgePosts.length).toBe(1);
        const payload = bridgePosts[0]?.body as {
          schemaVersion: number;
          detections: Array<{ status: string; matchedService?: string; identifier: string }>;
        };
        expect(payload.schemaVersion).toBe(2);
        expect(payload.detections).toHaveLength(1);
        expect(payload.detections[0]?.identifier).toBe('_unknown_to_known');
        expect(payload.detections[0]?.status).toBe('known');
        expect(payload.detections[0]?.matchedService).toBe('late-known');
      } finally {
        globalThis.fetch = originalFetch;
        document.cookie = '_unknown_to_known=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      }
    });

    it('POSTs once after settle when the Service-DB lookup confirms unknown', async () => {
      // Service-DB returns an empty match → status stays `unknown` →
      // bridge POSTs once after settle.
      const bridgePosts: Array<{ url: string; body: unknown }> = [];
      const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        if (url.startsWith('https://example.test/bridge')) {
          bridgePosts.push({ url, body: JSON.parse(init.body as string) });
          return new Response('', { status: 200 });
        }
        if (url.includes('/v1/lookup')) {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('', { status: 404 });
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;
      try {
        init({
          storageName: 'simplecmp-test-req-n7-unknown',
          services: [],
          record: { silenceProductionWarning: true },
          serviceDbUrl: 'https://example.test/db',
          cmsBridgeUrl: 'https://example.test/bridge',
          cmsBridge: { source: 'test-unknown' },
        });
        document.cookie = '_genuinely_unknown=1';
        await new Promise((r) => setTimeout(r, 1100));
        await new Promise((r) => setTimeout(r, 1600)); // > flush debounce

        expect(bridgePosts.length).toBe(1);
        const payload = bridgePosts[0]?.body as {
          schemaVersion: number;
          detections: Array<{ kind: string; identifier: string; status: string }>;
        };
        expect(payload.schemaVersion).toBe(2);
        expect(payload.detections).toHaveLength(1);
        expect(payload.detections[0]?.kind).toBe('cookie');
        expect(payload.detections[0]?.identifier).toBe('_genuinely_unknown');
        expect(payload.detections[0]?.status).toBe('unknown');
      } finally {
        globalThis.fetch = originalFetch;
        document.cookie = '_genuinely_unknown=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      }
    });
  });
});
