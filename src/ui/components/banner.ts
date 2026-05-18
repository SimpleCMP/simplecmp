/**
 * <simplecmp-banner> — small consent notice (REQ-1, REQ-2).
 *
 * The Lit equivalent of the Klaro `consent-notice.jsx` "small notice"
 * branch. The modal branch is the separate `<simplecmp-modal>` (D.3) —
 * `init()` (D.5) decides which to mount based on config.
 *
 * Properties (set by `init()`):
 *   - `config`: the active SimpleCMP/Klaro config
 *   - `manager`: the engine ConsentManager
 *   - `testing`: render even when already confirmed (Klaro testing-mode)
 *
 * Events (bubbling + composed, so they cross Shadow DOM):
 *   - `simplecmp:accept`     — user accepted all services
 *   - `simplecmp:decline`    — user declined all services
 *   - `simplecmp:configure`  — user clicked "Let me choose" / a link
 *
 * REQ-1 separation: privacyPolicy and imprint render as distinct links
 * (Klaro upstream conflates them into the description placeholders).
 *
 * **A11y — no focus trap, no Esc handler (REQ-6).** The banner is a
 * non-modal notice — it overlays the page but the user must still be
 * able to read and use the underlying content. A focus trap would block
 * legitimate site interaction, and Esc-to-decline would silently make a
 * destructive decision the user didn't intend. The site-wide consent
 * decision happens through the explicit Accept / Decline / Configure
 * buttons inside the banner; nothing else is wired to keyboard
 * shortcuts at the banner level. The modal (`<simplecmp-modal>`) is
 * where the focus trap and Esc handling live, because it *is* a modal.
 */

import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { getPurposes } from '../../engine/utils/config.js';
import { asTitle } from '../../engine/utils/strings.js';
import { SimpleCmpElement } from '../base.js';
import { tokens } from '../styles/tokens.js';

/** Localized URL form: `string` or `{ [lang]: string, default?: string }`. */
type LocalizedUrl = string | Record<string, string> | undefined;

function resolveLocalizedUrl(value: LocalizedUrl, lang: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value[lang] ?? value.default;
  return undefined;
}

@customElement('simplecmp-banner')
export class SimpleCmpBanner extends SimpleCmpElement {
  /** Render even when consent already saved — Klaro's testing-mode flag. */
  @property({ type: Boolean })
  testing = false;

  static override styles = [
    tokens,
    css`
      :host {
        display: block;
        position: fixed;
        right: var(--simplecmp-spacing);
        bottom: var(--simplecmp-spacing);
        max-width: 30rem;
        z-index: var(--simplecmp-z-index);
      }

      :host([hidden]) {
        display: none;
      }

      .cn-body {
        background: var(--simplecmp-color-bg);
        color: var(--simplecmp-color-text);
        border: 1px solid var(--simplecmp-color-border);
        border-radius: var(--simplecmp-radius);
        box-shadow: var(--simplecmp-shadow);
        padding: var(--simplecmp-spacing-lg);
      }

      h2 {
        margin: 0 0 var(--simplecmp-spacing) 0;
        font-family: var(--simplecmp-font-family-heading);
        font-size: var(--simplecmp-font-size-heading);
      }

      p {
        margin: 0 0 var(--simplecmp-spacing) 0;
      }

      .cn-policy-links {
        font-size: var(--simplecmp-font-size-sm);
        color: var(--simplecmp-color-text-muted);
      }

      .cn-policy-links a {
        color: var(--simplecmp-color-text-muted);
      }

      .cn-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--simplecmp-spacing-sm);
        margin-top: var(--simplecmp-spacing);
      }

      button {
        font: inherit;
        border: 1px solid transparent;
        border-radius: var(--simplecmp-radius);
        padding: var(--simplecmp-spacing-sm) var(--simplecmp-spacing);
        cursor: pointer;
      }

      button.cn-accept {
        background: var(--simplecmp-color-primary);
        color: white;
      }

      button.cn-accept:hover {
        background: var(--simplecmp-color-primary-hover);
      }

      button.cn-decline {
        background: transparent;
        color: var(--simplecmp-color-danger);
        border-color: var(--simplecmp-color-danger);
      }

      button.cn-configure {
        background: transparent;
        color: var(--simplecmp-color-text);
        border-color: var(--simplecmp-color-border);
      }

      a {
        color: var(--simplecmp-color-primary);
      }

      .cn-changes {
        font-size: var(--simplecmp-font-size-sm);
        font-style: italic;
        color: var(--simplecmp-color-text-muted);
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.config?.autoFocus === true) {
      // Defer until first render so the host is in the doc & focusable.
      queueMicrotask(() => this.focus());
    }
  }

  // --- handlers ---------------------------------------------------------

  private _handleAccept = (): void => {
    if (this.manager === undefined) return;
    this.manager.changeAll(true);
    this.manager.saveAndApplyConsents('accept');
    this._emit('accept');
  };

  private _handleDecline = (): void => {
    if (this.manager === undefined) return;
    this.manager.changeAll(false);
    this.manager.saveAndApplyConsents('decline');
    this._emit('decline');
  };

  private _handleConfigure = (event: Event): void => {
    event.preventDefault();
    this._emit('configure');
  };

  // --- render -----------------------------------------------------------

  override render(): TemplateResult | typeof nothing {
    const config = this.config;
    const manager = this.manager;
    if (config === undefined || manager === undefined) return nothing;

    if (!this.testing && manager.confirmed) return nothing;
    if (config.noNotice === true) return nothing;

    const lang = this._activeLang();
    const ppUrl = this._resolvePolicyUrl(
      config.privacyPolicy as LocalizedUrl,
      ['privacyPolicyUrl'],
      lang
    );
    const imprintUrl = this._resolvePolicyUrl(config.imprint as LocalizedUrl, ['imprintUrl'], lang);

    const titleText = this._t(['!', 'consentNotice', 'title']);
    const showTitle = config.showNoticeTitle === true && titleText !== undefined;
    const useHtml = config.htmlTexts === true;

    const ppLink: TemplateResult | string = ppUrl
      ? html`<a href=${ppUrl}>${this._t(['privacyPolicy', 'name'])}</a>`
      : '';
    const imprintLink: TemplateResult | string = imprintUrl
      ? html`<a href=${imprintUrl}>${this._imprintLinkText()}</a>`
      : '';
    const learnMoreInline: TemplateResult = html`<a
      href="#"
      @click=${this._handleConfigure}
      >${this._t(['consentNotice', 'learnMore'])}</a
    >`;

    const description = this._t(['consentNotice', 'description'], {
      purposes: html`<strong>${this._purposesText(config)}</strong>`,
      privacyPolicy: ppLink,
      imprint: imprintLink,
      learnMoreLink: learnMoreInline,
    });

    // a11y: aria-labelledby only references `#cn-title` when the
    // heading is actually rendered. Sites that hide the heading
    // (`showTitle: false`) fall back to `aria-label` so the dialog
    // still has an accessible name (WCAG aria-dialog-name).
    return html`
      <div
        class="cn-body"
        role="dialog"
        aria-labelledby=${ifDefined(showTitle ? 'cn-title' : undefined)}
        aria-label=${ifDefined(showTitle ? undefined : titleText)}
        aria-describedby="cn-description"
        tabindex="0"
      >
        ${showTitle ? html`<h2 id="cn-title">${titleText}</h2>` : nothing}
        <p id="cn-description">${useHtml ? renderWithUnsafe(description) : description}</p>
        ${this._renderPolicyLinks(ppUrl, imprintUrl)}
        ${
          manager.changed
            ? html`<p class="cn-changes">${this._t(['consentNotice', 'changeDescription'])}</p>`
            : nothing
        }
        ${this.testing ? html`<p>${this._t(['consentNotice', 'testing'])}</p>` : nothing}
        <div class="cn-buttons">
          ${
            config.hideLearnMore === true
              ? nothing
              : html`<button
                type="button"
                class="cn-configure"
                @click=${this._handleConfigure}
              >
                ${this._t(['consentNotice', 'learnMore'])}
              </button>`
          }
          ${
            config.hideDeclineAll === true
              ? nothing
              : html`<button
                type="button"
                class="cn-decline"
                @click=${this._handleDecline}
              >
                ${this._t(['decline'])}
              </button>`
          }
          <button type="button" class="cn-accept" @click=${this._handleAccept}>
            ${this._t(['ok'])}
          </button>
        </div>
      </div>
    `;
  }

  // --- helpers ----------------------------------------------------------

  private _activeLang(): string {
    return this.config?.lang ?? document.documentElement.lang ?? 'en';
  }

  private _purposesText(config: NonNullable<typeof this.config>): string {
    const order = (config.purposeOrder as string[] | undefined) ?? [];
    const purposes = getPurposes(config)
      .filter((p) => p !== 'functional')
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const names = purposes.map((p) => this._tString(['!', 'purposes', p, 'title?']) || asTitle(p));
    if (names.length <= 1) return names[0] ?? '';
    const head = names.slice(0, -2);
    const tail = names.slice(-2).join(' & ');
    return [...head, tail].join(', ');
  }

  /**
   * Resolve a URL from either the legacy config field (string or
   * `{ [lang]: string }`) or the modern translation key.
   */
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

  private _renderPolicyLinks(
    ppUrl: string | undefined,
    imprintUrl: string | undefined
  ): TemplateResult | typeof nothing {
    if (ppUrl === undefined && imprintUrl === undefined) return nothing;
    return html`
      <p class="cn-policy-links">
        ${ppUrl ? html`<a href=${ppUrl}>${this._t(['privacyPolicy', 'name'])}</a>` : nothing}
        ${ppUrl && imprintUrl ? ' · ' : nothing}
        ${imprintUrl ? html`<a href=${imprintUrl}>${this._imprintLinkText()}</a>` : nothing}
      </p>
    `;
  }
}

/**
 * htmlTexts=true rendering: each string fragment becomes raw HTML, each
 * non-string fragment (TemplateResult, etc.) renders as-is. Mirrors what
 * Klaro's `Text` component does with `dangerouslySetInnerHTML`.
 */
function renderWithUnsafe(value: unknown): unknown {
  if (typeof value === 'string') return unsafeHTML(value);
  if (!Array.isArray(value)) return value;
  return value.map((part) => (typeof part === 'string' ? unsafeHTML(part) : part));
}

declare global {
  interface HTMLElementTagNameMap {
    'simplecmp-banner': SimpleCmpBanner;
  }
}
