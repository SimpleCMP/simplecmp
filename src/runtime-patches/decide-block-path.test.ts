/**
 * `decideBlock` already parses the full URL; it must hand the matcher
 * the path as well as the host, or path-scoped library claims can never
 * fire at runtime and a JS-injected Maps iframe stays attributed to
 * whichever service happens to claim the host.
 *
 * Mirrors the `HtmlRewriter` half of SimpleCMP/t3-simplecmp#8, which had
 * the same shape: full URL in hand, only the host passed on.
 */

import { describe, expect, it } from 'vitest';
import { decideBlock } from './index.js';

function makeOpts(matcher: (host: string, path?: string | null) => string | null) {
  return {
    matcher,
    consentChecker: () => false,
    sameOriginHosts: [window.location.host],
    onBlock: () => {},
  };
}

describe('decideBlock — path forwarding', () => {
  it('passes the URL pathname to the matcher', () => {
    const seen: Array<[string, string | null | undefined]> = [];
    decideBlock(
      'https://www.google.com/maps/embed?pb=!1m18',
      makeOpts((host, path) => {
        seen.push([host, path]);
        return null;
      })
    );
    expect(seen).toEqual([['www.google.com', '/maps/embed']]);
  });

  it('passes "/" for a URL with no explicit path', () => {
    const seen: Array<string | null | undefined> = [];
    decideBlock(
      'https://tracker.example',
      makeOpts((_host, path) => {
        seen.push(path);
        return null;
      })
    );
    expect(seen).toEqual(['/']);
  });

  it('strips the port from the host but keeps the path intact', () => {
    // Port-stripping is pre-existing behaviour (hostname, not host) —
    // pinned here so the path change cannot quietly alter it.
    const seen: Array<[string, string | null | undefined]> = [];
    decideBlock(
      'https://tracker.example:8443/collect/v2',
      makeOpts((host, path) => {
        seen.push([host, path]);
        return null;
      })
    );
    expect(seen).toEqual([['tracker.example', '/collect/v2']]);
  });

  it('resolves two services on one host by path', () => {
    const matcher = (host: string, path?: string | null): string | null => {
      if (host !== 'www.google.com') return null;
      if (path?.startsWith('/maps')) return 'google-maps';
      if (path?.startsWith('/recaptcha')) return 'google-recaptcha';
      return 'google';
    };
    expect(decideBlock('https://www.google.com/maps/embed', makeOpts(matcher))).toBe('google-maps');
    expect(decideBlock('https://www.google.com/recaptcha/api.js', makeOpts(matcher))).toBe(
      'google-recaptcha'
    );
  });

  it('keeps working with a legacy host-only matcher', () => {
    // Integrators pass their own matcher; a one-parameter function must
    // stay valid, both at the type level and at runtime.
    const hostOnly = (host: string): string | null => (host === 'tracker.example' ? 'x' : null);
    expect(decideBlock('https://tracker.example/a/b', makeOpts(hostOnly))).toBe('x');
  });
});
