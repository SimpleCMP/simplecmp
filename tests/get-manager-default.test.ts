/**
 * The public `getManager()` without an argument must return the manager
 * `init()` set up. The Lit init path never set the engine's default config
 * (Klaro did that in `setup()`), so integrations calling
 * `SimpleCMP.getManager()` — e.g. a CMS video opt-in that wants to read or
 * grant consent for one service — got "called without config and no
 * default config set" even after init.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetManagers } from '../src/engine/index.js';
import { getManager, init } from '../src/index.js';
import type { SimpleCMPConfig } from '../src/index.js';

const config = {
  storageName: 'simplecmp-get-manager-test',
  storageMethod: 'localStorage',
  privacyPolicy: '/privacy',
  services: [{ name: 'youtube', purposes: ['marketing'] }],
  translations: {
    en: {
      consentNotice: { description: 'We use cookies.' },
      purposes: { marketing: { title: 'Marketing' } },
    },
  },
} as unknown as SimpleCMPConfig;

describe('getManager() after init()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the manager init() created', () => {
    const handle = init(config);
    expect(getManager()).toBe(handle.manager);
  });

  it('lets an integration grant consent for one service', () => {
    init(config);
    const manager = getManager();
    expect(manager.getConsent('youtube')).toBe(false);
    manager.updateConsent('youtube', true);
    expect(getManager().getConsent('youtube')).toBe(true);
  });
});
