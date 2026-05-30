/**
 * Theme registry + DOM-injection helper for `config.theme`.
 *
 * The bundle's components ship a self-sufficient design language in
 * `tokens.ts` — that's the `'default'` theme. Integrators whose host
 * page uses a CSS framework (Bootstrap, Tailwind, …) can opt into an
 * adapter that re-binds the SimpleCMP design tokens to the host
 * framework's own custom properties, so the consent UI inherits the
 * host's colors, radii, spacing, and typography without any manual
 * stylesheet wiring.
 *
 * Adapters set `--simplecmp-*` variables only — they never reach into
 * a component's shadow root. CSS custom-property inheritance crosses
 * the shadow boundary, so a `<style>` block in `<head>` is enough.
 *
 * The registry below carries one entry per `(framework, major
 * version)` pair. Bootstrap 4 and Bootstrap 5 use different custom-
 * property schemes (no `--bs-*` prefix in 4); a future v4 adapter
 * lives next to `bootstrap5` as `bootstrap4`. Same pattern for
 * Tailwind v3 vs v4 etc. The version suffix is required so the
 * choice is unambiguous when reading a config.
 *
 * Adding a new theme:
 *   1. Drop a `<name>.ts` next to this file that exports the CSS
 *      as a string (mirrors a `<name>.css` standalone stylesheet
 *      for light-DOM consumers who prefer `<link>` over JS
 *      injection).
 *   2. Add it to the `THEMES` map and to the `Theme` union below.
 *   3. The init-time injection picks it up automatically.
 */

import { BOOTSTRAP5_THEME_CSS } from './bootstrap5.js';

/** Identifier on `<style>` so re-init can replace its own injection. */
const STYLE_ELEMENT_MARKER = 'data-simplecmp-theme';

/**
 * Themes the bundle currently ships adapter CSS for. `'default'`
 * means the component's built-in tokens apply — no adapter needed.
 * Add new framework adapters here as they're contributed.
 */
export type Theme = 'default' | 'bootstrap5';

/**
 * Adapter CSS keyed by theme name. `'default'` deliberately has no
 * entry (and falls through to a no-op in `applyThemeAdapter`).
 */
const THEMES: Partial<Record<Theme, string>> = {
  bootstrap5: BOOTSTRAP5_THEME_CSS,
};

/**
 * Inject (or remove) the theme adapter `<style>` element for the
 * chosen theme. Idempotent — re-init with a different theme swaps
 * the CSS in place; re-init with the same theme is a no-op; re-init
 * with `'default'` (or undefined) tears the previously-injected
 * adapter down so the bundle's built-in tokens win again.
 *
 * Marker attribute: `data-simplecmp-theme="<name>"`. Integrators can
 * `document.querySelector('[data-simplecmp-theme]')` if they want to
 * detect which adapter is active.
 */
export function applyThemeAdapter(theme: Theme | undefined): void {
  // SSR / Node — nothing to do. Manager creation still works in those
  // environments (headless engine surface, REQ-N2).
  if (typeof document === 'undefined') return;

  const existing = document.querySelector(`style[${STYLE_ELEMENT_MARKER}]`);

  // Default / undefined → drop any prior adapter and stop. Re-init
  // shouldn't leave a stale Bootstrap injection lying around after
  // switching back to the default register.
  if (theme === undefined || theme === 'default') {
    existing?.remove();
    return;
  }

  const css = THEMES[theme];
  if (css === undefined) {
    // Unknown theme — keep any prior adapter intact and log so the
    // misconfiguration is visible in dev/staging. Failing closed is
    // worse here: dropping the adapter would silently regress the
    // UI back to the default tokens.
    console.warn(
      `SimpleCMP: theme "${theme}" has no adapter; ignoring. ` +
        `Known themes: ${Object.keys(THEMES).join(', ')}, 'default'.`
    );
    return;
  }

  // Same theme is already injected — no DOM mutation needed.
  if (existing?.getAttribute(STYLE_ELEMENT_MARKER) === theme) return;

  const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style');
  style.setAttribute(STYLE_ELEMENT_MARKER, theme);
  style.textContent = css;
  if (!style.isConnected) {
    document.head.appendChild(style);
  }
}
