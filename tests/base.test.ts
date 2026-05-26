/**
 * Regression tests for `SimpleCmpElement`'s consent-watcher lifecycle.
 *
 * The base class subscribes a `ConsentWatcher` to the element's `manager`
 * property and must keep that subscription in sync as the manager swaps
 * or the element moves around the DOM. Verifies no leaks and no
 * double-subscribes, especially under the "disconnect/reconnect between
 * property swap and willUpdate" race that motivated the rewrite.
 */
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsentManager, ConsentWatcher } from '../src/engine/index.js';
import { SimpleCmpElement } from '../src/ui/base.js';

class MockManager {
  watchCount = 0;
  unwatchCount = 0;
  active = new Set<ConsentWatcher>();
  watch(w: ConsentWatcher): void {
    this.watchCount++;
    this.active.add(w);
  }
  unwatch(w: ConsentWatcher): void {
    this.unwatchCount++;
    this.active.delete(w);
  }
}

function asManager(m: MockManager): ConsentManager {
  return m as unknown as ConsentManager;
}

@customElement('simplecmp-base-test')
class TestElement extends SimpleCmpElement {
  override render() {
    return html`<span></span>`;
  }
}

describe('SimpleCmpElement consent-watcher lifecycle', () => {
  let mounted: TestElement[] = [];

  function mount(manager: MockManager): TestElement {
    const el = document.createElement('simplecmp-base-test') as TestElement;
    el.manager = asManager(manager);
    document.body.appendChild(el);
    mounted.push(el);
    return el;
  }

  afterEach(() => {
    for (const el of mounted) el.remove();
    mounted = [];
  });

  it('subscribes exactly once on connect', async () => {
    const a = new MockManager();
    const el = mount(a);
    await el.updateComplete;
    expect(a.watchCount).toBe(1);
    expect(a.active.size).toBe(1);
  });

  it('unsubscribes cleanly on disconnect', async () => {
    const a = new MockManager();
    const el = mount(a);
    await el.updateComplete;

    el.remove();
    expect(a.unwatchCount).toBe(1);
    expect(a.active.size).toBe(0);
  });

  it('swaps subscription when manager property changes', async () => {
    const a = new MockManager();
    const b = new MockManager();
    const el = mount(a);
    await el.updateComplete;

    el.manager = asManager(b);
    await el.updateComplete;

    expect(a.unwatchCount).toBe(1);
    expect(a.active.size).toBe(0);
    expect(b.watchCount).toBe(1);
    expect(b.active.size).toBe(1);
  });

  it('survives disconnect/reconnect between property swap and willUpdate', async () => {
    // Race scenario: element holds a watcher on A. Caller assigns
    // `manager = B` (Lit schedules an async update). Before that update
    // fires, the element is detached + reattached. With the previous
    // implementation, `disconnectedCallback` unwatched from the *current*
    // `this.manager` (= B, but the watcher was attached to A → no-op),
    // `connectedCallback` then subscribed a new watcher to B, and the
    // deferred `willUpdate` tried to unwatch from the Lit-reported
    // "previous" (= A) — but it would unwatch the wrong watcher, then
    // create yet another and attach to B. Net: orphan watcher on A,
    // double watcher on B.
    const a = new MockManager();
    const b = new MockManager();
    const el = mount(a);
    await el.updateComplete;

    // Synchronous swap + detach + reattach, all before the next microtask.
    el.manager = asManager(b);
    el.remove();
    document.body.appendChild(el);
    await el.updateComplete;

    expect(a.watchCount).toBe(1);
    expect(a.unwatchCount).toBe(1);
    expect(a.active.size).toBe(0);
    expect(b.watchCount).toBe(1);
    expect(b.unwatchCount).toBe(0);
    expect(b.active.size).toBe(1);
  });

  it('clears manager → unsubscribes without resubscribing', async () => {
    const a = new MockManager();
    const el = mount(a);
    await el.updateComplete;

    el.manager = undefined;
    await el.updateComplete;

    expect(a.unwatchCount).toBe(1);
    expect(a.active.size).toBe(0);
  });
});
