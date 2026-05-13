/**
 * Translation lookup + string formatting. Used by the (legacy) Klaro UI
 * components and re-used by the new Lit components until REQ-15 lands the
 * JSON-based translations module.
 *
 * The `Map<unknown, unknown>` shape comes from `convertToMap()` — each
 * language is a Map of arbitrary depth.
 */

/** Loose config shape — only the language-related fields matter here. */
export interface I18nConfigLike {
  lang?: string;
  languages?: string[];
}

/** Augmented Window with Klaro's optional `language` global. */
interface WindowWithLanguage {
  language?: string;
}

/**
 * Format a translation string. `{0}` / `{1}` get positional args;
 * `{name}` get keyed args. Returns an array because args may include JSX
 * elements / DOM nodes — the caller stitches them back together.
 *
 * Preserved from the Klaro original; the inscrutable `n != n`-NaN-check
 * is intentional (positional args are numeric).
 */
function format(str: string, ...rest: unknown[]): unknown[] {
  const head = rest[0];
  let args: Record<string | number, unknown>;
  if (rest.length === 0) {
    args = {};
  } else if (typeof head === 'string' || typeof head === 'number') {
    args = Array.prototype.slice.call(rest) as Record<number, unknown>;
  } else {
    args = (head ?? {}) as Record<string, unknown>;
  }

  const splits: unknown[] = [];
  let s = String(str);
  while (s.length > 0) {
    const m = s.match(/\{(?!\{)([\w\d]+)\}(?!\})/);
    if (m === null || m.index === undefined || m[1] === undefined) {
      splits.push(s);
      s = '';
      break;
    }
    const left = s.substring(0, m.index);
    s = s.substring(m.index + m[0].length);
    splits.push(left);
    const n = Number.parseInt(m[1], 10);
    if (Number.isNaN(n)) {
      splits.push(args[m[1]]);
    } else {
      splits.push(args[n]);
    }
  }
  return splits;
}

/**
 * Resolve the active language code from config + browser hints + fallback.
 * Strips region from BCP-47 codes (`de-DE` → `de`).
 */
export function language(config?: I18nConfigLike): string {
  if (config?.lang !== undefined && config.lang !== 'zz') return config.lang;
  const win = typeof window !== 'undefined' ? (window as unknown as WindowWithLanguage) : undefined;
  const docLang = typeof document !== 'undefined' ? document.documentElement.lang : undefined;
  const fallbackFromConfig = config?.languages?.[0];
  const lang = (
    (typeof win?.language === 'string' ? win.language : null) ||
    docLang ||
    fallbackFromConfig ||
    'en'
  ).toLowerCase();
  const regex = /^([\w]+)-([\w]+)$/;
  const result = regex.exec(lang);
  if (result === null || result[1] === undefined) return lang;
  return result[1];
}

/** Walk a key path through a nested Map / object structure. */
function hget(d: unknown, key: string | string[], defaultValue?: string): string | undefined {
  const kl = Array.isArray(key) ? key : [key];
  let cv: unknown = d;
  for (const part of kl) {
    if (cv === undefined) return defaultValue;
    if (typeof part === 'string' && part.endsWith('?')) {
      // optional segment: only descend if a string is found
      const trimmed = part.slice(0, -1);
      const cvn = cv instanceof Map ? cv.get(trimmed) : (cv as Record<string, unknown>)[trimmed];
      if (typeof cvn === 'string') {
        cv = cvn;
      }
    } else if (cv instanceof Map) {
      cv = cv.get(part);
    } else if (cv !== null && typeof cv === 'object') {
      cv = (cv as Record<string, unknown>)[part];
    } else {
      return defaultValue;
    }
  }
  if (typeof cv !== 'string') return defaultValue;
  // Klaro convention: empty string means "translation missing"
  if (cv === '') return undefined;
  return cv;
}

/**
 * Translate a key against `trans` (a `Map<lang, Map<...>>`) for the active
 * `lang`, optionally falling back to `fallbackLang`. Prefix the key with
 * `'!'` to return `undefined` instead of a `[missing translation: ...]`
 * placeholder.
 */
export function t(
  trans: Map<unknown, unknown>,
  lang: string,
  fallbackLang: string | undefined,
  key: string | string[],
  ...params: unknown[]
): unknown {
  let kl: string | string[] = key;
  let returnUndefined = false;
  if (kl[0] === '!') {
    kl = kl.slice(1);
    returnUndefined = true;
  }
  if (!Array.isArray(kl)) kl = [kl];
  let value = hget(trans, [lang, ...kl]);
  if (value === undefined && fallbackLang !== undefined) {
    value = hget(trans, [fallbackLang, ...kl]);
  }
  if (value === undefined) {
    if (returnUndefined) return undefined;
    return [`[missing translation: ${lang}/${kl.join('/')}]`];
  }
  if (params.length > 0) return format(value, ...params);
  return value;
}
