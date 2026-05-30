/**
 * Informal-tone translation overlays.
 *
 * For languages with a T/V distinction (du/Sie, tu/vous, tu/usted, …) some
 * sites prefer the informal register — younger / consumer brands, lifestyle
 * publishers, anything with a casual voice. The bundle's main translation
 * packs (`../<lang>.json`) ship the formal register because it's the safe
 * default for legal-adjacent UI; this directory holds sparse overlays that
 * an integrator can opt into via the per-config `tones` field:
 *
 *   simplecmp.init({
 *     tones: { de: 'informal' },
 *     ...
 *   });
 *
 * The overlay only carries the strings that actually change tone. Anything
 * absent falls through to the formal pack, then to `fallbackLang` — same
 * resolution chain as before, the tone overlay just sits between the
 * bundled defaults and the consumer's `config.translations`.
 *
 * Adding a new informal pack:
 *   1. Drop `<lang>.json` here containing only the dotted keys that
 *      differ from the formal register.
 *   2. Add an `import` line below and the language code in the export.
 *   3. The engine will surface it the moment a config sets
 *      `tones: { <lang>: 'informal' }`.
 */

import de from './de.json';

const informalPacks: Record<string, Record<string, unknown>> = {
  de,
};

export default informalPacks;