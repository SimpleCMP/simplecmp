/**
 * Bootstrap 5 theme adapter, as an inlinable CSS string.
 *
 * Mirrors `src/ui/styles/bootstrap5.css` — the file consumers `<link>`
 * when running in light-DOM mode without the new init-time injection.
 * The string form lets `init({ theme: 'bootstrap5' })` insert the same
 * rules into the host page's `<head>` from JS, so integrators don't
 * have to remember to wire the stylesheet by hand.
 *
 * Why this works through Shadow DOM: CSS custom properties cross the
 * shadow boundary by inheritance. The rules below only set
 * `--simplecmp-*` variables on the component tag selectors — those
 * variables are then consumed by `tokens.ts` inside each component's
 * `static styles`. No selectors need to reach inside the shadow root.
 *
 * `:where()` keeps the specificity at zero so any consumer override
 * via inline style or higher-specificity rule wins as expected.
 *
 * **Drift warning:** keep this string in sync with
 * `src/ui/styles/bootstrap5.css`. The standalone file remains for
 * consumers who prefer to `<link>` rather than init with a `theme`
 * config field.
 *
 * **Naming:** the `5` suffix is deliberate. Bootstrap 4 used a
 * different custom-property scheme (no `--bs-*` prefix, separate
 * `--orange`, `--blue`, etc.). When a `bootstrap4` adapter is added
 * later it lives next to this one as `src/ui/themes/bootstrap4.ts`
 * with its own mapping.
 */
export const BOOTSTRAP5_THEME_CSS = `:where(
    simplecmp-banner,
    simplecmp-modal,
    simplecmp-purpose-group,
    simplecmp-service-toggle,
    simplecmp-trigger,
    simplecmp-policy-links,
    simplecmp-contextual-notice
  ) {
  /* Colors */
  --simplecmp-color-primary: var(--bs-primary, #0d6efd);
  --simplecmp-color-primary-hover: var(--bs-primary-bg-subtle, #084298);
  --simplecmp-color-secondary: var(--bs-secondary, #6c757d);
  --simplecmp-color-danger: var(--bs-danger, #dc3545);
  --simplecmp-color-bg: var(--bs-body-bg, #ffffff);
  --simplecmp-color-bg-alt: var(--bs-tertiary-bg, #f8f9fa);
  --simplecmp-color-border: var(--bs-border-color, #dee2e6);
  --simplecmp-color-text: var(--bs-body-color, #212529);
  --simplecmp-color-text-muted: var(--bs-secondary-color, #6c757d);

  /* Geometry */
  --simplecmp-radius: var(--bs-border-radius, 0.375rem);
  --simplecmp-spacing: var(--bs-spacer, 1rem);
  --simplecmp-spacing-sm: 0.5rem;
  --simplecmp-spacing-lg: 1.5rem;

  /* Typography */
  --simplecmp-font-family: var(--bs-body-font-family, system-ui);
  --simplecmp-font-size: var(--bs-body-font-size, 1rem);
  --simplecmp-font-size-sm: 0.875rem;
  --simplecmp-line-height: var(--bs-body-line-height, 1.5);

  /* Effects */
  --simplecmp-shadow: var(--bs-box-shadow, 0 0.5rem 1rem rgba(0, 0, 0, 0.15));
}`;
