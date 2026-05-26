/**
 * URL-parsing fuzz for `decideBlock`. The runtime patches themselves
 * need a real browser to exercise end-to-end, but `decideBlock` is a
 * pure function (string in, service-id-or-null out, with three pure
 * dependencies). This file locks in its behavior across the URL edges
 * an attacker or a sloppy embed shape can reach.
 *
 * Where the current behavior is potentially surprising (e.g. ports
 * included in host strings, IDN converted to Punycode before matching)
 * the test is annotated so a future reader knows what's intentional vs.
 * what's a known smell.
 */
import { describe, expect, it } from 'vitest';
import { decideBlock } from './index.js';

const KNOWN_HOSTS = new Set([
  'tracker.com',
  'sub.tracker.com',
  'xn--bcher-kva.example', // IDN Punycode form of bücher.example
  '1.2.3.4',
  '[::1]',
  'tracker.com.', // trailing-dot variant
]);

function makeOpts(extra: Partial<Parameters<typeof decideBlock>[1]> = {}) {
  return {
    matcher: (host: string) => (KNOWN_HOSTS.has(host) ? 'analytics' : null),
    consentChecker: (id: string) => id === 'consented',
    sameOriginHosts: ['localhost', 'localhost:3000', window.location.host],
    onBlock: () => {},
    ...extra,
  };
}

interface Case {
  name: string;
  url: string;
  expect: string | null;
  optsOverride?: Partial<Parameters<typeof decideBlock>[1]>;
}

describe('decideBlock — pass-through cases', () => {
  const cases: Case[] = [
    { name: 'empty string', url: '', expect: null },
    { name: 'about:blank', url: 'about:blank', expect: null },
    { name: 'unparseable garbage', url: 'not a url', expect: null },
    { name: 'malformed brackets', url: 'http://[unclosed', expect: null },
    { name: 'data: URL (empty host)', url: 'data:text/html,<x>', expect: null },
    { name: 'javascript: URL (empty host)', url: 'javascript:alert(1)', expect: null },
    { name: 'file:// URL (empty host)', url: 'file:///etc/passwd', expect: null },
    { name: 'blob: URL (empty host)', url: 'blob:https://tracker.com/abc', expect: null },
    {
      name: 'same-origin via explicit allowlist',
      url: 'https://localhost/page',
      expect: null,
    },
    {
      name: 'same-origin via relative URL',
      url: '/path/foo.js',
      expect: null,
    },
    {
      name: 'unknown host (matcher returns null)',
      url: 'https://uncovered.example/',
      expect: null,
    },
    {
      name: 'consented service is not blocked',
      url: 'https://tracker.com/x',
      expect: null,
      optsOverride: {
        matcher: () => 'consented',
      },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(decideBlock(c.url, makeOpts(c.optsOverride))).toBe(c.expect);
    });
  }
});

describe('decideBlock — block decisions', () => {
  const cases: Case[] = [
    { name: 'plain https', url: 'https://tracker.com/x', expect: 'analytics' },
    { name: 'plain http', url: 'http://tracker.com/x', expect: 'analytics' },
    {
      name: 'protocol-relative (resolves against current page)',
      url: '//tracker.com/x',
      expect: 'analytics',
    },
    {
      name: 'userinfo prefix is stripped from host',
      url: 'https://user:pass@tracker.com/x',
      expect: 'analytics',
    },
    {
      name: 'mixed-case host gets lowercased',
      url: 'https://Tracker.COM/X',
      expect: 'analytics',
    },
    {
      name: 'whitespace-trimmed URL still parses',
      url: '   https://tracker.com/x   ',
      expect: 'analytics',
    },
    {
      name: 'subdomain is matched independently',
      url: 'https://sub.tracker.com/x',
      expect: 'analytics',
    },
    {
      name: 'IDN host is Punycoded before matching',
      url: 'https://bücher.example/',
      expect: 'analytics',
    },
    {
      name: 'IPv4 literal host',
      url: 'https://1.2.3.4/path',
      expect: 'analytics',
    },
    {
      name: 'IPv6 literal host keeps brackets',
      url: 'https://[::1]/path',
      expect: 'analytics',
    },
    {
      name: 'trailing-dot host is NOT folded to bare host (matcher sees the dot)',
      url: 'https://tracker.com./x',
      expect: 'analytics',
    },
    {
      name: 'default https port is stripped from host',
      url: 'https://tracker.com:443/x',
      expect: 'analytics',
    },
    {
      name: 'non-default port is stripped before matcher lookup',
      url: 'https://tracker.com:8443/x',
      expect: 'analytics',
    },
    {
      name: 'query + fragment do not affect host',
      url: 'https://tracker.com/x?y=1#frag',
      expect: 'analytics',
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(decideBlock(c.url, makeOpts(c.optsOverride))).toBe(c.expect);
    });
  }
});

describe('decideBlock — port-smuggling bypass is closed', () => {
  it('bare-host library entry matches URL with non-default port', () => {
    // Regression: prior to the asymmetric port-stripping fix, a URL like
    // `https://tracker.com:8443/x` produced host `tracker.com:8443`, which
    // did NOT match a library entry of `tracker.com`. An attacker could
    // bypass the patch by serving the tracker on a non-standard port. Fix:
    // decideBlock now passes `hostname` (port-stripped) to the matcher.
    const opts = makeOpts({
      matcher: (host: string) => (host === 'tracker.com' ? 'analytics' : null),
    });
    expect(decideBlock('https://tracker.com:8443/x', opts)).toBe('analytics');
    expect(decideBlock('https://tracker.com/x', opts)).toBe('analytics');
  });
});

describe('decideBlock — same-origin check stays port-strict', () => {
  it('different port on same host is NOT treated as same-origin', () => {
    // Same-origin check intentionally uses `host` (port-strict). A dev page
    // on `localhost:3000` must NOT auto-trust `localhost:8080`. The matcher
    // lookup downstream still uses `hostname` (port-stripped), which is the
    // asymmetry we want.
    const opts = makeOpts({
      sameOriginHosts: ['localhost:3000'],
      matcher: (host: string) => (host === 'localhost' ? 'devtool' : null),
      consentChecker: () => false,
    });
    expect(decideBlock('https://localhost:3000/api', opts)).toBeNull();
    expect(decideBlock('https://localhost:8080/api', opts)).toBe('devtool');
  });
});
