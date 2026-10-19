/**
 * `script.src` assignments with a Trusted Types value.
 *
 * gtag.js / GTM assign a `TrustedScriptURL` object to `script.src`, not a
 * string. The patch must report the blocked URL as a string — downstream
 * consumers (recorder, CMS bridge) call string methods on it — and must
 * pass the original object, not its string form, to the native setter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BlockInfo, installRuntimePatches } from './index.js';

/** Stand-in for a `TrustedScriptURL`: an object that stringifies to a URL. */
function trustedUrl(url: string): string {
  return { toString: () => url } as unknown as string;
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

describe('runtime patches — Trusted Types values on script.src', () => {
  it('reports a blocked TrustedScriptURL as a string', () => {
    const blocked: BlockInfo[] = [];
    uninstall = installRuntimePatches({
      matcher: (host) => (host === 'www.googletagmanager.com' ? 'gtm' : null),
      consentChecker: () => false,
      onBlock: (info) => blocked.push(info),
    });

    const script = document.createElement('script');
    script.src = trustedUrl('https://www.googletagmanager.com/gtag/js?id=AW-1');

    expect(blocked).toHaveLength(1);
    expect(typeof blocked[0]?.url).toBe('string');
    expect(blocked[0]?.url).toBe('https://www.googletagmanager.com/gtag/js?id=AW-1');
  });

  it('hands the original value to the native setter when allowed', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    const nativeSet = vi.fn();
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      ...original,
      set: nativeSet,
    });
    try {
      uninstall = installRuntimePatches({
        matcher: () => null,
        consentChecker: () => false,
      });
      const value = trustedUrl('https://cdn.example.test/lib.js');

      document.createElement('script').src = value;

      expect(nativeSet).toHaveBeenCalledWith(value);
    } finally {
      uninstall?.();
      uninstall = null;
      if (original) Object.defineProperty(HTMLScriptElement.prototype, 'src', original);
    }
  });
});
