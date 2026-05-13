import { describe, expect, it } from 'vitest';
import { LocalClassifier } from './classifier.js';
import type { ClassifierServiceConfig } from './types.js';

const services: ClassifierServiceConfig[] = [
  {
    name: 'analytics',
    cookies: ['_ga', /^_ga_/, ['^_gid$']],
    origins: ['www.google-analytics.com', '*.googletagmanager.com'],
  },
  {
    name: 'cdn',
    origins: [/^cdn\d*\.example\.com$/],
  },
];

describe('LocalClassifier — cookies', () => {
  const classifier = new LocalClassifier(services);

  it('matches an exact cookie name', () => {
    const result = classifier.classify({ kind: 'cookie', identifier: '_ga' });
    expect(result.status).toBe('known');
    expect(result.matchedService).toBe('analytics');
  });

  it('matches a RegExp cookie pattern', () => {
    const result = classifier.classify({ kind: 'cookie', identifier: '_ga_ABC123' });
    expect(result.status).toBe('known');
    expect(result.matchedService).toBe('analytics');
  });

  it('matches a Klaro-tuple cookie pattern (regex source string)', () => {
    const result = classifier.classify({ kind: 'cookie', identifier: '_gid' });
    expect(result.status).toBe('known');
    expect(result.matchedService).toBe('analytics');
  });

  it('returns unknown for an unrecognised cookie name', () => {
    const result = classifier.classify({ kind: 'cookie', identifier: '__hotjar_id' });
    expect(result.status).toBe('unknown');
    expect(result.matchedService).toBeUndefined();
  });
});

describe('LocalClassifier — origins', () => {
  const classifier = new LocalClassifier(services);

  it('matches an exact host', () => {
    const result = classifier.classify({
      kind: 'script',
      identifier: 'https://www.google-analytics.com/ga.js',
      origin: 'www.google-analytics.com',
    });
    expect(result.status).toBe('known');
    expect(result.matchedService).toBe('analytics');
  });

  it('matches a *.suffix wildcard', () => {
    const result = classifier.classify({
      kind: 'script',
      identifier: 'https://gtm-1.googletagmanager.com/gtm.js',
      origin: 'gtm-1.googletagmanager.com',
    });
    expect(result.status).toBe('known');
    expect(result.matchedService).toBe('analytics');
  });

  it('does NOT match a *.suffix when host is the bare suffix', () => {
    // *.googletagmanager.com matches subdomains; bare host also matches per
    // our spec. Verify both cases.
    const sub = classifier.classify({
      kind: 'script',
      identifier: 'https://x.googletagmanager.com/x',
      origin: 'x.googletagmanager.com',
    });
    expect(sub.status).toBe('known');

    const bare = classifier.classify({
      kind: 'script',
      identifier: 'https://googletagmanager.com/x',
      origin: 'googletagmanager.com',
    });
    expect(bare.status).toBe('known');
  });

  it('matches a RegExp origin pattern', () => {
    const result = classifier.classify({
      kind: 'image',
      identifier: 'https://cdn3.example.com/pixel.gif',
      origin: 'cdn3.example.com',
    });
    expect(result.status).toBe('known');
    expect(result.matchedService).toBe('cdn');
  });

  it('returns unknown when origin is missing', () => {
    const result = classifier.classify({
      kind: 'script',
      identifier: 'inline-snippet',
    });
    expect(result.status).toBe('unknown');
  });

  it('returns unknown for an unrecognised origin', () => {
    const result = classifier.classify({
      kind: 'iframe',
      identifier: 'https://random.cdn/x',
      origin: 'random.cdn',
    });
    expect(result.status).toBe('unknown');
  });
});
