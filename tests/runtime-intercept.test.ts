import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetManagers } from '../src/engine/index.js';
import { init } from '../src/index.js';

/**
 * Integration tests for `init({ interceptRuntime: ... })` (ADR-0013
 * Phase 2). Verifies that:
 *
 * 1. Without the flag, prototypes are untouched.
 * 2. With the flag, JS-injected calls to configured third-party hosts
 *    are blocked when consent is denied.
 * 3. The same calls pass through when consent is granted.
 * 4. Same-origin and unconfigured hosts always pass through.
 * 5. Re-init() does not stack prototype patches (the prior install is
 *    uninstalled first).
 * 6. `handle.destroy()` removes the patches.
 *
 * We test the prototype patches indirectly via `new Image()` rather
 * than `fetch` because happy-dom's fetch implementation is
 * test-specific and would conflate the test plumbing with the patch
 * mechanism.
 */
describe('init({ interceptRuntime })', () => {
  // Snapshot the native `src` setter so each test can verify the
  // prototype is back to native after destroy(). We compare the
  // setter reference (not the descriptor object), because
  // `getOwnPropertyDescriptor` returns a fresh object on every call.
  const nativeImageSrcSetter = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'src'
  )?.set;
  const currentImageSrcSetter = (): ((v: string) => void) | undefined =>
    Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')?.set;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    resetManagers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not patch prototypes when the flag is absent', () => {
    init({
      storageName: 'simplecmp-no-intercept',
      services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
    });
    expect(currentImageSrcSetter()).toBe(nativeImageSrcSetter);
  });

  it('blocks JS-injected calls to configured hosts when consent is denied', () => {
    const blocked: string[] = [];
    init({
      storageName: 'simplecmp-intercept-deny',
      services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
      interceptRuntime: {
        sameOriginHosts: ['localhost'],
        onBlock: (info) => {
          blocked.push(`${info.mechanism}:${info.service}`);
        },
      },
    });
    const img = new Image();
    img.src = 'https://analytics.example.com/pixel.gif?id=1';
    // Patch swallows the assignment; `src` stays at its default ('').
    expect(img.src === '' || img.src === 'about:blank').toBe(true);
    expect(blocked).toContain('img-src:analytics');
  });

  it('passes through configured hosts once consent is granted', () => {
    const blocked: string[] = [];
    const handle = init({
      storageName: 'simplecmp-intercept-grant',
      services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
      interceptRuntime: {
        sameOriginHosts: ['localhost'],
        onBlock: (info) => {
          blocked.push(info.service);
        },
      },
    });
    handle.manager.updateConsent('analytics', true);
    const img = new Image();
    img.src = 'https://analytics.example.com/pixel.gif?id=2';
    expect(img.src).toBe('https://analytics.example.com/pixel.gif?id=2');
    expect(blocked).toEqual([]);
  });

  it('passes through unconfigured hosts (no service to gate on)', () => {
    const blocked: string[] = [];
    init({
      storageName: 'simplecmp-intercept-unknown',
      services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
      interceptRuntime: {
        sameOriginHosts: ['localhost'],
        onBlock: (info) => {
          blocked.push(info.service);
        },
      },
    });
    const img = new Image();
    img.src = 'https://unrelated.example.com/icon.png';
    expect(img.src).toBe('https://unrelated.example.com/icon.png');
    expect(blocked).toEqual([]);
  });

  it('passes through same-origin requests', () => {
    const blocked: string[] = [];
    init({
      storageName: 'simplecmp-intercept-same-origin',
      services: [{ name: 'self', origins: [window.location.host] }],
      interceptRuntime: {
        onBlock: (info) => {
          blocked.push(info.service);
        },
      },
    });
    const img = new Image();
    img.src = `${window.location.origin}/local-asset.png`;
    expect(img.src).toBe(`${window.location.origin}/local-asset.png`);
    expect(blocked).toEqual([]);
  });

  it('re-init() uninstalls the prior patches before installing new ones', () => {
    const handle1 = init({
      storageName: 'simplecmp-intercept-reinit',
      services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
      interceptRuntime: { sameOriginHosts: ['localhost'] },
    });
    const firstSetter = currentImageSrcSetter();
    expect(firstSetter).not.toBe(nativeImageSrcSetter);

    // Re-init with a different service set. Should not stack patches —
    // the second init must uninstall the first, leaving exactly one
    // layer of patching, and that layer should reference the new
    // matcher (different setter identity).
    const handle2 = init({
      storageName: 'simplecmp-intercept-reinit',
      services: [{ name: 'ads', origins: ['ads.example.com'] }],
      interceptRuntime: { sameOriginHosts: ['localhost'] },
    });
    const secondSetter = currentImageSrcSetter();
    expect(secondSetter).not.toBe(nativeImageSrcSetter);
    expect(secondSetter).not.toBe(firstSetter);

    handle2.destroy();
    expect(currentImageSrcSetter()).toBe(nativeImageSrcSetter);
    // First handle's destroy() is a no-op now — already cleaned up.
    handle1.destroy();
  });

  it('universalBlock: true gates any non-same-origin host as the host id', () => {
    // Maximum-protection posture: even hosts NOT in config.services
    // get blocked, using the host as the synthetic service id. Admin
    // has to Kuratieren them via the BE to unblock.
    const blocked: string[] = [];
    init({
      storageName: 'simplecmp-intercept-universal',
      services: [{ name: 'configured', origins: ['known.example.com'] }],
      interceptRuntime: {
        universalBlock: true,
        sameOriginHosts: ['localhost'],
        onBlock: (info) => {
          blocked.push(`${info.mechanism}:${info.service}`);
        },
      },
    });

    // Configured host blocks under its real service id.
    const img1 = new Image();
    img1.src = 'https://known.example.com/pixel.gif';
    expect(img1.src === '' || img1.src === 'about:blank').toBe(true);
    expect(blocked).toContain('img-src:configured');

    // Unknown third-party host blocks under the synthetic host-id.
    const img2 = new Image();
    img2.src = 'https://unknown-tracker.com/track.gif';
    expect(img2.src === '' || img2.src === 'about:blank').toBe(true);
    expect(blocked).toContain('img-src:unknown-tracker.com');

    // Same-origin (window.location.host = 'localhost') still passes.
    const img3 = new Image();
    img3.src = `${window.location.origin}/local.png`;
    expect(img3.src).toBe(`${window.location.origin}/local.png`);
    expect(blocked).not.toContain('img-src:localhost');
  });

  it('sameOriginHosts is additive — window.location.host always included implicitly', () => {
    // Regression guard: the old "replaces default" semantics let an
    // integrator strip own-host protection by passing any array. The
    // new semantics combine `[window.location.host, ...extras]`.
    init({
      storageName: 'simplecmp-intercept-same-origin-additive',
      services: [{ name: 'cfg', origins: ['cfg.example.com'] }],
      interceptRuntime: {
        sameOriginHosts: ['cdn.example.com'], // intentionally NOT including localhost
      },
    });
    // Own-host still passes through despite not being listed.
    const img1 = new Image();
    img1.src = `${window.location.origin}/asset.png`;
    expect(img1.src).toBe(`${window.location.origin}/asset.png`);
    // Explicit extra also passes through.
    const img2 = new Image();
    img2.src = 'https://cdn.example.com/asset.png';
    expect(img2.src).toBe('https://cdn.example.com/asset.png');
  });

  it('destroy() restores the native prototype src setter', () => {
    const handle = init({
      storageName: 'simplecmp-intercept-destroy',
      services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
      interceptRuntime: { sameOriginHosts: ['localhost'] },
    });
    expect(currentImageSrcSetter()).not.toBe(nativeImageSrcSetter);
    handle.destroy();
    expect(currentImageSrcSetter()).toBe(nativeImageSrcSetter);
  });

  // The key Phase 4 hardening property: when init() is called from a
  // head-priority asset slot (TYPO3 universal-blocking integration),
  // patches must install BEFORE inline body scripts execute. Mount
  // gets deferred to DOMContentLoaded.
  it('installs runtime patches even when document.body is not yet ready', () => {
    // Override the instance property so `document.body` returns null
    // for the duration of the try block. `delete` in finally restores
    // access to the prototype's native getter.
    Object.defineProperty(document, 'body', {
      configurable: true,
      get: () => null,
    });
    try {
      const blocked: string[] = [];
      init({
        storageName: 'simplecmp-intercept-pre-body',
        services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
        interceptRuntime: {
          sameOriginHosts: ['localhost'],
          onBlock: (info) => {
            blocked.push(`${info.mechanism}:${info.service}`);
          },
        },
      });
      // Patches installed despite body being null.
      expect(currentImageSrcSetter()).not.toBe(nativeImageSrcSetter);

      // And they're wired to a real manager, so consent checks work.
      const img = new Image();
      img.src = 'https://analytics.example.com/pixel.gif';
      expect(img.src === '' || img.src === 'about:blank').toBe(true);
      expect(blocked).toContain('img-src:analytics');
    } finally {
      // Drop the own-property override so accesses fall back to the
      // prototype getter (which returns the real body again).
      Reflect.deleteProperty(document, 'body');
    }
  });

  it('deferred mount happens on DOMContentLoaded and replays queued show()', () => {
    // Override the instance property so `document.body` returns null
    // for the duration of the try block. `delete` in finally restores
    // access to the prototype's native getter.
    Object.defineProperty(document, 'body', {
      configurable: true,
      get: () => null,
    });
    let handle: ReturnType<typeof init>;
    try {
      handle = init({
        storageName: 'simplecmp-intercept-pre-body-mount',
        services: [{ name: 'analytics', origins: ['analytics.example.com'] }],
        interceptRuntime: { sameOriginHosts: ['localhost'] },
      });
      // Pre-mount: show() must not throw, it queues until mount.
      expect(() => handle.show()).not.toThrow();
      // Nothing should be mounted yet.
      expect(document.querySelector('simplecmp-modal')).toBeNull();
    } finally {
      // Drop the own-property override so accesses fall back to the
      // prototype getter (which returns the real body again).
      Reflect.deleteProperty(document, 'body');
    }
    // Body is restored; fire DOMContentLoaded.
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const modal = document.querySelector('simplecmp-modal');
    expect(modal).not.toBeNull();
    // Queued show() should have been replayed — modal opens.
    expect((modal as HTMLElement & { open?: boolean }).open).toBe(true);
    handle.destroy();
  });
});
