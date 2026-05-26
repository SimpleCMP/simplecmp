/**
 * Base class for SimpleCMP Lit components.
 *
 * Provides three things every component needs:
 *
 * 1. **Hybrid Shadow/Light DOM** (ADR-0007) — components default to Shadow
 *    DOM for theme isolation; setting `mode="light"` opts into Light DOM
 *    for hosts that want their own CSS (Bootstrap, Tailwind, etc.) to
 *    style the component directly.
 *
 * 2. **Translator binding** — components hold a `config` property; the
 *    base class derives `_t(key, ...args)` lazily and rebinds on config
 *    change. Concrete components only call `_t(...)` in their templates.
 *
 * 3. **Consent-manager subscription** — components observe consent state
 *    via the engine's `ConsentWatcher` API. The base class wires
 *    `watch`/`unwatch` against a `manager` property and triggers a
 *    re-render via Lit's `requestUpdate()` on every notify.
 *
 * Concrete components extend this and only implement `render()`.
 */

import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import type { ConsentConfig, ConsentManager } from '../engine/index.js';
import { type Translator, bindTranslator } from './i18n-bridge.js';

/**
 * Re-render trigger for `manager.watch(...)`. Kept module-local — this
 * is implementation detail, components don't see it.
 */
function makeRerenderWatcher(host: SimpleCmpElement) {
  return {
    update: () => {
      host.requestUpdate();
    },
  };
}

export abstract class SimpleCmpElement extends LitElement {
  /** The active config. Required at mount time by `init()` (D.5). */
  @property({ attribute: false })
  config?: ConsentConfig;

  /** The engine ConsentManager instance for this config. */
  @property({ attribute: false })
  manager?: ConsentManager;

  /**
   * Light-DOM opt-in: `<simplecmp-banner mode="light">`.
   *
   * Not declared as a Lit `@property` because Lit would assign the class
   * default during construction and reflect it back to the attribute,
   * clobbering an author-supplied `mode="light"`. We read the attribute
   * directly in `createRenderRoot()` instead — it runs once, on first
   * connection, which is exactly when we need the answer.
   */

  /** Internal: cached translator, rebuilt when `config` changes. */
  private _translator?: Translator;

  /** Internal: registered watcher reference, kept for unwatch on disconnect. */
  private _watcher?: ReturnType<typeof makeRerenderWatcher>;

  /**
   * Internal: the manager that `_watcher` is actually attached to. Tracked
   * separately from the `manager` property because the two can drift when
   * disconnect/reconnect runs between a property swap and the deferred
   * `willUpdate`. Always source the unwatch target from this, never from
   * `this.manager` or `changed.get('manager')`.
   */
  private _watcherManager?: ConsentManager;

  /**
   * Translate a key against the active config. Components call this in
   * their `render()` templates: `${this._t('acceptAll')}`.
   *
   * Returns the engine `t()` result unchanged — `string` or `unknown[]`.
   * Lit handles both natively in `${...}` slots.
   */
  protected _t(key: string | string[], ...params: unknown[]): unknown {
    if (this._translator === undefined) {
      if (this.config === undefined) return key;
      this._translator = bindTranslator(this.config);
    }
    return this._translator(key, ...params);
  }

  /** Hybrid Shadow/Light DOM: ADR-0007. */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    if (this.getAttribute('mode') === 'light') return this;
    return super.createRenderRoot();
  }

  /** Detach the current watcher from whichever manager it's attached to. */
  private _detachWatcher(): void {
    if (this._watcher !== undefined && this._watcherManager !== undefined) {
      this._watcherManager.unwatch(this._watcher);
    }
    this._watcher = undefined;
    this._watcherManager = undefined;
  }

  /**
   * Idempotently align the watcher subscription with `this.manager`.
   *
   * Safe to call from any lifecycle hook — no-ops when already in sync.
   * Crucially independent of Lit's `changed.get('manager')`, which can
   * reflect a manager that was never the active subscription target if
   * disconnect/reconnect runs between a property swap and `willUpdate`.
   */
  private _syncWatcher(): void {
    if (this._watcherManager === this.manager) return;
    this._detachWatcher();
    if (this.manager !== undefined) {
      this._watcher = makeRerenderWatcher(this);
      this._watcherManager = this.manager;
      this.manager.watch(this._watcher);
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._syncWatcher();
  }

  override disconnectedCallback(): void {
    this._detachWatcher();
    super.disconnectedCallback();
  }

  override willUpdate(changed: Map<string | number | symbol, unknown>): void {
    super.willUpdate(changed);

    // Rebind the translator when the config changes.
    if (changed.has('config')) {
      this._translator = undefined;
    }

    // Re-align the watcher when the manager swaps.
    if (changed.has('manager')) {
      this._syncWatcher();
    }
  }

  /**
   * Helper for emitting public CustomEvents in the `simplecmp:` namespace.
   * Bubbles + composed so they cross Shadow DOM boundaries.
   */
  protected _emit<T = unknown>(eventName: string, detail?: T): void {
    this.dispatchEvent(
      new CustomEvent(`simplecmp:${eventName}`, {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }
}
