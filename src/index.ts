/**
 * SimpleCMP — open-source consent manager.
 *
 * Public API entry point. All exports here form the supported surface of the
 * library. Internal modules (`src/recorder`, `src/service-db`) should not be
 * imported directly by consumers.
 *
 * @packageDocumentation
 */

import { auditDom as runAuditDom } from './audit/dom.js';
import { maxSeverity as auditMaxSeverity, audit as runAudit } from './audit/index.js';
import type { Check as AuditCheck, AuditResult, Severity as AuditSeverity } from './audit/index.js';
import type { CmsBridgeAuth, CmsBridgeOptions } from './cms-bridge/index.js';
import { ConsentLogger, getOrCreateVisitorUuid } from './consent-log/index.js';
import type { ConsentLogConfig } from './consent-log/index.js';
import {
  defaultTranslations,
  addEventListener as engineAddEventListener,
  getManager as engineGetManager,
  updateConfig as engineUpdateConfig,
  installConsentMode,
} from './engine/index.js';
import type {
  ConsentConfig,
  ConsentManager,
  ConsentModeConfig,
  Regime,
  Service,
} from './engine/index.js';
import en from './engine/translations/en.json';
import bundledTranslations from './engine/translations/index.js';
import { convertToMap, update } from './engine/utils/maps.js';

// Build-time flag (esbuild `define`, ADR-0018). In the "core"/slim build it is
// `true` and ONLY English (the fallback) is bundled — hosts inject the active
// locale via `config.translations`. In the default/full build it is `false` and
// all packs ship for zero-config drop-in use. The unused branch is tree-shaken,
// so the slim build drops the other 25 packs.
declare const SLIM_BUILD: boolean;
import type { Recorder } from './recorder/recorder.js';
import { createRecorder } from './recorder/start.js';
import type { RecorderOptions } from './recorder/types.js';
import { detectionKindForMechanism, hostFromUrl } from './runtime-patches/detection-map.js';
import { installRuntimePatches } from './runtime-patches/index.js';
import type { BlockInfo } from './runtime-patches/index.js';
import { buildHostMatcher } from './runtime-patches/matcher.js';
import type { ServiceDbAuth } from './service-db/types.js';
import { initLit as mountUI } from './ui/init.js';
import type { FloatingTriggerOptions, LitInitHandle } from './ui/init.js';
import { type Theme, applyThemeAdapter } from './ui/themes/index.js';

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
export type { Regime } from './engine/index.js';
export type { ConsentModeConfig, ConsentVendorId, GoogleConsentSignal } from './engine/index.js';
export { ServiceDbClient } from './service-db/client.js';
export { LayeredClassifier } from './service-db/layered-classifier.js';
export { CmsBridge } from './cms-bridge/index.js';
export type { AuditResult, AuditSeverity, AuditCheck };
export { CHECKS as auditChecks } from './audit/index.js';

/**
 * Run the compliance audit against a config and return per-check
 * findings. Pure function, side-effect-free — safe to call in any
 * environment (browser, Node, CI). Returns the results in a stable
 * order so server-side mirrors (e.g. the TYPO3 BE module's PHP-side
 * audit) can match findings by index or by `id` field.
 *
 * See `docs/legal-compliance.md` for the legal basis of each check
 * and the rationale for `severity` assignments.
 */
export function audit(config: SimpleCMPConfig): AuditResult[] {
  return runAudit(config);
}

/**
 * Pick the worst severity across an audit result set. Integrators
 * use this to drive a top-level status badge ("any findings?")
 * without re-implementing the severity ordering.
 */
export function auditWorstSeverity(results: readonly AuditResult[]): AuditSeverity {
  return auditMaxSeverity(results);
}

/**
 * Run DOM-level compliance checks against a mounted banner. Pairs
 * with `audit(config)` — same `AuditResult` shape, different scope:
 * this one inspects the live DOM (computed styles, element tags,
 * WCAG contrast) rather than the config object. Call after the
 * banner has rendered.
 *
 * Pass a shadow root to scope the check; default is the global
 * `document`. Walks `<simplecmp-banner>` shadow roots automatically
 * to find the actual button elements.
 */
export function auditDom(root?: Document | ShadowRoot): AuditResult[] {
  return runAuditDom(root);
}

// Seed the engine's translation registry at import time. Consumers get sensible
// defaults out of the box; per-config `translations` still override or extend.
// The full build seeds all bundled packs; the slim "core" build seeds only
// English (the fallback) and relies on the host injecting the active locale
// (ADR-0018). `SLIM_BUILD` is a compile-time constant, so the unused branch — and
// with it the 25 non-English packs — is dropped from the slim bundle.
update(defaultTranslations, convertToMap(SLIM_BUILD ? { en } : bundledTranslations));

export const VERSION = '0.4.1';

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
   * Time-based consent expiry in days (§6). When set (> 0), a returning visitor
   * whose stored consent is older than this is re-asked — the stored decision is
   * discarded and the banner re-shows. There is no statutory expiry; regulator
   * best practice is ~6 months (CNIL/ICO) up to 24 months (AEPD). Default off
   * (`undefined`/`0`). The age is stamped in the visitor's own stored record
   * (`ts`) — nothing is stored server-side. Material-change re-consent is handled
   * separately by `consentVersion` / the services-list reconciliation.
   *
   * SimpleCMP-specific (REQ-N12).
   */
  consentExpiryDays?: number;

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
   * Region-aware consent regime (REQ-N4 / ADR-0015). SimpleCMP supports two
   * legal models plus a no-op:
   *
   * - `'opt-in'` (GDPR / ePrivacy) — non-required services default-deny; the
   *   banner is a blocking decision wall. **The default.**
   * - `'opt-out'` (US state laws, CCPA/CPRA, …) — non-required services
   *   default-*allow*; the banner is a non-blocking notice with a "Do Not Sell
   *   or Share" control; GPC forces opt-out.
   * - `'none'` — no applicable regime: allow by default, no auto-banner.
   *
   * This is the **baseline** used when `region` is unknown or unmapped. An
   * EU-established business typically leaves it at `'opt-in'` (everyone gets the
   * wall); a US-only shop may set `'opt-out'`. Default `'opt-in'` (strictest).
   */
  regimeDefault?: Regime;

  /**
   * The visitor's jurisdiction, e.g. `'DE'`, `'US-CA'`, `'US'` (REQ-N4).
   *
   * **Must be supplied by the host server** (CDN/edge geo header, GeoIP, or
   * Shopify's `getRegion()`) — SimpleCMP deliberately does NOT geo-locate the
   * client (unreliable, and it would be a pre-consent third-party call). The
   * value resolves to a regime via `regimes`, then a built-in region table
   * (EU/EEA/UK/CH → opt-in; US states + `'US'` → opt-out), then `regimeDefault`.
   * An unknown region falls back to `regimeDefault` (default `'opt-in'`).
   *
   * Note: applicable law depends on the controller's establishment and the
   * visitor's location — not the server's location or the visitor's
   * citizenship. See `docs/adr/0015-region-aware-consent-regimes.md`.
   */
  region?: string;

  /**
   * Per-region regime override map, e.g. `{ 'US-CA': 'opt-out', 'GB': 'opt-in' }`
   * (REQ-N4). Takes precedence over the built-in region table; matched
   * case-insensitively against `region`.
   */
  regimes?: Record<string, Regime>;

  /**
   * Render components into Shadow DOM (default, encapsulated styles) or
   * Light DOM (host page's CSS applies). REQ-16. With `'light'` you must
   * `<link rel="stylesheet" href="simplecmp/styles/default.css">` (or
   * `bootstrap5.css`, or your own) for the components to be styled.
   */
  domMode?: 'shadow' | 'light';

  /**
   * Re-bind SimpleCMP's design tokens to the host page's CSS-framework
   * custom properties so the consent UI inherits the host's color
   * scheme, radius, spacing, and typography without any manual
   * stylesheet wiring.
   *
   * - `'default'` (default) — the bundle's built-in tokens apply.
   * - `'bootstrap5'` — map `--simplecmp-*` to Bootstrap 5's `--bs-*`.
   *   Same effect as `<link rel=stylesheet href=simplecmp/styles/
   *   bootstrap5.css>` but injected from JS at `init()` time.
   * - `'tailwind4'` — map to Tailwind 4's `@theme` tokens
   *   (`--color-*`, `--text-*`, `--radius-*`, `--spacing`, …). Pulls
   *   semantic names (`--color-primary`, `--color-background`, …)
   *   first and falls back to the Tailwind palette so sites without
   *   curated brand tokens still look coherent.
   * - `'bulma'` — map to Bulma 1.0+'s `--bulma-*` tokens. Stable
   *   across the v1 series.
   * - `'pico'` — map to Pico CSS v2's `--pico-*` tokens. Optimised
   *   for the classless minimal-CSS style Pico encourages.
   *
   * The version suffix on framework names is required so adding a
   * Bootstrap 4 adapter later (different `--bs-*` scheme) is
   * unambiguous next to `'bootstrap5'`. Same pattern for
   * `'tailwind3'`: Tailwind 3 didn't expose CSS custom properties
   * out of the box, so a v3 adapter would have nothing to bind
   * against and lives in its own slot if/when contributed.
   *
   * Adapters work through Shadow DOM: they set `--simplecmp-*`
   * variables on the component tag selectors only, and custom-
   * property inheritance carries the values across the shadow
   * boundary into the component's `static styles`. No selectors
   * reach inside the shadow root.
   */
  theme?: Theme;

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
   * Defer the recorder's boot to browser idle (`requestIdleCallback`, falling
   * back to a short timeout) instead of installing it synchronously during
   * `init()`. Off by default, which preserves the early-catch guarantee (the
   * recorder patches `fetch`/XHR before body scripts run — see `init()`).
   *
   * Opt in when detection is *drift monitoring* rather than a per-page audit and
   * keeping `init()` off the critical path matters (e.g. a high-traffic
   * storefront): it moves the recorder's setup cost out of the load/TBT window
   * at the price of missing requests that fire before idle — acceptable when
   * coverage is statistical across sessions. Pre-consent blocking
   * (`interceptRuntime`) is unaffected; it always installs synchronously.
   */
  deferRecorder?: boolean;
  /**
   * Defer mounting the consent UI (banner/modal/trigger) to browser idle
   * (`requestIdleCallback`, falling back to a short timeout) instead of rendering
   * it synchronously during `init()` / on `DOMContentLoaded`. Off by default.
   *
   * The UI render — instantiating the Lit components — is the largest single
   * cost in `init()`'s critical path. Deferring it moves that cost out of the
   * load/TBT window so the banner appears a beat after first paint instead of
   * blocking it. **Pre-consent blocking is unaffected**: `interceptRuntime`
   * installs synchronously in Phase 1, so the pre-consent state (everything
   * blocked) holds from page load — the deferred banner only delays the *visual
   * prompt*, never the enforcement. Safe for a compliance surface because the
   * gap is strictly more conservative (blocked + not-yet-prompted).
   *
   * Ignored in audit mode (`?simplecmp_audit=1`), which needs the DOM rendered
   * synchronously to scan it.
   */
  deferRender?: boolean;
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
    | 'reportGeneration'
  >;

  /**
   * Visitor consent decision logging — Phase 2 audit trail.
   *
   * When `url` is set, each accept / decline / save-selected click
   * is POSTed to the host endpoint, bound to the snapshot
   * `version_hash` of the banner state at click time (`configVersion`).
   * The host pseudonymizes the visitor UUID server-side before
   * insertion — see `docs/cms-bridge-webhook.md` for the contract.
   *
   * Reuses `CmsBridgeAuth` for nonce-Bearer + refresh-on-401, so the
   * same source-bound nonce works against both `cmsBridgeUrl` and
   * `consentLog.url` endpoints.
   */
  consentLog?: ConsentLogConfig;

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

  /**
   * Google Consent Mode v2 emission (REQ-N10 / ADR-0016). Opt-in; off by
   * default. When set, SimpleCMP **signals** consent to the merchant's
   * *existing* Google tags — it emits `gtag('consent', 'default'|'update', …)`
   * and a dataLayer event so GA4 / Google Ads (via gtag or GTM) respect the
   * visitor's choice. It does **not** load gtag/GTM and does **not** run an
   * analytics pipe (that's the deliberate CMP posture — see Shopify ADR-0003).
   *
   * State is derived from the engine's existing default consent, so it
   * automatically composes the region regime (REQ-N4) and GPC (REQ-5): no new
   * policy logic. Pass `true` for the default purpose→signal mapping
   * (`analytics → analytics_storage`, `marketing → ad_storage + ad_user_data +
   * ad_personalization`) or a `ConsentModeConfig` to customize.
   *
   * **Compliance posture (ADR-0016):** signal-gating loads the Google tag
   * pre-consent (cookieless pings), which is a different posture from
   * load-blocking the tag entirely (`interceptRuntime`). A service should be
   * *either* signal-gated here *or* load-blocked — not both. Hosts must
   * surface that trade-off to the merchant.
   *
   * **`<head>` ordering matters** — the `default` command must run before the
   * Google tag library loads (same constraint as `interceptRuntime`).
   */
  consentMode?: boolean | ConsentModeConfig;
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

// Monotonic init counter — lets deferred work (a deferred recorder boot) bail if
// a later init() has superseded the config it was scheduled for.
let initToken = 0;

/**
 * Run `fn` when the browser is idle (`requestIdleCallback`), falling back to a
 * short timeout where it's unavailable (Safari / non-browser).
 */
function scheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 200);
  }
}

/**
 * Uninstaller for the runtime patches installed by the most recent
 * `init({ interceptRuntime: ... })` call. Re-init / destroy chains
 * through this so prototype patches don't stack.
 */
let activeRuntimePatchUninstaller: (() => void) | null = null;

/**
 * Uninstaller for the Consent Mode v2 hook installed by the most recent
 * `init({ consentMode: ... })`. Re-init / destroy unwatches the manager so the
 * hook doesn't stack across re-inits.
 */
let activeConsentModeUninstaller: (() => void) | null = null;

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

  // Each init supersedes prior deferred work (e.g. a deferred recorder boot).
  const myToken = ++initToken;

  // BE-driven live-FE compliance audit (?simplecmp_audit=1): force
  // the banner visible regardless of stored consent, then post DOM
  // audit results to the parent window so the BE designer can render
  // them next to its own preview-iframe findings. The shallow-clone
  // ensures we don't mutate the caller's config object — same
  // pattern `validateConfig()` uses for the `apps→services` rename.
  const auditMode = isAuditMode();
  const effectiveConfig: SimpleCMPConfig = auditMode ? { ...config, testing: true } : config;
  if (auditMode) {
    scheduleAuditPostToParent();
  }

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
  if (activeConsentModeUninstaller !== null) {
    activeConsentModeUninstaller();
    activeConsentModeUninstaller = null;
  }

  // Theme adapter is a DOM-only side effect — injects (or removes) a
  // `<style data-simplecmp-theme>` element in `<head>` that re-binds
  // the `--simplecmp-*` tokens to the host framework's variables.
  // Idempotent across re-inits; safe to call on every `init()`.
  applyThemeAdapter(config.theme);

  // Phase 1 — set up everything that doesn't need the DOM. Critically,
  // the recorder + runtime patches install BEFORE any inline body script
  // can dispatch third-party requests when init() is called pre-body
  // (e.g. from a TYPO3 head-priority asset). `getManager(config)` is
  // pure JS (the engine's manager cache); the recorder uses
  // `document.documentElement` not `document.body`; patches just swap
  // prototype descriptors. None need a parsed body.
  const manager = engineGetManager(effectiveConfig);
  if (effectiveConfig.record) {
    // `deferRecorder` moves the recorder's setup off the critical path to idle
    // (drift-monitoring trade-off; see the config field). Default stays
    // synchronous so the early-catch guarantee holds. Blocking is installed
    // synchronously below regardless.
    if (effectiveConfig.deferRecorder) {
      scheduleIdle(() => {
        // Re-check: a later init()/destroy() may have superseded this config.
        if (myToken === initToken) startRecorder(effectiveConfig);
      });
    } else {
      startRecorder(effectiveConfig);
    }
  }
  if (effectiveConfig.interceptRuntime) {
    activeRuntimePatchUninstaller = installRuntimePatchesWithManager(effectiveConfig, manager);
  }
  // REQ-N10 / ADR-0016 — Consent Mode v2 emission. Installs in Phase 1 (before
  // UI mount) so the `default` command fires early, before the merchant's
  // Google tag library runs.
  if (effectiveConfig.consentMode) {
    activeConsentModeUninstaller = installConsentMode(
      effectiveConfig.consentMode,
      manager,
      effectiveConfig.services
    );
  }
  // Phase 2 audit trail — log each visitor consent decision against
  // the snapshot version_hash of the banner state shown to them.
  // Hooks `ConsentManager.notify('saveConsents', …)` so the watcher
  // fires when the visitor actively confirms (not on per-toggle
  // mid-interaction notifications). Zero overhead when
  // `config.consentLog?.url` is unset.
  if (effectiveConfig.consentLog?.url) {
    const visitorUuid = getOrCreateVisitorUuid(effectiveConfig.storageName ?? 'simplecmp');
    const consentLogger = new ConsentLogger({
      url: effectiveConfig.consentLog.url,
      source: effectiveConfig.consentLog.source ?? effectiveConfig.storageName,
      auth: effectiveConfig.consentLog.auth,
      configVersion: effectiveConfig.consentLog.configVersion,
      visitorUuid,
    });
    manager.watch(consentLogger);
  }

  // Phase 2 — mount the UI. Defer to DOMContentLoaded if body isn't
  // ready yet so callers can wire init() into <head> without breaking
  // the banner/modal/trigger mount path.
  let mountedHandle: LitInitHandle | null = null;
  let destroyed = false;
  type QueuedOp = 'show' | 'hide';
  const queued: QueuedOp[] = [];
  const mountNow = (): void => {
    // A teardown or superseding init() between schedule and run cancels the
    // mount (deferRender schedules this onto idle — see below).
    if (destroyed || myToken !== initToken) return;
    mountedHandle = mountUI(effectiveConfig);
    for (const op of queued) {
      if (op === 'show') mountedHandle.show();
      else mountedHandle.hide();
    }
    queued.length = 0;
  };
  // `deferRender` moves the (expensive) Lit mount off the critical path to idle.
  // Blocking already installed synchronously in Phase 1, so the deferred banner
  // only delays the visual prompt, not enforcement. Audit mode opts out — it
  // needs the DOM rendered synchronously to scan it.
  const wantDeferRender = effectiveConfig.deferRender === true && !auditMode;
  const triggerMount = wantDeferRender ? () => scheduleIdle(mountNow) : mountNow;
  let deferredMountListener: (() => void) | null = null;
  if (typeof document !== 'undefined' && document.body !== null) {
    triggerMount();
  } else if (typeof document !== 'undefined') {
    deferredMountListener = triggerMount;
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
      destroyed = true;
      if (activeRuntimePatchUninstaller !== null) {
        activeRuntimePatchUninstaller();
        activeRuntimePatchUninstaller = null;
      }
      if (activeConsentModeUninstaller !== null) {
        activeConsentModeUninstaller();
        activeConsentModeUninstaller = null;
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
  const userOnBlock = opts.onBlock;
  return installRuntimePatches({
    matcher,
    consentChecker: (serviceId: string) => manager.getConsent(serviceId),
    sameOriginHosts: opts.sameOriginHosts,
    onBlock: (info) => {
      // ADR-0013 step 4b — feed blocked-at-the-prototype calls into the
      // recorder so the bridge + BE detection table still discover
      // them. Patches kill the URL before the network sees it, which
      // means PerformanceObserver / NetworkWatcher would otherwise be
      // blind to the attempted request. Reading `activeRecorder` at
      // call time (not install time) means a re-init keeps the wiring
      // correct.
      if (activeRecorder !== null) {
        activeRecorder.recordSyntheticDetection({
          kind: detectionKindForMechanism(info.mechanism),
          identifier: info.url,
          origin: hostFromUrl(info.url),
        });
      }
      // Preserve the integrator's onBlock callback (dev-mode logging,
      // debug panels, etc.).
      userOnBlock?.(info);
    },
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
  // bridge lives only as a closure captured by the recorder's detection
  // listener — replacing the recorder drops the listener, which drops the
  // bridge reference (and its dedup map) on the next GC.
  if (activeRecorder) {
    activeRecorder.stop();
    activeRecorder = null;
  }
  // ADR-0019: the wiring (classifier, watchers, lib-event + CMS bridge) lives in
  // the shared `createRecorder` factory, reused by the critical-core deferred
  // tier. This wrapper owns only the singleton lifecycle.
  const recorder = createRecorder(config);
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
 * Detect the BE-driven compliance-audit marker
 * (`?simplecmp_audit=1`). When set:
 *
 *   - The banner is force-shown regardless of any stored consent
 *     decision (same behaviour as `testing: true`), so the audit can
 *     read the live computed styles even on URLs the visitor has
 *     already consented from.
 *   - After the banner mounts, `auditDom()` runs against the actual
 *     page DOM — picking up any host-page CSS that the BE's own
 *     preview iframe wouldn't see (global resets, theme bleed,
 *     framework styles).
 *   - Results are posted to `window.parent` via
 *     `{type: 'simplecmp-audit-from-fe', results, location}`.
 *
 * The BE designer's "Live-FE-Audit" button mounts a hidden iframe at
 * the site URL with this parameter appended, listens for the
 * postMessage, and renders the results next to its own preview-iframe
 * findings. The two audits then expose the gap between "banner styled
 * correctly in isolation" and "banner styled correctly under the
 * host's CSS".
 */
function isAuditMode(): boolean {
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') return false;
  try {
    const search = new URLSearchParams(window.location.search);
    if (search.get('simplecmp_audit') === '1') return true;
    // Hash-based fallback: survives server-side redirects that strip
    // query parameters. TYPO3's language detector redirects
    // `/?…=…` to `/de/?…=…` but drops the query in the process; a
    // hash like `#simplecmp_audit=1` rides through the redirect
    // untouched because hashes are client-only. The BE designer's
    // FE-audit iframe sets both query AND hash to cover any
    // downstream that prefers one or the other.
    const hashFragment = window.location.hash;
    if (hashFragment.length > 1) {
      const hash = new URLSearchParams(hashFragment.slice(1));
      if (hash.get('simplecmp_audit') === '1') return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Run the DOM-level audit after the banner has mounted and post the
 * results to `window.parent`. Called only when `isAuditMode()` is
 * true; on regular site visits the function is never reached. Three
 * rAF frames buffer the call so the banner's `static styles`, any
 * shadow-DOM adopted-stylesheet inheritance, and the host page's
 * cascading rules all settle before the audit reads computed values.
 */
function scheduleAuditPostToParent(): void {
  if (typeof window === 'undefined') return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const results = runAuditDom();
        try {
          window.parent.postMessage(
            {
              type: 'simplecmp-audit-from-fe',
              results,
              location: {
                href: window.location.href,
                host: window.location.host,
              },
            },
            '*'
          );
        } catch (_) {
          // Cross-origin parent or no parent (window.parent === window) —
          // both are non-fatal; the audit just goes nowhere.
        }
      });
    });
  });
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
