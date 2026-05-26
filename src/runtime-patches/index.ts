/**
 * Runtime patches for universal pre-consent blocking (ADR-0013, Phase 0
 * prototype).
 *
 * The server-side HTML rewriter (TYPO3 ext's `UniversalBlocking` module)
 * catches every declarative subresource — `<script src>`, `<iframe src>`,
 * `<img src>`, `<link href>` — and swaps them to the engine's gate
 * shape before the response leaves the server. What it can't catch is
 * everything JS-injected at runtime: scripts built up by concatenating
 * strings, `fetch()` calls to tracking endpoints, `new Image()` pixels,
 * `navigator.sendBeacon` for page-unload analytics.
 *
 * This module patches the relevant browser APIs so JS-injected calls go
 * through the same consent-state check as declarative ones. Five
 * patches in total:
 *
 * - `HTMLScriptElement.prototype.src` setter
 * - `HTMLIFrameElement.prototype.src` setter
 * - `HTMLImageElement.prototype.src` setter (catches `new Image()`,
 *   `img.src = '...'`, and `<img>` cloned and re-mutated by JS)
 * - `window.fetch`
 * - `XMLHttpRequest.prototype.open` (state captured for `.send` no-op)
 * - `navigator.sendBeacon`
 *
 * Each patched call resolves the URL's host through the caller-supplied
 * `matcher` (returns a library service id or `null`). For known
 * third-party hosts whose service hasn't been consented, the call is
 * dropped with a synthetic outcome (rejected promise, `false` return,
 * no-op send). For unknown hosts, same-origin hosts, or consented
 * services, the call passes through unchanged.
 *
 * Install order matters: load this module synchronously in `<head>`
 * BEFORE any third-party script could execute. If a script runs before
 * `installRuntimePatches()` finishes, its synchronous network requests
 * are out of reach. This is the same constraint Klaro/SimpleCMP's
 * banner-init has — first script in the head, gate everything else.
 *
 * Fragility surface (documented in this module's README):
 *
 * - Inline scripts that build URLs by string concatenation slip past if
 *   the host is dynamic. The server-side rewriter has the same gap.
 * - Third-party loaders that bypass `document.createElement` (e.g. by
 *   writing into an existing element's `outerHTML`) aren't caught.
 *   Rare in practice; the standard injection patterns are covered.
 * - Service Workers controlled by the host site can issue their own
 *   third-party fetches — out of scope.
 */

export interface BlockInfo {
  /** Which patched mechanism triggered the block. */
  mechanism: 'script-src' | 'iframe-src' | 'img-src' | 'fetch' | 'xhr' | 'sendBeacon';
  /** The URL that was blocked (string form). */
  url: string;
  /** The library service id the URL matched against. */
  service: string;
}

export interface RuntimePatchOptions {
  /**
   * Host → library service id lookup. Returns `null` when the host
   * doesn't belong to any known third-party service (= pass through).
   *
   * In production this is the same matcher the recorder uses (see
   * `src/recorder/classifier.ts::originMatches`). For Phase 0 the demo
   * page wires up a hardcoded test matcher; productionisation will
   * derive this from the bundled `simplecmp/services-library`.
   */
  matcher: (host: string) => string | null;

  /**
   * Returns true if consent has been granted for the given service.
   * Patches let the call pass through; otherwise it's blocked.
   *
   * In production this would be `manager.getConsent(serviceName)` from
   * the engine's `ConsentManager`.
   */
  consentChecker: (serviceId: string) => boolean;

  /**
   * Extra hosts treated as "same-origin" for pass-through purposes —
   * the site's own CDN, vendor's own infrastructure, anything the
   * admin trusts. `window.location.host` is **always** included
   * implicitly; entries here are additive on top of that, so
   * integrators can't accidentally lose own-host protection by
   * passing an array. Pass `[]` to keep just `window.location.host`.
   */
  sameOriginHosts?: readonly string[];

  /**
   * Observability hook fired whenever a call is blocked. Useful for
   * dev-mode logging and for surfacing blocked traffic in a debug
   * panel. Optional.
   */
  onBlock?: (info: BlockInfo) => void;
}

/**
 * Install the runtime patches and return an uninstaller. Calling the
 * uninstaller restores the original methods on the prototypes — useful
 * for tests, not typically called in production.
 */
export function installRuntimePatches(options: RuntimePatchOptions): () => void {
  const resolved: Required<RuntimePatchOptions> = {
    matcher: options.matcher,
    consentChecker: options.consentChecker,
    // `window.location.host` is always included; any explicit entries
    // are additive. Integrators can no longer accidentally strip the
    // own-host pass-through by passing an array.
    sameOriginHosts: [window.location.host, ...(options.sameOriginHosts ?? [])],
    onBlock: options.onBlock ?? (() => {}),
  };
  const uninstallers: Array<() => void> = [
    patchElementSrc(HTMLScriptElement.prototype, 'script-src', resolved),
    patchElementSrc(HTMLIFrameElement.prototype, 'iframe-src', resolved),
    patchElementSrc(HTMLImageElement.prototype, 'img-src', resolved),
    patchFetch(resolved),
    patchXhr(resolved),
    patchSendBeacon(resolved),
  ];
  return () => {
    for (const uninstall of uninstallers) uninstall();
  };
}

// --- internal --------------------------------------------------------

interface Resolved {
  matcher: (host: string) => string | null;
  consentChecker: (serviceId: string) => boolean;
  sameOriginHosts: readonly string[];
  onBlock: (info: BlockInfo) => void;
}

/**
 * Decide whether to block a URL. Returns the matched service id when
 * the URL should be blocked, `null` when it should pass through.
 *
 * Pass-through reasons: empty URL, same-origin, unparseable URL,
 * unknown host (no library service), or consented service.
 *
 * Exported for unit testing — not re-exported via `src/index.ts`, so
 * it doesn't enter the public package surface.
 */
export function decideBlock(url: string, opts: Resolved): string | null {
  if (!url || url === 'about:blank') return null;
  let host: string;
  try {
    host = new URL(url, window.location.href).host;
  } catch {
    return null;
  }
  if (host === '' || opts.sameOriginHosts.includes(host)) return null;
  const service = opts.matcher(host);
  if (service === null) return null;
  if (opts.consentChecker(service)) return null;
  return service;
}

/**
 * Patch the `src` setter on a prototype (HTMLScriptElement,
 * HTMLIFrameElement, HTMLImageElement). When set, decide if the URL
 * should be blocked. If yes, swallow the assignment (the property
 * stays at whatever it was — typically empty). The engine's banner +
 * contextual-notice mechanism still surfaces these blocked elements
 * for visitor consent.
 *
 * Returns the uninstaller.
 */
function patchElementSrc(
  proto:
    | typeof HTMLScriptElement.prototype
    | typeof HTMLIFrameElement.prototype
    | typeof HTMLImageElement.prototype,
  mechanism: 'script-src' | 'iframe-src' | 'img-src',
  opts: Resolved
): () => void {
  const original = Object.getOwnPropertyDescriptor(proto, 'src');
  if (!original?.get || !original?.set) return () => {};
  const originalSet = original.set;
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: original.enumerable,
    get: original.get,
    set(value: string) {
      // Engine-managed elements carry `data-name`. When the engine
      // grants consent (visitor clicks "Ja" on a contextual notice),
      // it swaps the iframe's src from `about:blank` to the real URL
      // — and that assignment lands here. Defer to consent for the
      // data-name BEFORE running the URL-host matcher: under
      // `universalBlock`, the matcher would synthesize a host-derived
      // service id (e.g. `www.youtube-nocookie.com`) for which no
      // consent has been recorded under that exact name, and the
      // engine's data-name-keyed grant (e.g. `youtube`) would be
      // silently overridden. Without this short-circuit, "Ja" on a
      // state-2 notice clicks through but the iframe never loads.
      const dataName = (this as Element).getAttribute?.('data-name');
      if (dataName !== null && dataName !== undefined && opts.consentChecker(dataName) === true) {
        originalSet.call(this, value);
        return;
      }
      const service = decideBlock(value, opts);
      if (service !== null) {
        opts.onBlock({ mechanism, url: value, service });
        return;
      }
      originalSet.call(this, value);
    },
  });
  return () => Object.defineProperty(proto, 'src', original);
}

/**
 * Patch `window.fetch`. Blocked calls return a rejected Promise so
 * callers' `.catch()` chains run, mirroring how a network error would
 * surface. Avoids breaking promise chains that assume fetch always
 * resolves to a Response — those would crash either way on a blocked
 * call.
 */
function patchFetch(opts: Resolved): () => void {
  if (typeof window.fetch !== 'function') return () => {};
  const original = window.fetch.bind(window);
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    let url: string;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    const service = decideBlock(url, opts);
    if (service !== null) {
      opts.onBlock({ mechanism: 'fetch', url, service });
      return Promise.reject(new TypeError(`SimpleCMP: consent for ${service} not granted`));
    }
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}

/**
 * Patch `XMLHttpRequest.prototype.open` to flag blocked URLs.
 * `.send()` then no-ops on flagged instances — calling open() with a
 * blocked URL doesn't throw (a synchronous throw breaks too many
 * legacy callers), it just makes subsequent send() a silent no-op.
 */
function patchXhr(opts: Resolved): () => void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const BLOCKED_MARKER = '__simplecmpBlockedService';

  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    // XHR instances are reusable — the same object can be `.open()`ed
    // multiple times across its lifetime. Clear any prior block marker
    // so a previously-blocked instance reopened with a benign URL
    // doesn't carry a stale flag into `.send()` and silently suppress.
    const instance = this as unknown as Record<string, unknown>;
    if (instance[BLOCKED_MARKER] !== undefined) {
      delete instance[BLOCKED_MARKER];
    }
    const urlString = typeof url === 'string' ? url : url.href;
    const service = decideBlock(urlString, opts);
    if (service !== null) {
      opts.onBlock({ mechanism: 'xhr', url: urlString, service });
      instance[BLOCKED_MARKER] = service;
    }
    // @ts-expect-error rest spread on overloaded signature
    originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    if ((this as unknown as Record<string, unknown>)[BLOCKED_MARKER] !== undefined) {
      return;
    }
    originalSend.call(this, body);
  };

  return () => {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
}

/**
 * Patch `navigator.sendBeacon`. Returns `false` on block, matching the
 * native return shape for "queueing failed".
 */
function patchSendBeacon(opts: Resolved): () => void {
  if (typeof navigator.sendBeacon !== 'function') return () => {};
  const original = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function patchedSendBeacon(
    url: string | URL,
    data?: BodyInit | null
  ): boolean {
    const urlString = typeof url === 'string' ? url : url.href;
    const service = decideBlock(urlString, opts);
    if (service !== null) {
      opts.onBlock({ mechanism: 'sendBeacon', url: urlString, service });
      return false;
    }
    return original(url, data);
  };
  return () => {
    navigator.sendBeacon = original;
  };
}
