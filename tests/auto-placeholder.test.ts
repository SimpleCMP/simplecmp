/**
 * Click-to-enable / auto-placeholder behaviour.
 *
 * When a `[data-name="<service>"]` element is blocked by absent consent,
 * the engine auto-inserts a `<simplecmp-contextual-notice>` as its
 * immediate following sibling so the visitor can grant consent inline.
 * On consent flip, the notice is removed. The Service-level
 * `noAutoPlaceholder`, the global `config.autoContextualPlaceholder`,
 * and the element-level `data-no-placeholder` all opt out.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConsentConfig } from '../src/engine/index.js';
import { getManager, resetManagers } from '../src/engine/index.js';

function makeConfig(extra: Partial<ConsentConfig> = {}): ConsentConfig {
  return {
    storageName: 'simplecmp-auto-placeholder-test',
    storageMethod: 'localStorage',
    services: [
      {
        name: 'youtube',
        purposes: ['marketing'],
        default: false,
        placeholderTitle: 'YouTube',
      },
    ],
    ...extra,
  };
}

function makeBlockedIframe(serviceName: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-name', serviceName);
  iframe.setAttribute('data-src', 'https://www.youtube.com/embed/test');
  document.body.appendChild(iframe);
  return iframe;
}

function autoPlaceholderFor(serviceName: string): Element | null {
  return document.querySelector(
    `[data-simplecmp-auto-placeholder][data-simplecmp-for="${serviceName}"]`
  );
}

describe('auto-placeholder click-to-enable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetManagers();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('inserts a contextual notice next to a blocked iframe', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    const notice = autoPlaceholderFor('youtube');
    expect(notice).not.toBeNull();
    expect(notice?.tagName.toLowerCase()).toBe('simplecmp-contextual-notice');
    expect(notice?.getAttribute('service-name')).toBe('youtube');
  });

  it('removes the notice when consent flips to true', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();
    expect(autoPlaceholderFor('youtube')).not.toBeNull();

    // Mirror what `<simplecmp-contextual-notice>` does on Accept:
    // updateConsent + interactive applyConsents scoped to the service.
    manager.updateConsent('youtube', true);
    manager.applyConsents(false, true, 'youtube');

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('is idempotent — repeated applyConsents with consent:false does not stack notices', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();
    manager.applyConsents();
    manager.applyConsents();

    const notices = document.querySelectorAll(
      '[data-simplecmp-auto-placeholder][data-simplecmp-for="youtube"]'
    );
    expect(notices.length).toBe(1);
  });

  it('skips when service.noAutoPlaceholder is true', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(
      makeConfig({
        services: [
          {
            name: 'youtube',
            purposes: ['marketing'],
            default: false,
            noAutoPlaceholder: true,
          },
        ],
      })
    );
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('skips when config.autoContextualPlaceholder is false', () => {
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig({ autoContextualPlaceholder: false }));
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('skips when the element has data-no-placeholder', () => {
    const iframe = makeBlockedIframe('youtube');
    iframe.setAttribute('data-no-placeholder', '');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('inserts one notice per blocked element on the page', () => {
    makeBlockedIframe('youtube');
    makeBlockedIframe('youtube');
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    const notices = document.querySelectorAll(
      '[data-simplecmp-auto-placeholder][data-simplecmp-for="youtube"]'
    );
    expect(notices.length).toBe(3);
  });

  it('does not auto-insert next to an integrator-authored placeholder element (data-type="placeholder")', () => {
    const div = document.createElement('div');
    div.setAttribute('data-name', 'youtube');
    div.setAttribute('data-type', 'placeholder');
    document.body.appendChild(div);
    const manager = getManager(makeConfig());
    manager.applyConsents();

    expect(autoPlaceholderFor('youtube')).toBeNull();
  });

  it('sets blocked iframe src to about:blank, not the empty string', () => {
    // Regression for the Klaro-heritage bug where src="" was treated by
    // browsers as a relative URL pointing to the current page — the
    // blocked iframe would load the host page recursively inside
    // itself. about:blank is the standard "explicitly empty document"
    // URL and doesn't trigger any network request.
    makeBlockedIframe('youtube');
    const manager = getManager(makeConfig());
    manager.applyConsents();

    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-name="youtube"]');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('about:blank');
  });

  it('inserts a notice next to a blocked <script> element', () => {
    const script = document.createElement('script');
    script.setAttribute('data-name', 'youtube');
    script.setAttribute('data-src', 'https://example.com/analytics.js');
    script.setAttribute('data-type', 'text/javascript');
    document.body.appendChild(script);

    const manager = getManager(makeConfig());
    manager.applyConsents();

    const notice = autoPlaceholderFor('youtube');
    expect(notice).not.toBeNull();
    expect(notice?.previousElementSibling?.tagName.toLowerCase()).toBe('script');
  });
});
