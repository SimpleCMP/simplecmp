/**
 * Tailwind 4 theme adapter, as an inlinable CSS string.
 *
 * Tailwind 4 (March 2025) ships its design tokens as actual CSS
 * custom properties via the `@theme` directive — `--color-*`,
 * `--text-*`, `--radius-*`, `--spacing`, `--font-*`, `--leading-*`,
 * `--shadow-*`. That's a clean surface to bind SimpleCMP's own
 * tokens against.
 *
 * Mirrors `src/ui/styles/tailwind4.css` — the file consumers `<link>`
 * when running in light-DOM mode without the new init-time injection.
 * The string form lets `init({ theme: 'tailwind4' })` insert the same
 * rules into the host page's `<head>` from JS, so integrators don't
 * have to remember to wire the stylesheet by hand.
 *
 * **Naming:** the `4` suffix is deliberate. Tailwind 3 used a
 * fundamentally different theming approach (`tailwind.config.js`,
 * Sass-driven, no CSS custom properties by default) — a Tailwind 3
 * adapter would have nothing to bind against and lives in a separate
 * world. Same pattern as `bootstrap4` vs `bootstrap5`.
 *
 * **Semantic vs. palette tokens:** Tailwind 4 ships the *utility-scale*
 * tokens (full palette, full text/radius/spacing scales) but no
 * semantic ones like `--color-primary`. Sites that want the consent
 * UI to look on-brand define those in their own `@theme`:
 *
 *   @theme {
 *     --color-primary: oklch(0.59 0.24 264);
 *     --color-background: oklch(1 0 0);
 *     ...
 *   }
 *
 * This adapter pulls the semantic name first and falls back to a
 * sensible palette default (Tailwind's slate/blue defaults), so the
 * banner still looks coherent on sites that haven't curated brand
 * tokens yet. The fallback chain follows the conventions shadcn/ui
 * and similar Tailwind-ecosystem libraries use, which is the
 * de-facto standard for semantic tokens in Tailwind 4 today.
 *
 * **Drift warning:** keep this string in sync with
 * `src/ui/styles/tailwind4.css`. The standalone file remains for
 * consumers who prefer to `<link>` rather than init with a `theme`
 * config field.
 */
export const TAILWIND4_THEME_CSS = `:where(
    simplecmp-banner,
    simplecmp-modal,
    simplecmp-purpose-group,
    simplecmp-service-toggle,
    simplecmp-trigger,
    simplecmp-policy-links,
    simplecmp-contextual-notice
  ) {
  /* Colors — semantic first, Tailwind palette fallback chain. The
     semantic names (--color-primary, --color-background, …) follow
     the shadcn/ui convention which is the de-facto standard for
     Tailwind 4 semantic tokens. Sites that don't define them get
     the palette default (Tailwind's blue/slate). */
  --simplecmp-color-primary: var(--color-primary, var(--color-blue-600, #2563eb));
  --simplecmp-color-primary-hover: var(--color-primary-hover, var(--color-blue-700, #1d4ed8));
  --simplecmp-color-secondary: var(--color-secondary, var(--color-slate-500, #64748b));
  --simplecmp-color-danger: var(--color-destructive, var(--color-red-600, #dc2626));
  --simplecmp-color-bg: var(--color-background, var(--color-white, #ffffff));
  --simplecmp-color-bg-alt: var(--color-muted, var(--color-slate-50, #f8fafc));
  --simplecmp-color-border: var(--color-border, var(--color-slate-200, #e2e8f0));
  --simplecmp-color-text: var(--color-foreground, var(--color-slate-900, #0f172a));
  --simplecmp-color-text-muted: var(--color-muted-foreground, var(--color-slate-500, #64748b));

  /* Geometry. Tailwind 4 spacing is computed: gap-4 → calc(--spacing * 4).
     We pin --simplecmp-spacing to ~1rem (the visual rhythm the banner
     was designed for) by multiplying the base unit by 4 — which lands
     at 1rem under Tailwind's default 0.25rem base. Sites that scale
     --spacing up/down keep the banner consistent with their rhythm. */
  --simplecmp-radius: var(--radius-md, 0.375rem);
  --simplecmp-spacing: calc(var(--spacing, 0.25rem) * 4);
  --simplecmp-spacing-sm: calc(var(--spacing, 0.25rem) * 2);
  --simplecmp-spacing-lg: calc(var(--spacing, 0.25rem) * 6);

  /* Typography */
  --simplecmp-font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
  --simplecmp-font-size: var(--text-base, 1rem);
  --simplecmp-font-size-sm: var(--text-sm, 0.875rem);
  --simplecmp-line-height: var(--leading-normal, 1.5);

  /* Effects */
  --simplecmp-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1));
}
`;
