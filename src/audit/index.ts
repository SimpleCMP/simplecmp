/**
 * Consent-banner compliance audit.
 *
 * Synchronous, side-effect-free checks that grade a `SimpleCMPConfig`
 * against the hard requirements from `docs/legal-compliance.md`. Each
 * check returns one of:
 *
 *   - `severity: 'critical'` — clearly illegal under DSGVO / ePrivacy
 *     and the converging DPA enforcement line. Operator MUST fix.
 *   - `severity: 'warning'` — gray-zone or risk-amplifier. Operator
 *     should justify or fix.
 *   - `severity: 'info'` — informational notice that the audit ran
 *     and the property looks OK.
 *
 * The check list is exported alongside the runner so CMS integrations
 * (TYPO3 first, others later) can either consume `audit()` directly
 * (when running JS) or mirror the check IDs/severities in their own
 * native language (when running server-side) without re-curating the
 * compliance taxonomy. The mirrored implementations should keep the
 * `id` and `section` fields in lockstep with this list.
 *
 * **Scope is the *config*, not the rendered DOM.** Checks that need
 * to inspect computed styles (WCAG contrast, focus-trap behaviour,
 * close-button semantics) belong in a separate browser-side audit
 * that has access to a mounted banner. Those are not implemented
 * here.
 */

import type { SimpleCMPConfig } from '../index.js';
import { checkDeclineLabelClarity, checkNoMarketingNudgeInDescription } from './heuristics.js';

/** Severity of a single audit finding. */
export type Severity = 'critical' | 'warning' | 'info';

/** Outcome of one check against a config. */
export interface AuditResult {
  /** Stable identifier — keep in sync with downstream integrations. */
  id: string;
  /** Section of `docs/legal-compliance.md` the check derives from. */
  section: string;
  /** Severity if the check failed; `'info'` when it passed. */
  severity: Severity;
  /** Human-readable status (English; integrators localize on display). */
  title: string;
  /** Short explanation of what was checked and what the result means. */
  detail: string;
  /** Whether the check passed (`true`) or surfaced an issue (`false`). */
  passed: boolean;
}

/** Definition of one check; checks are pure functions of the config. */
export interface Check {
  id: string;
  section: string;
  title: string;
  /** Severity assigned when the check fails. */
  failSeverity: Exclude<Severity, 'info'>;
  run: (config: SimpleCMPConfig) => CheckOutcome;
}

/**
 * Outcome of a single check before it's converted to an `AuditResult`.
 * Splitting the "did it pass" and "if not, why" logic makes each
 * check function trivial to test in isolation.
 */
export interface CheckOutcome {
  passed: boolean;
  detail: string;
}

/**
 * The check list. Each entry references the `docs/legal-compliance.md`
 * section it derives from so a reader can find the legal basis.
 *
 * Order is the order results are reported. Checks that uncover a
 * clearly-illegal posture sort to the top so the most-actionable
 * findings are surfaced first.
 */
export const CHECKS: readonly Check[] = [
  {
    id: 'privacy-policy-url',
    section: '1.5',
    title: 'Privacy-policy URL configured',
    failSeverity: 'critical',
    run: (config) => {
      const url = config.privacyPolicy;
      if (typeof url === 'string' && url !== '' && url !== '#') {
        return { passed: true, detail: 'Privacy policy URL is set.' };
      }
      if (typeof url === 'object' && url !== null) {
        // Per-language map shape. Accept if at least one entry is a
        // non-placeholder string.
        const values = Object.values(url).filter(
          (v) => typeof v === 'string' && v !== '' && v !== '#'
        );
        if (values.length > 0) {
          return { passed: true, detail: 'Privacy policy URL is set (per-language map).' };
        }
      }
      return {
        passed: false,
        detail:
          'GDPR Art. 13 requires the privacy policy to be linked before consent is captured. ' +
          'Set `simplecmp.privacyPolicy` to the live URL of the site’s policy.',
      };
    },
  },
  {
    id: 'first-layer-reject',
    section: '1.3',
    title: '"Reject all" available on first layer',
    failSeverity: 'critical',
    run: (config) => {
      // `hideDeclineAll: true` removes the Decline button from the
      // first level. VG Hannover 10 A 5385/22 + EDPB Taskforce treat
      // this as unlawful — rejection must be as easy as accept.
      if ((config as { hideDeclineAll?: unknown }).hideDeclineAll === true) {
        return {
          passed: false,
          detail:
            'VG Hannover 10 A 5385/22 (19.03.2025) and the EDPB Cookie Banner Taskforce ' +
            'require a first-layer Reject affordance. `hideDeclineAll: true` removes it. ' +
            'Set `hideDeclineAll: false` or remove the property.',
        };
      }
      return { passed: true, detail: 'Reject affordance is present on the first banner layer.' };
    },
  },
  {
    id: 'opt-in-defaults',
    section: '1.1',
    title: 'Non-essential services default to OFF',
    failSeverity: 'critical',
    run: (config) => {
      const services = config.services ?? [];
      const offenders: string[] = [];
      for (const service of services) {
        // `required: true` means the service is essential — opt-in is
        // not legally required. Skip those.
        if (service.required === true) continue;
        // `default: true` pre-selects the toggle as consent given —
        // invalid under Planet49 (CJEU C-673/17) and BGH Cookie II.
        if (service.default === true) {
          offenders.push(service.name);
        }
      }
      if (offenders.length === 0) {
        return { passed: true, detail: 'All non-essential services default to OFF.' };
      }
      return {
        passed: false,
        detail: `${offenders.length} non-essential service(s) have \`default: true\` (pre-consent granted): ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? `, … (${offenders.length - 5} more)` : ''}. Pre-ticked consent fails Planet49 / Cookie II. Either mark the service \`required: true\` (if it truly is essential) or remove the \`default: true\` flag.`,
      };
    },
  },
  {
    id: 'pre-consent-blocking',
    section: '1.7',
    title: 'Pre-consent tracking blocked',
    failSeverity: 'critical',
    run: (config) => {
      // `interceptRuntime` is the SimpleCMP-side switch that wires
      // up the JS-injected interceptors plus universal blocking. The
      // CMS-side rewriter complements this for declarative tags.
      // Without it, third-party tags can fire before consent — § 25
      // TDDDG + LG München Google-Fonts ruling treat that as
      // unlawful.
      const opted = config.interceptRuntime;
      if (opted === undefined || opted === false) {
        return {
          passed: false,
          detail:
            'Without `interceptRuntime`, third-party scripts can dispatch requests before ' +
            'the user has chosen — § 25 TDDDG and Art. 5(3) ePrivacy require prior ' +
            'consent for any non-essential storage/access. Enable `interceptRuntime: true` ' +
            '(or the CMS-side equivalent setting that does the same).',
        };
      }
      return { passed: true, detail: 'Pre-consent runtime blocking is enabled.' };
    },
  },
  {
    id: 'persistent-revocation-trigger',
    section: '1.6',
    title: 'Persistent revocation trigger enabled',
    failSeverity: 'warning',
    run: (config) => {
      const trigger = config.floatingTrigger;
      if (trigger === undefined || trigger === false) {
        return {
          passed: false,
          detail:
            'GDPR Art. 7(3) demands that withdrawal be as easy as granting consent. Without ' +
            'a persistent trigger (`floatingTrigger`), visitors must hunt for the consent ' +
            'banner to revoke. Set `floatingTrigger: true` or configure a custom trigger.',
        };
      }
      return { passed: true, detail: 'Persistent revocation trigger is enabled.' };
    },
  },
  {
    id: 'imprint-url-dach',
    section: '1.5',
    title: 'Imprint URL configured (DACH compliance)',
    failSeverity: 'warning',
    run: (config) => {
      const url = config.imprint;
      if (typeof url === 'string' && url !== '' && url !== '#') {
        return { passed: true, detail: 'Imprint URL is set.' };
      }
      if (typeof url === 'object' && url !== null) {
        const values = Object.values(url).filter(
          (v) => typeof v === 'string' && v !== '' && v !== '#'
        );
        if (values.length > 0) {
          return { passed: true, detail: 'Imprint URL is set (per-language map).' };
        }
      }
      return {
        passed: false,
        detail:
          'German TMG / Austrian ECG / Swiss UWG require a separately reachable Impressum. ' +
          'Surface the link next to the privacy policy in the banner by setting ' +
          '`simplecmp.imprint` to the live URL. Skip this check only if the site is not ' +
          'targeted at DACH visitors.',
      };
    },
  },
  {
    // Heuristic — fuzzy pattern match against weak / deferring
    // reject labels in `config.translations.<lang>.decline`. Only
    // fires on overridden labels; the bundle's own defaults are
    // clean. Warning (never critical) because heuristics can have
    // false positives — an editor can confirm or revert with a
    // tone judgement.
    id: 'heuristic-decline-label-clarity',
    section: '2.2',
    title: 'Reject button labels read as clear refusal',
    failSeverity: 'warning',
    run: checkDeclineLabelClarity,
  },
  {
    // Heuristic — fuzzy pattern match against marketing nudges in
    // `config.translations.<lang>.consentNotice.description`. Same
    // scoping + severity rationale as the decline-label check.
    id: 'heuristic-no-marketing-nudge-in-description',
    section: '2.3',
    title: 'Banner description avoids marketing nudges',
    failSeverity: 'warning',
    run: checkNoMarketingNudgeInDescription,
  },
  {
    id: 'services-have-purposes',
    section: '1.4',
    title: 'Each service declares processing purposes',
    failSeverity: 'warning',
    run: (config) => {
      const services = config.services ?? [];
      const offenders: string[] = [];
      for (const service of services) {
        const purposes = (service as { purposes?: unknown }).purposes;
        if (!Array.isArray(purposes) || purposes.length === 0) {
          offenders.push(service.name);
        }
      }
      if (offenders.length === 0) {
        return { passed: true, detail: 'All services declare at least one purpose.' };
      }
      return {
        passed: false,
        detail: `${offenders.length} service(s) have no \`purposes\` declared: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? `, … (${offenders.length - 5} more)` : ''}. EDPB 05/2020 § 42 requires consent to be specific per purpose. Either tag each service with at least one purpose category or remove unused entries.`,
      };
    },
  },
] as const;

/**
 * Run all checks against a config and return per-check findings.
 *
 * Pure function — no `document` access, no async. Safe to call in
 * any environment (browser, Node, headless CI). Order of results
 * matches the order of `CHECKS`.
 */
export function audit(config: SimpleCMPConfig): AuditResult[] {
  return CHECKS.map((check) => {
    const outcome = check.run(config);
    return {
      id: check.id,
      section: check.section,
      severity: outcome.passed ? 'info' : check.failSeverity,
      title: check.title,
      detail: outcome.detail,
      passed: outcome.passed,
    };
  });
}

/**
 * Severity ranking helper — `critical` > `warning` > `info`. Useful
 * when an integrator wants to pick the worst finding to surface as
 * a top-level badge.
 */
export function maxSeverity(results: readonly AuditResult[]): Severity {
  // Early return on 'critical' means later iterations don't need to
  // re-check it; `worst` is only ever 'info' or 'warning' here.
  let worst: Severity = 'info';
  for (const result of results) {
    if (result.severity === 'critical') return 'critical';
    if (result.severity === 'warning') worst = 'warning';
  }
  return worst;
}
