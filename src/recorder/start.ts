/**
 * Pure recorder construction (ADR-0019).
 *
 * Builds a fully-wired {@link Recorder} — classifier (local or service-DB
 * layered), the cookie/DOM/network watchers, the library-event bridge, and the
 * optional CMS bridge subscription — and returns it **without starting it** and
 * **without touching any module-level singleton**.
 *
 * Shared by the full-library entry (`src/index.ts`, which wraps this in its
 * `activeRecorder` singleton management) and the critical-core's deferred tier
 * (`src/deferred.ts`), so the bundle split adds no duplicated recorder wiring.
 */

import { CmsBridge } from '../cms-bridge/index.js';
import type { CmsBridgeAuth, CmsBridgeOptions } from '../cms-bridge/index.js';
import { fireEvent as engineFireEvent } from '../engine/index.js';
import { ServiceDbClient } from '../service-db/client.js';
import { LayeredClassifier } from '../service-db/layered-classifier.js';
import type { ServiceDbAuth } from '../service-db/types.js';
import { LocalClassifier } from './classifier.js';
import { Recorder } from './recorder.js';
import type { ClassifierServiceConfig, Detection, RecorderOptions } from './types.js';
import { CookieWatcher } from './watchers/cookie-watcher.js';
import { DomWatcher } from './watchers/dom-watcher.js';
import { NetworkWatcher } from './watchers/network-watcher.js';

/**
 * Structural subset of `SimpleCMPConfig` that the recorder needs. Defined here
 * (rather than importing `SimpleCMPConfig` from `src/index.ts`) to keep this
 * module free of a circular dependency on the entry point; `SimpleCMPConfig` is
 * assignable to it.
 */
export interface RecorderStartConfig {
  record?: boolean | RecorderOptions;
  storageName?: string;
  services?: readonly unknown[];
  serviceDbUrl?: string;
  serviceDbAuth?: ServiceDbAuth;
  cmsBridgeUrl?: string;
  cmsBridgeAuth?: CmsBridgeAuth;
  // The factory reads only the tuning fields (source, dedup, sampleRate, …); the
  // URL comes from `cmsBridgeUrl`. `Partial` so `SimpleCMPConfig`'s url-less
  // `cmsBridge` Pick is structurally assignable.
  cmsBridge?: Partial<CmsBridgeOptions>;
}

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
 * Treat the param as opt-in for the *current page load only*. It does not
 * persist anywhere, doesn't affect future visits, and never reaches the bridge
 * payload — it's a runtime hint to the local recorder.
 */
export function isDiscoverMode(): boolean {
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('simplecmp_discover') === '1';
  } catch {
    return false;
  }
}

/**
 * Build a wired-but-not-started recorder for `config`. The caller is responsible
 * for `recorder.start()` and for any singleton lifecycle (stopping a prior one).
 */
export function createRecorder(config: RecorderStartConfig): Recorder {
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
      // Channel #1 (ADR-0004 section F): surface detections through the engine's
      // event bus so consumers can subscribe via
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
  // recorder's detection stream. The bridge filters for status: 'unknown' and
  // dedupes by `${kind}:${identifier}` with a TTL window.
  //
  // REQ-N7: subscribe to `'detectionSettled'` rather than `'detection'`. The
  // first emission of a detection is always `status: 'unknown'` even when the
  // Service-DB lookup would have classified it as known — the bridge would race
  // the lookup and POST before enrichment finalises the status. The settled
  // event fires once per detection, after any async classification finishes,
  // with the final status.
  if (config.cmsBridgeUrl) {
    const discover = isDiscoverMode();
    const bridge = new CmsBridge({
      url: config.cmsBridgeUrl,
      auth: config.cmsBridgeAuth,
      source: config.cmsBridge?.source ?? options.storageName ?? 'default',
      // Discover mode (?simplecmp_discover=1) is an admin-driven sitemap sweep
      // run from the BE: every page load should POST regardless of the
      // bandwidth controls that normally suppress repeat visits.
      dedupTtlMs: config.cmsBridge?.dedupTtlMs,
      crossSessionDedupMs: discover ? 0 : config.cmsBridge?.crossSessionDedupMs,
      flushDebounceMs: config.cmsBridge?.flushDebounceMs,
      maxBatchSize: config.cmsBridge?.maxBatchSize,
      sampleRate: discover ? 1 : config.cmsBridge?.sampleRate,
      respectDoNotTrack: discover ? false : config.cmsBridge?.respectDoNotTrack,
      timeoutMs: config.cmsBridge?.timeoutMs,
      // Server-supplied reset counter (bumped on BE detection delete) so a
      // deleted detection re-reports on the next page load instead of being
      // suppressed by a stale cross-session marker.
      reportGeneration: config.cmsBridge?.reportGeneration,
    });
    recorder.on('detectionSettled', (d) => bridge.onDetection(d));
  }
  return recorder;
}
