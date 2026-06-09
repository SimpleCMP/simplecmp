/**
 * <simplecmp-provider-info-modal> — Layer 2 disclosure surface (REQ-19).
 *
 * Renders the recipient identity + transfer-basis disclosure for a
 * single service:
 *   - Vendor brand name (`vendor`)
 *   - Provider description (`vendorDescription`)
 *   - Postal address of the legal entity (`vendorAddress`)
 *   - Country (`vendorCountry`)
 *   - Privacy policy URL (`privacyPolicyUrl`)
 *   - Opt-out URL (`vendorOptOutUrl`)
 *   - Partner / joint-controller notes + transfer basis (`vendorPartner`)
 *
 * Reused from two places:
 *   - The "Weitere Informationen ›" link inside
 *     `<simplecmp-contextual-notice>` (the blocked-embed placeholder).
 *   - Per-service expansion in the main banner modal (future, when
 *     wiring lands).
 *
 * Each field renders only when present; missing fields are hidden.
 * The trigger link is responsible for not opening the modal when no
 * fields are present — see `<simplecmp-contextual-notice>`.
 *
 * Same `<dialog>`-based pattern as `<simplecmp-modal>`, but much
 * simpler: no consent actions, no per-service toggles. Just info.
 */

import { css, html, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type { Service } from '../../engine/index.js';
import { SimpleCmpElement } from '../base.js';
import { isSafeHttpUrl } from '../safe-url.js';
import { tokens } from '../styles/tokens.js';

@customElement('simplecmp-provider-info-modal')
export class SimpleCmpProviderInfoModal extends SimpleCmpElement {
  /** The service whose provider disclosure should be rendered. */
  @property({ attribute: false })
  service?: Service;

  /** Whether the modal is shown. Setting `true` calls `dialog.showModal()`. */
  @property({ type: Boolean, reflect: true })
  open = false;

  @query('dialog')
  private _dialog?: HTMLDialogElement;

  static override styles = [
    tokens,
    css`
      :host {
        display: contents;
      }

      dialog {
        max-width: 36rem;
        width: 90%;
        border: 1px solid var(--simplecmp-color-border);
        border-radius: var(--simplecmp-radius);
        padding: 0;
        background: var(--simplecmp-color-bg);
        color: var(--simplecmp-color-text);
        font-family: var(--simplecmp-font-family);
        font-size: var(--simplecmp-font-size);
      }

      dialog::backdrop {
        background: rgba(0, 0, 0, 0.4);
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--simplecmp-spacing-lg);
        border-bottom: 1px solid var(--simplecmp-color-border);
      }

      header h2 {
        font-size: var(--simplecmp-font-size-heading, 1.25rem);
        font-family: var(--simplecmp-font-family-heading, var(--simplecmp-font-family));
        margin: 0;
      }

      button.close {
        font: inherit;
        background: transparent;
        border: none;
        color: var(--simplecmp-color-text-muted);
        cursor: pointer;
        font-size: 1.5rem;
        line-height: 1;
        padding: 0 var(--simplecmp-spacing-sm);
      }

      button.close:hover {
        color: var(--simplecmp-color-text);
      }

      .body {
        padding: var(--simplecmp-spacing-lg);
      }

      dl {
        margin: 0;
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--simplecmp-spacing-sm) var(--simplecmp-spacing);
      }

      dt {
        font-weight: 600;
        color: var(--simplecmp-color-text-muted);
        white-space: nowrap;
      }

      dd {
        margin: 0;
        word-break: break-word;
      }

      dd a {
        color: var(--simplecmp-color-primary);
        text-decoration: underline;
      }

      dd a:hover {
        color: var(--simplecmp-color-primary-hover);
      }

      .empty {
        font-style: italic;
        color: var(--simplecmp-color-text-muted);
      }

      footer {
        display: flex;
        justify-content: flex-end;
        padding: var(--simplecmp-spacing) var(--simplecmp-spacing-lg);
        border-top: 1px solid var(--simplecmp-color-border);
      }

      footer button {
        font: inherit;
        border: 1px solid transparent;
        border-radius: var(--simplecmp-radius);
        padding: var(--simplecmp-spacing-sm) var(--simplecmp-spacing);
        cursor: pointer;
        background: var(--simplecmp-color-primary);
        color: white;
      }

      footer button:hover {
        background: var(--simplecmp-color-primary-hover);
      }
    `,
  ];

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('open')) {
      const dialog = this._dialog;
      if (dialog === undefined) return;
      if (this.open && !dialog.open) {
        dialog.showModal();
      } else if (!this.open && dialog.open) {
        dialog.close();
      }
    }
  }

  // --- handlers ---------------------------------------------------------

  private _onCancel = (): void => {
    // Native Escape close — allow it (no mustConsent equivalent here).
  };

  private _onClose = (): void => {
    this.open = false;
    this._emit('provider-info-close');
  };

  private _onCloseClick = (): void => {
    this.open = false;
    this._emit('provider-info-close');
  };

  private _onBackdropClick = (event: MouseEvent): void => {
    if (event.target === this._dialog) {
      this.open = false;
      this._emit('provider-info-close');
    }
  };

  // --- render -----------------------------------------------------------

  override render(): TemplateResult | typeof nothing {
    const service = this.service;
    if (service === undefined) return nothing;

    const closeLabel = this._tString(['providerInfo', 'close']) || 'Close';

    return html`
      <dialog
        aria-labelledby="simplecmp-provider-info-title"
        @cancel=${this._onCancel}
        @close=${this._onClose}
        @click=${this._onBackdropClick}
      >
        <header>
          <h2 id="simplecmp-provider-info-title">
            ${this._tString(['providerInfo', 'title']) || 'Provider information'}
          </h2>
          <button type="button" class="close" @click=${this._onCloseClick} aria-label=${closeLabel}>
            ×
          </button>
        </header>
        <div class="body">${this._renderBody(service)}</div>
        <footer>
          <button type="button" @click=${this._onCloseClick}>${closeLabel}</button>
        </footer>
      </dialog>
    `;
  }

  private _renderBody(service: Service): TemplateResult {
    const rows: TemplateResult[] = [];
    const push = (key: string, value: string | undefined, isUrl = false): void => {
      if (value === undefined || value === '') return;
      const label = this._tString(['providerInfo', 'field', key]) || key;
      // Only link out for http(s); an unsafe URL (javascript:/data:/…) is
      // shown as plain, auto-escaped text instead of a clickable href.
      const valueNode =
        isUrl && isSafeHttpUrl(value)
          ? html`<a href=${value} target="_blank" rel="noopener noreferrer">${value}</a>`
          : html`${value}`;
      rows.push(html`<dt>${label}</dt><dd>${valueNode}</dd>`);
    };

    push('vendor', service.vendor);
    push('description', service.vendorDescription);
    push('address', service.vendorAddress);
    push('country', service.vendorCountry);
    push('privacyPolicy', service.privacyPolicyUrl, true);
    push('optOut', service.vendorOptOutUrl, true);
    push('partner', service.vendorPartner);

    if (rows.length === 0) {
      return html`<p class="empty">
        ${this._tString(['providerInfo', 'noData']) || 'No provider information available.'}
      </p>`;
    }
    return html`<dl>${rows}</dl>`;
  }

  private _tString(key: string | string[]): string {
    const value = this._t(key);
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'string' ? v : '')).join('');
    }
    return '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'simplecmp-provider-info-modal': SimpleCmpProviderInfoModal;
  }
}
