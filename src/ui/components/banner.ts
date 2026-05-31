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
import type { ConsentConfig } from '../../engine/index.js';
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
        /* Banner placement — overridable via three tokens, all set
           together by the integrator (t3-simplecmp ships a 3x3
           picker). Default mirrors the original hard-coded
           bottom-right corner. */
        inset: var(
          --simplecmp-banner-inset,
          auto var(--simplecmp-spacing) var(--simplecmp-spacing) auto
        );
        transform: var(--simplecmp-banner-transform, none);
        max-width: var(--simplecmp-banner-max-width, 30rem);
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

      /* Layout-independent button row defaults. Per-layout overrides
         live in the .cn-layout-* selectors below.

         Compliance baseline (legal-compliance.md §1.2 + §2.3): all
         three buttons share identical styling. Visual hierarchy is
         carried by label + position, never by color/size/weight.
         The previous Accept-filled-primary vs. Decline-ghost-outline
         treatment was a Stirring dark pattern; this rewrite levels
         the visual playing field. */
      .cn-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--simplecmp-spacing-sm);
        margin-top: var(--simplecmp-spacing);
      }

      button {
        font: inherit;
        font-weight: 500;
        border: 1px solid var(--simplecmp-color-border);
        border-radius: var(--simplecmp-radius);
        padding: var(--simplecmp-spacing-sm) var(--simplecmp-spacing);
        cursor: pointer;
        background: var(--simplecmp-color-bg-alt);
        color: var(--simplecmp-color-text);
        line-height: var(--simplecmp-line-height);
      }

      button:hover {
        background: var(--simplecmp-color-border);
      }

      button:focus-visible {
        outline: 2px solid var(--simplecmp-color-primary);
        outline-offset: 2px;
      }

      /* Standard layout — horizontal flex row with Configure-Decline-
         Accept in source order. Wraps on narrow viewports. */
      .cn-layout-standard {
        /* Inherits .cn-buttons defaults — explicit name retained for
           future per-layout tweaks without bloating the base rule. */
      }

      /* Compact layout — Decline | Accept only, no Configure. The
         component skips the Configure button in render() when
         layout === 'compact'; this rule just exists so a
         downstream theme can target compact-mode if needed. */
      .cn-layout-compact {
        /* same as standard for now */
      }

      /* Stacked layout — vertical column, each button full-width.
         Optimised for narrow viewports and assistive tech where
         buttons-of-equal-styling on a row are hard to scan. */
      .cn-layout-stacked {
        flex-direction: column;
        align-items: stretch;
      }

      .cn-layout-stacked button {
        width: 100%;
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
        ${this._renderButtonRow(config)}
      </div>
    `;
  }

  // --- helpers ----------------------------------------------------------

  /**
   * Render the button row for the active layout.
   *
   * Three templates are supported, all of which preserve the
   * legal-compliance baseline (`docs/legal-compliance.md` §1.2 +
   * §2.3): equal visual styling across Accept / Decline / Configure,
   * hierarchy carried by label and position only.
   *
   *  - `standard` (default) — three buttons horizontally:
   *    Configure | Decline | Accept. The recommended posture for
   *    DACH compliance with a Settings-layer fallback.
   *
   *  - `compact` — Decline | Accept only. Configure is hidden so the
   *    banner is denser; works for sites where the second-layer
   *    Settings dialog is opened via the persistent footer trigger
   *    (`floatingTrigger`) instead of a first-layer button.
   *
   *  - `stacked` — same three buttons as standard, stacked vertically
   *    with full-width treatment. Optimised for narrow viewports
   *    and assistive tech.
   *
   * Legacy `config.hideLearnMore` / `config.hideDeclineAll` flags
   * remain honored on top — they win where set so existing
   * integrations don't suddenly grow buttons. `hideDeclineAll: true`
   * is flagged by the audit module as illegal under VG Hannover
   * 10 A 5385/22; the banner still renders without it for
   * backward-compat, the warning lives in the audit surface.
   */
  private _renderButtonRow(config: ConsentConfig): TemplateResult {
    const layout = this._resolveLayout(config);
    const showConfigure = layout !== 'compact' && config.hideLearnMore !== true;
    const showDecline = config.hideDeclineAll !== true;
    return html`<div class="cn-buttons cn-layout-${layout}">
      ${
        showConfigure
          ? html`<button
            type="button"
            class="cn-configure"
            @click=${this._handleConfigure}
          >
            ${this._t(['consentNotice', 'learnMore'])}
          </button>`
          : nothing
      }
      ${
        showDecline
          ? html`<button
            type="button"
            class="cn-decline"
            @click=${this._handleDecline}
          >
            ${this._t(['decline'])}
          </button>`
          : nothing
      }
      <button type="button" class="cn-accept" @click=${this._handleAccept}>
        ${this._t(['ok'])}
      </button>
    </div>`;
  }

  /**
   * Resolve the active layout. Unknown values fall back to `standard`
   * — silent, because the audit module surfaces misconfiguration
   * separately. Lower-case-normalised so `'Stacked'` and similar
   * casing slips don't break the lookup.
   */
  private _resolveLayout(config: ConsentConfig): 'standard' | 'compact' | 'stacked' {
    const raw = (config.layout ?? 'standard').toString().toLowerCase();
    if (raw === 'compact' || raw === 'stacked') return raw;
    return 'standard';
  }

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
