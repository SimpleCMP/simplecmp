/**
 * Grammar contract for `originMatches` and its helpers.
 *
 * Mirrors `Tests/Unit/Service/OriginMatcherTest.php` in the TYPO3
 * extension (SimpleCMP/t3-simplecmp#8) — the two implementations must
 * agree, or the server-side rewriter and the runtime patches attribute
 * the same URL to different services.
 */

import { describe, expect, it } from 'vitest';
import {
  hostPatternMatches,
  isPathScopedMatcher,
  originMatches,
  pathPrefixMatches,
  splitOriginMatcher,
} from './classifier.js';

describe('splitOriginMatcher', () => {
  it('returns a null path prefix for a bare host', () => {
    expect(splitOriginMatcher('maps.google.com')).toEqual(['maps.google.com', null]);
  });

  it('splits at the first slash', () => {
    expect(splitOriginMatcher('www.google.com/maps/')).toEqual(['www.google.com', '/maps/']);
  });

  it('keeps deeper path prefixes intact', () => {
    expect(splitOriginMatcher('www.gstatic.com/recaptcha/releases/')).toEqual([
      'www.gstatic.com',
      '/recaptcha/releases/',
    ]);
  });

  it('normalises a bare trailing slash away — it carries no information', () => {
    expect(splitOriginMatcher('example.com/')).toEqual(['example.com', null]);
  });

  it('preserves the wildcard host form', () => {
    expect(splitOriginMatcher('*.google.com/recaptcha/')).toEqual(['*.google.com', '/recaptcha/']);
  });
});

describe('hostPatternMatches', () => {
  it('matches an exact host', () => {
    expect(hostPatternMatches('maps.google.com', 'maps.google.com')).toBe(true);
    expect(hostPatternMatches('other.google.com', 'maps.google.com')).toBe(false);
  });

  it('matches the apex and every subdomain for *.apex', () => {
    expect(hostPatternMatches('youtube.com', '*.youtube.com')).toBe(true);
    expect(hostPatternMatches('www.youtube.com', '*.youtube.com')).toBe(true);
    expect(hostPatternMatches('a.b.youtube.com', '*.youtube.com')).toBe(true);
  });

  it('does not let a suffix impersonate the apex', () => {
    expect(hostPatternMatches('eviltube.com', '*.youtube.com')).toBe(false);
    expect(hostPatternMatches('notyoutube.com', '*.youtube.com')).toBe(false);
  });
});

describe('pathPrefixMatches', () => {
  it('matches a path below the prefix', () => {
    expect(pathPrefixMatches('/maps/embed', '/maps/')).toBe(true);
    expect(pathPrefixMatches('/maps/embed?pb=x', '/maps/')).toBe(true);
  });

  it('also accepts the bare directory itself', () => {
    // So a library entry does not have to list both `/maps` and `/maps/`.
    expect(pathPrefixMatches('/maps', '/maps/')).toBe(true);
  });

  it('does not accept a sibling that merely shares the prefix string', () => {
    expect(pathPrefixMatches('/mapsomething', '/maps/')).toBe(false);
  });

  it('tolerates a path that arrives without its leading slash', () => {
    expect(pathPrefixMatches('maps/embed', '/maps/')).toBe(true);
  });

  it('rejects an unrelated path', () => {
    expect(pathPrefixMatches('/recaptcha/api.js', '/maps/')).toBe(false);
  });
});

describe('isPathScopedMatcher', () => {
  it('is true only for string matchers that name a path', () => {
    expect(isPathScopedMatcher('www.google.com/maps/')).toBe(true);
    expect(isPathScopedMatcher('www.google.com')).toBe(false);
    expect(isPathScopedMatcher('example.com/')).toBe(false);
  });

  it('is false for regex forms — those are host patterns, never paths', () => {
    expect(isPathScopedMatcher(/^a\d+\.example\.com$/)).toBe(false);
    expect(isPathScopedMatcher('/^analytics\\.example\\.com$/')).toBe(false);
  });
});

describe('originMatches — behaviour before path prefixes, unchanged', () => {
  it('matches an exact host with no path given', () => {
    expect(originMatches('maps.google.com', 'maps.google.com')).toBe(true);
  });

  it('matches an exact host and ignores the path when the matcher names none', () => {
    expect(originMatches('maps.google.com', 'maps.google.com', '/anything/at/all')).toBe(true);
  });

  it('honours the *. wildcard', () => {
    expect(originMatches('www.youtube.com', '*.youtube.com')).toBe(true);
    expect(originMatches('youtube.com', '*.youtube.com')).toBe(true);
  });

  it('honours a RegExp matcher', () => {
    expect(originMatches('a1.example.com', /^a\d+\.example\.com$/)).toBe(true);
    expect(originMatches('b1.example.com', /^a\d+\.example\.com$/)).toBe(false);
  });

  it('honours the slash-bounded regex form and never splits it as a path', () => {
    // The regression this guards: naive splitting at the first slash
    // turns `/^analytics\.example\.com$/` into host pattern '' plus a
    // path — matching nothing at all.
    expect(originMatches('analytics.example.com', '/^analytics\\.example\\.com$/')).toBe(true);
    expect(originMatches('analytics.example.com', '/^analytics\\.example\\.com$/', '/x')).toBe(
      true
    );
    expect(originMatches('evil.example.com', '/^analytics\\.example\\.com$/')).toBe(false);
  });

  it('keeps the slash-bounded regex anchored to a full-host match', () => {
    expect(originMatches('eviltracker.example.com.attacker.net', '/tracker\\.example\\.com/')).toBe(
      false
    );
  });
});

describe('originMatches — path-scoped matchers', () => {
  const MAPS = 'www.google.com/maps/';
  const RECAPTCHA = '*.google.com/recaptcha/';

  it('matches when host and path both fit', () => {
    expect(originMatches('www.google.com', MAPS, '/maps/embed')).toBe(true);
  });

  it('does not match when the host fits but the path does not', () => {
    // The reported bug: a Maps embed attributed to reCAPTCHA.
    expect(originMatches('www.google.com', MAPS, '/recaptcha/api.js')).toBe(false);
  });

  it('does not match when the path fits but the host does not', () => {
    expect(originMatches('maps.example.com', MAPS, '/maps/embed')).toBe(false);
  });

  it('applies the path half to a wildcard host too', () => {
    expect(originMatches('www.google.com', RECAPTCHA, '/recaptcha/api.js')).toBe(true);
    expect(originMatches('google.com', RECAPTCHA, '/recaptcha/api.js')).toBe(true);
    expect(originMatches('www.google.com', RECAPTCHA, '/maps/embed')).toBe(false);
  });

  it('degrades to the host half when the caller knows no path', () => {
    // Host-only callers (`/v1/lookup` by origin, the BE detection
    // list) ask "which services CAN live on this host" — answering
    // "none" would be a regression. Both `undefined` and an explicit
    // `null` mean "no path known".
    expect(originMatches('www.google.com', MAPS)).toBe(true);
    expect(originMatches('www.google.com', MAPS, null)).toBe(true);
  });

  it('treats a bare trailing slash as no path prefix at all', () => {
    expect(originMatches('example.com', 'example.com/', '/anything')).toBe(true);
  });
});
