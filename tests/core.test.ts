import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, show } from '../src/core.js';
import { resetManagers } from '../src/engine/index.js';

/**
 * Critical-core entry (ADR-0019). The core arms the manager + blocking
 * synchronously and defers the UI (+ recorder) to a chunk loaded at idle via a
 * dynamic import. These tests pin that contract: nothing UI mounts on the
 * critical path, the deferred mount happens after idle, and a teardown before
 * idle cancels it.
 */
describe('SimpleCMP critical core (ADR-0019)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    resetManagers();
  });

  afterEach(() => {
    // Tear down whatever the last init mounted/scheduled.
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('returns a handle with a manager synchronously, without mounting UI', () => {
    const ric = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    const handle = init({ storageName: 'core-test-sync', services: [] });
    expect(handle.manager).toBeDefined();
    // UI mount was scheduled to idle, not run on the critical path.
    expect(ric).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('simplecmp-banner')).toBeNull();
  });

  it('mounts the deferred UI after the idle callback runs', async () => {
    const ric = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    init({ storageName: 'core-test-defer', services: [] });
    expect(document.body.querySelector('simplecmp-banner')).toBeNull();
    // Run the scheduled idle callback → triggers the dynamic import.
    (ric.mock.calls[0][0] as () => void)();
    await vi.waitFor(() => expect(document.body.querySelector('simplecmp-banner')).not.toBeNull());
  });

  it('a destroy() before idle cancels the deferred mount', async () => {
    const ric = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    const handle = init({ storageName: 'core-test-destroy', services: [] });
    handle.destroy();
    (ric.mock.calls[0][0] as () => void)();
    // Let the dynamic import resolve; the destroyed guard must still suppress it.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.querySelector('simplecmp-banner')).toBeNull();
  });

  it('queued show() replays once the deferred UI mounts', async () => {
    const ric = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    const handle = init({ storageName: 'core-test-show', services: [] });
    // No UI yet — show() must queue rather than throw.
    expect(() => {
      handle.show();
      show();
    }).not.toThrow();
    (ric.mock.calls[0][0] as () => void)();
    await vi.waitFor(() => expect(document.body.querySelector('simplecmp-banner')).not.toBeNull());
  });
});
