/**
 * SimpleCMP default design tokens.
 *
 * Each Lit component imports this and folds it into its own `static styles`,
 * so the tokens are scoped to the component's `:host` (Shadow DOM) or the
 * element itself (Light DOM). Hosts override these via plain CSS:
 *
 *   simplecmp-banner { --simplecmp-color-primary: #ff6600; }
 *
 * The Bootstrap adapter (D.7) is just a stylesheet that maps `--bs-*` to
 * `--simplecmp-*` — no JS, no fork, no theming framework.
 */
import { css } from 'lit';

export const tokens = css`
  :host {
    --simplecmp-color-primary: #1a936f;
    --simplecmp-color-primary-hover: #15775a;
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
    --simplecmp-font-size: 0.95rem;
    --simplecmp-font-size-sm: 0.85rem;
    --simplecmp-line-height: 1.5;

    --simplecmp-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    --simplecmp-z-index: 2147483000;

    color: var(--simplecmp-color-text);
    font-family: var(--simplecmp-font-family);
    font-size: var(--simplecmp-font-size);
    line-height: var(--simplecmp-line-height);
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --simplecmp-transition: none;
    }
  }
`;
