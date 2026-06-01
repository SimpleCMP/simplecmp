/**
 * Heuristic compliance checks.
 *
 * The strict checks in `src/audit/index.ts` grade configuration
 * properties that have a clean pass/fail decision (URL set or not,
 * service flag true or false). The dark-pattern landscape also has
 * a softer surface — manipulative wording, vague labels, marketing
 * nudges — that catches by pattern-match against the text the
 * banner shows. The matches are heuristic, sometimes noisy; this
 * module never returns `'critical'`. Findings surface as
 * `'warning'` and are explicit about what was matched and why so an
 * editor can dismiss false positives with a tone judgement.
 *
 * Two checks ship initially:
 *
 *   - `heuristic-decline-label-clarity` — flags weak / deferring
 *     decline labels ("Maybe later", "Vielleicht später", "Skip",
 *     …). The classic example: an editor overrides the bundle's
 *     "Reject all" with "Maybe later" thinking it's more polite.
 *     Polite, but no longer a refusal — EDPB 03/2022 § Skipping
 *     treats deferring-as-decline as deceptive.
 *
 *   - `heuristic-no-marketing-nudge-in-description` — flags banner
 *     description copy that uses marketing language to push the
 *     visitor toward accepting ("Improve your experience",
 *     "Trusted partners", "Volle Funktionalität"). Per EDPB
 *     03/2022 § Stirring and CNIL recommendation 17.09.2020.
 *
 * Pattern lists are per-language. German + English ship initially —
 * languages with shipped translation packs that haven't been seeded
 * with patterns get an empty list (= every check passes). Adding a
 * new language is a data-only change here.
 */

import type { SimpleCMPConfig } from '../index.js';
import type { CheckOutcome } from './index.js';

interface Pattern {
  /** Lowercased substring to match against the banner text. */
  phrase: string;
  /** Short explanation that's appended to the finding detail. */
  reason: string;
}

/**
 * Decline-label phrases that read as deferral rather than refusal.
 * An editor who picks one of these has probably traded compliance
 * for niceness — surface the trade-off so they can confirm or
 * revert.
 */
const WEAK_DECLINE_PATTERNS: Record<string, readonly Pattern[]> = {
  de: [
    { phrase: 'vielleicht später', reason: 'verschiebt die Entscheidung statt sie zu treffen' },
    { phrase: 'nicht jetzt', reason: 'klingt aufschiebend, nicht ablehnend' },
    { phrase: 'überspringen', reason: 'klingt nach „später", nicht „nein"' },
    { phrase: 'schließen', reason: 'beschreibt eine UI-Aktion, nicht eine Ablehnung' },
    { phrase: 'weiter ohne', reason: 'unklar — was genau wird abgelehnt?' },
  ],
  en: [
    { phrase: 'maybe later', reason: 'defers instead of refuses' },
    { phrase: 'not now', reason: 'sounds like postponement, not refusal' },
    { phrase: 'skip', reason: 'reads as "later", not "no"' },
    { phrase: 'close', reason: 'describes a UI action, not a rejection' },
    { phrase: 'continue without', reason: 'ambiguous — what is actually being rejected?' },
    { phrase: 'remind me later', reason: 'defers instead of refuses' },
  ],
  fr: [
    { phrase: 'plus tard', reason: 'reporte au lieu de refuser' },
    { phrase: 'pas maintenant', reason: 'sonne comme un report, pas un refus' },
    { phrase: 'fermer', reason: 'décrit une action UI, pas un refus' },
  ],
  it: [
    { phrase: 'più tardi', reason: 'rimanda invece di rifiutare' },
    { phrase: 'non ora', reason: 'suona come un rinvio, non un rifiuto' },
    { phrase: 'chiudi', reason: "descrive un'azione UI, non un rifiuto" },
  ],
  es: [
    { phrase: 'más tarde', reason: 'aplaza en lugar de rechazar' },
    { phrase: 'ahora no', reason: 'suena como aplazamiento, no rechazo' },
    { phrase: 'cerrar', reason: 'describe una acción UI, no un rechazo' },
  ],
  nl: [
    { phrase: 'later', reason: 'verschuift de keuze in plaats van te weigeren' },
    { phrase: 'niet nu', reason: 'klinkt als uitstel, geen weigering' },
    { phrase: 'sluiten', reason: 'beschrijft een UI-actie, geen weigering' },
    { phrase: 'overslaan', reason: 'klinkt als "later", niet "nee"' },
  ],
};

/**
 * Phrases in the banner description that nudge toward acceptance.
 * Marketing language has no place in a consent banner; the EDPB
 * Guidelines 03/2022 (Stirring) and the CNIL recommendation of
 * 17.09.2020 both flag this pattern explicitly. The phrases listed
 * are the most-recognised dark-pattern formulations across the four
 * shipped DACH-adjacent locales — operators with niche
 * formulations can disagree, and the warning detail names the
 * matched phrase so they can.
 */
const MARKETING_NUDGE_PATTERNS: Record<string, readonly Pattern[]> = {
  de: [
    { phrase: 'erlebnis verbessern', reason: '„Erlebnis" ist Marketing-Sprache' },
    { phrase: 'verbessere dein erlebnis', reason: 'manipulativer Nudge zur Zustimmung' },
    { phrase: 'verbessern sie ihr erlebnis', reason: 'manipulativer Nudge zur Zustimmung' },
    { phrase: 'volle funktionalität', reason: 'suggeriert eingeschränkten Service bei Ablehnung' },
    { phrase: 'volles erlebnis', reason: 'suggeriert eingeschränkten Service bei Ablehnung' },
    { phrase: 'vertrauensvolle partner', reason: 'vage — benenne die Verantwortlichen' },
    { phrase: 'optimal erleben', reason: '„optimal" ist subjektiv und manipulativ' },
    { phrase: 'personalisieren sie ihren besuch', reason: 'Marketing-Nudge zur Zustimmung' },
    { phrase: 'personalisiere deinen besuch', reason: 'Marketing-Nudge zur Zustimmung' },
  ],
  en: [
    { phrase: 'improve your experience', reason: 'marketing nudge toward acceptance' },
    { phrase: 'enhance your experience', reason: 'marketing nudge toward acceptance' },
    { phrase: 'get the full experience', reason: 'suggests degraded service on refusal' },
    { phrase: 'full functionality', reason: 'suggests degraded service on refusal' },
    { phrase: 'trusted partners', reason: 'vague — name the controllers' },
    { phrase: 'personalize your visit', reason: 'marketing nudge toward acceptance' },
    { phrase: 'continue to enjoy', reason: 'marketing nudge' },
    { phrase: 'tailored experience', reason: 'marketing nudge toward acceptance' },
  ],
  fr: [
    { phrase: 'meilleure expérience', reason: 'langage marketing, pousse vers l’acceptation' },
    { phrase: 'expérience optimale', reason: '« optimal » est subjectif et manipulateur' },
    { phrase: 'partenaires de confiance', reason: 'vague — nommer les responsables' },
    { phrase: 'personnaliser votre visite', reason: 'nudge marketing vers l’acceptation' },
  ],
  it: [
    { phrase: 'migliore esperienza', reason: 'linguaggio marketing, spinge verso l’accettazione' },
    { phrase: 'esperienza ottimale', reason: '«ottimale» è soggettivo e manipolativo' },
    { phrase: 'partner di fiducia', reason: 'vago — nominare i titolari' },
    { phrase: 'personalizza la tua visita', reason: 'nudge marketing verso l’accettazione' },
  ],
  es: [
    { phrase: 'mejor experiencia', reason: 'lenguaje marketing, empuja hacia la aceptación' },
    { phrase: 'experiencia óptima', reason: '«óptima» es subjetiva y manipuladora' },
    { phrase: 'socios de confianza', reason: 'vago — nombrar los responsables' },
    { phrase: 'personalizar tu visita', reason: 'nudge marketing hacia la aceptación' },
  ],
  nl: [
    { phrase: 'betere ervaring', reason: 'marketingtaal, duwt richting acceptatie' },
    { phrase: 'optimale ervaring', reason: '"optimaal" is subjectief en manipulatief' },
    { phrase: 'vertrouwde partners', reason: 'vaag — noem de verwerkingsverantwoordelijken' },
    { phrase: 'personaliseer je bezoek', reason: 'marketingnudge richting acceptatie' },
  ],
};

/**
 * Walk the per-language translation tree and pull a string at a
 * dotted path (e.g. `consentNotice.description`). Returns the
 * concrete string for each language that has both an override and
 * a non-empty value at that path.
 */
function collectTranslations(
  config: SimpleCMPConfig,
  path: readonly string[]
): Array<{ lang: string; text: string }> {
  const trans = config.translations as Record<string, unknown> | undefined;
  if (typeof trans !== 'object' || trans === null) return [];
  const out: Array<{ lang: string; text: string }> = [];
  for (const [lang, branch] of Object.entries(trans)) {
    if (typeof branch !== 'object' || branch === null) continue;
    let node: unknown = branch;
    for (const segment of path) {
      if (typeof node !== 'object' || node === null) {
        node = undefined;
        break;
      }
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node === 'string' && node.trim() !== '') {
      out.push({ lang, text: node });
    }
  }
  return out;
}

/**
 * Match `text` against the patterns shipped for `lang`. Returns the
 * first pattern hit (and only the first — repeated phrases would
 * just clutter the detail without adding information) or `null`.
 */
function findPatternHit(
  patterns: Record<string, readonly Pattern[]>,
  lang: string,
  text: string
): Pattern | null {
  const list = patterns[lang.toLowerCase()];
  if (list === undefined) return null;
  const haystack = text.toLowerCase();
  for (const pattern of list) {
    if (haystack.includes(pattern.phrase)) return pattern;
  }
  return null;
}

/**
 * Run the decline-label heuristic across every language the config
 * carries an override for. Returns a single `CheckOutcome`:
 * passing if no overrides match the weak-decline pattern list,
 * failing otherwise with a per-language hit summary in the detail.
 */
export function checkDeclineLabelClarity(config: SimpleCMPConfig): CheckOutcome {
  const declines = collectTranslations(config, ['decline']);
  const hits: string[] = [];
  for (const { lang, text } of declines) {
    const hit = findPatternHit(WEAK_DECLINE_PATTERNS, lang, text);
    if (hit !== null) {
      hits.push(`[${lang}] "${text}" — ${hit.reason}`);
    }
  }
  if (hits.length === 0) {
    return {
      passed: true,
      detail: 'Reject button labels read as clear refusal across all configured languages.',
    };
  }
  return {
    passed: false,
    detail: `Reject button label(s) read as deferral or postponement instead of refusal, which EDPB 03/2022 § Skipping treats as deceptive design. Affected language(s):\n  - ${hits.join('\n  - ')}`,
  };
}

/**
 * Length thresholds for the banner-description heuristic. These are
 * deliberately wide: descriptions below the floor almost certainly
 * fail the "informed" prong of valid consent (Art. 6(1)(a) GDPR +
 * EDPB 05/2020), while descriptions above the ceiling risk EDPB
 * 03/2022 § Overloading. Editors with edge-case content can read
 * the matched length in the finding detail and confirm or revert.
 */
const DESCRIPTION_MIN_CHARS = 80;
const DESCRIPTION_MAX_CHARS = 600;

/**
 * Run the description-length heuristic across every banner
 * description the config overrides. Flags two failure modes in
 * one combined finding:
 *
 *   - **Too short** (< 80 chars): the description likely can't
 *     carry both the purpose enumeration AND the controller-
 *     identification the "informed" prong of valid consent
 *     requires. Common pattern: an editor reduces the banner to
 *     a one-liner "Wir nutzen Cookies." — technically truthful,
 *     legally insufficient.
 *   - **Too long** (> 600 chars): risks Overloading (EDPB 03/2022).
 *     Visitors stop reading walls of text, and an audit-banner
 *     that nobody reads isn't an informed consent prompt.
 *
 * `{purposes}` placeholders in the source text expand at runtime;
 * the heuristic counts the literal override length, not the
 * post-expansion length. An editor who keeps the placeholder
 * usually lands well inside the thresholds.
 */
export function checkDescriptionLength(config: SimpleCMPConfig): CheckOutcome {
  const descriptions = collectTranslations(config, ['consentNotice', 'description']);
  const issues: string[] = [];
  for (const { lang, text } of descriptions) {
    const len = text.length;
    if (len < DESCRIPTION_MIN_CHARS) {
      issues.push(
        `[${lang}] ${len} chars — below the ${DESCRIPTION_MIN_CHARS}-char floor; likely doesn’t carry the purpose enumeration + controller info "informed" consent needs.`
      );
    } else if (len > DESCRIPTION_MAX_CHARS) {
      issues.push(
        `[${lang}] ${len} chars — above the ${DESCRIPTION_MAX_CHARS}-char ceiling; risks EDPB 03/2022 § Overloading. Trim to the essentials or move detail into the modal.`
      );
    }
  }
  if (issues.length === 0) {
    return {
      passed: true,
      detail: 'Banner descriptions sit in the informative-but-readable range across languages.',
    };
  }
  return {
    passed: false,
    detail:
      `Banner description length is outside the recommended range (${DESCRIPTION_MIN_CHARS}–` +
      `${DESCRIPTION_MAX_CHARS} chars). Affected language(s):\n  - ${issues.join('\n  - ')}`,
  };
}

/**
 * Run the marketing-nudge heuristic across every banner description
 * the config overrides. Same single-outcome shape as the decline
 * check.
 */
export function checkNoMarketingNudgeInDescription(config: SimpleCMPConfig): CheckOutcome {
  const descriptions = collectTranslations(config, ['consentNotice', 'description']);
  const hits: string[] = [];
  for (const { lang, text } of descriptions) {
    const hit = findPatternHit(MARKETING_NUDGE_PATTERNS, lang, text);
    if (hit !== null) {
      hits.push(`[${lang}] "${hit.phrase}" — ${hit.reason}`);
    }
  }
  if (hits.length === 0) {
    return {
      passed: true,
      detail: 'Banner descriptions stay clear of marketing-nudge language.',
    };
  }
  return {
    passed: false,
    detail: `Banner description(s) contain marketing-nudge phrases that push the visitor toward accepting — EDPB 03/2022 § Stirring + CNIL 17.09.2020 flag this as deceptive design. Affected phrase(s):\n  - ${hits.join('\n  - ')}`,
  };
}
