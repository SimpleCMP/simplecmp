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
import informalPacks from './translations/informal/index.js';
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
/**
 * Fingerprint of the config each cached manager was built from, keyed by the
 * same storageName. Lets `getManager` detect a re-`init()` with a changed
 * config (e.g. an SPA / CMS-preview swapping `services[]` under the same
 * storageName) and rebuild instead of returning a stale manager.
 */
const managerConfigs: Record<string, string> = {};

/** Event-bus state for `addEventListener` / `fireEvent`. */
const eventHandlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};
const events: Record<string, unknown[][]> = {};

// --- public API ------------------------------------------------------------

export type {
  ConsentConfig,
  LibraryFallback,
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
 * Build a Map of translations for a given config.
 *
 * Resolution chain (lowest → highest precedence):
 *   1. bundled `defaultTranslations` (formal register)
 *   2. informal-tone overlays for any `config.tones[lang] === 'informal'`
 *   3. consumer-supplied `config.translations` (always wins)
 *
 * The tone layer sits between bundle and consumer so that integrators
 * who opt a language into the informal register get the curated du-form
 * out of the box, but still keep the ability to override individual
 * strings via `translations`.
 */
export function getConfigTranslations(config: ConsentConfig): Map<unknown, unknown> {
  const trans = new Map<unknown, unknown>();
  updateMap(trans, defaultTranslations);
  applyToneOverlays(trans, config);
  const configTranslations = (config.translations ?? {}) as Record<string, unknown>;
  updateMap(trans, convertToMap(configTranslations));
  return trans;
}

/**
 * Overlay informal-tone packs on top of the formal defaults for every
 * language the config opted in via `tones: { <lang>: 'informal' }`.
 * Languages without a shipped informal pack are silent no-ops — they
 * stay formal until somebody contributes a `<lang>.json` to
 * `src/engine/translations/informal/`.
 */
function applyToneOverlays(trans: Map<unknown, unknown>, config: ConsentConfig): void {
  const tones = config.tones;
  if (tones === undefined || tones === null) return;
  for (const [lang, tone] of Object.entries(tones)) {
    if (tone !== 'informal') continue;
    const pack = informalPacks[lang];
    if (pack === undefined) continue;
    const overlay = new Map<unknown, unknown>();
    overlay.set(lang, convertToMap(pack));
    updateMap(trans, overlay);
  }
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
  // Rebuild when there's no manager yet OR the config changed since the cached
  // one was built — otherwise a re-init with new services[] under the same
  // storageName silently returns the stale manager. One manager per
  // storageName is kept (it owns the cookie/localStorage slot); the rebuild
  // re-reads saved consent from storage, so the visitor's persisted choice
  // survives, and re-derives defaults from the new services.
  const fingerprint = configFingerprint(cfg);
  if (managers[name] === undefined || managerConfigs[name] !== fingerprint) {
    managers[name] = new ConsentManager(validateConfig(cfg));
    managerConfigs[name] = fingerprint;
    // REQ-3 / ADR-0004 — surface the mismatch through the event bus on
    // (re)build, when the stored consent was discarded due to a version bump.
    if (managers[name].versionMismatch !== undefined) {
      fireEvent('consentVersionMismatch', managers[name].versionMismatch);
    }
  }
  return managers[name];
}

/**
 * Stable string fingerprint of a config's serialisable surface. Functions
 * (callbacks like `callback` / `getConsent`) are dropped — they don't affect
 * the consent state machine and aren't serialisable. A non-serialisable config
 * (e.g. a cyclic structure) yields a unique sentinel so it always rebuilds
 * rather than throwing.
 */
function configFingerprint(cfg: ConsentConfig): string {
  try {
    return JSON.stringify(cfg, (_key, value) => (typeof value === 'function' ? undefined : value));
  } catch {
    return `__unserialisable__:${_fingerprintCounter++}`;
  }
}
let _fingerprintCounter = 0;

/** Drop all cached manager instances. */
export function resetManagers(): void {
  // Klaro upstream had a long-standing bug here (`for...in Object.keys()`
  // iterates over indices, not keys). Fixed as part of the TS migration.
  for (const key of Object.keys(managers)) {
    delete managers[key];
  }
  for (const key of Object.keys(managerConfigs)) {
    delete managerConfigs[key];
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
