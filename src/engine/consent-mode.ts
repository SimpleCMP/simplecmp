/**
 * Google Consent Mode v2 emission hook (REQ-N10 / ADR-0016).
 *
 * Opt-in. Signals consent to the merchant's *existing* Google tags via
 * `gtag('consent', …)` / the dataLayer — it does NOT load gtag/GTM and does
 * NOT run an analytics pipe. State is derived from the engine's existing
 * default-consent (which already composes the REQ-N4 regime and REQ-5 GPC),
 * so there is no new policy logic here.
 *
 * @see docs/adr/0016-google-consent-mode-v2-hook.md
 */

import type { ConsentManager, ConsentWatcher, Service } from './consent-manager.js';

export type GoogleConsentSignal =
  | 'ad_storage'
  | 'analytics_storage'
  | 'ad_user_data'
  | 'ad_personalization'
  | 'functionality_storage'
  | 'personalization_storage'
  | 'security_storage';

export interface ConsentModeConfig {
  /**
   * Map of purpose id → the Google signals it grants. Default:
   * `analytics → ['analytics_storage']`,
   * `marketing → ['ad_storage','ad_user_data','ad_personalization']`.
   * Only signals present here are emitted (an unmapped signal stays *unset*,
   * which Google treats differently from `denied`).
   */
  purposeSignals?: Record<string, GoogleConsentSignal[]>;
  /** ms the `default` command asks tags to wait for an update. Default 500. */
  waitForUpdate?: number;
  /**
   * Also push a GTM custom event on each update. Default on
   * (`'simplecmp_consent_update'`); `false` disables. Hardcoded gtag reacts to
   * the consent command itself; GTM triggers need the event.
   */
  dataLayerEvent?: boolean | string;
  /**
   * Dynamically set `ads_data_redaction` to track `ad_storage` (true while
   * denied), per Google's advanced pattern. Default false. No-op unless
   * `ad_storage` is a mapped signal.
   */
  redactAdsData?: boolean;
}

type ConsentState = 'granted' | 'denied';

const DEFAULT_PURPOSE_SIGNALS: Record<string, GoogleConsentSignal[]> = {
  analytics: ['analytics_storage'],
  marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
};
const DEFAULT_EVENT = 'simplecmp_consent_update';
const DEFAULT_WAIT_MS = 500;

interface ResolvedOpts {
  purposeSignals: Record<string, GoogleConsentSignal[]>;
  waitForUpdate: number;
  dataLayerEvent: string | null;
  redactAdsData: boolean;
}

function resolveOpts(cfg: boolean | ConsentModeConfig): ResolvedOpts {
  const obj = typeof cfg === 'object' && cfg !== null ? cfg : {};
  const dle = obj.dataLayerEvent;
  return {
    purposeSignals: obj.purposeSignals ?? DEFAULT_PURPOSE_SIGNALS,
    waitForUpdate: obj.waitForUpdate ?? DEFAULT_WAIT_MS,
    dataLayerEvent: dle === false ? null : typeof dle === 'string' ? dle : DEFAULT_EVENT,
    redactAdsData: obj.redactAdsData ?? false,
  };
}

interface GtagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

/**
 * Ensure `window.dataLayer` and a canonical `gtag` shim exist. The shim MUST
 * push the `arguments` object (not an array) — GTM's consent reading depends
 * on it; a plain-array push silently breaks consent mode.
 */
function ensureGtag(w: GtagWindow): (...args: unknown[]) => void {
  if (!Array.isArray(w.dataLayer)) w.dataLayer = [];
  if (typeof w.gtag !== 'function') {
    w.gtag = function gtag() {
      // biome-ignore lint/style/noArguments: canonical gtag shim — GTM reads the arguments object, not an array.
      (w.dataLayer as unknown[]).push(arguments);
    };
  }
  return w.gtag;
}

function trackedSignals(
  purposeSignals: Record<string, GoogleConsentSignal[]>
): GoogleConsentSignal[] {
  const set = new Set<GoogleConsentSignal>();
  for (const sigs of Object.values(purposeSignals)) {
    for (const s of sigs) set.add(s);
  }
  return [...set];
}

function purposesForSignal(
  signal: GoogleConsentSignal,
  purposeSignals: Record<string, GoogleConsentSignal[]>
): string[] {
  return Object.keys(purposeSignals).filter((p) => purposeSignals[p]?.includes(signal));
}

/** A signal is granted iff at least one service with a mapped purpose passes `stateFn`. */
function signalGranted(
  signal: GoogleConsentSignal,
  purposeSignals: Record<string, GoogleConsentSignal[]>,
  services: readonly Service[],
  stateFn: (s: Service) => boolean
): boolean {
  const purposes = purposesForSignal(signal, purposeSignals);
  return services.some((s) => (s.purposes ?? []).some((p) => purposes.includes(p)) && stateFn(s));
}

function buildMap(
  signals: readonly GoogleConsentSignal[],
  purposeSignals: Record<string, GoogleConsentSignal[]>,
  services: readonly Service[],
  stateFn: (s: Service) => boolean
): Record<string, ConsentState> {
  const map: Record<string, ConsentState> = {};
  for (const sig of signals) {
    map[sig] = signalGranted(sig, purposeSignals, services, stateFn) ? 'granted' : 'denied';
  }
  return map;
}

/**
 * Install the Consent Mode v2 hook. Emits the `default` command immediately
 * (state from the engine's default-consent), replays an `update` if the
 * visitor already has a stored decision, and emits `update` on every later
 * change. Returns an uninstaller.
 */
export function installConsentMode(
  cfg: boolean | ConsentModeConfig,
  manager: ConsentManager,
  services: readonly Service[]
): () => void {
  if (typeof window === 'undefined') return () => {};
  const opts = resolveOpts(cfg);
  const signals = trackedSignals(opts.purposeSignals);
  const w = window as GtagWindow;
  const gtag = ensureGtag(w);

  const emitRedaction = (map: Record<string, ConsentState>): void => {
    // `ads_data_redaction` tracks `ad_storage` (redact while denied). Only
    // meaningful when `ad_storage` is actually mapped.
    if (!opts.redactAdsData || !signals.includes('ad_storage')) return;
    gtag('set', 'ads_data_redaction', map.ad_storage !== 'granted');
  };

  const emit = (mode: 'default' | 'update', stateFn: (s: Service) => boolean): void => {
    const map = buildMap(signals, opts.purposeSignals, services, stateFn);
    // Redaction precedes the consent command (and re-fires on each update).
    emitRedaction(map);
    if (mode === 'default') {
      gtag('consent', 'default', {
        ...map,
        security_storage: 'granted',
        wait_for_update: opts.waitForUpdate,
      });
    } else {
      gtag('consent', 'update', { ...map });
      if (opts.dataLayerEvent !== null && Array.isArray(w.dataLayer)) {
        w.dataLayer.push({ event: opts.dataLayerEvent });
      }
    }
  };

  // Bootstrap — default state from the regime/GPC-composed default consent.
  emit('default', (s) => manager.getDefaultConsent(s));

  // Replay — a returning visitor with a stored, complete decision must get an
  // `update` right after `default`, or they stay on `default: denied` forever.
  // `manager.confirmed` is set by the restore path (`_checkConsents`); we do
  // NOT rely on the watch firing during construction (it fires before this
  // hook can subscribe).
  if (manager.confirmed) {
    emit('update', (s) => manager.getConsent(s.name));
  }

  // Update — every later decision.
  const watcher: ConsentWatcher = {
    update: (m, name) => {
      if (name !== 'consents' && name !== 'saveConsents') return;
      emit('update', (s) => m.getConsent(s.name));
    },
  };
  manager.watch(watcher);
  return () => manager.unwatch(watcher);
}
