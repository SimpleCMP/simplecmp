import { describe, expect, it } from 'vitest';
import { buildHostMatcher } from './matcher.js';

describe('buildHostMatcher', () => {
  it('resolves an exact host to the configured service name', () => {
    const matcher = buildHostMatcher([{ name: 'analytics', origins: ['analytics.example.com'] }]);
    expect(matcher('analytics.example.com')).toBe('analytics');
  });

  it('returns null for an unknown host', () => {
    const matcher = buildHostMatcher([{ name: 'analytics', origins: ['analytics.example.com'] }]);
    expect(matcher('other.example.com')).toBeNull();
  });

  it('honors the *. wildcard form (apex + every subdomain)', () => {
    const matcher = buildHostMatcher([{ name: 'videos', origins: ['*.video-cdn.example'] }]);
    expect(matcher('video-cdn.example')).toBe('videos');
    expect(matcher('player.video-cdn.example')).toBe('videos');
    expect(matcher('cdn1.video-cdn.example')).toBe('videos');
  });

  it('honors the /regex/ slash-bounded form', () => {
    const matcher = buildHostMatcher([
      { name: 'analytics', origins: ['/^analytics-\\d+\\.example\\.com$/'] },
    ]);
    expect(matcher('analytics-1.example.com')).toBe('analytics');
    expect(matcher('analytics-99.example.com')).toBe('analytics');
    expect(matcher('analytics-abc.example.com')).toBeNull();
  });

  it('honors a RegExp matcher passed directly', () => {
    const matcher = buildHostMatcher([{ name: 'analytics', origins: [/^a\d+\.example\.com$/] }]);
    expect(matcher('a1.example.com')).toBe('analytics');
    expect(matcher('b1.example.com')).toBeNull();
  });

  it('returns the first matching service when origins overlap', () => {
    // Services are walked in config order. Whichever lists the host
    // first wins. This is the deterministic behavior integrators rely
    // on when they have specific-before-generic services.
    const matcher = buildHostMatcher([
      { name: 'specific', origins: ['embed.video.example'] },
      { name: 'generic', origins: ['*.video.example'] },
    ]);
    expect(matcher('embed.video.example')).toBe('specific');
  });

  it('skips services without an origins array (cookie-only services)', () => {
    const matcher = buildHostMatcher([
      { name: 'cookie-only', cookies: ['_cookie'] },
      { name: 'with-origins', origins: ['cdn.example.com'] },
    ] as Parameters<typeof buildHostMatcher>[0]);
    expect(matcher('cdn.example.com')).toBe('with-origins');
  });

  it('returns null for empty host', () => {
    const matcher = buildHostMatcher([{ name: 'analytics', origins: ['analytics.example.com'] }]);
    expect(matcher('')).toBeNull();
  });

  it('works with an empty services array', () => {
    const matcher = buildHostMatcher([]);
    expect(matcher('any.host.example')).toBeNull();
  });

  describe('blockAllUnknown mode', () => {
    it('returns the host as the synthetic service id for unmatched hosts', () => {
      const matcher = buildHostMatcher(
        [{ name: 'analytics', origins: ['analytics.example.com'] }],
        { blockAllUnknown: true }
      );
      // Unknown host → fallback to host-as-id, so the patch can still
      // block it (consent check against a synthetic id always denies).
      expect(matcher('unknown-tracker.com')).toBe('unknown-tracker.com');
      expect(matcher('cdn.someplace.net')).toBe('cdn.someplace.net');
    });

    it('still prefers configured services over the synthetic fallback', () => {
      const matcher = buildHostMatcher([{ name: 'analytics', origins: ['*.analytics.example'] }], {
        blockAllUnknown: true,
      });
      // Real service match wins over the host-as-id fallback.
      expect(matcher('cdn1.analytics.example')).toBe('analytics');
    });

    it('returns null for empty host even in universal mode', () => {
      // decideBlock relies on this — an empty host is a non-URL, not
      // a synthetic service to block.
      const matcher = buildHostMatcher([], { blockAllUnknown: true });
      expect(matcher('')).toBeNull();
    });

    it('default (no options) preserves narrow behavior', () => {
      const matcher = buildHostMatcher([{ name: 'analytics', origins: ['analytics.example.com'] }]);
      expect(matcher('unknown-tracker.com')).toBeNull();
    });
  });
});
