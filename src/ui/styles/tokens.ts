/**
 * SimpleCMP default design tokens.
 *
 * Components fold these into their own `static styles`. Hosts override the
 * tokens via plain CSS on the component tag:
 *
 *   simplecmp-banner { --simplecmp-color-primary: #ff6600; }
 *
 * and the `config.theme` framework adapters (src/ui/themes/) do the same,
 * mapping `--bs-*` / Tailwind / Bulma / Pico variables onto `--simplecmp-*`.
 *
 * ## Why there are two exports
 *
 * Custom properties inherit across the shadow boundary, so an override set
 * on a top-level component's host (by a tag selector or an adapter) is seen
 * by the elements that component renders in its own shadow root — UNLESS one
 * of those nested elements *re-declares* the same `--simplecmp-*` on its own
 * `:host`. A `:host { --x: <default> }` on a nested component wins over the
 * inherited (overridden) value for that subtree, so it pins the nested UI to
 * the defaults and the adapter/override never reaches it. (See
 * docs/issue-config-theme-nested-components.md.)
 *
 * Therefore:
 *
 *  - **`tokens`** — defaults + base consumption. Use in components mounted
 *    as a theming root (top-level: banner, modal, trigger,
 *    contextual-notice, provider-info-modal). They establish the defaults.
 *  - **`baseTokens`** — base consumption only, NO `--simplecmp-*` defaults.
 *    Use in components only ever rendered *inside* another component's
 *    shadow root (purpose-group, service-toggle). They inherit every token
 *    from their parent host, so an adapter/override on that host flows in
 *    unblocked.
 *
 * A new nested component must use `baseTokens` (or it re-introduces the
 * theming bug); a new top-level component uses `tokens`.
 */
import { css } from 'lit';

/**
 * The `--simplecmp-*` default values. Declared on `:host`, so only the
 * components that include this block (the theming roots) establish them;
 * everything nested inherits.
 */
const tokenDefaults = css`
  :host {
    --simplecmp-color-primary: #15775a;
    --simplecmp-color-primary-hover: #0f5d44;
    --simplecmp-color-secondary: #6c757d;
    --simplecmp-color-danger: #da2c43;
    --simplecmp-color-bg: #ffffff;
    --simplecmp-color-bg-alt: #f5f7f9;
    --simplecmp-color-border: #dde2e7;
    --simplecmp-color-text: #1a232c;
    --simplecmp-color-text-muted: #5f6b78;

    --simplecmp-radius: 6px;
    --simplecmp-spacing: 0.75rem;
    --simplecmp-spacing-sm: 0.5rem;
    --simplecmp-spacing-lg: 1.25rem;

    --simplecmp-font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --simplecmp-font-family-heading: var(--simplecmp-font-family);
    --simplecmp-font-size: 0.95rem;
    --simplecmp-font-size-heading: 20px;
    --simplecmp-font-size-sm: 0.85rem;
    --simplecmp-line-height: 1.5;

    --simplecmp-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    --simplecmp-z-index: 2147483000;
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --simplecmp-transition: none;
    }
  }
`;

/**
 * Base consumption applied to every component's host. Declares NO
 * `--simplecmp-*` (so it never blocks inheritance into nested components);
 * the four base properties carry inline fallbacks so a component still
 * renders sensibly even if mounted without a defaults-bearing ancestor.
 */
export const baseTokens = css`
  :host {
    color: var(--simplecmp-color-text, #1a232c);
    font-family: var(--simplecmp-font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    font-size: var(--simplecmp-font-size, 0.95rem);
    line-height: var(--simplecmp-line-height, 1.5);
  }
`;

/** Defaults + base consumption — for theming-root (top-level) components. */
export const tokens = css`
  ${tokenDefaults}
  ${baseTokens}
`;
