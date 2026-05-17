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
    ignoreCookies?: readonly string[];
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
      ignoreCookies: opts.ignoreCookies,
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

  it('skips cookies listed in ignoreCookies', () => {
    const { recorder, fake } = makeRecorder({ ignoreCookies: ['simplecmp-default'] });
    recorder.start();

    fake.sink({ kind: 'cookie', identifier: 'simplecmp-default' });
    fake.sink({ kind: 'cookie', identifier: '_ga' });

    const snapshot = recorder.getSnapshot();
    expect(snapshot.length).toBe(1);
    expect(snapshot[0]?.identifier).toBe('_ga');
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

  it("fires 'detectionSettled' immediately when the classifier returns no pending promise (REQ-N7)", async () => {
    const { recorder, fake } = makeRecorder();
    const settled = vi.fn();
    recorder.on('detectionSettled', settled);
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_ga' });
    // LocalClassifier is synchronous → settled fires in the same tick.
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]?.[0]?.identifier).toBe('_ga');
    expect(settled.mock.calls[0]?.[0]?.status).toBe('known');
    recorder.stop();
  });

  it("defers 'detectionSettled' until the classifier's pending promise resolves and reflects enrichment (REQ-N7)", async () => {
    // Stub a classifier that returns `unknown` synchronously but exposes a
    // pending promise — and calls `enrichDetection` mid-flight to upgrade
    // the stored detection to `known`. The settled event must fire AFTER
    // the promise resolves and read back the enriched state.
    let resolvePending!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    const fake = new FakeWatcher();
    let recorderRef: Recorder | undefined;
    const stubClassifier = {
      classify() {
        return {
          status: 'unknown' as const,
          pending: pending.then(() => {
            recorderRef?.enrichDetection(
              { kind: 'cookie', identifier: '_late' },
              { matchedService: 'late-svc', status: 'known' as const }
            );
          }),
        };
      },
    };
    const recorder = new Recorder({
      options: { summaryIntervalMs: 0 },
      classifier: stubClassifier,
      services: [],
      watcherFactories: [
        (sink) => {
          fake.sink = sink;
          return fake;
        },
      ],
    });
    recorderRef = recorder;
    const settled = vi.fn();
    recorder.on('detectionSettled', settled);
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_late' });
    expect(settled).not.toHaveBeenCalled();
    resolvePending();
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]?.[0]?.status).toBe('known');
    expect(settled.mock.calls[0]?.[0]?.matchedService).toBe('late-svc');
    recorder.stop();
  });

  it("still fires 'detectionSettled' when the classifier's pending promise rejects (REQ-N7)", async () => {
    const fake = new FakeWatcher();
    const stubClassifier = {
      classify() {
        return {
          status: 'unknown' as const,
          pending: Promise.reject(new Error('db unavailable')).catch(() => undefined),
        };
      },
    };
    const recorder = new Recorder({
      options: { summaryIntervalMs: 0 },
      classifier: stubClassifier,
      services: [],
      watcherFactories: [
        (sink) => {
          fake.sink = sink;
          return fake;
        },
      ],
    });
    const settled = vi.fn();
    recorder.on('detectionSettled', settled);
    recorder.start();
    fake.sink({ kind: 'cookie', identifier: '_err' });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]?.[0]?.status).toBe('unknown');
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
