/**
 * Resolution-order contract for `buildHostMatcher` once matchers can
 * name a path.
 *
 * Mirrors `Tests/Unit/UniversalBlocking/Service/HostMatcherPathScopeTest.php`
 * in the TYPO3 extension (SimpleCMP/t3-simplecmp#8).
 *
 * The asymmetry worth keeping in view: `originMatches` DEGRADES when no
 * path is known (a path-scoped matcher then matches on its host half —
 * "which services can live here?"), while this matcher SKIPS such a
 * claim entirely, because it has to resolve to exactly one service and
 * an unverifiable claim must not beat a verifiable host match.
 */

import { describe, expect, it } from 'vitest';
import { buildHostMatcher } from './matcher.js';

/**
 * The shape the bug was reported against: `www.google.com` serves both
 * the Maps embed and the reCAPTCHA loader, and the generic `google`
 * service claims the whole wildcard. Listed generic-first on purpose —
 * config order must NOT decide this.
 */
const GOOGLE_SERVICES = [
  { name: 'google', origins: ['*.google.com'] },
  { name: 'google-maps', origins: ['www.google.com/maps/', 'maps.google.com'] },
  { name: 'google-recaptcha', origins: ['www.google.com/recaptcha/'] },
];

describe('buildHostMatcher — path-scoped resolution', () => {
  it('prefers the path-scoped claim over a wildcard host claim listed earlier', () => {
    const matcher = buildHostMatcher(GOOGLE_SERVICES);
    expect(matcher('www.google.com', '/maps/embed')).toBe('google-maps');
  });

  it('attributes the same host to a different service under another path', () => {
    const matcher = buildHostMatcher(GOOGLE_SERVICES);
    expect(matcher('www.google.com', '/recaptcha/api.js')).toBe('google-recaptcha');
  });

  it('falls back to the host claim for a path no one has scoped', () => {
    const matcher = buildHostMatcher(GOOGLE_SERVICES);
    expect(matcher('www.google.com', '/search?q=x')).toBe('google');
  });

  it('still resolves a host-only claim that needs no path', () => {
    const matcher = buildHostMatcher(GOOGLE_SERVICES);
    expect(matcher('maps.google.com', '/anything')).toBe('google-maps');
  });

  it('skips a path-scoped claim when the caller supplies no path', () => {
    // Not a degradation to the host half — see the module docblock.
    const matcher = buildHostMatcher(GOOGLE_SERVICES);
    expect(matcher('www.google.com')).toBe('google');
  });

  it('returns null when only path-scoped claims exist and no path is given', () => {
    const matcher = buildHostMatcher([{ name: 'google-maps', origins: ['www.google.com/maps/'] }]);
    expect(matcher('www.google.com')).toBeNull();
    expect(matcher('www.google.com', null)).toBeNull();
  });

  it('does not let a path-scoped claim match a host it does not own', () => {
    const matcher = buildHostMatcher([
      { name: 'google-maps', origins: ['www.google.com/maps/'] },
      { name: 'other', origins: ['maps.example.com'] },
    ]);
    expect(matcher('maps.example.com', '/maps/embed')).toBe('other');
  });

  it('walks path-scoped claims in config order when two of them fit', () => {
    const matcher = buildHostMatcher([
      { name: 'first', origins: ['cdn.example.com/assets/'] },
      { name: 'second', origins: ['cdn.example.com/assets/'] },
    ]);
    expect(matcher('cdn.example.com', '/assets/x.js')).toBe('first');
  });

  describe('with blockAllUnknown', () => {
    it('synthesises the host when a path-scoped claim is skipped for want of a path', () => {
      const matcher = buildHostMatcher(
        [{ name: 'google-maps', origins: ['www.google.com/maps/'] }],
        {
          blockAllUnknown: true,
        }
      );
      expect(matcher('www.google.com')).toBe('www.google.com');
    });

    it('still resolves the real service once the path is known', () => {
      const matcher = buildHostMatcher(
        [{ name: 'google-maps', origins: ['www.google.com/maps/'] }],
        {
          blockAllUnknown: true,
        }
      );
      expect(matcher('www.google.com', '/maps/embed')).toBe('google-maps');
    });
  });
});
