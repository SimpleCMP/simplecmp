/**
 * DOM-compat helpers — bridge browser-API quirks the Klaro UI relied on.
 *
 * The TS rewrite preserves Klaro semantics; once the new Lit-based UI lands
 * (REQ-14), this whole module can be slimmed down or removed (everything
 * here is UI-side glue).
 */

/**
 * Locate the `<script>` tag whose `src` includes the given marker. Klaro's
 * setup() uses this to find its own script tag in the DOM and read
 * `data-klaro-*` attributes off it.
 */
export function currentScript(name: string): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null;
  if (document.currentScript instanceof HTMLScriptElement) {
    return document.currentScript;
  }
  const scripts = document.getElementsByTagName('script');
  for (const script of Array.from(scripts)) {
    // if the script src includes the given name we hope for the best
    if (script.src.includes(name)) return script;
  }
  return null;
}

/** Read `data-*` attributes off an element into a plain object. */
export function dataset(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith('data-')) {
      out[attribute.name.slice(5)] = attribute.value;
    }
  }
  return out;
}

/** Inverse of `dataset` — write a `data-*` attribute set onto an element. */
export function applyDataset(ds: Record<string, string>, element: Element): void {
  for (const [key, value] of Object.entries(ds)) {
    // Klaro's original logic skipped writes when the property already had
    // the same value; we preserve that to avoid noisy attribute mutations.
    if ((element as unknown as Record<string, unknown>)[key] === value) continue;
    element.setAttribute(`data-${key}`, value);
  }
}

/**
 * Replace CSS Custom Properties at runtime in Klaro's `<style data-context="klaro-styles">`
 * tags. Pulls the matching declarations out of the stylesheet and re-inlines
 * them with literal values, so older browsers without `var()` support get
 * functional styling.
 *
 * Slated for removal after REQ-14 — the new Lit UI uses CSS Custom Properties
 * natively without this kind of post-processing.
 */
export function replaceCSSVariables(variables: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const elements = document.querySelectorAll('style[data-context=klaro-styles]');
  for (const element of Array.from(elements)) {
    const styleEl = element as HTMLStyleElement;
    let css = styleEl.innerText;
    // IE-era fallback (kept for parity with the original; not exercised today)
    const ieStyleSheet = (styleEl as unknown as { styleSheet?: { cssText: string } }).styleSheet;
    if (ieStyleSheet !== undefined) {
      css = ieStyleSheet.cssText;
    }
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(
        `([a-z0-9-]+):[^;]+;[\\s\\n]*\\1:\\s*var\\(--${key},\\s*[^)]+\\)`,
        'g'
      );
      css = css.replace(regex, (_, name) => `${name}: ${value}; ${name}: var(--${key}, ${value})`);
    }
    const replacement = document.createElement('style');
    replacement.setAttribute('type', 'text/css');
    replacement.setAttribute('data-context', 'klaro-styles');
    const ieReplacementSheet = (replacement as unknown as { styleSheet?: { cssText: string } })
      .styleSheet;
    if (ieReplacementSheet !== undefined) {
      ieReplacementSheet.cssText = css;
    } else {
      replacement.innerText = css;
    }
    element.parentElement?.appendChild(replacement);
    element.parentElement?.removeChild(element);
  }
}
