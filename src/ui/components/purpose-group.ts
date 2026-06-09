/**
 * <simplecmp-purpose-group> — a single purpose with its services.
 *
 * Renders a labeled checkbox for the purpose group plus an expandable
 * list of `<simplecmp-service-toggle>` children. The master toggle calls
 * `manager.updateConsent` for each non-required service in the group.
 *
 * Tristate logic mirrors Klaro:
 *   - all enabled       → checked
 *   - mixed             → indeterminate
 *   - all disabled      → unchecked
 *   - all required-only → checked + disabled
 */

import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Service } from '../../engine/index.js';
import { asTitle } from '../../engine/utils/strings.js';
import { SimpleCmpElement } from '../base.js';
// baseTokens, not tokens: this component is only ever rendered inside
// another component's shadow root, so it must NOT re-declare the
// `--simplecmp-*` defaults — that would block an adapter/host override from
// inheriting in. See tokens.ts.
import { baseTokens } from '../styles/tokens.js';
import './service-toggle.js';

@customElement('simplecmp-purpose-group')
export class SimpleCmpPurposeGroup extends SimpleCmpElement {
  /** The purpose key (e.g. 'analytics', 'marketing'). */
  @property({ type: String })
  purpose = '';

  /** Services that belong to this purpose. */
  @property({ attribute: false })
  services: Service[] = [];

  @state()
  private _expanded = false;

  static override styles = [
    baseTokens,
    css`
      :host {
        display: block;
        border: 1px solid var(--simplecmp-color-border);
        border-radius: var(--simplecmp-radius);
        padding: var(--simplecmp-spacing);
        margin-bottom: var(--simplecmp-spacing-sm);
      }

      .header {
        display: flex;
        align-items: flex-start;
        gap: var(--simplecmp-spacing-sm);
      }

      input[type='checkbox'] {
        margin-top: 0.25rem;
        accent-color: var(--simplecmp-color-primary);
      }

      .title {
        font-weight: 500;
      }

      .description {
        margin: 0.25rem 0 0 0;
        font-size: var(--simplecmp-font-size-sm);
        color: var(--simplecmp-color-text-muted);
      }

      .toggle-services {
        margin-top: var(--simplecmp-spacing-sm);
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-size: var(--simplecmp-font-size-sm);
        color: var(--simplecmp-color-primary);
        cursor: pointer;
      }

      .services {
        margin-top: var(--simplecmp-spacing-sm);
        padding-left: var(--simplecmp-spacing-lg);
        border-left: 2px solid var(--simplecmp-color-border);
      }

      .services[hidden] {
        display: none;
      }
    `,
  ];

  private _onMasterChange = (event: Event): void => {
    const checked = (event.target as HTMLInputElement).checked;
    if (this.manager === undefined) return;
    for (const service of this.services) {
      if (service.required !== true) {
        this.manager.updateConsent(service.name, checked);
      }
    }
    this._emit('purpose-toggle', { purpose: this.purpose, value: checked });
  };

  private _toggleExpanded = (event: Event): void => {
    event.preventDefault();
    this._expanded = !this._expanded;
  };

  override render(): TemplateResult | typeof nothing {
    if (this.manager === undefined) return nothing;

    const status = this._computeStatus();
    const title = this._tString(['!', 'purposes', this.purpose, 'title?']) || asTitle(this.purpose);
    const description = this._tString(['!', 'purposes', this.purpose, 'description']);

    const id = `simplecmp-purpose-${this.purpose}`;

    return html`
      <div class="header">
        <input
          type="checkbox"
          id=${id}
          .checked=${status.allEnabled || (!status.allDisabled && !status.onlyRequiredEnabled)}
          .indeterminate=${!status.allEnabled && !status.allDisabled}
          ?disabled=${status.allRequired}
          @change=${this._onMasterChange}
        />
        <div class="meta">
          <label for=${id}>
            <span class="title">${title}</span>
          </label>
          ${description ? html`<p class="description">${description}</p>` : nothing}
        </div>
      </div>

      ${
        this.services.length > 0
          ? html`
            <button
              type="button"
              class="toggle-services"
              aria-expanded=${this._expanded ? 'true' : 'false'}
              @click=${this._toggleExpanded}
            >
              ${this._expanded ? '▴' : '▾'} ${this.services.length}
              ${this._t(['purposeItem', this.services.length > 1 ? 'services' : 'service'])}
            </button>
            <ul class="services" ?hidden=${!this._expanded}>
              ${this.services.map(
                (service) => html`
                  <li>
                    <simplecmp-service-toggle
                      .config=${this.config}
                      .manager=${this.manager}
                      .service=${service}
                      .visible=${this._expanded}
                    ></simplecmp-service-toggle>
                  </li>
                `
              )}
            </ul>
          `
          : nothing
      }
    `;
  }

  // --- helpers ----------------------------------------------------------

  private _computeStatus(): {
    allEnabled: boolean;
    allDisabled: boolean;
    onlyRequiredEnabled: boolean;
    allRequired: boolean;
  } {
    const consents = this.manager?.consents ?? {};
    const status = {
      allEnabled: true,
      allDisabled: true,
      onlyRequiredEnabled: true,
      allRequired: true,
    };
    for (const service of this.services) {
      const required = service.required === true;
      if (!required) status.allRequired = false;
      if (consents[service.name]) {
        if (!required) status.onlyRequiredEnabled = false;
        status.allDisabled = false;
      } else if (!required) {
        status.allEnabled = false;
      }
    }
    if (status.allDisabled) status.onlyRequiredEnabled = false;
    return status;
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
    'simplecmp-purpose-group': SimpleCmpPurposeGroup;
  }
}
