/**
 * Recorder coordinator — REQ-7 / ADR-0004.
 *
 * Owns the lifecycle of the watchers and the in-memory detection map.
 * Exposes the public API consumers see via `simplecmp.getRecorder()`.
 */

import type {
  Classifier,
  ClassifierServiceConfig,
  Detection,
  DetectionSink,
  RawDetection,
  RecorderOptions,
  Watcher,
} from './types.js';

export type RecorderEventName = 'detection';
export type DetectionListener = (d: Detection) => void;

const STORAGE_PREFIX = 'simplecmp.recorder.';
const STORAGE_SCHEMA = 1;

/**
 * Heuristic — does this hostname look like a development / local / staging
 * environment? Returns `true` for empty/missing hostname (e.g., file://,
 * tests).
 */
export function hostnameLooksLikeDev(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === 'localhost') return true;
  if (hostname.endsWith('.localhost')) return true;
  if (hostname.endsWith('.local')) return true;
  if (hostname.endsWith('.test')) return true;
  // IPv4 / IPv6 literals — common in dev/preview environments
  if (/^127\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (hostname === '::1' || hostname === '0.0.0.0') return true;
  return false;
}

export interface RecorderInit {
  options: RecorderOptions;
  classifier: Classifier;
  /** Service config used by `exportConfig()` to reproduce known entries verbatim. */
  services: readonly ClassifierServiceConfig[];
  /**
   * Watcher factories. Tests inject stubs; runtime callers pass the real
   * watcher constructors. Each factory receives the detection sink.
   */
  watcherFactories: ReadonlyArray<(sink: DetectionSink) => Watcher>;
  /** Hook so the coordinator can dispatch through Klaro's lib event bus. */
  onDetectionForLibEvent?: (d: Detection) => void;
}

export class Recorder {
  private readonly options: RecorderOptions;
  private readonly classifier: Classifier;
  private readonly services: readonly ClassifierServiceConfig[];
  private readonly watchers: Watcher[];
  private readonly listeners = new Set<DetectionListener>();
  private readonly detections = new Map<string, Detection>();
  private summaryTimer?: ReturnType<typeof setInterval>;
  private active = false;
  private readonly onDetectionForLibEvent?: (d: Detection) => void;

  constructor(init: RecorderInit) {
    this.options = init.options;
    this.classifier = init.classifier;
    this.services = init.services;
    this.onDetectionForLibEvent = init.onDetectionForLibEvent;
    const sink: DetectionSink = (raw) => this._ingest(raw);
    this.watchers = init.watcherFactories.map((factory) => factory(sink));
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    const hostname = typeof location !== 'undefined' ? location.hostname : '';
    const looksDev = hostnameLooksLikeDev(hostname);
    if (!looksDev && !this.options.silenceProductionWarning) {
      console.warn(
        `SimpleCMP: recorder is active on a hostname that looks like production (${hostname || 'unknown'}). Set \`record: { silenceProductionWarning: true }\` to suppress this warning if intentional.`
      );
    }

    if (this.options.persistInDev && looksDev) {
      this._loadFromStorage();
    }

    for (const watcher of this.watchers) watcher.start();

    const cadence = this.options.summaryIntervalMs ?? 30000;
    if (cadence > 0 && typeof setInterval !== 'undefined') {
      this.summaryTimer = setInterval(() => this._logSummary(), cadence);
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const watcher of this.watchers) watcher.stop();
    if (this.summaryTimer !== undefined) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = undefined;
    }
  }

  getSnapshot(): Detection[] {
    return Array.from(this.detections.values());
  }

  clear(): void {
    this.detections.clear();
    this._writeToStorage();
  }

  on(event: RecorderEventName, handler: DetectionListener): void {
    if (event !== 'detection') return;
    this.listeners.add(handler);
  }

  off(event: RecorderEventName, handler: DetectionListener): void {
    if (event !== 'detection') return;
    this.listeners.delete(handler);
  }

  /**
   * Patch a previously-recorded detection with new classification data.
   *
   * Used by `LayeredClassifier` (REQ-8 / ADR-0005 G) when a background
   * Service-DB lookup resolves *after* the detection was first recorded as
   * `unknown`. Re-fires the detection listeners with the updated record.
   * No-op if the detection is no longer in the snapshot (e.g., after
   * `clear()`).
   */
  enrichDetection(
    raw: { kind: string; identifier: string },
    enrichment: { matchedService?: string; matchedVendor?: string; status: 'known' | 'unknown' }
  ): void {
    const key = `${raw.kind}:${raw.identifier}`;
    const existing = this.detections.get(key);
    if (!existing) return;
    const updated: Detection = {
      ...existing,
      ...enrichment,
      lastSeen: Date.now(),
    };
    this.detections.set(key, updated);
    this._announce(updated);
    this._writeToStorage();
  }

  /**
   * Generate a Klaro-compatible service config from current detections.
   * Known detections are reproduced verbatim from the existing services
   * list; unknown detections become stubs the developer fills in.
   */
  exportConfig(): { services: ExportedService[] } {
    // Start with a copy of the known services so existing config is preserved.
    const map = new Map<string, ExportedService>();
    for (const service of this.services) {
      const copy: ExportedService = { name: service.name };
      if (service.cookies) copy.cookies = service.cookies.slice() as ExportedService['cookies'];
      if (service.origins) copy.origins = service.origins.slice() as ExportedService['origins'];
      map.set(service.name, copy);
    }
    // Add a stub per unknown detection.
    let stubCounter = 1;
    for (const detection of this.detections.values()) {
      if (detection.status !== 'unknown') continue;
      const stubName =
        detection.kind === 'cookie'
          ? `unknown-cookie-${stubCounter++}`
          : `unknown-${detection.origin?.replace(/[^a-z0-9]+/gi, '-') ?? 'origin'}-${stubCounter++}`;
      const stub: ExportedService = { name: stubName, purposes: [] };
      if (detection.kind === 'cookie') {
        stub.cookies = [detection.identifier];
      } else if (detection.origin) {
        stub.origins = [detection.origin];
      }
      map.set(stubName, stub);
    }
    return { services: Array.from(map.values()) };
  }

  /**
   * Throws an error listing all detections with `status === 'unknown'`. Use
   * in CI/CD to fail builds when consent drift is detected.
   */
  assertNoUnknown(): void {
    const unknown = this.getSnapshot().filter((d) => d.status === 'unknown');
    if (unknown.length === 0) return;
    const summary = unknown
      .map((d) => `  - [${d.kind}] ${d.identifier}${d.origin ? ` (${d.origin})` : ''}`)
      .join('\n');
    throw new Error(
      `SimpleCMP recorder: ${unknown.length} unknown detection(s):\n${summary}\nAdd a service for each, or pass \`record: { silenceProductionWarning: true }\` if intentional.`
    );
  }

  private _ingest(raw: RawDetection): void {
    const key = `${raw.kind}:${raw.identifier}`;
    const now = Date.now();
    const existing = this.detections.get(key);
    if (existing) {
      existing.lastSeen = now;
      existing.count += 1;
      return;
    }
    const enriched = this.classifier.classify(raw);
    const detection: Detection = {
      kind: raw.kind,
      identifier: raw.identifier,
      origin: raw.origin,
      firstSeen: now,
      lastSeen: now,
      firstSeenOn: raw.firstSeenOn,
      count: 1,
      ...enriched,
    };
    this.detections.set(key, detection);
    this._announce(detection);
    this._writeToStorage();
  }

  private _announce(d: Detection): void {
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info(
        `[SimpleCMP recorder] ${d.kind} ${d.status === 'unknown' ? '🟡 unknown' : `→ ${d.matchedService}`}: ${d.identifier}`
      );
    }
    for (const listener of this.listeners) {
      try {
        listener(d);
      } catch (err) {
        console.warn('SimpleCMP recorder: listener threw:', err);
      }
    }
    if (this.onDetectionForLibEvent) {
      try {
        this.onDetectionForLibEvent(d);
      } catch {
        // ignore — lib event bus is best-effort
      }
    }
  }

  private _logSummary(): void {
    if (this.detections.size === 0) return;
    const rows = Array.from(this.detections.values()).map((d) => ({
      kind: d.kind,
      identifier: d.identifier,
      origin: d.origin ?? '',
      status: d.status,
      service: d.matchedService ?? '',
      count: d.count,
      firstSeenOn: d.firstSeenOn ?? '',
    }));
    if (typeof console.table === 'function') {
      console.groupCollapsed('[SimpleCMP recorder] catalog');
      console.table(rows);
      console.groupEnd();
    }
  }

  private _storageKey(): string {
    return STORAGE_PREFIX + (this.options.storageName ?? 'default');
  }

  private _loadFromStorage(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(this._storageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as { schema?: number; detections?: Detection[] };
      if (parsed.schema !== STORAGE_SCHEMA || !Array.isArray(parsed.detections)) return;
      for (const d of parsed.detections) {
        this.detections.set(`${d.kind}:${d.identifier}`, d);
      }
    } catch {
      // Storage corruption / quota error → start fresh
    }
  }

  private _writeToStorage(): void {
    if (!this.options.persistInDev) return;
    if (typeof location === 'undefined' || !hostnameLooksLikeDev(location.hostname)) return;
    if (typeof sessionStorage === 'undefined') return;
    try {
      const payload = JSON.stringify({
        schema: STORAGE_SCHEMA,
        detections: Array.from(this.detections.values()),
      });
      sessionStorage.setItem(this._storageKey(), payload);
    } catch {
      // Quota / privacy mode → silently skip persistence
    }
  }
}

export interface ExportedService {
  name: string;
  cookies?: ClassifierServiceConfig['cookies'];
  origins?: ClassifierServiceConfig['origins'];
  purposes?: string[];
}
