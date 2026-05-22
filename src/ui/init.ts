/**
 * SimpleCMP Lit UI — `initLit()` mount entry point (D.5).
 *
 * Wires together the components built in D.2–D.4 against a single
 * config:
 *
 *   1. Mount `<simplecmp-banner>` unless consent was already saved.
 *   2. Mount `<simplecmp-modal>` (initially closed) for the preference
 *      center.
 *   3. Banner's `simplecmp:configure` event opens the modal.
 *   4. When the manager fires `saveConsents`, drop the banner.
 *   5. Optional `<simplecmp-trigger>` opens the modal anywhere on the
 *      page (REQ-4 / DSGVO Art. 7(3)).
 *
 * Returns a handle the integrator can call `show()` / `hide()` /
 * `destroy()` on. Does not touch Klaro's legacy render path — both
 * UIs coexist during the rewrite (REQ-14 → REQ-17).
 */

import { type ConsentConfig, type ConsentManager, getManager } from '../engine/index.js';
import { SimpleCmpBanner } from './components/banner.js';
// Side-effect import — registers `<simplecmp-contextual-notice>` so the
// engine's auto-placeholder click-to-enable affordance has a real custom
// element to upgrade. Without this the engine inserts raw HTMLElements
// that never render their shadow root.
import './components/contextual-notice.js';
import { SimpleCmpModal } from './components/modal.js';
import { SimpleCmpTrigger } from './components/trigger.js';

export interface FloatingTriggerOptions {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  label?: string;
}

/**
 * Config fields recognised by `initLit()` beyond the engine's own. The
 * full `ConsentConfig` (with the `[key: string]: unknown` index signature)
 * is what callers pass — these are just the fields this module reads.
 */
export interface LitInitConfig extends ConsentConfig {
  /** Render the banner even when consent is already saved. */
  testing?: boolean;
  /** `true` to mount the floating trigger with defaults; or pass an options object. */
  floatingTrigger?: boolean | FloatingTriggerOptions;
  /**
   * Render the components into Shadow DOM (default, encapsulated styles)
   * or Light DOM (host page's CSS applies). REQ-16. With `'light'` you
   * must `<link rel="stylesheet" href="simplecmp/styles/default.css">`
   * (or `bootstrap.css`, or your own) for the components to be styled.
   */
  domMode?: 'shadow' | 'light';
}

export interface LitInitHandle {
  /** Open the preferences modal. */
  show(): void;
  /** Close the preferences modal. */
  hide(): void;
  /** Remove every component this `initLit()` call mounted. */
  destroy(): void;
  /** The engine ConsentManager — exposed so integrators can subscribe directly. */
  readonly manager: ConsentManager;
}

/**
 * Mount the Lit UI for a given config. Idempotent only by virtue of the
 * engine's manager cache — calling twice with the same `storageName`
 * shares the manager, but each call still creates fresh UI elements.
 * Call `destroy()` on the prior handle if you re-init.
 */
export function initLit(config: LitInitConfig): LitInitHandle {
  const manager = getManager(config);
  // Light DOM (REQ-16): set the attribute before append so the
  // components' `createRenderRoot()` reads it on first connect.
  const lightMode = config.domMode === 'light';

  // --- banner -----------------------------------------------------------

  let banner: SimpleCmpBanner | undefined;
  const shouldShowBanner =
    config.noNotice !== true && (!manager.confirmed || config.testing === true);
  if (shouldShowBanner) {
    banner = new SimpleCmpBanner();
    banner.config = config;
    banner.manager = manager;
    if (config.testing === true) banner.testing = true;
    if (lightMode) banner.setAttribute('mode', 'light');
    document.body.appendChild(banner);
  }

  // --- modal ------------------------------------------------------------

  const modal = new SimpleCmpModal();
  modal.config = config;
  modal.manager = manager;
  if (config.testing === true) modal.testing = true;
  if (lightMode) modal.setAttribute('mode', 'light');
  document.body.appendChild(modal);

  // mustConsent: open the modal immediately so the user has somewhere to act.
  if (config.mustConsent === true && !manager.confirmed) {
    modal.open = true;
  }

  // --- wiring -----------------------------------------------------------

  // Listen at the document level so any element in the SimpleCMP family
  // can open the modal by emitting `simplecmp:configure` — currently the
  // banner and the contextual-notice ("Open settings" button), but any
  // future widget that wants to surface this affordance gets it for free.
  // Bubbles + composed on the event means it crosses Shadow DOM up to
  // the document.
  const onConfigure = (): void => {
    modal.open = true;
  };
  document.addEventListener('simplecmp:configure', onConfigure);

  // Watcher: drop the banner once the user saves consent through any path
  // (banner buttons, modal buttons, programmatic).
  const watcher = {
    update(_manager: ConsentManager, type: string): void {
      if (type === 'saveConsents' && banner !== undefined) {
        banner.remove();
        banner = undefined;
      }
    },
  };
  manager.watch(watcher);

  // --- trigger ----------------------------------------------------------

  let trigger: SimpleCmpTrigger | undefined;
  let onTriggerClick: (() => void) | undefined;
  if (config.floatingTrigger) {
    trigger = new SimpleCmpTrigger();
    trigger.config = config;
    if (typeof config.floatingTrigger === 'object') {
      if (config.floatingTrigger.position !== undefined) {
        trigger.position = config.floatingTrigger.position;
      }
      if (config.floatingTrigger.label !== undefined) {
        trigger.label = config.floatingTrigger.label;
      }
    }
    if (lightMode) trigger.setAttribute('mode', 'light');
    document.body.appendChild(trigger);
    onTriggerClick = (): void => {
      modal.open = true;
    };
    trigger.addEventListener('simplecmp:trigger-click', onTriggerClick);
  }

  // --- reapply consents now that the DOM has the [data-name] elements ----
  //
  // The manager's constructor calls applyConsents() once at creation time.
  // When init() is wired into <head> (body-aware path, ADR-0013 Phase 4),
  // the manager is created BEFORE the body parses, so that first
  // applyConsents pass finds zero `[data-name]` elements and the
  // auto-contextual-notice insertion does nothing. Once mountUI runs
  // (either now if body is ready, or via DOMContentLoaded), the elements
  // are in the DOM — re-apply so the engine inserts notices next to
  // blocked embeds.
  //
  // Idempotent — for the synchronous-mount path (body was already ready
  // at init time) this is a redundant second pass but harmless.
  manager.applyConsents();

  // --- handle -----------------------------------------------------------

  return {
    show() {
      modal.open = true;
    },
    hide() {
      modal.open = false;
    },
    destroy() {
      manager.unwatch(watcher);
      document.removeEventListener('simplecmp:configure', onConfigure);
      banner?.remove();
      modal.remove();
      if (trigger !== undefined && onTriggerClick !== undefined) {
        trigger.removeEventListener('simplecmp:trigger-click', onTriggerClick);
        trigger.remove();
      }
    },
    manager,
  };
}
