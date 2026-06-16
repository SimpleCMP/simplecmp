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

describe('ConsentManager — time-based consent expiry (§6)', () => {
  const DAY = 86_400_000;
  const expiryConfig: ConsentConfig = {
    storageName: 'simplecmp-expiry-test',
    storageMethod: 'localStorage',
    consentExpiryDays: 180,
    services: [
      { name: 'analytics', purposes: ['analytics'], default: false },
      { name: 'required', purposes: ['required'], required: true, default: true },
    ],
  };
  const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
  const stored = (tsOffsetMs: number) =>
    enc({ ts: Date.now() + tsOffsetMs, consents: { analytics: true, required: true } });

  function capturingStore(initial: string | null): Store & { value: string | null } {
    return {
      value: initial,
      get() {
        return this.value;
      },
      set(v: string) {
        this.value = v;
      },
      delete() {
        this.value = null;
      },
    };
  }

  it('honors fresh consent (within the window)', () => {
    const m = new ConsentManager(expiryConfig, storeReturning(stored(-10 * DAY)));
    expect(m.getConsent('analytics')).toBe(true);
    expect(m.confirmed).toBe(true);
    expect(m.consentExpired).toBeUndefined();
  });

  it('discards stale consent and re-prompts (older than the window)', () => {
    const m = new ConsentManager(expiryConfig, storeReturning(stored(-200 * DAY)));
    expect(m.getConsent('analytics')).toBe(false); // reset to default
    expect(m.confirmed).toBe(false);
    expect(m.changed).toBe(true);
    expect(m.consentExpired?.expiryDays).toBe(180);
  });

  it('ignores age when expiry is off (no consentExpiryDays)', () => {
    const noExpiry: ConsentConfig = { ...expiryConfig, consentExpiryDays: undefined };
    const m = new ConsentManager(noExpiry, storeReturning(stored(-500 * DAY)));
    expect(m.getConsent('analytics')).toBe(true);
    expect(m.consentExpired).toBeUndefined();
  });

  it('grandfathers a stored record with no ts (legacy shape) — never force-expires', () => {
    const legacy = encodeURIComponent(JSON.stringify({ analytics: true, required: true }));
    const m = new ConsentManager(expiryConfig, storeReturning(legacy));
    expect(m.getConsent('analytics')).toBe(true);
    expect(m.consentExpired).toBeUndefined();
  });

  it('stamps a numeric ts into the stored record on save when expiry is on', () => {
    const store = capturingStore(null);
    const m = new ConsentManager(expiryConfig, store);
    m.updateConsent('analytics', true);
    m.saveConsents();
    const written = JSON.parse(decodeURIComponent(store.value as string)) as {
      ts?: unknown;
      consents?: unknown;
    };
    expect(typeof written.ts).toBe('number');
    expect(written.consents).toMatchObject({ analytics: true });
  });
});
