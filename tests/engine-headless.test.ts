/**
 * REQ-N2 — Headless-Modus smoke test.
 *
 * Confirms the `src/engine/index.ts` module is self-contained: importing
 * it gives a working consent state-machine without pulling in any UI
 * (Lit, banner/modal components) or initializing DOM. Consumers reach
 * this surface in production via the `simplecmp/engine` subpath export
 * from `package.json`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  addEventListener,
  fireEvent,
  getManager,
  resetManagers,
  validateConfig,
  version,
} from '../src/engine/index.js';
import type { ConsentConfig } from '../src/engine/index.js';

const headlessConfig: ConsentConfig = {
  storageName: 'simplecmp-headless-test',
  storageMethod: 'localStorage',
  services: [
    { name: 'analytics', purposes: ['analytics'], default: false },
    { name: 'required', purposes: ['required'], required: true, default: true },
  ],
};

describe('engine headless surface (REQ-N2)', () => {
  afterEach(() => {
    resetManagers();
    localStorage.clear();
  });

  it('returns a working ConsentManager without any UI side-effects', () => {
    const bannerBefore = document.querySelector('simplecmp-banner');
    const manager = getManager(headlessConfig);
    expect(manager).toBeDefined();
    expect(manager.getConsent('analytics')).toBe(false);
    expect(manager.getConsent('required')).toBe(true);
    // Importing + using the engine must not mount any UI.
    expect(document.querySelector('simplecmp-banner')).toBe(bannerBefore);
    expect(document.querySelector('simplecmp-modal')).toBe(null);
  });

  it('persists consent decisions through the manager', () => {
    const manager = getManager(headlessConfig);
    manager.updateConsent('analytics', true);
    manager.saveConsents();
    resetManagers();
    const reopened = getManager(headlessConfig);
    expect(reopened.getConsent('analytics')).toBe(true);
  });

  it('migrates legacy `apps` → `services` via validateConfig', () => {
    const legacy = {
      services: undefined,
      apps: [{ name: 'legacy', purposes: ['analytics'], default: false }],
    } as unknown as ConsentConfig;
    const migrated = validateConfig(legacy);
    expect(migrated.services).toBeDefined();
    expect(migrated.services?.[0]?.name).toBe('legacy');
    expect((migrated as unknown as { apps?: unknown }).apps).toBeUndefined();
  });

  it('event bus delivers fired events to subscribers', () => {
    const seen: unknown[] = [];
    addEventListener('headlessProbe', (payload) => {
      seen.push(payload);
    });
    fireEvent('headlessProbe', { hello: 'world' });
    expect(seen).toEqual([{ hello: 'world' }]);
  });

  it('reports a version string', () => {
    expect(typeof version()).toBe('string');
    expect(version().length).toBeGreaterThan(0);
  });

  // --- changeAll() precedence -----------------------------------------
  //
  // Regression guards for the audit-surfaced bug where the previous
  // `service.required || this.config.required || value` chain treated
  // config.required as a global "force every service to true" override.

  it('changeAll(false) declines a non-required service even when config.required is true', () => {
    const config: ConsentConfig = {
      storageName: 'simplecmp-changeall-config-required',
      storageMethod: 'localStorage',
      // Global default = required, but the visitor's accept/decline
      // choice still has to govern services that explicitly override.
      required: true,
      services: [
        // Explicit `required: false` — overrides the config default.
        { name: 'optional', purposes: ['marketing'], required: false, default: false },
      ],
    };
    const manager = getManager(config);
    manager.updateConsent('optional', true);
    manager.changeAll(false);
    expect(manager.getConsent('optional')).toBe(false);
  });

  it('changeAll(false) preserves consent on a required service', () => {
    const config: ConsentConfig = {
      storageName: 'simplecmp-changeall-required-service',
      storageMethod: 'localStorage',
      services: [
        { name: 'required', purposes: ['functional'], required: true, default: true },
        { name: 'analytics', purposes: ['analytics'], default: false },
      ],
    };
    const manager = getManager(config);
    manager.updateConsent('analytics', true);
    manager.changeAll(false);
    // Required service stays consented; non-required flips off.
    expect(manager.getConsent('required')).toBe(true);
    expect(manager.getConsent('analytics')).toBe(false);
  });

  it('changeAll(true) sets non-required services to true', () => {
    const config: ConsentConfig = {
      storageName: 'simplecmp-changeall-accept-all',
      storageMethod: 'localStorage',
      services: [
        { name: 'analytics', purposes: ['analytics'], default: false },
        { name: 'marketing', purposes: ['marketing'], default: false },
      ],
    };
    const manager = getManager(config);
    manager.changeAll(true);
    expect(manager.getConsent('analytics')).toBe(true);
    expect(manager.getConsent('marketing')).toBe(true);
  });
});

describe('getDefaultConsent precedence + GPC (Finding 2)', () => {
  afterEach(() => {
    resetManagers();
    localStorage.clear();
    // Don't leak the GPC signal into other tests (reads check `=== true`).
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl = false;
  });

  it('honors an explicit service.default:false against config.default:true', () => {
    // Regression: the old `service.default || service.required` swallowed an
    // explicit `false` and fell through to config.default (→ true).
    const config: ConsentConfig = {
      storageName: 'gdc-explicit-false',
      storageMethod: 'localStorage',
      default: true,
      services: [{ name: 'a', purposes: ['analytics'], default: false }],
    };
    expect(getManager(config).getConsent('a')).toBe(false);
  });

  it('falls through to config.default when service.default is unset', () => {
    const config: ConsentConfig = {
      storageName: 'gdc-config-default',
      storageMethod: 'localStorage',
      default: true,
      services: [{ name: 'a', purposes: ['analytics'] }],
    };
    expect(getManager(config).getConsent('a')).toBe(true);
  });

  it('defaults to false when neither service nor config sets a default', () => {
    const config: ConsentConfig = {
      storageName: 'gdc-no-default',
      storageMethod: 'localStorage',
      services: [{ name: 'a', purposes: ['analytics'] }],
    };
    expect(getManager(config).getConsent('a')).toBe(false);
  });

  it('required service always consents, even with default:false', () => {
    const config: ConsentConfig = {
      storageName: 'gdc-required-default-false',
      storageMethod: 'localStorage',
      services: [{ name: 'a', purposes: ['required'], required: true, default: false }],
    };
    expect(getManager(config).getConsent('a')).toBe(true);
  });

  it('config.required:true makes an otherwise-unset service consent', () => {
    const config: ConsentConfig = {
      storageName: 'gdc-config-required',
      storageMethod: 'localStorage',
      required: true,
      services: [{ name: 'a', purposes: ['required'] }],
    };
    expect(getManager(config).getConsent('a')).toBe(true);
  });

  it('per-service required:false overrides config.required:true', () => {
    const config: ConsentConfig = {
      storageName: 'gdc-service-required-false',
      storageMethod: 'localStorage',
      required: true,
      services: [{ name: 'a', purposes: ['analytics'], required: false, default: false }],
    };
    expect(getManager(config).getConsent('a')).toBe(false);
  });

  it('suppresses a non-required service under a GPC signal', () => {
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl = true;
    const config: ConsentConfig = {
      storageName: 'gdc-gpc-nonrequired',
      storageMethod: 'localStorage',
      default: true,
      services: [{ name: 'a', purposes: ['analytics'], default: true }],
    };
    expect(getManager(config).getConsent('a')).toBe(false);
  });

  it('keeps required services consented under a GPC signal', () => {
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl = true;
    const perService: ConsentConfig = {
      storageName: 'gdc-gpc-required',
      storageMethod: 'localStorage',
      services: [{ name: 'a', purposes: ['required'], required: true }],
    };
    expect(getManager(perService).getConsent('a')).toBe(true);
    // config.required path also stays consented under GPC.
    const configRequired: ConsentConfig = {
      storageName: 'gdc-gpc-config-required',
      storageMethod: 'localStorage',
      required: true,
      services: [{ name: 'b', purposes: ['required'] }],
    };
    expect(getManager(configRequired).getConsent('b')).toBe(true);
  });
});

describe('getManager — config-change cache invalidation', () => {
  afterEach(() => {
    resetManagers();
    localStorage.clear();
  });

  it('rebuilds when services[] change under the same storageName', () => {
    const v1: ConsentConfig = {
      storageName: 'gm-reinit',
      storageMethod: 'localStorage',
      services: [{ name: 'analytics', purposes: ['analytics'], default: false }],
    };
    const m1 = getManager(v1);
    expect('analytics' in m1.defaultConsents).toBe(true);
    expect('newsvc' in m1.defaultConsents).toBe(false);

    // Same storageName, an added service — must NOT return the stale manager.
    const v2: ConsentConfig = {
      storageName: 'gm-reinit',
      storageMethod: 'localStorage',
      services: [
        { name: 'analytics', purposes: ['analytics'], default: false },
        { name: 'newsvc', purposes: ['marketing'], default: false },
      ],
    };
    const m2 = getManager(v2);
    expect(m2).not.toBe(m1);
    expect('newsvc' in m2.defaultConsents).toBe(true);
  });

  it('returns the same instance for an identical config passed as a fresh object', () => {
    const base: ConsentConfig = {
      storageName: 'gm-same',
      storageMethod: 'localStorage',
      services: [{ name: 'analytics', purposes: ['analytics'], default: false }],
    };
    const m1 = getManager(base);
    // Shallow clone — same content, different object reference.
    const m2 = getManager({ ...base });
    expect(m2).toBe(m1);
  });

  it('keeps distinct managers per storageName', () => {
    const a = getManager({
      storageName: 'gm-a',
      storageMethod: 'localStorage',
      services: [{ name: 's', purposes: ['analytics'] }],
    });
    const b = getManager({
      storageName: 'gm-b',
      storageMethod: 'localStorage',
      services: [{ name: 's', purposes: ['analytics'] }],
    });
    expect(b).not.toBe(a);
  });

  it('rebuilds (does not reuse) when consentVersion changes', () => {
    const m1 = getManager({
      storageName: 'gm-ver',
      storageMethod: 'localStorage',
      consentVersion: 1,
      services: [{ name: 's', purposes: ['analytics'] }],
    });
    const m2 = getManager({
      storageName: 'gm-ver',
      storageMethod: 'localStorage',
      consentVersion: 2,
      services: [{ name: 's', purposes: ['analytics'] }],
    });
    expect(m2).not.toBe(m1);
  });

  it('callback-only differences do not force a rebuild (functions are ignored)', () => {
    const base: ConsentConfig = {
      storageName: 'gm-fn',
      storageMethod: 'localStorage',
      services: [{ name: 's', purposes: ['analytics'] }],
    };
    const m1 = getManager({ ...base, callback: () => undefined } as ConsentConfig);
    const m2 = getManager({ ...base, callback: () => 'different' } as ConsentConfig);
    expect(m2).toBe(m1);
  });
});
