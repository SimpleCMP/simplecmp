/**
 * Revocation cleanup: what a declined service stored in the browser is
 * removed — cookies in the services-library pattern shapes, and
 * `localStorage` keys matching the same patterns.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ConsentManager } from './consent-manager.js';
import type { ConsentConfig, Service } from './consent-manager.js';
import type { Store } from './stores.js';

const memoryStore = (): Store => {
  let value: string | null = null;
  return {
    get: () => value,
    set: (v: string) => {
      value = v;
    },
    delete: () => {
      value = null;
    },
  };
};

function manager(services: Service[]): ConsentManager {
  const config: ConsentConfig = {
    storageName: 'simplecmp-test',
    storageMethod: 'cookie',
    services,
  };
  return new ConsentManager(config, memoryStore());
}

const cookieNames = () =>
  document.cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim())
    .filter((n) => n !== '');

afterEach(() => {
  for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=-1; path=/`;
  localStorage.clear();
});

describe('ConsentManager.updateServiceStorage', () => {
  it('understands regex-literal strings and { name } objects', () => {
    const service: Service = {
      name: 'ga',
      cookies: ['/^_ga_/', { name: 'AEC', requireOrigin: 'google.com' }],
    };
    const m = manager([service]);
    document.cookie = '_ga_ABC123=1; path=/';
    document.cookie = 'AEC=1; path=/';
    document.cookie = 'keep=1; path=/';
    m.updateServiceStorage(service, false);
    expect(cookieNames()).toEqual(['keep']);
  });

  it('removes matching localStorage keys but not the consent record', () => {
    const services: Service[] = [
      { name: 'lead', cookies: ['lead_attribution_v1'] },
      { name: 'uet', cookies: ['/^_uet/', '/^simplecmp/'] },
    ];
    const m = manager(services);
    localStorage.setItem('lead_attribution_v1', '{}');
    localStorage.setItem('_uetsid', 'x');
    localStorage.setItem('_uetsid_exp', 'x');
    localStorage.setItem('simplecmp-test', '{}');
    localStorage.setItem('unrelated', 'x');
    for (const s of services) m.updateServiceStorage(s, false);
    expect(Object.keys(localStorage).sort()).toEqual(['simplecmp-test', 'unrelated']);
  });

  it('leaves storage alone while consent is given', () => {
    const service: Service = { name: 'lead', cookies: ['lead_attribution_v1'] };
    const m = manager([service]);
    localStorage.setItem('lead_attribution_v1', '{}');
    m.updateServiceStorage(service, true);
    expect(localStorage.getItem('lead_attribution_v1')).toBe('{}');
  });

  it('skips invalid regex patterns instead of throwing', () => {
    const service: Service = { name: 'bad', cookies: ['/[/', 'x_one'] };
    const m = manager([service]);
    document.cookie = 'x_one=1; path=/';
    expect(() => m.updateServiceStorage(service, false)).not.toThrow();
    expect(cookieNames()).toEqual([]);
  });
});
