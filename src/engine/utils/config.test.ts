import { describe, expect, it } from 'vitest';
import { update } from './config.js';

describe('update() — merge', () => {
  it('merges string + nested object values', () => {
    const target = { a: '1', nested: { x: 'x' } };
    update(target, { b: '2', nested: { y: 'y' } });
    expect(target).toEqual({ a: '1', b: '2', nested: { x: 'x', y: 'y' } });
  });

  it('does not pollute Object.prototype via a crafted __proto__ key', () => {
    // JSON.parse materialises __proto__ as an own enumerable key.
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    update(target, malicious);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('ignores constructor / prototype keys too', () => {
    const malicious = JSON.parse('{"constructor": {"x": 1}, "prototype": {"y": 2}}') as Record<
      string,
      unknown
    >;
    const target: Record<string, unknown> = {};
    update(target, malicious);
    expect(target.constructor).toBe(Object);
    expect(target.prototype).toBeUndefined();
  });
});
