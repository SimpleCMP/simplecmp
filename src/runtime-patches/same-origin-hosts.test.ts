/**
 * `sameOriginHosts` carries the site's universal-blocking allowlist. The
 * server-side rewriter (t3-simplecmp HostMatcher) treats `*.example.com` as
 * apex + every subdomain; the runtime used to compare every entry verbatim
 * against `host`, so wildcards never matched in the browser. Found with a
 * Botpress chat: the rewriter let `cdn.botpress.cloud` through via
 * `*.botpress.cloud`, the runtime then blocked the chat API on
 * `webchat.botpress.cloud` ("consent for webchat.botpress.cloud not granted").
 */

import { describe, expect, it } from 'vitest';
import { decideBlock, isSameOriginHost } from './index.js';

function optsWith(sameOriginHosts: string[]) {
  return {
    matcher: () => 'some-service',
    consentChecker: () => false,
    sameOriginHosts,
    onBlock: () => {},
  };
}

describe('isSameOriginHost', () => {
  it('matches a subdomain against a wildcard entry', () => {
    expect(
      isSameOriginHost('webchat.botpress.cloud', 'webchat.botpress.cloud', ['*.botpress.cloud'])
    ).toBe(true);
  });

  it('matches the apex against a wildcard entry', () => {
    expect(isSameOriginHost('botpress.cloud', 'botpress.cloud', ['*.botpress.cloud'])).toBe(true);
  });

  it('does not match a look-alike domain', () => {
    expect(isSameOriginHost('evilbotpress.cloud', 'evilbotpress.cloud', ['*.botpress.cloud'])).toBe(
      false
    );
    expect(
      isSameOriginHost('botpress.cloud.evil.com', 'botpress.cloud.evil.com', ['*.botpress.cloud'])
    ).toBe(false);
  });

  it('ignores the port for wildcard entries', () => {
    expect(isSameOriginHost('api.example.com:8443', 'api.example.com', ['*.example.com'])).toBe(
      true
    );
  });

  it('keeps exact entries port-strict', () => {
    expect(isSameOriginHost('localhost:3000', 'localhost', ['localhost:3000'])).toBe(true);
    expect(isSameOriginHost('localhost:8080', 'localhost', ['localhost:3000'])).toBe(false);
  });

  it('compares case-insensitively', () => {
    expect(isSameOriginHost('cdn.example.com', 'cdn.example.com', ['CDN.Example.com'])).toBe(true);
  });
});

describe('decideBlock with wildcard sameOriginHosts', () => {
  it('passes a request to a subdomain of an allowlisted wildcard', () => {
    expect(
      decideBlock('https://webchat.botpress.cloud/x/messages', optsWith(['*.botpress.cloud']))
    ).toBeNull();
  });

  it('still blocks hosts outside the wildcard', () => {
    expect(decideBlock('https://tracker.example/pixel', optsWith(['*.botpress.cloud']))).toBe(
      'some-service'
    );
  });
});
