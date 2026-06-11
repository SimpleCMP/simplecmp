/**
 * Region → consent-regime resolution (REQ-N4 / ADR-0015).
 *
 * A **regime** is the resolved legal model that governs consent behaviour:
 *   - `opt-in`  — GDPR / ePrivacy: non-essential processing only after consent
 *                 (banner is a blocking decision wall).
 *   - `opt-out` — US state laws (CCPA/CPRA, VCDPA, …): processing allowed by
 *                 default, the visitor may opt out ("Do Not Sell or Share";
 *                 banner is a non-blocking notice).
 *   - `none`    — no applicable regime: allow by default, no auto-banner.
 *
 * A **region** is the *input* — the visitor's jurisdiction, supplied by the host
 * server (CDN/edge geo header, GeoIP, or Shopify's `getRegion()`). The engine
 * never geo-locates the client itself (unreliable + a pre-consent third-party
 * call). See ADR-0015 for the legal framing (applicability turns on the
 * controller's establishment + the visitor's location, NOT the server location
 * or citizenship).
 */

export type Regime = 'opt-in' | 'opt-out' | 'none';

export const DEFAULT_REGIME: Regime = 'opt-in';

/**
 * Built-in region→regime defaults. ISO 3166-1 alpha-2 (and a few `US-<state>`
 * subdivisions + coarse aliases). A sensible default, NOT a legal source of
 * truth — override per deployment via `config.regimes`, and treat it as
 * drifting as laws change. Not legal advice.
 */

// EU + EEA + UK + Switzerland → opt-in (GDPR / ePrivacy / UK GDPR / revFADP).
const OPT_IN_REGIONS = new Set<string>([
  // EU member states
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  // EEA non-EU
  'IS',
  'LI',
  'NO',
  // UK + Switzerland
  'GB',
  'CH',
  // coarse aliases
  'EU',
  'EEA',
]);

// US states with comprehensive opt-out privacy laws + coarse 'US'. The lighter
// opt-out posture is permissible US-wide (no-law states have no banner duty at
// all), so coarse 'US' maps here.
const OPT_OUT_REGIONS = new Set<string>([
  'US',
  'US-CA',
  'US-VA',
  'US-CO',
  'US-CT',
  'US-UT', // first wave
  'US-TX',
  'US-OR',
  'US-MT',
  'US-DE',
  'US-IA',
  'US-NE',
  'US-NH',
  'US-NJ',
  'US-IN',
  'US-TN',
  'US-MN',
  'US-MD',
  'US-KY',
  'US-RI', // later waves
]);

/**
 * Resolve the effective regime for a request.
 *
 * Order: explicit `regimes` override map (by region) → built-in region table →
 * `regimeDefault` (the merchant baseline; defaults to the strictest, `opt-in`).
 * An absent/unknown region falls straight through to `regimeDefault`, so a
 * merchant who sets nothing gets opt-in for everyone.
 *
 * @param region        Visitor jurisdiction from the host (e.g. `'DE'`, `'US-CA'`). Case-insensitive.
 * @param regimes       Optional per-region override map (merchant-supplied).
 * @param regimeDefault Baseline regime when the region is unknown/unmapped.
 */
export function resolveRegime(
  region: string | undefined,
  regimes?: Record<string, Regime>,
  regimeDefault: Regime = DEFAULT_REGIME
): Regime {
  if (region) {
    const key = region.toUpperCase();
    if (regimes) {
      const override = regimes[region] ?? regimes[key];
      if (override) return override;
    }
    if (OPT_IN_REGIONS.has(key)) return 'opt-in';
    if (OPT_OUT_REGIONS.has(key)) return 'opt-out';
  }
  return regimeDefault;
}
