/**
 * <simplecmp-service-toggle> — single-service on/off control.
 *
 * Used inside `<simplecmp-purpose-group>` and (for ungrouped service lists)
 * directly inside `<simplecmp-modal>`. Renders a labeled checkbox with
 * required/optOut badges and an optional description. Calls
 * `manager.updateConsent(name, value)` directly on toggle, mirroring
 * Klaro's behavior — also emits `simplecmp:service-toggle` for hosts
 * that want to observe.
 */

import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Service } from '../../engine/index.js';
import { asTitle } from '../../engine/utils/strings.js';
import { SimpleCmpElement } from '../base.js';
// baseTokens, not tokens: this component is only ever rendered inside
// another component's shadow root, so it must NOT re-declare the
// `--simplecmp-*` defaults — that would block an adapter/host override from
// inheriting in. See tokens.ts.
import { baseTokens } from '../styles/tokens.js';

@customElement('simplecmp-service-toggle')
export class SimpleCmpServiceToggle extends SimpleCmpElement {
  @property({ attribute: false })
  service?: Service;

  /** Visibility flag for nested rendering — hidden services get tabindex=-1. */
  @property({ type: Boolean })
  visible = true;

  static override styles = [
    baseTokens,
    css`
      :host {
        display: block;
        margin: var(--simplecmp-spacing-sm) 0;
      }

      .row {
        display: flex;
        align-items: flex-start;
        gap: var(--simplecmp-spacing-sm);
      }

      input[type='checkbox'] {
        margin-top: 0.25rem;
        flex-shrink: 0;
        accent-color: var(--simplecmp-color-primary);
      }

      .meta {
        flex: 1;
      }

      .title {
        font-weight: 500;
      }

      .badge {
        display: inline-block;
        margin-left: var(--simplecmp-spacing-sm);
        padding: 0 0.4rem;
        font-size: var(--simplecmp-font-size-sm);
        background: var(--simplecmp-color-bg-alt);
        border-radius: var(--simplecmp-radius);
        color: var(--simplecmp-color-text-muted);
      }

      .description {
        margin: 0.25rem 0 0 0;
        font-size: var(--simplecmp-font-size-sm);
        color: var(--simplecmp-color-text-muted);
      }

      .purposes {
        margin: 0.25rem 0 0 0;
        font-size: var(--simplecmp-font-size-sm);
        color: var(--simplecmp-color-text-muted);
      }
    `,
  ];

  private _onChange = (event: Event): void => {
    const checked = (event.target as HTMLInputElement).checked;
    const service = this.service;
    if (service === undefined || service.required) return;
    this.manager?.updateConsent(service.name, checked);
    this._emit('service-toggle', { name: service.name, value: checked });
  };

  override render(): TemplateResult | typeof nothing {
    const service = this.service;
    if (service === undefined) return nothing;

    const id = `simplecmp-service-${service.name}`;
    const checked = service.required === true || this.manager?.consents[service.name] === true;
    const title = this._tString(['!', service.name, 'title?']) || asTitle(service.name);
    const description = this._tString(['!', service.name, 'description?']) || undefined;

    return html`
      <div class="row">
        <input
          type="checkbox"
          id=${id}
          .checked=${checked}
          ?disabled=${service.required === true}
          tabindex=${this.visible ? '0' : '-1'}
          @change=${this._onChange}
        />
        <div class="meta">
          <label for=${id}>
            <span class="title">${title}</span>
            ${service.required ? html`<span class="badge">${this._t(['service', 'required', 'title'])}</span>` : nothing}
            ${service.optOut ? html`<span class="badge">${this._t(['service', 'optOut', 'title'])}</span>` : nothing}
          </label>
          ${description ? html`<p class="description">${description}</p>` : nothing}
          ${this._renderPurposes(service)}
        </div>
      </div>
    `;
  }

  private _renderPurposes(service: Service): TemplateResult | typeof nothing {
    const purposes = service.purposes ?? [];
    if (purposes.length === 0) return nothing;
    const list = purposes
      .map((p) => this._tString(['!', 'purposes', p, 'title?']) || asTitle(p))
      .join(', ');
    const label = this._t(['service', purposes.length > 1 ? 'purposes' : 'purpose']);
    return html`<p class="purposes">${label}: ${list}</p>`;
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
    'simplecmp-service-toggle': SimpleCmpServiceToggle;
  }
}
