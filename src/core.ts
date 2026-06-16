/**
 * SimpleCMP critical core (ADR-0019).
 *
 * The slim, synchronous half of the engine for managed hosts (Shopify, TYPO3).
 * It bundles only what must run on the critical path — the consent manager,
 * pre-consent blocking (`interceptRuntime`), and Consent Mode v2 — and **defers
 * everything else** (the Lit UI and the recorder) to a separate chunk loaded at
 * browser idle via `import('./deferred.js')`.
 *
 * Why a distinct entry rather than reusing `src/index.ts`: the full IIFE/ESM
 * library parses the UI + recorder synchronously, and that parse blocks the host
 * page's largest-contentful-paint under mobile CPU throttling (measured; see the
 * ADR). Splitting them into a lazy chunk keeps the on-load parse small. The
 * zero-config `<script>` drop-in keeps using `src/index.ts` unchanged; managed
 * hosts adopt this core as an ES module.
 *
 * English-only translations (ADR-0018); hosts inject the active locale via
 * `config.translations`. Audit mode (`?simplecmp_audit=1`) and the verbose dev
 * warnings are intentionally **not** carried here — they belong to the full
 * build; managed configs are server-generated and validated upstream.
 */

import {
  defaultTranslations,
  addEventListener as engineAddEventListener,
  getManager as engineGetManager,
  updateConfig as engineUpdateConfig,
  installConsentMode,
} from './engine/index.js';
import type { ConsentManager } from './engine/index.js';
import en from './engine/translations/en.json';
import { convertToMap, update } from './engine/utils/maps.js';
// Type-only imports from the full entry: erased at build (verbatimModuleSyntax),
// so the core chunk never pulls `src/index.ts` in at runtime.
import type { InterceptRuntimeOptions, SimpleCMPConfig } from './index.js';
import type { Recorder } from './recorder/recorder.js';
import { detectionKindForMechanism, hostFromUrl } from './runtime-patches/detection-map.js';
import { installRuntimePatches } from './runtime-patches/index.js';
import { buildHostMatcher } from './runtime-patches/matcher.js';
import type { LitInitHandle } from './ui/init.js';
import { applyThemeAdapter } from './ui/themes/index.js';

// Seed the engine's translation registry with English (the fallback). Managed
// hosts inject the active locale through `config.translations` (ADR-0018).
update(defaultTranslations, convertToMap({ en }));

export const VERSION = '0.4.1';

/** Subscribe to lifecycle events (`recorderDetection`, `consentVersionMismatch`). */
export const addEventListener = engineAddEventListener;
/** Retrieve the consent manager for a config (or the current default). */
export const getManager = engineGetManager;
/** Update a config object in place. */
export const updateConfig = engineUpdateConfig;

/**
 * Most recent init handle, replaced each `init()`. `show()` proxies to it.
 */
let activeHandle: LitInitHandle | null = null;
let activeRuntimePatchUninstaller: (() => void) | null = null;
let activeConsentModeUninstaller: (() => void) | null = null;
/**
 * The deferred recorder, set once the lazy chunk mounts. Blocking's `onBlock`
 * reads it at call time (not install time), so blocked calls that fire after the
 * recorder boots are still surfaced; calls before idle are missed by design
 * (the deferred tier trades pre-idle coverage for a smaller critical path).
 */
let deferredRecorder: Recorder | null = null;
// Monotonic init counter — lets the deferred mount bail if a later init() (or a
// destroy()) has superseded the config it was scheduled for.
let initToken = 0;

/** Run `fn` when the browser is idle, falling back to a short timeout. */
function scheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 200);
  }
}

/**
 * Install pre-consent blocking synchronously. Mirrors the full build's wiring
 * (`src/index.ts`), but `onBlock` feeds the *deferred* recorder via the
 * module-level ref.
 */
function installBlocking(config: SimpleCMPConfig, manager: ConsentManager): () => void {
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
      // ADR-0013 step 4b — feed blocked-at-the-prototype calls into the recorder
      // so the bridge + BE detection table discover them even though the patch
      // killed the URL before the network (and PerformanceObserver) saw it.
      if (deferredRecorder !== null) {
        deferredRecorder.recordSyntheticDetection({
          kind: detectionKindForMechanism(info.mechanism),
          identifier: info.url,
          origin: hostFromUrl(info.url),
        });
      }
      userOnBlock?.(info);
    },
  });
}

/**
 * Initialize SimpleCMP (critical core). Arms the consent manager, pre-consent
 * blocking and Consent Mode v2 **synchronously**, then loads the deferred UI +
 * recorder chunk at idle. Returns a handle whose `show()`/`hide()` queue until
 * the UI mounts.
 */
export function init(config: SimpleCMPConfig): LitInitHandle {
  const myToken = ++initToken;

  // Replace any prior handle/patches cleanly — re-init shouldn't leak DOM or
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
  deferredRecorder = null;

  applyThemeAdapter(config.theme);

  // Phase 1 — synchronous, on the critical path. Blocking installs before any
  // body script can dispatch a third-party request.
  const manager = engineGetManager(config);
  if (config.interceptRuntime) {
    activeRuntimePatchUninstaller = installBlocking(config, manager);
  }
  if (config.consentMode) {
    activeConsentModeUninstaller = installConsentMode(config.consentMode, manager, config.services);
  }

  // Phase 2 — deferred. Load the UI + recorder chunk at idle, off the critical
  // path. Blocking is already armed, so the late banner only delays the visual
  // prompt, never enforcement.
  let mountedHandle: LitInitHandle | null = null;
  let destroyed = false;
  type QueuedOp = 'show' | 'hide';
  const queued: QueuedOp[] = [];
  scheduleIdle(() => {
    if (destroyed || myToken !== initToken) return;
    void import('./deferred.js').then(({ mountDeferred }) => {
      // A teardown or superseding init() during the async import cancels the mount.
      if (destroyed || myToken !== initToken) return;
      const result = mountDeferred(config);
      mountedHandle = result.ui;
      deferredRecorder = result.recorder;
      for (const op of queued) {
        if (op === 'show') mountedHandle.show();
        else mountedHandle.hide();
      }
      queued.length = 0;
    });
  });

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
      mountedHandle?.destroy();
      mountedHandle = null;
      deferredRecorder?.stop();
      deferredRecorder = null;
      queued.length = 0;
    },
  };
  return activeHandle;
}

/**
 * Open the preferences modal of the most recently mounted SimpleCMP. Queues if
 * the deferred UI hasn't mounted yet.
 */
export function show(): void {
  activeHandle?.show();
}
