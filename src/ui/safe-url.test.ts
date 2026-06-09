import { describe, expect, it } from 'vitest';
import { isSafeHttpUrl } from './safe-url.js';

describe('isSafeHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeHttpUrl('https://policies.google.com/privacy')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/imprint')).toBe(true);
  });

  it('accepts relative URLs (resolved same-origin)', () => {
    expect(isSafeHttpUrl('/datenschutz')).toBe(true);
  });

  it('rejects javascript: URLs regardless of case', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('rejects javascript: hidden behind stripped control characters', () => {
    // The URL parser strips tabs/newlines per spec, so these normalise to
    // `javascript:` and must still be rejected.
    expect(isSafeHttpUrl('java\nscript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('java\tscript:alert(1)')).toBe(false);
  });

  it('rejects other dangerous or non-web schemes', () => {
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHttpUrl('mailto:x@example.com')).toBe(false);
  });
});
