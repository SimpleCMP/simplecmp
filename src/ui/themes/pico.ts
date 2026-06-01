/**
 * Pico CSS theme adapter, as an inlinable CSS string.
 *
 * Pico v2 (the current major as of 2024) ships its design tokens as
 * CSS custom properties under the `--pico-*` prefix. The naming is
 * stable across the v2 series; if Pico 3 changes the prefix this
 * adapter splits into `pico1` / `pico2` at that point. For now,
 * unversioned `pico` is the right name.
 *
 * Pico is heavy on the "classless" idea — there's no
 * `--pico-primary-hover` pair like Bootstrap has, just `--pico-
 * primary` and `--pico-primary-hover` (Pico's own naming). The
 * adapter binds 1:1 where Pico exposes a counterpart and falls
 * back to sensible literals otherwise.
 *
 * Mirrors `src/ui/styles/pico.css` — the file consumers `<link>`
 * when running in light-DOM mode without the new init-time
 * injection. Keep both in sync.
 */
export const PICO_THEME_CSS = `:where(
    simplecmp-banner,
    simplecmp-modal,
    simplecmp-purpose-group,
    simplecmp-service-toggle,
    simplecmp-trigger,
    simplecmp-policy-links,
    simplecmp-contextual-notice
  ) {
  /* Colors. Pico exposes a primary palette via --pico-primary and
     --pico-primary-hover for hover states; both are stable in v2.
     Background pair: --pico-background-color is the body / card,
     --pico-card-background-color is what cards specifically use
     (slightly elevated). Text follows the same pattern with
     --pico-color and --pico-muted-color. */
  --simplecmp-color-primary: var(--pico-primary, #0172ad);
  --simplecmp-color-primary-hover: var(--pico-primary-hover, #015887);
  --simplecmp-color-secondary: var(--pico-secondary, #5d6b89);
  --simplecmp-color-danger: var(--pico-del-color, #c62828);
  --simplecmp-color-bg: var(--pico-card-background-color, var(--pico-background-color, #ffffff));
  --simplecmp-color-bg-alt: var(--pico-card-sectioning-background-color, #f9f9f9);
  --simplecmp-color-border: var(--pico-muted-border-color, #e1e6eb);
  --simplecmp-color-text: var(--pico-color, #373c44);
  --simplecmp-color-text-muted: var(--pico-muted-color, #646b79);

  /* Geometry */
  --simplecmp-radius: var(--pico-border-radius, 0.25rem);
  --simplecmp-spacing: var(--pico-spacing, 1rem);
  --simplecmp-spacing-sm: calc(var(--pico-spacing, 1rem) * 0.5);
  --simplecmp-spacing-lg: calc(var(--pico-spacing, 1rem) * 1.5);

  /* Typography */
  --simplecmp-font-family: var(--pico-font-family, system-ui);
  --simplecmp-font-size: var(--pico-font-size, 1rem);
  --simplecmp-font-size-sm: calc(var(--pico-font-size, 1rem) * 0.875);
  --simplecmp-line-height: var(--pico-line-height, 1.5);

  /* Effects */
  --simplecmp-shadow: var(--pico-card-box-shadow, 0 0.125rem 1rem rgba(0, 0, 0, 0.04));
}
`;
