/**
 * Deferred tier (ADR-0019).
 *
 * The heavy half of the engine — the Lit consent UI plus the recorder
 * (classifier, watchers, service-DB, CMS bridge) — split out so it can be loaded
 * **lazily** by the critical core. `src/core.ts` reaches it with a dynamic
 * `import('./deferred.js')` from inside its idle callback; esbuild's ESM
 * code-splitting then emits this module (and its dependency subtree) as a
 * separate chunk that is fetched and parsed **after** the critical path, so the
 * synchronous on-load parse — and the LCP it was blocking (ADR-0019 context) —
 * stays small.
 *
 * Nothing here may be imported synchronously by `src/core.ts`, or the split
 * collapses and the chunk folds back into the core.
 */

import type { Recorder } from './recorder/recorder.js';
import { type RecorderStartConfig, createRecorder } from './recorder/start.js';
import { initLit as mountUI } from './ui/init.js';
import type { LitInitConfig, LitInitHandle } from './ui/init.js';

export interface DeferredMount {
  /** The mounted Lit UI handle (show/hide/destroy). */
  ui: LitInitHandle;
  /** The started recorder, or `null` when `record` was not configured. */
  recorder: Recorder | null;
}

/**
 * Mount the consent UI and, when `record` is set, build and start the recorder.
 * Pure with respect to module state — the core owns the singleton lifecycle and
 * the blocking↔recorder wiring (it reads the returned `recorder`).
 */
export function mountDeferred(config: LitInitConfig & RecorderStartConfig): DeferredMount {
  const ui = mountUI(config);
  let recorder: Recorder | null = null;
  if (config.record) {
    recorder = createRecorder(config);
    recorder.start();
  }
  return { ui, recorder };
}
