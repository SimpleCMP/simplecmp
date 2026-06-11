/**
 * loadConsents() robustness against corrupt / tampered stored consent.
 *
 * loadConsents runs from the constructor, so an uncaught throw (bad JSON,
 * malformed percent-encoding) would abort CMP init entirely — no banner,
 * no blocking — for any visitor with a corrupt cookie. A valid-JSON value
 * of the wrong shape (null/number/array) would crash later or store junk.
 * Both must degrade to defaults instead.
 */
import { describe, expect, it } from 'vitest';
import { ConsentManager } from './consent-manager.js';
import type { ConsentConfig } from './consent-manager.js';
import type { Store } from './stores.js';

const config: ConsentConfig = {
  storageName: 'simplecmp-corrupt-test',
  storageMethod: 'localStorage',
  services: [
    { name: 'analytics', purposes: ['analytics'], default: false },
    { name: 'required', purposes: ['required'], required: true, default: true },
  ],
};

/** Minimal Store whose get() returns a fixed value. */
function storeReturning(value: string | null): Store {
  return {
    get: () => value,
    set: () => undefined,
    delete: () => undefined,
  };
}

function managerWithStored(value: string | null): ConsentManager {
  return new ConsentManager(config, storeReturning(value));
}

describe('ConsentManager.loadConsents — corrupt input handling', () => {
  it('does not throw and falls back to defaults on invalid JSON', () => {
    let manager: ConsentManager | undefined;
    expect(() => {
      manager = managerWithStored('{not valid json');
    }).not.toThrow();
    // Defaults: analytics opt-out false, required true.
    expect(manager?.getConsent('analytics')).toBe(false);
    expect(manager?.getConsent('required')).toBe(true);
  });

  it('does not throw on malformed percent-encoding', () => {
    // A lone `%` makes decodeURIComponent throw URIError.
    expect(() => managerWithStored('%E0%A4%A')).not.toThrow();
    expect(() => managerWithStored('100%')).not.toThrow();
  });

  it('falls back to defaults on valid JSON of the wrong shape', () => {
    for (const wrong of ['null', '5', '"a string"', '[true,false]', 'true']) {
      let manager: ConsentManager | undefined;
      expect(() => {
        manager = managerWithStored(wrong);
      }, `input: ${wrong}`).not.toThrow();
      // getConsent must not throw and must reflect defaults.
      expect(manager?.getConsent('analytics')).toBe(false);
      expect(manager?.getConsent('required')).toBe(true);
    }
  });

  it('still loads a valid legacy consent object', () => {
    const manager = managerWithStored(JSON.stringify({ analytics: true, required: true }));
    expect(manager.getConsent('analytics')).toBe(true);
  });

  it('still loads a valid versioned consent wrapper', () => {
    const manager = managerWithStored(
      JSON.stringify({ __v: 1, consents: { analytics: true, required: true } })
    );
    expect(manager.getConsent('analytics')).toBe(true);
  });

  it('falls back to defaults when the versioned wrapper consents are not an object', () => {
    let manager: ConsentManager | undefined;
    expect(() => {
      manager = managerWithStored(JSON.stringify({ __v: 1, consents: null }));
    }).not.toThrow();
    expect(manager?.getConsent('analytics')).toBe(false);
  });
});

// --- REQ-N4 / ADR-0015 — region-aware consent regimes ----------------------

const ANALYTICS = { name: 'analytics', purposes: ['analytics'] };
const ESSENTIAL = { name: 'essential', purposes: ['essential'], required: true };

function regimeManager(over: Partial<ConsentConfig> = {}): ConsentManager {
  return new ConsentManager(
    { services: [ANALYTICS, ESSENTIAL], storageName: 'regime-test', ...over },
    storeReturning(null)
  );
}

describe('ConsentManager — region-aware regimes (REQ-N4)', () => {
  it('defaults to opt-in (deny non-required) with no region config', () => {
    const m = regimeManager();
    expect(m.regime).toBe('opt-in');
    expect(m.bannerMode).toBe('wall');
    expect(m.getDefaultConsent(ANALYTICS)).toBe(false);
    expect(m.getDefaultConsent(ESSENTIAL)).toBe(true);
  });

  it('opt-out regime (US) allows non-required by default; banner is a notice', () => {
    const m = regimeManager({ region: 'US' });
    expect(m.regime).toBe('opt-out');
    expect(m.bannerMode).toBe('notice');
    expect(m.getDefaultConsent(ANALYTICS)).toBe(true);
    expect(m.getDefaultConsent(ESSENTIAL)).toBe(true);
  });

  it('resolves regime from the region (EU -> opt-in, US-CA -> opt-out)', () => {
    expect(regimeManager({ region: 'DE' }).regime).toBe('opt-in');
    expect(regimeManager({ region: 'US-CA' }).regime).toBe('opt-out');
  });

  it('none regime allows by default and does not auto-show', () => {
    const m = regimeManager({ regimeDefault: 'none' });
    expect(m.regime).toBe('none');
    expect(m.bannerMode).toBe('none');
    expect(m.getDefaultConsent(ANALYTICS)).toBe(true);
  });

  it('honors an explicit service.default over the regime fallback', () => {
    const optedOut = { name: 'x', purposes: ['analytics'], default: false };
    const m = regimeManager({ region: 'US', services: [optedOut, ESSENTIAL] });
    // opt-out would allow by default, but the explicit `false` wins.
    expect(m.getDefaultConsent(optedOut)).toBe(false);
  });

  it('lets the regimes override map win over the built-in table', () => {
    const m = regimeManager({ region: 'US-CA', regimes: { 'US-CA': 'opt-in' } });
    expect(m.regime).toBe('opt-in');
    expect(m.getDefaultConsent(ANALYTICS)).toBe(false);
  });

  it('GPC forces deny even in the opt-out regime', () => {
    const nav = navigator as { globalPrivacyControl?: boolean };
    const prev = nav.globalPrivacyControl;
    nav.globalPrivacyControl = true;
    try {
      const m = regimeManager({ region: 'US' });
      expect(m.regime).toBe('opt-out');
      expect(m.getDefaultConsent(ANALYTICS)).toBe(false);
      // required still consents under GPC
      expect(m.getDefaultConsent(ESSENTIAL)).toBe(true);
    } finally {
      nav.globalPrivacyControl = prev;
    }
  });
});
