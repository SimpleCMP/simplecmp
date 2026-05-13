/**
 * Network watcher — REQ-7 / ADR-0004 section G.
 *
 * `PerformanceObserver` for `entryTypes: ['resource']`. Each resource entry
 * has `name` (URL) and we derive `origin` from it. Cross-origin entries
 * are reported even when their headers were opaque — the point is to know
 * that the request happened.
 *
 * Same-origin entries are skipped (not interesting for the consent
 * recorder).
 *
 * On `start()` we also drain `performance.getEntriesByType('resource')` so
 * resources fetched before the observer attached are still reported.
 */

import type { DetectionSink, RawDetection, Watcher } from '../types.js';

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export interface NetworkWatcherOptions {
  /**
   * Override the source of performance entries. Tests inject a stub so they
   * don't have to drive a real PerformanceObserver. Defaults to the live
   * `performance` API when available.
   */
  performance?: Pick<Performance, 'getEntriesByType'>;
  /**
   * Override the constructor used to subscribe to live entries. Tests inject
   * a stub. Defaults to the global `PerformanceObserver`.
   */
  PerformanceObserver?: typeof PerformanceObserver;
}

export class NetworkWatcher implements Watcher {
  private readonly sink: DetectionSink;
  private readonly perf?: Pick<Performance, 'getEntriesByType'>;
  private readonly Observer?: typeof PerformanceObserver;
  private observer?: PerformanceObserver;
  private readonly seen = new Set<string>();

  constructor(sink: DetectionSink, options: NetworkWatcherOptions = {}) {
    this.sink = sink;
    this.perf =
      options.performance ?? (typeof performance !== 'undefined' ? performance : undefined);
    this.Observer =
      options.PerformanceObserver ??
      (typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : undefined);
  }

  start(): void {
    if (this.observer) return;
    this._drainExisting();
    if (!this.Observer) return;
    try {
      this.observer = new this.Observer((list) => this._handleList(list));
      this.observer.observe({ type: 'resource', buffered: false });
    } catch {
      // Some browsers reject `{ type, buffered }` and need `{ entryTypes }`.
      // Try the older form before giving up.
      try {
        this.observer = new this.Observer((list) => this._handleList(list));
        this.observer.observe({ entryTypes: ['resource'] });
      } catch {
        this.observer = undefined;
      }
    }
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
  }

  private _drainExisting(): void {
    if (!this.perf) return;
    try {
      const entries = this.perf.getEntriesByType('resource');
      for (const entry of entries) this._handleEntry(entry);
    } catch {
      // No-op — getEntriesByType isn't critical
    }
  }

  private _handleList(list: PerformanceObserverEntryList): void {
    for (const entry of list.getEntries()) this._handleEntry(entry);
  }

  private _handleEntry(entry: PerformanceEntry): void {
    const url = entry.name;
    if (!url) return;
    const origin = safeOrigin(url);
    if (!origin) return;
    if (typeof location !== 'undefined' && origin === location.host) return;
    const key = `request:${url}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const raw: RawDetection = {
      kind: 'request',
      identifier: url,
      origin,
      firstSeenOn:
        typeof location !== 'undefined' ? location.pathname + location.search : undefined,
    };
    this.sink(raw);
  }
}
