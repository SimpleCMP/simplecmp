/**
 * SimpleCMP — open-source consent manager.
 *
 * Public API entry point. All exports here form the supported surface of the
 * library. Internal modules (`src/recorder`, `src/service-db`) should not be
 * imported directly by consumers.
 *
 * @packageDocumentation
 */

import { CmsBridge } from './cms-bridge/index.js';
import type { CmsBridgeAuth, CmsBridgeOptions } from './cms-bridge/index.js';
import {
  defaultTranslations,
  addEventListener as engineAddEventListener,
  fireEvent as engineFireEvent,
  getManager as engineGetManager,
  updateConfig as engineUpdateConfig,
} from './engine/index.js';
import type { ConsentConfig, ConsentManager, Service } from './engine/index.js';
import bundledTranslations from './engine/translations/index.js';
import { convertToMap, update } from './engine/utils/maps.js';
import { LocalClassifier } from './recorder/classifier.js';
import { Recorder } from './recorder/recorder.js';
import type { ClassifierServiceConfig, Detection, RecorderOptions } from './recorder/types.js';
import { CookieWatcher } from './recorder/watchers/cookie-watcher.js';
import { DomWatcher } from './recorder/watchers/dom-watcher.js';
import { NetworkWatcher } from './recorder/watchers/network-watcher.js';
import { installRuntimePatches } from './runtime-patches/index.js';
import type { BlockInfo } from './runtime-patches/index.js';
import { buildHostMatcher } from './runtime-patches/matcher.js';
import { ServiceDbClient } from './service-db/client.js';
import { LayeredClassifier } from './service-db/layered-classifier.js';
import type { ServiceDbAuth } from './service-db/types.js';
import { initLit as mountUI } from './ui/init.js';
import type { FloatingTriggerOptions, LitInitHandle } from './ui/init.js';

export type { FloatingTriggerOptions, LitInitHandle as InitHandle } from './ui/init.js';
export type {
  Detection,
  DetectionKind,
  DetectionStatus,
  RecorderOptions,
} from './recorder/types.js';
export type { LookupQuery, ServiceDbAuth, ServiceMatch } from './service-db/types.js';
export type { CmsBridgeAuth, CmsBridgeOptions, CmsBridgePayload } from './cms-bridge/index.js';
export type { BlockInfo } from './runtime-patches/index.js';
export { ServiceDbClient } from './service-db/client.js';
export { LayeredClassifier } from './service-db/layered-classifier.js';
export { CmsBridge } from './cms-bridge/index.js';

// Seed the engine's translation registry with the bundled language packs at
// import time. Consumers get sensible defaults out of the box; per-config
// `translations` still override or extend.
update(defaultTranslations, convertToMap(bundledTranslations));

export const VERSION = '0.0.1';

/**
 * SimpleCMP configuration. Engine fields plus SimpleCMP-specific options
 * (record mode, service DB, CMS bridge). Unknown keys are forwarded to
 * the engine untouched.
 */
export interface SimpleCMPConfig extends ConsentConfig {
  /** Storage key for consent decisions. */
  storageName?: string;
  /** Storage backend. Defaults to `cookie`. */
  storageMethod?: 'cookie' | 'localStorage';
  /** Consent services (trackers, scripts, etc.). Required, but may be `[]`. */
  services: Service[];

  /**
   * Privacy policy URL. Either a single URL string, or a `{ [lang]: url }` map
   * with an optional `default` fallback.
   */
  privacyPolicy?: string | (Record<string, string> & { default?: string });
  /**
   * Imprint (Impressum) URL. Same shape as `privacyPolicy`. SimpleCMP-specific
   * extension (REQ-1) — German law (TMG/MStV) requires a separate imprint
   * link. Renders as its own link next to the privacy policy in both the
   * banner and the modal.
   */
  imprint?: string | (Record<string, string> & { default?: string });

  /**
   * Consent version. When set, SimpleCMP stores the version alongside the
   * consent decisions and discards the stored consent on a later visit if
   * this value has changed (re-asking the user). Fires the
   * `consentVersionMismatch` event when the discard happens.
   *
   * **When to bump:**
   * - You added a new service that processes personal data.
   * - You added a new processing purpose.
   * - You added a new third-country recipient.
   * - Your privacy policy changed in a way that affects the consent given.
   *
   * SimpleCMP-specific (REQ-3).
   */
  consentVersion?: string | number;
  /**
   * How strictly to compare `consentVersion` against the stored value. Default
   * `'any'` re-asks on any difference. `'major'` tolerates patch/minor bumps
   * (semver-like, takes the part before the first dot).
   *
   * SimpleCMP-specific (REQ-3).
   */
  consentVersionPolicy?: 'any' | 'major';

  /**
   * Show a persistent "cookie settings" floating button so users can re-open
   * the consent preferences from any page. Required for DSGVO Art. 7(3)
   * (withdrawing consent must be as easy as giving it). REQ-4.
   *
   * `true` mounts the trigger with defaults (bottom-right corner,
   * `'Cookie settings'` label). Pass an object to customize position and
   * label.
   */
  floatingTrigger?: boolean | FloatingTriggerOptions;

  /**
   * Whether to respect the Global Privacy Control (GPC) signal sent by the
   * browser. Default `true`. SimpleCMP-specific (REQ-5).
   *
   * When the signal is set and there is no stored consent yet, all
   * non-required services default to opt-out. Required services bypass it.
   */
  respectGPC?: boolean;

  /**
   * Render components into Shadow DOM (default, encapsulated styles) or
   * Light DOM (host page's CSS applies). REQ-16. With `'light'` you must
   * `<link rel="stylesheet" href="simplecmp/styles/default.css">` (or
   * `bootstrap.css`, or your own) for the components to be styled.
   */
  domMode?: 'shadow' | 'light';

  /**
   * Enable record mode for development-time tracker detection. `true` uses
   * sensible defaults; pass a `RecorderOptions` object to customize cookie
   * polling cadence, periodic summary cadence, sessionStorage persistence
   * (dev only), or to suppress the production-hostname warning.
   *
   * The recorder observes cookies, DOM resource tags, and network requests,
   * classifies each against the configured `services` list, and surfaces
   * unknown items via `simplecmp.addEventListener('recorderDetection', ...)`,
   * `simplecmp.getRecorder()`, and the dev console. Read access is
   * side-effect-free; the recorder never transmits data on its own.
   *
   * See `docs/adr/0004-recorder-architecture.md` for the full design.
   */
  record?: boolean | RecorderOptions;
  /**
   * Base URL of a Service DB endpoint that implements the SimpleCMP
   * protocol (`docs/service-db-protocol.md`). When set together with
   * `record`, the recorder uses a `LayeredClassifier` that consults the
   * DB after the local services list, enriching unknown detections with
   * vendor metadata.
   *
   * **Do NOT include the `/v1` version segment.** The client appends
   * `/<apiVersion>/lookup` (etc.) automatically. Pass the URL up to but
   * excluding the version: e.g. `https://example.com/api/simplecmp`,
   * not `https://example.com/api/simplecmp/v1`.
   *
   * SimpleCMP-specific (REQ-8).
   */
  serviceDbUrl?: string;
  /**
   * Optional auth header for the Service DB endpoint. SimpleCMP-specific (REQ-8).
   */
  serviceDbAuth?: ServiceDbAuth;
  /**
   * CMS bridge webhook URL. When set together with `record: true`, the
   * bridge POSTs a JSON payload to this URL each time the recorder sees a
   * tracker that classifies as `'unknown'` (no local match, no Service-DB
   * hit). Production-oriented alerting — your CMS receives the webhook
   * and surfaces unknown trackers to admins before they compound into a
   * compliance issue.
   *
   * Schema and example POST: `docs/cms-bridge-webhook.md`. SimpleCMP-
   * specific (REQ-9).
   *
   * Dedup: same `${kind}:${identifier}` only re-fires after
   * `cmsBridge.dedupTtlMs` (default 1 hour). URL query strings are
   * stripped from the payload for privacy.
   */
  cmsBridgeUrl?: string;
  /**
   * Optional auth header for the CMS bridge webhook. Bearer-by-default;
   * pass `header` / `scheme` to use a custom header. SimpleCMP-specific
   * (REQ-9).
   */
  cmsBridgeAuth?: CmsBridgeAuth;
  /**
   * Advanced overrides for the CMS bridge. Most consumers should leave
   * this off and rely on `cmsBridgeUrl` + `cmsBridgeAuth` alone. SimpleCMP-
   * specific (REQ-9).
   *
   * **Discover-mode override:** when the page URL carries
   * `?simplecmp_discover=1`, the bridge ignores `crossSessionDedupMs`,
   * `sampleRate`, and `respectDoNotTrack` for that page load — they're
   * forced to `0`, `1`, and `false` respectively. Intended for BE-driven
   * sitemap sweeps where every page load needs to POST regardless of
   * the bandwidth controls that normally suppress repeat visits.
   */
  cmsBridge?: Pick<
    CmsBridgeOptions,
    | 'source'
    | 'dedupTtlMs'
    | 'crossSessionDedupMs'
    | 'flushDebounceMs'
    | 'maxBatchSize'
    | 'sampleRate'
    | 'respectDoNotTrack'
    | 'timeoutMs'
  >;

  /**
   * Universal pre-consent blocking — JS-injected calls (ADR-0013
   * Phase 2). When set, SimpleCMP installs prototype-level patches on
   * `HTMLScriptElement.prototype.src`,
   * `HTMLIFrameElement.prototype.src`,
   * `HTMLImageElement.prototype.src`, `window.fetch`,
   * `XMLHttpRequest.prototype.open`+`send`, and
   * `navigator.sendBeacon`. A request is gated when its host matches
   * an origin pattern in `config.services[].origins` AND consent for
   * that service has not been granted. Same-origin requests, hosts
   * with no matching service, and consented services all pass
   * through unchanged.
   *
   * Off by default — opt in per integrator. Pairs naturally with the
   * server-side TYPO3 rewriter (which catches declarative tags); the
   * runtime patches close the gap for code that injects scripts /
   * iframes / pixels at runtime.
   *
   * Pass `true` for defaults or an object to configure same-origin
   * hosts (your CDN, your own infrastructure) and an observability
   * `onBlock` hook.
   *
   * **First-script ordering matters.** Patches only catch calls that
   * execute AFTER `init()` runs. Load the SimpleCMP bundle
   * synchronously in `<head>` before any third-party loader.
   */
  interceptRuntime?: boolean | InterceptRuntimeOptions;
}

/**
 * Optional configuration for `interceptRuntime`. All fields optional —
 * sensible defaults keep simple opt-in (`interceptRuntime: true`)
 * usable.
 */
export interface InterceptRuntimeOptions {
  /**
   * Extra hosts treated as same-origin for pass-through. The site's
   * own `window.location.host` is **always** implicitly included;
   * entries here are additive. Use for CDNs, vendor infrastructure,
   * or anything the admin has explicitly trusted (e.g. the TYPO3
   * `simplecmp.universalBlocking.allowlist` Site Set).
   */
  sameOriginHosts?: readonly string[];

  /**
   * Observability hook fired whenever a JS-injected call is blocked.
   * Useful for dev-mode logging or surfacing blocked traffic in a
   * debug panel.
   */
  onBlock?: (info: BlockInfo) => void;

  /**
   * Strict "block everything third-party" posture — when `true`, any
   * non-same-origin call to a host that DOESN'T match a configured
   * service is blocked too, using the host itself as the synthetic
   * service id (visible in `BlockInfo.service` and the recorder
   * detection log).
   *
   * Off by default — opt in via the per-CMS universal-blocking switch
   * (TYPO3 Site Set `simplecmp.universalBlocking.enabled`). The
   * trade-off is real: hosts blocked without a curated service have
   * no consent UI to unblock through; admin has to Kuratieren them
   * via the BE. That's the intended posture for sites that have
   * opted into maximum protection.
   */
  universalBlock?: boolean;
}

/**
 * Most recent init handle. `show()` / programmatic re-open uses it.
 * Replaced on each `init()` call; the previous handle is destroyed first
 * so re-initing doesn't leak DOM elements or watcher subscriptions.
 */
let activeHandle: LitInitHandle | null = null;

/**
 * Uninstaller for the runtime patches installed by the most recent
 * `init({ interceptRuntime: ... })` call. Re-init / destroy chains
 * through this so prototype patches don't stack.
 */
let activeRuntimePatchUninstaller: (() => void) | null = null;

/**
 * Initialize SimpleCMP and mount the consent UI.
 *
 * Returns a handle the caller can keep around for `handle.show()`,
 * `handle.hide()`, `handle.destroy()`, and direct `handle.manager`
 * access. The same handle is also stashed module-level, so the
 * convenience export `show()` works without it.
 *
 * @see docs/adr/0006-hard-fork-from-klaro.md
 * @see docs/adr/0007-ui-architecture-lit.md
 */
export function init(config: SimpleCMPConfig): LitInitHandle {
  warnOnUnimplementedFeatures(config);
  warnOnConfigInconsistencies(config);
  warnOnComplianceRisks(config);

  // Replace any prior handle cleanly — re-init shouldn't leak DOM or
  // leave prototype patches stacked.
  if (activeHandle !== null) {
    activeHandle.destroy();
    activeHandle = null;
  }
  if (activeRuntimePatchUninstaller !== null) {
    activeRuntimePatchUninstaller();
    activeRuntimePatchUninstaller = null;
  }

  // Phase 1 — set up everything that doesn't need the DOM. Critically,
  // the recorder + runtime patches install BEFORE any inline body script
  // can dispatch third-party requests when init() is called pre-body
  // (e.g. from a TYPO3 head-priority asset). `getManager(config)` is
  // pure JS (the engine's manager cache); the recorder uses
  // `document.documentElement` not `document.body`; patches just swap
  // prototype descriptors. None need a parsed body.
  const manager = engineGetManager(config);
  if (config.record) startRecorder(config);
  if (config.interceptRuntime) {
    activeRuntimePatchUninstaller = installRuntimePatchesWithManager(config, manager);
  }

  // Phase 2 — mount the UI. Defer to DOMContentLoaded if body isn't
  // ready yet so callers can wire init() into <head> without breaking
  // the banner/modal/trigger mount path.
  let mountedHandle: LitInitHandle | null = null;
  type QueuedOp = 'show' | 'hide';
  const queued: QueuedOp[] = [];
  const mountNow = (): void => {
    mountedHandle = mountUI(config);
    for (const op of queued) {
      if (op === 'show') mountedHandle.show();
      else mountedHandle.hide();
    }
    queued.length = 0;
  };
  let deferredMountListener: (() => void) | null = null;
  if (typeof document !== 'undefined' && document.body !== null) {
    mountNow();
  } else if (typeof document !== 'undefined') {
    deferredMountListener = mountNow;
    document.addEventListener('DOMContentLoaded', deferredMountListener, { once: true });
  }

  // Wrap into a single handle that proxies show/hide to the mounted
  // handle when available and queues otherwise. destroy() also tears
  // the runtime patches down so re-init / explicit teardown is clean.
  activeHandle = {
    show: () => {
      if (mountedHandle !== null) mountedHandle.show();
      else queued.push('show');
    },
    hide: () => {
      if (mountedHandle !== null) mountedHandle.hide();
      else queued.push('hide');
    },
    manager,
    destroy: () => {
      if (activeRuntimePatchUninstaller !== null) {
        activeRuntimePatchUninstaller();
        activeRuntimePatchUninstaller = null;
      }
      if (deferredMountListener !== null && typeof document !== 'undefined') {
        document.removeEventListener('DOMContentLoaded', deferredMountListener);
        deferredMountListener = null;
      }
      mountedHandle?.destroy();
      mountedHandle = null;
      queued.length = 0;
    },
  };
  return activeHandle;
}

function installRuntimePatchesWithManager(
  config: SimpleCMPConfig,
  manager: ConsentManager
): () => void {
  const opts: InterceptRuntimeOptions =
    typeof config.interceptRuntime === 'object' && config.interceptRuntime !== null
      ? config.interceptRuntime
      : {};
  const matcher = buildHostMatcher(config.services, {
    blockAllUnknown: opts.universalBlock === true,
  });
  return installRuntimePatches({
    matcher,
    consentChecker: (serviceId: string) => manager.getConsent(serviceId),
    sameOriginHosts: opts.sameOriginHosts,
    onBlock: opts.onBlock,
  });
}

/**
 * Open the preferences modal of the most recently mounted SimpleCMP.
 * Equivalent to `handle.show()` from the `init()` return value — kept
 * as a global convenience for inline `onclick` handlers in templates.
 */
export function show(): void {
  activeHandle?.show();
}

/**
 * Singleton recorder for the current page. There is at most one active
 * recorder per page; calling `init({ record: true })` again with the same
 * config replaces the existing one cleanly. `null` when no recorder is
 * active.
 */
let activeRecorder: Recorder | null = null;

function startRecorder(config: SimpleCMPConfig): void {
  // Replace any prior recorder so re-init doesn't leak watchers. The CMS
  // bridge lives only as a closure captured by `recorder.on('detection',
  // ...)` below — replacing the recorder drops the listener, which drops
  // the bridge reference (and its dedup map) on the next GC.
  if (activeRecorder) {
    activeRecorder.stop();
    activeRecorder = null;
  }
  const options: RecorderOptions =
    typeof config.record === 'object' && config.record !== null ? { ...config.record } : {};
  if (!options.storageName && typeof config.storageName === 'string') {
    options.storageName = config.storageName;
  }
  // The recorder would otherwise detect its own consent cookie as an unknown
  // tracker on every page. Pre-populate `ignoreCookies` with whatever the
  // consent storageName resolves to (cookie + sessionStorage entry share the
  // name). Caller-supplied entries are preserved.
  if (options.storageName) {
    const userIgnored = options.ignoreCookies ?? [];
    options.ignoreCookies = userIgnored.includes(options.storageName)
      ? userIgnored
      : [options.storageName, ...userIgnored];
  }
  const services = (config.services as ClassifierServiceConfig[] | undefined) ?? [];
  // REQ-8 / ADR-0005: when serviceDbUrl is configured, the recorder uses a
  // LayeredClassifier that consults the DB after the local services list.
  const layered = config.serviceDbUrl
    ? new LayeredClassifier(
        new ServiceDbClient({ url: config.serviceDbUrl, auth: config.serviceDbAuth }),
        services
      )
    : null;
  const classifier = layered ?? new LocalClassifier(services);
  const recorder = new Recorder({
    options,
    classifier,
    services,
    watcherFactories: [
      (sink) => new CookieWatcher(sink, { intervalMs: options.cookieIntervalMs }),
      (sink) => new DomWatcher(sink),
      (sink) => new NetworkWatcher(sink),
    ],
    onDetectionForLibEvent: (d: Detection) => {
      // Channel #1 (ADR-0004 section F): surface detections through the
      // engine's event bus so consumers can subscribe via
      // `simplecmp.addEventListener('recorderDetection', handler)`.
      engineFireEvent('recorderDetection', d);
    },
  });
  if (layered) {
    layered.onEnrichment((raw, enrichment) => {
      recorder.enrichDetection(raw, enrichment);
    });
  }
  // REQ-9: when cmsBridgeUrl is configured, subscribe the bridge to the
  // recorder's detection stream. The bridge filters for status: 'unknown'
  // and dedupes by `${kind}:${identifier}` with a TTL window.
  //
  // REQ-N7: subscribe to `'detectionSettled'` rather than `'detection'`.
  // The first emission of a detection is always `status: 'unknown'` even
  // when the Service-DB lookup would have classified it as known — the
  // bridge would race the lookup and POST before enrichment finalises
  // the status. The settled event fires once per detection, after any
  // async classification finishes, with the final status.
  if (config.cmsBridgeUrl) {
    const discover = isDiscoverMode();
    const bridge = new CmsBridge({
      url: config.cmsBridgeUrl,
      auth: config.cmsBridgeAuth,
      source: config.cmsBridge?.source ?? options.storageName ?? 'default',
      // Discover mode (?simplecmp_discover=1) is an admin-driven sitemap
      // sweep run from the BE: every page load should POST regardless of
      // the bandwidth controls that normally suppress repeat visits.
      dedupTtlMs: config.cmsBridge?.dedupTtlMs,
      crossSessionDedupMs: discover ? 0 : config.cmsBridge?.crossSessionDedupMs,
      flushDebounceMs: config.cmsBridge?.flushDebounceMs,
      maxBatchSize: config.cmsBridge?.maxBatchSize,
      sampleRate: discover ? 1 : config.cmsBridge?.sampleRate,
      respectDoNotTrack: discover ? false : config.cmsBridge?.respectDoNotTrack,
      timeoutMs: config.cmsBridge?.timeoutMs,
    });
    recorder.on('detectionSettled', (d) => bridge.onDetection(d));
  }
  activeRecorder = recorder;
  activeRecorder.start();
}

/**
 * Get the currently active recorder, or `undefined` if `record` was not set.
 * The recorder exposes `getSnapshot()`, `clear()`, `on('detection', ...)`,
 * `exportConfig()`, and `assertNoUnknown()`.
 *
 * @see docs/adr/0004-recorder-architecture.md
 */
export function getRecorder(): Recorder | undefined {
  return activeRecorder ?? undefined;
}

/** Subscribe to lifecycle events (`recorderDetection`, `consentVersionMismatch`). */
export const addEventListener = engineAddEventListener;

/** Retrieve the consent manager for a config (or the current default). */
export const getManager = engineGetManager;

/** Update a config object in place. */
export const updateConfig = engineUpdateConfig;

/**
 * Detect the BE-driven discovery sweep marker (`?simplecmp_discover=1`).
 *
 * The TYPO3 (or any CMS) backend can run a discovery pass by loading each
 * sitemap URL in a hidden iframe with this query parameter appended. The
 * recorder and bridge then behave as for a real visitor *except* that the
 * bandwidth controls designed to suppress repeat visits are turned off —
 * cross-session localStorage markers, sample rate, and Do-Not-Track all
 * skip — so the sweep populates the receiver's detection table reliably.
 *
 * Treat the param as opt-in for the *current page load only*. It does
 * not persist anywhere, doesn't affect future visits, and never reaches
 * the bridge payload — it's a runtime hint to the local recorder.
 */
function isDiscoverMode(): boolean {
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('simplecmp_discover') === '1';
  } catch {
    return false;
  }
}

function warnOnUnimplementedFeatures(_config: SimpleCMPConfig): void {
  // Reserved for future Phase 5 features. Currently no-op — REQ-8 and
  // REQ-9 are both implemented.
}

// REQ-9: the CMS bridge listens to recorder detections. Without
// `record: true` the bridge has no source of events and silently does
// nothing — surface that misconfiguration loudly so it's debuggable.
function warnOnConfigInconsistencies(config: SimpleCMPConfig): void {
  if (config.cmsBridgeUrl && !config.record) {
    console.warn(
      'SimpleCMP: `cmsBridgeUrl` is set but `record` is not enabled. The CMS bridge listens to recorder detections — without the recorder running, no webhooks will ever fire. Set `record: true` or remove `cmsBridgeUrl`.'
    );
  }
}

// REQ-2: equal prominence for accept and decline. We don't refuse the config —
// some integrators may have a defensible reason — but flag it loudly so the
// risk is visible in dev/staging logs.
function warnOnComplianceRisks(config: SimpleCMPConfig): void {
  if (config.hideDeclineAll) {
    console.warn(
      'SimpleCMP: `hideDeclineAll: true` hides the "Decline all" button on the first banner level. ' +
        'This is incompatible with German consent requirements (BGH "Cookie II", BGH I ZR 7/16; ' +
        'DSK 2022). Keep the decline option equally prominent or expect compliance issues.'
    );
  }
}
