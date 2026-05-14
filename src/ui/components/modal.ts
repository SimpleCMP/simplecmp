/**
 * <simplecmp-modal> — preference center modal (REQ-6).
 *
 * Built on the native HTML `<dialog>` element (ADR-0007) which gives us
 * for free:
 *   - focus trap
 *   - Escape to close (via the `cancel` event, preventable)
 *   - backdrop / `:modal` styling state
 *   - correct ARIA dialog semantics
 *
 * Klaro hand-rolled all of this. We don't.
 *
 * The host (`init()` in D.5) sets `open=true` to show the modal; the
 * component handles the rest. On close we emit `simplecmp:modal-close`
 * — hosts may also listen to `simplecmp:save` / `simplecmp:accept` /
 * `simplecmp:decline` for the action-specific flows.
 *
 * REQ-1: privacy + imprint links rendered as a separate footer block in
 * the header section.
 */

import { css, html, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { Service } from '../../engine/index.js';
import { SimpleCmpElement } from '../base.js';
import { tokens } from '../styles/tokens.js';
import './purpose-group.js';
import './service-toggle.js';

type LocalizedUrl = string | Record<string, string> | undefined;

function resolveLocalizedUrl(value: LocalizedUrl, lang: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value[lang] ?? value.default;
  return undefined;
}

@customElement('simplecmp-modal')
export class SimpleCmpModal extends SimpleCmpElement {
  /** Show / hide the modal. Setting `true` calls `dialog.showModal()`. */
  @property({ type: Boolean, reflect: true })
  open = false;

  @property({ type: Boolean })
  testing = false;

  @query('dialog')
  private _dialog?: HTMLDialogElement;

  static override styles = [
    tokens,
    css`
      :host {
        display: contents;
      }

      dialog {
        max-width: 40rem;
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

      .header,
      .body,
      .footer {
        padding: var(--simplecmp-spacing-lg);
      }

      .header {
        border-bottom: 1px solid var(--simplecmp-color-border);
        position: relative;
      }

      h1 {
        margin: 0 0 var(--simplecmp-spacing) 0;
        font-size: 1.25rem;
      }

      .description {
        margin: 0 0 var(--simplecmp-spacing) 0;
      }

      .policy-links {
        margin: 0;
        font-size: var(--simplecmp-font-size-sm);
        color: var(--simplecmp-color-text-muted);
      }

      .policy-links a {
        color: var(--simplecmp-color-text-muted);
      }

      .close {
        position: absolute;
        top: var(--simplecmp-spacing);
        right: var(--simplecmp-spacing);
        background: none;
        border: none;
        font-size: 1.25rem;
        line-height: 1;
        cursor: pointer;
        color: var(--simplecmp-color-text-muted);
      }

      .footer {
        border-top: 1px solid var(--simplecmp-color-border);
        display: flex;
        gap: var(--simplecmp-spacing-sm);
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      button.action {
        font: inherit;
        border: 1px solid transparent;
        border-radius: var(--simplecmp-radius);
        padding: var(--simplecmp-spacing-sm) var(--simplecmp-spacing);
        cursor: pointer;
      }

      button.accept-all,
      button.save {
        background: var(--simplecmp-color-primary);
        color: white;
      }

      button.accept-all:hover,
      button.save:hover {
        background: var(--simplecmp-color-primary-hover);
      }

      button.decline {
        background: transparent;
        color: var(--simplecmp-color-danger);
        border-color: var(--simplecmp-color-danger);
      }

      ul.services {
        list-style: none;
        padding: 0;
        margin: 0;
      }
    `,
  ];

  // --- lifecycle --------------------------------------------------------

  protected override updated(changed: PropertyValues): void {
    super.updated?.(changed);

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

  private _onCancel = (event: Event): void => {
    // mustConsent → suppress Escape close; user must click an action.
    if (this.config?.mustConsent === true) {
      event.preventDefault();
    }
  };

  private _onClose = (): void => {
    this.open = false;
    this._emit('modal-close');
  };

  private _onCloseClick = (): void => {
    if (this.config?.mustConsent === true) return;
    this.open = false;
    this._emit('modal-close');
  };

  private _onBackdropClick = (event: MouseEvent): void => {
    // Native <dialog> backdrop clicks land on the dialog element itself
    // (not its children) — comparing target/currentTarget is the standard
    // detection trick.
    if (event.target === this._dialog && this.config?.mustConsent !== true) {
      this.open = false;
      this._emit('modal-close');
    }
  };

  private _onAcceptAll = (): void => {
    if (this.manager === undefined) return;
    this.manager.changeAll(true);
    this.manager.saveAndApplyConsents('accept');
    this._emit('accept');
    this.open = false;
  };

  private _onDecline = (): void => {
    if (this.manager === undefined) return;
    this.manager.changeAll(false);
    this.manager.saveAndApplyConsents('decline');
    this._emit('decline');
    this.open = false;
  };

  private _onSave = (): void => {
    if (this.manager === undefined) return;
    this.manager.saveAndApplyConsents('save');
    this._emit('save');
    this.open = false;
  };

  // --- render -----------------------------------------------------------

  override render(): TemplateResult | typeof nothing {
    const config = this.config;
    const manager = this.manager;
    if (config === undefined || manager === undefined) return nothing;

    return html`
      <dialog
        @cancel=${this._onCancel}
        @close=${this._onClose}
        @click=${this._onBackdropClick}
      >
        ${this._renderHeader(config)}
        <div class="body">${this._renderBody(config)}</div>
        ${this._renderFooter(config, manager)}
      </dialog>
    `;
  }

  private _renderHeader(config: NonNullable<typeof this.config>): TemplateResult {
    const lang = this._activeLang();
    const ppUrl = this._resolvePolicyUrl(
      config.privacyPolicy as LocalizedUrl,
      ['privacyPolicyUrl'],
      lang
    );
    const imprintUrl = this._resolvePolicyUrl(config.imprint as LocalizedUrl, ['imprintUrl'], lang);

    const useHtml = config.htmlTexts === true;
    const description = this._t(['consentModal', 'description']);
    const showClose = config.mustConsent !== true;

    return html`
      <div class="header">
        ${
          showClose
            ? html`<button
              type="button"
              class="close"
              aria-label=${this._t(['close'])}
              @click=${this._onCloseClick}
            >
              ×
            </button>`
            : nothing
        }
        <h1 id="simplecmp-modal-title">${this._t(['consentModal', 'title'])}</h1>
        <p class="description">
          ${useHtml ? renderWithUnsafe(description) : description}
        </p>
        ${this._renderPolicyLinks(ppUrl, imprintUrl)}
      </div>
    `;
  }

  private _renderBody(config: NonNullable<typeof this.config>): TemplateResult {
    const groupByPurpose = config.groupByPurpose !== false;

    if (groupByPurpose) {
      const purposes = this._collectPurposes();
      const order = (config.purposeOrder as string[] | undefined) ?? [];
      const sorted = Array.from(purposes.keys()).sort(
        (a, b) => order.indexOf(a) - order.indexOf(b)
      );
      // The wrapper <div> matters: returning a multi-root template fragment
      // (just the array) doesn't render correctly inside a nested slot in
      // happy-dom. A single root element keeps Lit's NodePart marker
      // positions in sync. (See parallel pattern in `_renderFooter`.)
      return html`
        <div class="purposes">
          ${sorted.map(
            (purpose) => html`
              <simplecmp-purpose-group
                .config=${this.config}
                .manager=${this.manager}
                .purpose=${purpose}
                .services=${purposes.get(purpose) ?? []}
              ></simplecmp-purpose-group>
            `
          )}
        </div>
      `;
    }

    return html`
      <ul class="services">
        ${config.services.map(
          (service) => html`
            <li>
              <simplecmp-service-toggle
                .config=${this.config}
                .manager=${this.manager}
                .service=${service}
              ></simplecmp-service-toggle>
            </li>
          `
        )}
      </ul>
    `;
  }

  private _renderFooter(
    config: NonNullable<typeof this.config>,
    manager: NonNullable<typeof this.manager>
  ): TemplateResult {
    // Show decline + accept-all in both states (pre- and post-consent).
    // Returning users opening the modal from the floating trigger expect the
    // same bulk-toggle paths as first-visit users; the alternative left them
    // stranded with only "Save" — they'd have to flip switches manually to
    // approximate "decline all".
    const showDecline = config.hideDeclineAll !== true;
    const showAcceptAll = config.acceptAll === true;
    const saveLabel = manager.confirmed ? this._t(['save']) : this._t(['acceptSelected']);

    return html`
      <div class="footer">
        ${
          showDecline
            ? html`<button type="button" class="action decline" @click=${this._onDecline}>
              ${this._t(['decline'])}
            </button>`
            : nothing
        }
        <button type="button" class="action save" @click=${this._onSave}>
          ${saveLabel}
        </button>
        ${
          showAcceptAll
            ? html`<button type="button" class="action accept-all" @click=${this._onAcceptAll}>
              ${this._t(['acceptAll'])}
            </button>`
            : nothing
        }
      </div>
    `;
  }

  private _renderPolicyLinks(
    ppUrl: string | undefined,
    imprintUrl: string | undefined
  ): TemplateResult | typeof nothing {
    if (ppUrl === undefined && imprintUrl === undefined) return nothing;
    return html`
      <p class="policy-links">
        ${
          ppUrl
            ? html`<a href=${ppUrl} target="_blank" rel="noopener"
              >${this._t(['privacyPolicy', 'name'])}</a
            >`
            : nothing
        }
        ${ppUrl && imprintUrl ? ' · ' : nothing}
        ${
          imprintUrl
            ? html`<a href=${imprintUrl} target="_blank" rel="noopener"
              >${this._imprintLinkText()}</a
            >`
            : nothing
        }
      </p>
    `;
  }

  // --- helpers ----------------------------------------------------------

  private _activeLang(): string {
    return this.config?.lang ?? document.documentElement.lang ?? 'en';
  }

  private _collectPurposes(): Map<string, Service[]> {
    const map = new Map<string, Service[]>();
    for (const service of this.config?.services ?? []) {
      for (const purpose of service.purposes ?? []) {
        const list = map.get(purpose) ?? [];
        list.push(service);
        map.set(purpose, list);
      }
    }
    return map;
  }

  private _resolvePolicyUrl(
    configValue: LocalizedUrl,
    translationKey: string[],
    lang: string
  ): string | undefined {
    const fromConfig = resolveLocalizedUrl(configValue, lang);
    if (fromConfig !== undefined) return fromConfig;
    const fromTranslation = this._tString(['!', ...translationKey]);
    return fromTranslation === '' ? undefined : fromTranslation;
  }

  private _imprintLinkText(): string {
    return (
      this._tString(['!', 'consentNotice', 'imprint', 'name']) ||
      this._tString(['!', 'imprint', 'name']) ||
      'Imprint'
    );
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

function renderWithUnsafe(value: unknown): unknown {
  if (typeof value === 'string') return unsafeHTML(value);
  if (!Array.isArray(value)) return value;
  return value.map((part) => (typeof part === 'string' ? unsafeHTML(part) : part));
}

declare global {
  interface HTMLElementTagNameMap {
    'simplecmp-modal': SimpleCmpModal;
  }
}
