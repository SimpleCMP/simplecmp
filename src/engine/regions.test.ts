import { describe, expect, it } from 'vitest';
import { type Regime, resolveRegime } from './regions.js';

describe('resolveRegime (REQ-N4 / ADR-0015)', () => {
  it('maps EU / EEA / UK / CH to opt-in', () => {
    for (const r of ['DE', 'FR', 'IE', 'NO', 'IS', 'LI', 'GB', 'CH', 'EU', 'EEA']) {
      expect(resolveRegime(r), r).toBe('opt-in');
    }
  });

  it('maps US states + coarse US to opt-out', () => {
    for (const r of ['US', 'US-CA', 'US-VA', 'US-CO', 'US-CT', 'US-UT', 'US-TX']) {
      expect(resolveRegime(r), r).toBe('opt-out');
    }
  });

  it('is case-insensitive on the region code', () => {
    expect(resolveRegime('de')).toBe('opt-in');
    expect(resolveRegime('us-ca')).toBe('opt-out');
  });

  it('falls back to regimeDefault (opt-in) for unknown regions', () => {
    expect(resolveRegime('JP')).toBe('opt-in');
    expect(resolveRegime('BR')).toBe('opt-in');
  });

  it('honors an explicit regimeDefault for unknown / missing regions', () => {
    expect(resolveRegime('JP', undefined, 'opt-out')).toBe('opt-out');
    expect(resolveRegime(undefined, undefined, 'opt-out')).toBe('opt-out');
    expect(resolveRegime(undefined)).toBe('opt-in');
  });

  it('lets the regimes override map win over the built-in table', () => {
    const regimes: Record<string, Regime> = { 'US-CA': 'opt-in', DE: 'opt-out' };
    expect(resolveRegime('US-CA', regimes)).toBe('opt-in');
    expect(resolveRegime('DE', regimes)).toBe('opt-out');
    // override map is matched case-insensitively (upper-cased) too
    expect(resolveRegime('us-ca', regimes)).toBe('opt-in');
    // a region not in the map still uses the built-in table
    expect(resolveRegime('FR', regimes)).toBe('opt-in');
  });
});
