/**
 * Recorder public entry — REQ-7 / ADR-0004.
 *
 * Re-exports the surface that `src/index.ts` and (eventually) external
 * consumers via the `simplecmp/recorder` subpath import.
 */

export { LocalClassifier } from './classifier.js';
export { Recorder, hostnameLooksLikeDev } from './recorder.js';
export type { DetectionListener, RecorderEventName } from './recorder.js';
export type {
  Classifier,
  ClassifierServiceConfig,
  CookieMatcher,
  Detection,
  DetectionKind,
  DetectionStatus,
  OriginMatcher,
  RawDetection,
  RecorderOptions,
  Watcher,
} from './types.js';
export { CookieWatcher } from './watchers/cookie-watcher.js';
export { DomWatcher } from './watchers/dom-watcher.js';
export { NetworkWatcher } from './watchers/network-watcher.js';
