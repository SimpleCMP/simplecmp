import { describe, expect, it, vi } from 'vitest';
import { deleteCookie, getCookie } from './cookies.js';

describe('deleteCookie', () => {
  it('returns true after removing a previously-set cookie', () => {
    document.cookie = '_test_dc_one=hello; path=/';
    expect(getCookie('_test_dc_one')?.value).toBe('hello');

    expect(deleteCookie('_test_dc_one', '/')).toBe(true);
    expect(getCookie('_test_dc_one')).toBeNull();
  });

  it('returns true when the cookie does not exist (idempotent)', () => {
    expect(getCookie('_test_dc_two')).toBeNull();
    expect(deleteCookie('_test_dc_two')).toBe(true);
  });

  it('returns false when writes do not take effect', () => {
    // Save the original accessor descriptor so we can restore it after the
    // test — `vi.spyOn` on accessor properties doesn't fully restore via
    // `restoreAllMocks` in vitest 2.x.
    const proto = Object.getPrototypeOf(document) as Document;
    const original = Object.getOwnPropertyDescriptor(proto, 'cookie');

    try {
      // Getter pretends the cookie persists; setter is a no-op. Mimics
      // the real-world case of a cookie scoped to a path/domain we cannot
      // reach from JS.
      const setStub = vi.fn();
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '_test_dc_three=stuck',
        set: setStub,
      });

      expect(deleteCookie('_test_dc_three', '/')).toBe(false);
      expect(setStub).toHaveBeenCalled();
    } finally {
      // Reinstall the prototype accessor descriptor on the instance —
      // shadows the instance-level override we set above.
      if (original) Object.defineProperty(document, 'cookie', original);
    }
  });
});
