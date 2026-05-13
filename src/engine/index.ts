/**
 * SimpleCMP engine — UI-free public surface.
 *
 * Holds the consent state-machine, event bus, manager cache, config
 * validation, and the translation registry. The (legacy) Klaro UI in
 * `src/core/lib.js` and the (forthcoming) Lit-based UI in `src/ui/` both
 * consume from here.
 *
 * REQ-N2 (headless mode) is delivered by this module: importing
 * `simplecmp/engine` gives you the full state-machine without any UI
 * components or styling. ADR-0006 / ADR-0007.
 */

import { type ConsentConfig, ConsentManager } from './consent-manager.js';
import { update } from './utils/config.js';
import { language } from './utils/i18n.js';
import { convertToMap, update as updateMap } from './utils/maps.js';

// VERSION is replaced at build time via esbuild's `define`. Same mechanism
// Klaro used; works for both tsup output and Vite-driven test runs.
declare const VERSION: string;

// --- engine state ----------------------------------------------------------

/**
 * The "default" config a script-tag-driven `setup()` registers. Read by
 * `getManager(config)` when called without arguments. The legacy Klaro UI
 * in `src/core/lib.js` mutates this via `setDefaultConfig`.
 */
let _defaultConfig: ConsentConfig | undefined;

/** Module-level translation registry. `src/index.ts` seeds it on import. */
export const defaultTranslations = new Map<unknown, unknown>();

/** Manager instances keyed by storageName. */
const managers: Record<string, ConsentManager> = {};

/** Event-bus state for `addEventListener` / `fireEvent`. */
const eventHandlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};
const events: Record<string, unknown[][]> = {};

// --- public API ------------------------------------------------------------

export type {
  ConsentConfig,
  Service,
  ConsentWatcher,
  VersionMismatchInfo,
} from './consent-manager.js';
export { ConsentManager } from './consent-manager.js';
export { language };
export { update as updateConfig } from './utils/config.js';

/** Read the current default config. */
export function getDefaultConfig(): ConsentConfig | undefined {
  return _defaultConfig;
}

/** Set the default config (the legacy `setup()` writes here). */
export function setDefaultConfig(config: ConsentConfig): void {
  _defaultConfig = config;
}

/**
 * Subscribe to an engine lifecycle event. Past events are replayed to
 * newly-registered handlers so consumers don't miss events from earlier in
 * the boot sequence. Returning `false` from a handler stops further
 * delivery for that event call.
 */
export function addEventListener(
  eventType: string,
  handler: (...args: unknown[]) => unknown
): void {
  if (eventHandlers[eventType] === undefined) {
    eventHandlers[eventType] = [handler];
  } else {
    eventHandlers[eventType].push(handler);
  }
  // Replay buffered past events so late-registered handlers aren't skipped.
  const past = events[eventType];
  if (past !== undefined) {
    for (const eventArgs of past) {
      if (handler(...eventArgs) === false) break;
    }
  }
}

/**
 * Dispatch through the engine event bus. Used internally for
 * `consentVersionMismatch` (REQ-3 / ADR-0004) and `recorderDetection`
 * (REQ-7 / ADR-0004 F #1). Re-exported under the public name `fireEvent`.
 */
export function fireEvent(eventType: string, ...args: unknown[]): boolean | undefined {
  const handlers = eventHandlers[eventType];
  if (events[eventType] === undefined) {
    events[eventType] = [args];
  } else {
    events[eventType].push(args);
  }
  if (handlers === undefined) return undefined;
  for (const handler of handlers) {
    if (handler(...args) === true) return true;
  }
  return undefined;
}

/**
 * Validate a config and migrate legacy `apps` → `services` (the rename
 * happened in Klaro 0.7). Returns a shallow copy with the migration
 * applied.
 */
export function validateConfig(config: ConsentConfig): ConsentConfig {
  const validated: ConsentConfig = { ...config };
  if (validated.version === 2) return validated;
  if ((validated as { apps?: unknown }).apps !== undefined && validated.services === undefined) {
    validated.services = (validated as unknown as { apps: ConsentConfig['services'] }).apps;
    console.warn(
      'Warning, your configuration file is outdated. Please change `apps` to `services`'
    );
    // biome-ignore lint/performance/noDelete: one-shot legacy migration; cleanly drop the obsolete key
    delete (validated as { apps?: unknown }).apps;
  }
  if (
    validated.translations !== undefined &&
    typeof validated.translations === 'object' &&
    validated.translations !== null
  ) {
    const trans = validated.translations as { apps?: unknown; services?: unknown };
    if (trans.apps !== undefined && trans.services === undefined) {
      trans.services = trans.apps;
      console.warn(
        'Warning, your configuration file is outdated. Please change `apps` to `services` in the `translations` key'
      );
      // biome-ignore lint/performance/noDelete: one-shot legacy migration; cleanly drop the obsolete key
      delete trans.apps;
    }
  }
  return validated;
}

/**
 * Build a Map of translations for a given config — the bundled
 * `defaultTranslations` overlaid with any per-config `translations`
 * provided by the integrator.
 */
export function getConfigTranslations(config: ConsentConfig): Map<unknown, unknown> {
  const trans = new Map<unknown, unknown>();
  updateMap(trans, defaultTranslations);
  const configTranslations = (config.translations ?? {}) as Record<string, unknown>;
  updateMap(trans, convertToMap(configTranslations));
  return trans;
}

/**
 * Get (or lazily create) the ConsentManager for a config. When called
 * without a config, falls back to `defaultConfig` (set via `setDefaultConfig`
 * by the legacy script-tag `setup()` flow).
 *
 * On first creation, fires `consentVersionMismatch` (REQ-3) when the
 * stored consent was discarded due to a version bump.
 */
export function getManager(config?: ConsentConfig): ConsentManager {
  const cfg = config ?? _defaultConfig;
  if (!cfg) {
    throw new Error('SimpleCMP getManager called without config and no default config set');
  }
  const name =
    (cfg.storageName as string | undefined) ?? (cfg.cookieName as string | undefined) ?? 'default';
  if (managers[name] === undefined) {
    managers[name] = new ConsentManager(validateConfig(cfg));
    // REQ-3 / ADR-0004 — surface the mismatch through the event bus once,
    // on first manager creation per session.
    if (managers[name].versionMismatch !== undefined) {
      fireEvent('consentVersionMismatch', managers[name].versionMismatch);
    }
  }
  return managers[name];
}

/** Drop all cached manager instances. */
export function resetManagers(): void {
  // Klaro upstream had a long-standing bug here (`for...in Object.keys()`
  // iterates over indices, not keys). Fixed as part of the TS migration.
  for (const key of Object.keys(managers)) {
    delete managers[key];
  }
}

/** Library version. Replaced at build time via esbuild's `define`. */
export function version(): string {
  // Klaro stripped a leading `v` for tag-style version strings; preserve.
  return typeof VERSION === 'string' && VERSION.startsWith('v') ? VERSION.slice(1) : VERSION;
}

// Re-export `update` as a non-conflicting name so consumers can pick what
// they want without colliding with the maps `update`.
export { update };
