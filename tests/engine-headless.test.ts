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
});
