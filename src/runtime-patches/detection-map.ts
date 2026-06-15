/**
 * Map a runtime-patch block event onto the recorder's detection taxonomy
 * (ADR-0019). Shared by the full-library entry (`src/index.ts`) and the
 * critical-core's deferred tier (`src/deferred.ts` via `src/core.ts`), which both
 * feed blocked-at-the-prototype calls into the recorder so the bridge + BE
 * detection table still discover them.
 */

import type { Detection } from '../recorder/types.js';
import type { BlockInfo } from './index.js';

/**
 * Maps the patch's `mechanism` field onto the recorder's `DetectionKind`
 * taxonomy. Stable contract — the bridge + BE detection table read this kind
 * directly.
 */
export function detectionKindForMechanism(mechanism: BlockInfo['mechanism']): Detection['kind'] {
  switch (mechanism) {
    case 'script-src':
      return 'script';
    case 'iframe-src':
      return 'iframe';
    case 'img-src':
      return 'image';
    case 'fetch':
    case 'xhr':
    case 'sendBeacon':
      return 'request';
  }
}

/**
 * Host (port-stripped) of a blocked URL — consistent with the recorder watchers
 * and `decideBlock` so consent decisions apply per-host, not per-host-port. Keeps
 * universal-block synthetic detections of a port-mismatched URL like
 * `https://tracker.com:8443/x` matching the bare library entry for `tracker.com`
 * rather than surfacing as origin `tracker.com:8443`.
 */
export function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url, window.location.href).hostname || undefined;
  } catch {
    return undefined;
  }
}
