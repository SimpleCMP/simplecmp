/**
 * <simplecmp-trigger> — floating "open consent settings" button (REQ-4).
 *
 * DSGVO Art. 7(3): withdrawing consent must be as easy as giving it.
 * After the user has confirmed (banner dismissed), this trigger gives
 * them an always-available way to re-open the preference center.
 *
 * Lit equivalent of `src/floating-trigger.ts`. Emits
 * `simplecmp:trigger-click`; the host (`init()` in D.5) listens for it
 * and opens the `<simplecmp-modal>`.
 *
 * The host can also pass a `label` property to localize the button —
 * the trigger doesn't depend on `config.translations` being populated,
 * which means it works even when the engine has no config at all (e.g.
 * for a "consent settings" link in the page footer).
 */

import { css, html } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SimpleCmpElement } from '../base.js';
import { tokens } from '../styles/tokens.js';

type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

@customElement('simplecmp-trigger')
export class SimpleCmpTrigger extends SimpleCmpElement {
  /** Corner the button floats in. */
  @property({ type: String })
  position: Position = 'bottom-right';

  /** Visible aria-label / title. Falls back to the `floatingTrigger` translation key, then 'Cookie settings'. */
  @property({ type: String })
  label?: string;

  static override styles = [
    tokens,
    css`
      :host {
        display: contents;
      }

      button {
        position: fixed;
        z-index: var(--simplecmp-z-index);
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        background: var(--simplecmp-color-primary);
        color: white;
        border: none;
        box-shadow: var(--simplecmp-shadow);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      button:hover {
        background: var(--simplecmp-color-primary-hover);
      }

      :host([position='bottom-right']) button {
        right: var(--simplecmp-spacing);
        bottom: var(--simplecmp-spacing);
      }

      :host([position='bottom-left']) button {
        left: var(--simplecmp-spacing);
        bottom: var(--simplecmp-spacing);
      }

      :host([position='top-right']) button {
        right: var(--simplecmp-spacing);
        top: var(--simplecmp-spacing);
      }

      :host([position='top-left']) button {
        left: var(--simplecmp-spacing);
        top: var(--simplecmp-spacing);
      }

      svg {
        width: 1.25rem;
        height: 1.25rem;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    // `position` is a property; reflect it as an attribute so the
    // `:host([position=...])` selectors above find it.
    this.setAttribute('position', this.position);
  }

  private _onClick = (event: Event): void => {
    event.preventDefault();
    this._emit('trigger-click');
  };

  override render(): TemplateResult {
    const label = this._resolveLabel();
    return html`
      <button type="button" aria-label=${label} title=${label} @click=${this._onClick}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10c0-.34-.02-.68-.05-1.01-.71.93-1.83 1.51-3.07 1.51-2.21 0-4-1.79-4-4 0-.34.04-.68.13-1.01-1.65.32-3.13-1.04-3.13-2.49 0-.79.36-1.5.93-1.96A9.95 9.95 0 0 0 12 2zm-1 5h2v2h-2zm-3 4h2v2H8zm6 0h2v2h-2zm-2 4h2v2h-2z"
          />
        </svg>
      </button>
    `;
  }

  private _resolveLabel(): string {
    if (this.label !== undefined && this.label !== '') return this.label;
    if (this.config !== undefined) {
      const translated = this._t(['!', 'floatingTrigger', 'label']);
      if (typeof translated === 'string' && translated !== '') return translated;
      if (Array.isArray(translated) && translated.length > 0) {
        return translated.map((v) => (typeof v === 'string' ? v : '')).join('');
      }
    }
    return 'Cookie settings';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'simplecmp-trigger': SimpleCmpTrigger;
  }
}
