/**
 * Consent-mode signalling hook (REQ-N10 / ADR-0016, ADR-0017).
 *
 * Opt-in. Signals consent to the merchant's *existing* ad/analytics tags — it
 * does NOT load any vendor library and does NOT run an analytics pipe. State is
 * derived from the engine's existing default-consent (which already composes the
 * REQ-N4 regime and REQ-5 GPC), so there is no new policy logic here.
 *
 * Originally Google-only; ADR-0017 generalized it into a small vendor-adapter
 * registry. Built-in adapters: `google` (Consent Mode v2 via gtag/dataLayer),
 * `meta` (`fbq('consent', …)`), `microsoftUet` (`uetq.push('consent', …)`).
 * TikTok and (mostly) Pinterest have no in-page consent API — the only
 * compliant option there is load-gating (universal pre-consent blocking), not a
 * signal, so there are deliberately no adapters for them.
 *
 * @see docs/adr/0016-google-consent-mode-v2-hook.md
 * @see docs/adr/0017-multi-vendor-consent-signals.md
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

/** Built-in vendors with an in-page consent API we can signal. */
export type ConsentVendorId = 'google' | 'meta' | 'microsoftUet';

export interface ConsentModeConfig {
  /**
   * Which vendors to signal. Default `['google']` (back-compat: `consentMode:
   * true` or an object without `vendors` signals Google only).
   */
  vendors?: ConsentVendorId[];
  /**
   * Map of purpose id → the Google signals it grants. Default:
   * `analytics → ['analytics_storage']`,
   * `marketing → ['ad_storage','ad_user_data','ad_personalization']`.
   * Only signals present here are emitted (an unmapped signal stays *unset*,
   * which Google treats differently from `denied`). Google adapter only.
   */
  purposeSignals?: Record<string, GoogleConsentSignal[]>;
  /**
   * Purposes that gate the advertising vendors (`meta`, `microsoftUet`): the
   * vendor is granted iff at least one consenting service carries one of these
   * purposes. Default `['marketing']`.
   */
  adPurposes?: string[];
  /** ms the Google `default` command asks tags to wait for an update. Default 500. */
  waitForUpdate?: number;
  /**
   * Also push a GTM custom event on each Google update. Default on
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
const DEFAULT_AD_PURPOSES = ['marketing'];
const DEFAULT_EVENT = 'simplecmp_consent_update';
const DEFAULT_WAIT_MS = 500;
const DEFAULT_VENDORS: ConsentVendorId[] = ['google'];

interface ResolvedOpts {
  vendors: ConsentVendorId[];
  purposeSignals: Record<string, GoogleConsentSignal[]>;
  adPurposes: string[];
  waitForUpdate: number;
  dataLayerEvent: string | null;
  redactAdsData: boolean;
}

function resolveOpts(cfg: boolean | ConsentModeConfig): ResolvedOpts {
  const obj = typeof cfg === 'object' && cfg !== null ? cfg : {};
  const dle = obj.dataLayerEvent;
  return {
    vendors: obj.vendors ?? DEFAULT_VENDORS,
    purposeSignals: obj.purposeSignals ?? DEFAULT_PURPOSE_SIGNALS,
    adPurposes: obj.adPurposes ?? DEFAULT_AD_PURPOSES,
    waitForUpdate: obj.waitForUpdate ?? DEFAULT_WAIT_MS,
    dataLayerEvent: dle === false ? null : typeof dle === 'string' ? dle : DEFAULT_EVENT,
    redactAdsData: obj.redactAdsData ?? false,
  };
}

type EmitMode = 'default' | 'update';

/**
 * Per-emission view of the consent state, vendor-neutral: `granted(purpose)` is
 * true iff at least one service carrying that purpose passes the active state
 * function (default consent, stored decision, or a live change).
 */
interface ConsentView {
  granted(purpose: string): boolean;
}

/** A vendor that can be signalled in-page. Built once per install. */
interface ConsentVendorAdapter {
  id: ConsentVendorId;
  emit(mode: EmitMode, view: ConsentView): void;
}

// --- Google (Consent Mode v2 via gtag / dataLayer) -------------------------

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

function googleAdapter(opts: ResolvedOpts, w: GtagWindow): ConsentVendorAdapter {
  const gtag = ensureGtag(w);
  const signals = trackedSignals(opts.purposeSignals);
  const buildMap = (view: ConsentView): Record<string, ConsentState> => {
    const map: Record<string, ConsentState> = {};
    for (const sig of signals) {
      const granted = purposesForSignal(sig, opts.purposeSignals).some((p) => view.granted(p));
      map[sig] = granted ? 'granted' : 'denied';
    }
    return map;
  };
  return {
    id: 'google',
    emit(mode, view) {
      const map = buildMap(view);
      // `ads_data_redaction` tracks `ad_storage` (redact while denied). Only
      // meaningful when `ad_storage` is actually mapped. Precedes the command.
      if (opts.redactAdsData && signals.includes('ad_storage')) {
        gtag('set', 'ads_data_redaction', map.ad_storage !== 'granted');
      }
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
    },
  };
}

// --- Meta Pixel (fbq consent grant/revoke) ---------------------------------

interface FbqWindow {
  fbq?: (...args: unknown[]) => void;
}

/**
 * Meta has no granular signal model — just `fbq('consent','grant'|'revoke')`.
 * We emit only when the merchant's pixel is already present: pre-creating an
 * `fbq` stub would make Meta's own loader snippet bail (`if(f.fbq)return`) and
 * never load `fbevents.js`. This reliably handles the *update* path (a visitor
 * granting/withdrawing after the banner decision) and the case where the pixel
 * is present at init; hard pre-consent suppression is the job of load-gating.
 */
function metaAdapter(opts: ResolvedOpts, w: FbqWindow): ConsentVendorAdapter {
  return {
    id: 'meta',
    emit(_mode, view) {
      if (typeof w.fbq !== 'function') return;
      const granted = opts.adPurposes.some((p) => view.granted(p));
      w.fbq('consent', granted ? 'grant' : 'revoke');
    },
  };
}

// --- Microsoft UET (uetq consent, ad_storage) ------------------------------

interface UetqWindow {
  uetq?: unknown[];
}

/**
 * Microsoft UET Consent Mode mirrors Google's default/update shape but with a
 * single `ad_storage` signal. `uetq` is a queue array (like dataLayer), so
 * pre-creating it is safe — `uet.js` drains it on load.
 */
function microsoftUetAdapter(opts: ResolvedOpts, w: UetqWindow): ConsentVendorAdapter {
  return {
    id: 'microsoftUet',
    emit(mode, view) {
      if (!Array.isArray(w.uetq)) w.uetq = [];
      const adStorage: ConsentState = opts.adPurposes.some((p) => view.granted(p))
        ? 'granted'
        : 'denied';
      w.uetq.push('consent', mode, { ad_storage: adStorage });
    },
  };
}

function buildAdapters(opts: ResolvedOpts, w: object): ConsentVendorAdapter[] {
  const out: ConsentVendorAdapter[] = [];
  for (const v of opts.vendors) {
    if (v === 'google') out.push(googleAdapter(opts, w as GtagWindow));
    else if (v === 'meta') out.push(metaAdapter(opts, w as FbqWindow));
    else if (v === 'microsoftUet') out.push(microsoftUetAdapter(opts, w as UetqWindow));
  }
  return out;
}

/**
 * Install the consent-mode hook. Emits the `default` command immediately (state
 * from the engine's default-consent) to every configured vendor, replays an
 * `update` if the visitor already has a stored decision, and emits `update` on
 * every later change. Returns an uninstaller.
 */
export function installConsentMode(
  cfg: boolean | ConsentModeConfig,
  manager: ConsentManager,
  services: readonly Service[]
): () => void {
  if (typeof window === 'undefined') return () => {};
  const opts = resolveOpts(cfg);
  const adapters = buildAdapters(opts, window);
  if (adapters.length === 0) return () => {};

  const viewFor = (stateFn: (s: Service) => boolean): ConsentView => ({
    granted: (purpose) => services.some((s) => (s.purposes ?? []).includes(purpose) && stateFn(s)),
  });

  const emit = (mode: EmitMode, stateFn: (s: Service) => boolean): void => {
    const view = viewFor(stateFn);
    for (const a of adapters) a.emit(mode, view);
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
