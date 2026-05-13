import { describe, expect, it } from 'vitest';
import type { RawDetection } from '../types.js';
import { NetworkWatcher } from './network-watcher.js';

/** Minimal fake to drive the watcher without a real PerformanceObserver. */
function makeFake() {
  const entries: PerformanceEntry[] = [];
  let liveCallback: ((list: PerformanceObserverEntryList) => void) | undefined;
  const perf = {
    getEntriesByType: (_type: string) => entries.slice(),
  };
  class FakePO {
    constructor(cb: (list: PerformanceObserverEntryList) => void) {
      liveCallback = cb;
    }
    observe(): void {}
    disconnect(): void {
      liveCallback = undefined;
    }
    takeRecords(): PerformanceEntry[] {
      return [];
    }
  }
  function pushLive(...newEntries: PerformanceEntry[]): void {
    if (!liveCallback) return;
    liveCallback({
      getEntries: () => newEntries,
      getEntriesByName: () => [],
      getEntriesByType: () => [],
    } as unknown as PerformanceObserverEntryList);
  }
  function entry(url: string): PerformanceEntry {
    return { name: url, entryType: 'resource', startTime: 0, duration: 0, toJSON: () => ({}) };
  }
  return { perf, FakePO, entries, pushLive, entry };
}

describe('NetworkWatcher', () => {
  it('drains existing resource entries on start()', () => {
    const fake = makeFake();
    fake.entries.push(fake.entry('https://www.googletagmanager.com/gtm.js'));
    fake.entries.push(fake.entry(`${location.origin}/local-asset.js`));

    const seen: RawDetection[] = [];
    const watcher = new NetworkWatcher((d) => seen.push(d), {
      performance: fake.perf,
      PerformanceObserver: fake.FakePO as unknown as typeof PerformanceObserver,
    });

    watcher.start();
    watcher.stop();

    expect(seen.length).toBe(1);
    expect(seen[0]?.identifier).toBe('https://www.googletagmanager.com/gtm.js');
    expect(seen[0]?.origin).toBe('www.googletagmanager.com');
    expect(seen[0]?.kind).toBe('request');
  });

  it('reports new entries pushed live by the observer', () => {
    const fake = makeFake();
    const seen: RawDetection[] = [];
    const watcher = new NetworkWatcher((d) => seen.push(d), {
      performance: fake.perf,
      PerformanceObserver: fake.FakePO as unknown as typeof PerformanceObserver,
    });
    watcher.start();

    fake.pushLive(fake.entry('https://pixel.example.com/track?x=1'));
    expect(seen.length).toBe(1);
    expect(seen[0]?.origin).toBe('pixel.example.com');

    // Same URL again should not duplicate
    fake.pushLive(fake.entry('https://pixel.example.com/track?x=1'));
    expect(seen.length).toBe(1);

    watcher.stop();
  });

  it('skips same-origin entries', () => {
    const fake = makeFake();
    fake.entries.push(fake.entry(`${location.origin}/api/data.json`));

    const seen: RawDetection[] = [];
    const watcher = new NetworkWatcher((d) => seen.push(d), {
      performance: fake.perf,
      PerformanceObserver: fake.FakePO as unknown as typeof PerformanceObserver,
    });
    watcher.start();
    watcher.stop();

    expect(seen).toEqual([]);
  });
});
