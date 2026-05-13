/**
 * UI ↔ engine translation bridge.
 *
 * The engine's `t()` (in `src/engine/utils/i18n.ts`) takes the Map +
 * language + fallback as explicit arguments — that signature was shaped
 * by the Klaro JSX call sites. Lit components want a closure-style
 * helper they can store as a property and call with just the key.
 *
 * `bindTranslator()` returns such a closure for a given config; the new
 * UI components hold a reference and call `this._t('purposes.<id>.title')`.
 */
import { getConfigTranslations, language as resolveLanguage } from '../engine/index.js';
import type { ConsentConfig } from '../engine/index.js';
import { t as engineT } from '../engine/utils/i18n.js';

export type Translator = (key: string | string[], ...params: unknown[]) => unknown;

/**
 * Build a translator bound to the given config's translations + active
 * language. Components re-call this when their `config` property changes.
 */
export function bindTranslator(config: ConsentConfig): Translator {
  const translations = getConfigTranslations(config);
  const lang = resolveLanguage(config);
  const fallback = config.fallbackLang ?? 'zz';
  return (key, ...params) => engineT(translations, lang, fallback, key, ...params);
}

/**
 * Best-effort string coercion for translator output. The engine's `t()`
 * returns either `string | unknown[]` (the array form preserves JSX/DOM
 * nodes interleaved with text). For Lit `${...}` interpolation we want
 * a renderable value — strings and arrays both render natively, so we
 * pass through unchanged.
 */
export function toRenderable(value: unknown): unknown {
  return value;
}
