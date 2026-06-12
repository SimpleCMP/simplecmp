/**
 * REQ-N10 / ADR-0016 — Google Consent Mode v2 emission hook.
 *
 * Verifies the `default` command derives from the regime/GPC default consent,
 * the returning-visitor replay, per-decision updates, the purpose→signal
 * mapping, dynamic ads_data_redaction, the GTM event, and — critically — the
 * canonical `arguments`-object shim (a plain-array push silently breaks GTM's
 * consent reading).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsentManager } from './consent-manager.js';
import type { ConsentConfig, Service } from './consent-manager.js';
import { installConsentMode } from './consent-mode.js';
import type { Store } from './stores.js';

const SERVICES: Service[] = [
  { name: 'ga4', purposes: ['analytics'] },
  { name: 'gads', purposes: ['marketing'] },
];

function storeReturning(value: string | null): Store {
  return { get: () => value, set: () => undefined, delete: () => undefined };
}

function makeManager(
  overrides: Partial<ConsentConfig> = {},
  stored: string | null = null
): ConsentManager {
  const config: ConsentConfig = {
    storageName: 'cm-test',
    services: SERVICES,
    ...overrides,
  };
  return new ConsentManager(config, storeReturning(stored));
}

interface DL extends Array<unknown> {}
function dataLayer(): DL {
  return (window as unknown as { dataLayer: DL }).dataLayer ?? [];
}

/** Consent commands as `{mode, map}` (filters out `set`/event pushes). */
function consentCommands(): { mode: string; map: Record<string, unknown> }[] {
  return dataLayer()
    .filter((e): e is IArguments => {
      const a = e as IArguments;
      return typeof a === 'object' && a !== null && a[0] === 'consent';
    })
    .map((a) => ({ mode: a[1] as string, map: a[2] as Record<string, unknown> }));
}

function setCommands(): { key: unknown; value: unknown }[] {
  return dataLayer()
    .filter((e): e is IArguments => (e as IArguments)[0] === 'set')
    .map((a) => ({ key: a[1], value: a[2] }));
}

beforeEach(() => {
  const w = window as unknown as { dataLayer?: unknown; gtag?: unknown };
  // biome-ignore lint/performance/noDelete: test isolation — reset the global shim between cases.
  delete w.dataLayer;
  // biome-ignore lint/performance/noDelete: test isolation.
  delete w.gtag;
});

afterEach(() => {
  const nav = navigator as unknown as { globalPrivacyControl?: boolean };
  if ('globalPrivacyControl' in nav) {
    // biome-ignore lint/performance/noDelete: clear the GPC flag set by a test.
    delete nav.globalPrivacyControl;
  }
});

describe('default command', () => {
  it('opt-in → all mapped signals denied', () => {
    installConsentMode(true, makeManager({ regimeDefault: 'opt-in' }), SERVICES);
    const [def] = consentCommands();
    expect(def.mode).toBe('default');
    expect(def.map.analytics_storage).toBe('denied');
    expect(def.map.ad_storage).toBe('denied');
    expect(def.map.ad_user_data).toBe('denied');
    expect(def.map.ad_personalization).toBe('denied');
    expect(def.map.security_storage).toBe('granted');
    expect(def.map.wait_for_update).toBe(500);
  });

  it('opt-out → mapped signals granted', () => {
    installConsentMode(true, makeManager({ regimeDefault: 'opt-out' }), SERVICES);
    const [def] = consentCommands();
    expect(def.map.analytics_storage).toBe('granted');
    expect(def.map.ad_storage).toBe('granted');
  });

  it('GPC forces denied even in opt-out', () => {
    (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl = true;
    installConsentMode(true, makeManager({ regimeDefault: 'opt-out' }), SERVICES);
    const [def] = consentCommands();
    expect(def.map.analytics_storage).toBe('denied');
    expect(def.map.ad_storage).toBe('denied');
  });

  it('contains only mapped signals + security_storage (unmapped stay unset)', () => {
    installConsentMode(true, makeManager({ regimeDefault: 'opt-in' }), SERVICES);
    const [def] = consentCommands();
    expect(Object.keys(def.map).sort()).toEqual(
      [
        'ad_personalization',
        'ad_storage',
        'ad_user_data',
        'analytics_storage',
        'security_storage',
        'wait_for_update',
      ].sort()
    );
    expect(def.map.functionality_storage).toBeUndefined();
    expect(def.map.personalization_storage).toBeUndefined();
  });
});

describe('shim form', () => {
  it('pushes arguments objects, not arrays', () => {
    installConsentMode(true, makeManager(), SERVICES);
    const first = dataLayer()[0];
    expect(Array.isArray(first)).toBe(false);
    expect((first as IArguments)[0]).toBe('consent');
  });

  it('reuses a pre-existing gtag/dataLayer without clobbering', () => {
    const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
    w.dataLayer = [];
    const existing = (...a: unknown[]): void => {
      w.dataLayer.push(a);
    };
    w.gtag = existing;
    installConsentMode(true, makeManager(), SERVICES);
    expect(w.gtag).toBe(existing);
  });
});

describe('replay (returning visitor)', () => {
  it('emits default then update from stored consent', () => {
    const manager = makeManager({ regimeDefault: 'opt-in' });
    manager.changeAll(true);
    manager.saveConsents(); // marks confirmed
    installConsentMode(true, manager, SERVICES);
    const cmds = consentCommands();
    expect(cmds[0].mode).toBe('default');
    expect(cmds[0].map.analytics_storage).toBe('denied');
    expect(cmds[1].mode).toBe('update');
    expect(cmds[1].map.analytics_storage).toBe('granted');
    expect(cmds[1].map.ad_storage).toBe('granted');
  });

  it('first-time visitor gets default only (no premature update)', () => {
    installConsentMode(true, makeManager({ regimeDefault: 'opt-in' }), SERVICES);
    expect(consentCommands()).toHaveLength(1);
    expect(consentCommands()[0].mode).toBe('default');
  });
});

describe('update on decision', () => {
  it('grants a signal only when a consented service carries the mapped purpose', () => {
    const manager = makeManager({ regimeDefault: 'opt-in' });
    installConsentMode(true, manager, SERVICES);
    manager.updateConsent('ga4', true); // analytics only
    manager.saveConsents();
    const last = consentCommands().at(-1);
    expect(last?.mode).toBe('update');
    expect(last?.map.analytics_storage).toBe('granted');
    expect(last?.map.ad_storage).toBe('denied');
  });

  it('stops emitting after uninstall', () => {
    const manager = makeManager();
    const uninstall = installConsentMode(true, manager, SERVICES);
    const before = consentCommands().length;
    uninstall();
    manager.changeAll(true);
    manager.saveConsents();
    expect(consentCommands().length).toBe(before);
  });
});

describe('dataLayer GTM event', () => {
  it('pushes the event by default on update', () => {
    const manager = makeManager();
    installConsentMode(true, manager, SERVICES);
    manager.changeAll(true);
    manager.saveConsents();
    const events = dataLayer().filter(
      (e) => !Array.isArray(e) && (e as { event?: string }).event === 'simplecmp_consent_update'
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('omits the event when dataLayerEvent: false', () => {
    const manager = makeManager();
    installConsentMode({ dataLayerEvent: false }, manager, SERVICES);
    manager.changeAll(true);
    manager.saveConsents();
    const events = dataLayer().filter(
      (e) => !Array.isArray(e) && typeof (e as { event?: string }).event === 'string'
    );
    expect(events).toHaveLength(0);
  });
});

describe('ads_data_redaction (dynamic)', () => {
  it('redacts while ad_storage denied, clears once granted', () => {
    const manager = makeManager({ regimeDefault: 'opt-in' });
    installConsentMode({ redactAdsData: true }, manager, SERVICES);
    // before consent: ad_storage denied → redaction true
    expect(setCommands().at(-1)).toEqual({ key: 'ads_data_redaction', value: true });
    manager.changeAll(true);
    manager.saveConsents();
    expect(setCommands().at(-1)).toEqual({ key: 'ads_data_redaction', value: false });
  });

  it('is a no-op when ad_storage is not mapped', () => {
    const manager = makeManager();
    installConsentMode(
      { redactAdsData: true, purposeSignals: { analytics: ['analytics_storage'] } },
      manager,
      SERVICES
    );
    expect(setCommands()).toHaveLength(0);
  });
});
