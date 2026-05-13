import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalClassifier } from './classifier.js';
import { Recorder, hostnameLooksLikeDev } from './recorder.js';
import type { ClassifierServiceConfig, DetectionSink, Watcher } from './types.js';

/**
 * Minimal fake watcher whose only job is to surface the sink up to the test
 * so the test can drive ingestion directly. Avoids the timing complexity of
 * real watchers.
 */
class FakeWatcher implements Watcher {
  public sink!: DetectionSink;
  start(): void {}
  stop(): void {}
}

function makeRecorder(
  opts: {
    services?: ClassifierServiceConfig[];
    persistInDev?: boolean;
    storageName?: string;
  } = {}
) {
  const services: ClassifierServiceConfig[] = opts.services ?? [
    { name: 'analytics', cookies: ['_ga'] },
  ];
  const fake = new FakeWatcher();
  const recorder = new Recorder({
    options: {
      persistInDev: opts.persistInDev,
      storageName: opts.storageName,
      summaryIntervalMs: 0, // disable periodic summary in tests
    },
    classifier: new LocalClassifier(services),
    services,
    watcherFactories: [
      (sink) => {
        fake.sink = sink;
        return fake;
      },
    ],
  });
  return { recorder, fake };
}

describe('hostnameLooksLikeDev', () => {
  it('treats localhost and friends as dev', () => {
    expect(hostnameLooksLikeDev('localhost')).toBe(true);
    expect(hostnameLooksLikeDev('app.localhost')).toBe(true);
    expect(hostnameLooksLikeDev('site.local')).toBe(true);
    expect(hostnameLooksLikeDev('site.test')).toBe(true);
    expect(hostnameLooksLikeDev('127.0.0.1')).toBe(true);
    expect(hostnameLooksLikeDev('192.168.1.10')).toBe(true);
    expect(hostnameLooksLikeDev('')).toBe(true); // file:// or test env
  });

  it('treats real-looking hosts as production', () => {
    expect(hostnameLooksLikeDev('example.com')).toBe(false);
    expect(hostnameLooksLikeDev('shop.example.com')).toBe(false);
  });
});

describe('Recorder — ingestion + classification', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('classifies known cookies and adds them to the snapshot', () => {
    const { recorder, fake } = makeRecorder();
    recorder.start();

    const sink = fake.sink;
    sink({ kind: 'cookie', identifier: '_ga' });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.length).toBe(1);
    expect(snapshot[0]?.status).toBe('known');
    expect(snapshot[0]?.matchedService).toBe('analytics');
    recorder.stop();
  });

  it('marks unrecognised detections as unknown', () => {
    const { recorder, fake } = makeRecorder();
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_hjid' });
    const [d] = recorder.getSnapshot();
    expect(d?.status).toBe('unknown');
    recorder.stop();
  });

  it('deduplicates and bumps count on repeat observations', () => {
    const { recorder, fake } = makeRecorder();
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    const [d] = recorder.getSnapshot();
    expect(d?.count).toBe(3);
    expect(recorder.getSnapshot().length).toBe(1);
    recorder.stop();
  });

  it('fires detection listeners only on first sighting', () => {
    const { recorder, fake } = makeRecorder();
    const handler = vi.fn();
    recorder.on('detection', handler);
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    expect(handler).toHaveBeenCalledTimes(1);
    recorder.off('detection', handler);
    recorder.stop();
  });
});

describe('Recorder — exportConfig', () => {
  it('reproduces known services verbatim', () => {
    const services: ClassifierServiceConfig[] = [
      { name: 'analytics', cookies: ['_ga'], origins: ['*.google-analytics.com'] },
    ];
    const { recorder, fake } = makeRecorder({ services });
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    const exported = recorder.exportConfig();
    const analytics = exported.services.find((s) => s.name === 'analytics');
    expect(analytics?.cookies).toEqual(['_ga']);
    expect(analytics?.origins).toEqual(['*.google-analytics.com']);
    recorder.stop();
  });

  it('emits a stub for each unknown detection', () => {
    const { recorder, fake } = makeRecorder();
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_hjid' });
    fake.sink({
      kind: 'script',
      identifier: 'https://hotjar.com/x',
      origin: 'hotjar.com',
    });
    const exported = recorder.exportConfig();
    const stubs = exported.services.filter((s) => s.name.startsWith('unknown-'));
    expect(stubs.length).toBe(2);
    const cookieStub = stubs.find((s) => s.cookies);
    expect(cookieStub?.cookies).toEqual(['_hjid']);
    const originStub = stubs.find((s) => s.origins);
    expect(originStub?.origins).toEqual(['hotjar.com']);
    recorder.stop();
  });
});

describe('Recorder — assertNoUnknown', () => {
  it('does not throw when everything is known', () => {
    const { recorder, fake } = makeRecorder();
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    expect(() => recorder.assertNoUnknown()).not.toThrow();
    recorder.stop();
  });

  it('throws with a structured message when unknown items exist', () => {
    const { recorder, fake } = makeRecorder();
    recorder.start();
    fake.sink({
      kind: 'request',
      identifier: 'https://unknown.example/x',
      origin: 'unknown.example',
    });
    expect(() => recorder.assertNoUnknown()).toThrow(/1 unknown detection/);
    recorder.stop();
  });
});

describe('Recorder — sessionStorage persistence', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('persists and re-loads detections in dev', () => {
    {
      const { recorder, fake } = makeRecorder({
        persistInDev: true,
        storageName: 'persist-test',
      });
      recorder.start();
      fake.sink({ kind: 'cookie', identifier: '_ga' });
      recorder.stop();
    }

    // happy-dom defaults to localhost so persistInDev is honored
    const { recorder } = makeRecorder({
      persistInDev: true,
      storageName: 'persist-test',
    });
    recorder.start();
    const snapshot = recorder.getSnapshot();
    expect(snapshot.length).toBe(1);
    expect(snapshot[0]?.identifier).toBe('_ga');
    recorder.stop();
  });

  it('does not persist by default', () => {
    const { recorder, fake } = makeRecorder({ storageName: 'no-persist' });
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    recorder.stop();
    expect(sessionStorage.getItem('simplecmp.recorder.no-persist')).toBeNull();
  });
});
