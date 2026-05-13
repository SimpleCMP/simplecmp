/**
 * <simplecmp-contextual-notice> — placeholder for un-consented embeds.
 *
 * Replaces the legacy Klaro `ContextualConsentNotice`. When an `<iframe>`
 * (e.g. YouTube, Vimeo, Maps) requires consent that hasn't been given,
 * the integrator can wrap it in this element — the notice asks the user
 * to accept the specific service inline, with three options:
 *
 *   - **Accept once** — temporarily enable the service for this page
 *     view, without persisting consent (`manager.applyConsents` only).
 *   - **Accept always** — persist consent if the manager is already
 *     confirmed; otherwise just apply temporarily. Mirrors Klaro's
 *     contextual notice behavior.
 *   - **Open settings** — emit `simplecmp:configure` so the host can
 *     show the modal.
 *
 * The element is service-scoped: it requires a `service` property
 * (or `service-name` attribute resolved against `config.services`).
 */

import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Service } from '../../engine/index.js';
import { asTitle } from '../../engine/utils/strings.js';
import { SimpleCmpElement } from '../base.js';
import { tokens } from '../styles/tokens.js';

@customElement('simplecmp-contextual-notice')
export class SimpleCmpContextualNotice extends SimpleCmpElement {
  /** The service this notice gates. Set directly via property... */
  @property({ attribute: false })
  service?: Service;

  /** ...or by attribute, in which case the component looks it up in config.services. */
  @property({ type: String, attribute: 'service-name' })
  serviceName?: string;

  static override styles = [
    tokens,
    css`
      :host {
        display: block;
        padding: var(--simplecmp-spacing-lg);
        background: var(--simplecmp-color-bg-alt);
        border: 1px solid var(--simplecmp-color-border);
        border-radius: var(--simplecmp-radius);
        color: var(--simplecmp-color-text);
      }

      p {
        margin: 0 0 var(--simplecmp-spacing) 0;
      }

      .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--simplecmp-spacing-sm);
      }

      button {
        font: inherit;
        border: 1px solid transparent;
        border-radius: var(--simplecmp-radius);
        padding: var(--simplecmp-spacing-sm) var(--simplecmp-spacing);
        cursor: pointer;
      }

      button.accept {
        background: var(--simplecmp-color-primary);
        color: white;
      }

      button.accept:hover {
        background: var(--simplecmp-color-primary-hover);
      }

      button.accept-once {
        background: transparent;
        color: var(--simplecmp-color-primary);
        border-color: var(--simplecmp-color-primary);
      }

      button.configure {
        background: transparent;
        color: var(--simplecmp-color-text);
        border-color: var(--simplecmp-color-border);
      }
    `,
  ];

  // --- handlers ---------------------------------------------------------

  private _resolveService(): Service | undefined {
    if (this.service !== undefined) return this.service;
    if (this.serviceName === undefined || this.config === undefined) return undefined;
    return this.config.services.find((s) => s.name === this.serviceName);
  }

  private _onAcceptOnce = (): void => {
    const service = this._resolveService();
    if (service === undefined || this.manager === undefined) return;
    // Apply the consent for this page view only — don't persist.
    this.manager.updateConsent(service.name, true);
    this.manager.applyConsents(false, true, service.name);
    this.manager.updateConsent(service.name, false);
    this._emit('contextual-accept-once', { name: service.name });
  };

  private _onAccept = (): void => {
    const service = this._resolveService();
    if (service === undefined || this.manager === undefined) return;
    this.manager.updateConsent(service.name, true);
    if (this.manager.confirmed) {
      this.manager.saveConsents('contextual-accept');
      this.manager.applyConsents(false, true, service.name);
    } else {
      this.manager.applyConsents(false, true, service.name);
    }
    this._emit('contextual-accept', { name: service.name });
  };

  private _onConfigure = (event: Event): void => {
    event.preventDefault();
    this._emit('configure');
  };

  // --- render -----------------------------------------------------------

  override render(): TemplateResult | typeof nothing {
    const service = this._resolveService();
    if (service === undefined || this.manager === undefined) return nothing;

    const title = this._tString(['!', service.name, 'title?']) || asTitle(service.name);
    const hasStored = this.manager.store.get() !== null;

    return html`
      <p>${this._t(['contextualConsent', 'description'], { title })}</p>
      <div class="buttons">
        <button type="button" class="accept-once" @click=${this._onAcceptOnce}>
          ${this._t(['contextualConsent', 'acceptOnce'])}
        </button>
        ${
          hasStored
            ? html`<button type="button" class="accept" @click=${this._onAccept}>
              ${this._t(['contextualConsent', 'acceptAlways'])}
            </button>`
            : nothing
        }
        <button type="button" class="configure" @click=${this._onConfigure}>
          ${this._t(['contextualConsent', 'modalLinkText'])}
        </button>
      </div>
    `;
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
    'simplecmp-contextual-notice': SimpleCmpContextualNotice;
  }
}
