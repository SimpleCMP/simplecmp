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
import type { PropertyValues, TemplateResult } from 'lit';
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

  /**
   * Whether the host element carries `data-simplecmp-auto-placeholder` —
   * set by `ConsentManager._toggleAutoPlaceholder` when the engine
   * inserts this notice itself. We use it to decide whether to steal
   * focus on first paint (auto-insert: yes; integrator-authored: no).
   */
  private _autoPlaceholder = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this._autoPlaceholder = this.hasAttribute('data-simplecmp-auto-placeholder');
    // Landmark role + accessible name. Set on the host so screen
    // readers see this as a discrete region. The aria-label is
    // refreshed on each render in `firstUpdated`/`updated` once the
    // resolved service title is known.
    if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
  }

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

    const title = this._resolveTitle(service);
    const description = this._resolveDescription(service, title);
    const hasStored = this.manager.store.get() !== null;

    return html`
      <p>${description}</p>
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

  /**
   * Resolve the title shown on the notice. Precedence:
   *
   * 1. `service.placeholderTitle` — explicit per-service override on
   *    the JS init config. Used as-is so integrators who hardcode it
   *    bypass the translation chain entirely.
   * 2. The translated `!.<service>.placeholderTitle?` (i18n table).
   *    This is what CMS plugins use to surface library-curated copy
   *    per-language without forcing every integrator to set the
   *    service property.
   * 3. The translated `!.<service>.title?` — falls back to the
   *    service's regular title so a notice without a dedicated
   *    placeholder title still reads sensibly.
   * 4. `asTitle(service.name)` — title-cased fallback so a notice for
   *    `'google-maps'` reads "Google Maps" even when nothing else is
   *    configured.
   */
  private _resolveTitle(service: Service): string {
    if (typeof service.placeholderTitle === 'string' && service.placeholderTitle.length > 0) {
      return service.placeholderTitle;
    }
    return (
      this._tString(['!', service.name, 'placeholderTitle?']) ||
      this._tString(['!', service.name, 'title?']) ||
      asTitle(service.name)
    );
  }

  /**
   * Resolve the description shown on the notice. Precedence:
   *
   * 1. `service.placeholderDescription` — explicit per-service override
   *    on the JS init config. Used as-is, no interpolation.
   * 2. The translated `!.<service>.placeholderDescription?` (i18n
   *    table). CMS plugins surface library-curated copy per-language
   *    through this slot.
   * 3. The translated `contextualConsent.description` template with
   *    `{title}` interpolation — the language-aware default ("Click
   *    here to load the {title} content").
   */
  private _resolveDescription(service: Service, title: string): unknown {
    if (
      typeof service.placeholderDescription === 'string' &&
      service.placeholderDescription.length > 0
    ) {
      return service.placeholderDescription;
    }
    const fromI18n = this._tString(['!', service.name, 'placeholderDescription?']);
    if (fromI18n !== '') {
      return fromI18n;
    }
    return this._t(['contextualConsent', 'description'], { title });
  }

  override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated?.(changed);
    this._updateAriaLabel();
    this._maybeFocusFirstAction();
  }

  override updated(changed: PropertyValues): void {
    super.updated?.(changed);
    this._updateAriaLabel();
  }

  /**
   * Mirror the resolved title into the host's `aria-label` so the
   * landmark has a useful accessible name ("Google Maps placeholder")
   * for screen readers walking the page.
   */
  private _updateAriaLabel(): void {
    const service = this._resolveService();
    if (service === undefined) return;
    const title = this._resolveTitle(service);
    // `!` prefix suppresses the `[missing translation: …]` marker so
    // we get an empty string when no `contextualConsent.ariaLabel`
    // key is declared, allowing the fallback to `title` to fire.
    const label = this._tString(['!', 'contextualConsent', 'ariaLabel?']) || title;
    const final = label.includes('{title}') ? label.replace('{title}', title) : label;
    if (this.getAttribute('aria-label') !== final) {
      this.setAttribute('aria-label', final);
    }
  }

  /**
   * When the engine auto-inserts this notice (engine adds
   * `data-simplecmp-auto-placeholder` on the host), focus the first
   * non-disabled action button so keyboard users land on a useful
   * control. Integrator-authored notices (no marker attribute) don't
   * steal focus — they're declarative markup, not a dialog.
   */
  private _maybeFocusFirstAction(): void {
    if (!this._autoPlaceholder) return;
    const button = this.renderRoot.querySelector<HTMLButtonElement>('button:not([disabled])');
    button?.focus();
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
