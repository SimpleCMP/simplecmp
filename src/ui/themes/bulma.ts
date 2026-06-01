/**
 * Bulma theme adapter, as an inlinable CSS string.
 *
 * Bulma 1.0 (March 2024) introduced a full `--bulma-*` custom-
 * property layer covering colors, radius, spacing and typography.
 * The adapter binds SimpleCMP's `--simplecmp-*` tokens to those
 * variables so a consent banner on a Bulma site inherits the
 * host's palette automatically.
 *
 * **Naming:** unlike Bootstrap and Tailwind, Bulma keeps the
 * variable surface consistent across versions — the `--bulma-*`
 * prefix landed in 1.0 and the maintainer has signalled the
 * names are stable going forward. No version suffix is needed
 * yet; if Bulma 2.x changes the scheme this adapter can split
 * into `bulma1` / `bulma2` at that point.
 *
 * Mirrors `src/ui/styles/bulma.css` — the file consumers `<link>`
 * when running in light-DOM mode without the new init-time
 * injection. The string form lets `init({ theme: 'bulma' })`
 * insert the same rules into the host page's `<head>` from JS, so
 * integrators don't have to wire the stylesheet by hand.
 *
 * **Drift warning:** keep this string in sync with
 * `src/ui/styles/bulma.css`.
 */
export const BULMA_THEME_CSS = `:where(
    simplecmp-banner,
    simplecmp-modal,
    simplecmp-purpose-group,
    simplecmp-service-toggle,
    simplecmp-trigger,
    simplecmp-policy-links,
    simplecmp-contextual-notice
  ) {
  /* Colors — bind to Bulma's semantic palette. Hover falls back to
     a literal (Bulma offers a generated --bulma-primary-base for
     hover/dark adjustments but it's not always present on every
     theme; the literal #1e6cbf is Bulma's default primary darkened
     by ~12% for a sensible hover treatment). */
  --simplecmp-color-primary: var(--bulma-primary, #485fc7);
  --simplecmp-color-primary-hover: var(--bulma-primary-30-invert, var(--bulma-primary-dark, #1e6cbf));
  --simplecmp-color-secondary: var(--bulma-text-weak, #6c757d);
  --simplecmp-color-danger: var(--bulma-danger, #f14668);
  --simplecmp-color-bg: var(--bulma-scheme-main, #ffffff);
  --simplecmp-color-bg-alt: var(--bulma-scheme-main-bis, #fafafa);
  --simplecmp-color-border: var(--bulma-border, #ededed);
  --simplecmp-color-text: var(--bulma-text-strong, #2c2c2c);
  --simplecmp-color-text-muted: var(--bulma-text-weak, #6e6e6e);

  /* Geometry. Bulma exposes --bulma-radius for normal corners,
     and -small / -large for the rest. We pick the medium for
     buttons/cards. Spacing uses --bulma-block-spacing which Bulma
     1.0 sets to 1.5rem (closer to card-internal feel than the
     smaller 0.5rem element padding). */
  --simplecmp-radius: var(--bulma-radius, 4px);
  --simplecmp-spacing: var(--bulma-block-spacing, 1.5rem);
  --simplecmp-spacing-sm: 0.5rem;
  --simplecmp-spacing-lg: 2rem;

  /* Typography */
  --simplecmp-font-family: var(--bulma-family-primary, system-ui);
  --simplecmp-font-size: var(--bulma-size-normal, 1rem);
  --simplecmp-font-size-sm: var(--bulma-size-small, 0.875rem);
  --simplecmp-line-height: var(--bulma-body-line-height, 1.5);

  /* Effects */
  --simplecmp-shadow: var(--bulma-shadow, 0 0.5em 1em -0.125em rgba(10, 10, 10, 0.1));
}
`;
