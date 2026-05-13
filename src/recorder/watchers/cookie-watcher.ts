/**
 * Cookie watcher — REQ-7 / ADR-0004 section G.
 *
 * Polls `document.cookie` at a configurable interval and reports new cookie
 * names through the sink. There is no native event for cookie writes
 * pre-Cookie Store API, so polling is the only portable approach. Cost
 * (~1 ms/sec at default cadence) is acceptable for a dev-time tool.
 *
 * Initial scan on `start()` reports cookies already present at activation.
 */

import type { DetectionSink, Watcher } from '../types.js';

/** Parse a `document.cookie` string into a Set of cookie names. */
function parseCookieNames(raw: string): Set<string> {
  const names = new Set<string>();
  if (!raw) return names;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    const name = (eq >= 0 ? part.slice(0, eq) : part).trim();
    if (name) names.add(name);
  }
  return names;
}

export interface CookieWatcherOptions {
  intervalMs?: number;
  /**
   * Source of the cookie string. Defaults to `() => document.cookie`. Tests
   * inject a stub. The function is called repeatedly; it must be cheap.
   */
  readCookies?: () => string;
}

export class CookieWatcher implements Watcher {
  private readonly intervalMs: number;
  private readonly readCookies: () => string;
  private readonly sink: DetectionSink;
  private readonly seen = new Set<string>();
  private timerId?: ReturnType<typeof setInterval>;
  private readonly getPathname: () => string | undefined;

  constructor(sink: DetectionSink, options: CookieWatcherOptions = {}) {
    this.sink = sink;
    this.intervalMs = options.intervalMs ?? 1000;
    this.readCookies =
      options.readCookies ?? (() => (typeof document !== 'undefined' ? document.cookie : ''));
    this.getPathname = () =>
      typeof location !== 'undefined' ? location.pathname + location.search : undefined;
  }

  start(): void {
    if (this.timerId !== undefined) return;
    this._scan();
    this.timerId = setInterval(() => this._scan(), this.intervalMs);
  }

  stop(): void {
    if (this.timerId !== undefined) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
  }

  /** Force a scan now (used in tests, also called internally). */
  scanOnce(): void {
    this._scan();
  }

  private _scan(): void {
    const names = parseCookieNames(this.readCookies());
    const pathname = this.getPathname();
    for (const name of names) {
      if (!this.seen.has(name)) {
        this.seen.add(name);
        this.sink({ kind: 'cookie', identifier: name, firstSeenOn: pathname });
      }
    }
  }
}
