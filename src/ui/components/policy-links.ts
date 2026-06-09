/**
 * <simplecmp-policy-links> — REQ-1.
 *
 * Standalone privacy + imprint footer. Both the banner and the modal
 * already render their own copy inline, but this component lets
 * integrators drop the same predictable links anywhere in their layout
 * (e.g. site footer) without re-implementing the URL resolution rules.
 *
 * Resolves URLs in this order:
 *   1. `config.privacyPolicy` / `config.imprint` (string or `{ [lang]: string }`)
 *   2. translation key `privacyPolicyUrl` / `imprintUrl`
 *
 * Renders nothing if neither URL resolves — so it's safe to drop in
 * unconditionally.
 */

import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SimpleCmpElement } from '../base.js';
import { isSafeHttpUrl } from '../safe-url.js';
import { tokens } from '../styles/tokens.js';

type LocalizedUrl = string | Record<string, string> | undefined;

function resolveLocalizedUrl(value: LocalizedUrl, lang: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value[lang] ?? value.default;
  return undefined;
}

@customElement('simplecmp-policy-links')
export class SimpleCmpPolicyLinks extends SimpleCmpElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: inline;
        font-size: var(--simplecmp-font-size-sm);
        color: var(--simplecmp-color-text-muted);
      }

      a {
        color: var(--simplecmp-color-text-muted);
      }
    `,
  ];

  override render(): TemplateResult | typeof nothing {
    const config = this.config;
    if (config === undefined) return nothing;

    const lang = config.lang ?? document.documentElement.lang ?? 'en';
    const rawPp = this._resolve(config.privacyPolicy as LocalizedUrl, ['privacyPolicyUrl'], lang);
    const rawImprint = this._resolve(config.imprint as LocalizedUrl, ['imprintUrl'], lang);
    // Drop any non-http(s) URL so a javascript:/data: value can't become a
    // clickable link. Done once here so the separator + early-return below
    // stay consistent.
    const ppUrl = rawPp !== undefined && isSafeHttpUrl(rawPp) ? rawPp : undefined;
    const imprintUrl =
      rawImprint !== undefined && isSafeHttpUrl(rawImprint) ? rawImprint : undefined;

    if (ppUrl === undefined && imprintUrl === undefined) return nothing;

    return html`
      <span class="links">
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
      </span>
    `;
  }

  private _resolve(
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

declare global {
  interface HTMLElementTagNameMap {
    'simplecmp-policy-links': SimpleCmpPolicyLinks;
  }
}
