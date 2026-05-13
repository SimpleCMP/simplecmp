/**
 * Bundled translation packs (REQ-15 / Stage E).
 *
 * One JSON per language. The build pipeline used to inline these from
 * YAML at compile time via a custom esbuild plugin; converting to JSON
 * lets us drop both the `js-yaml` build-time dep and the bespoke
 * Vite/esbuild plugins. TypeScript's `resolveJsonModule` handles the
 * imports natively.
 *
 * Adding a new language:
 *   1. Drop a `<lang>.json` in this directory.
 *   2. Add an `import` line below.
 *   3. Add the language code to the default-export object.
 *
 * Each pack is the same shape — strings keyed by the i18n paths the UI
 * components use (e.g. `consentNotice.description`, `purposes.<id>.title`).
 * Klaro's English file is the canonical reference; missing keys fall back
 * to English at runtime via the `fallbackLang` config.
 *
 * Note: Klaro's upstream `hu.yml` is malformed (bad indentation at
 * 54:103). It ships here as `{}`, falling through to English. Fix
 * upstream before adding a real Hungarian pack.
 */

import bg from './bg.json';
import ca from './ca.json';
import cs from './cs.json';
import da from './da.json';
import de from './de.json';
import el from './el.json';
import en from './en.json';
import es from './es.json';
import fi from './fi.json';
import fr from './fr.json';
import gl from './gl.json';
import hr from './hr.json';
import hu from './hu.json';
import it from './it.json';
import nl from './nl.json';
import no from './no.json';
import oc from './oc.json';
import pl from './pl.json';
import pt from './pt.json';
import ro from './ro.json';
import ru from './ru.json';
import sr from './sr.json';
import sr_cyrl from './sr_cyrl.json';
import sv from './sv.json';
import tr from './tr.json';
import zh from './zh.json';

const bundledTranslations: Record<string, Record<string, unknown>> = {
  bg,
  ca,
  cs,
  da,
  de,
  el,
  en,
  es,
  fi,
  fr,
  gl,
  hr,
  hu,
  it,
  nl,
  no,
  oc,
  pl,
  pt,
  ro,
  ru,
  sr,
  sr_cyrl,
  sv,
  tr,
  zh,
};

export default bundledTranslations;
