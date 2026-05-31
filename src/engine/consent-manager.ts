/**
 * ConsentManager — the engine's state-machine for consent decisions.
 *
 * Originally derived from Klaro's `consent-manager.js`; rewritten as
 * TypeScript here as part of the hard-fork (ADR-0006). Behaviour and
 * public surface are preserved so the Klaro-era UI keeps working until
 * REQ-14 ships the new Lit-based components.
 *
 * Notable SimpleCMP additions still active:
 *   - REQ-3: versioned storage payload + `versionMismatch` detection
 *   - REQ-5: GPC signal handling in `getDefaultConsent`
 *
 * The parts that touch `document` / `<script>` / `<iframe>` (apply consent
 * to actual page elements, delete cookies on revocation) live here because
 * they're the consent-engine's contract with the host page — not the
 * banner UI.
 */

import stores, {
  type KeyedStore,
  SessionStorageStore,
  type Store,
  type StoreManagerLike,
} from './stores.js';
import { applyDataset, dataset } from './utils/compat.js';
import { deleteCookie, getCookies } from './utils/cookies.js';

// --- public types ----------------------------------------------------------

/** A consent service entry. Loose because consumers extend with custom keys. */
export interface Service {
  name: string;
  purposes?: string[];
  default?: boolean;
  required?: boolean;
  optOut?: boolean;
  contextualConsentOnly?: boolean;
  cookies?: unknown[];
  vars?: Record<string, unknown>;
  onInit?: ServiceHandler;
  onAccept?: ServiceHandler;
  onDecline?: ServiceHandler;
  callback?: (consent: boolean, service: Service) => void;
  onlyOnce?: boolean;
  /**
   * Click-to-enable affordance for blocked embeds. When this service is
   * not consented and one of its `[data-name]` elements is swapped/blocked,
   * the engine auto-inserts a `<simplecmp-contextual-notice>` as the
   * element's immediate following sibling so the visitor can grant
   * consent inline. Disable per-service with `noAutoPlaceholder: true`,
   * or per-element with `data-no-placeholder` on the blocked element.
   * Global default is `config.autoContextualPlaceholder` (default true).
   */
  noAutoPlaceholder?: boolean;
  /**
   * Optional short title shown in the auto-inserted contextual notice.
   * Falls back to the service's normal title / `name` if unset.
   */
  placeholderTitle?: string;
  /**
   * Optional short description shown in the auto-inserted contextual
   * notice. Falls back to the translation default if unset.
   */
  placeholderDescription?: string;
  // --- L2 Provider-Informationen modal fields (REQ-19) -------------
  // Surface the data recipient's identity + transfer basis on the
  // second layer of the contextual notice. All optional; the modal
  // hides fields that are unset and renders "nicht angegeben" only
  // when the field is missing on a service that has any other vendor*
  // field present.
  /** Display brand name (e.g. "Google", "Facebook"). Distinct from the legal entity name (which lives in `vendorAddress`). */
  vendor?: string;
  /** ISO 3166-1 alpha-2 country code of the vendor's establishment. */
  vendorCountry?: string;
  /** Full postal address of the legal entity, prefixed with the entity name (e.g. "Google Ireland Limited, Gordon House, …"). */
  vendorAddress?: string;
  /** Service-specific opt-out endpoint (HTTPS). Distinct from privacyPolicyUrl. */
  vendorOptOutUrl?: string;
  /** Joint-controller / partner notes (Fashion ID / Art. 26 GDPR) + transfer-basis disclosure (DPF / SCCs / Art. 49). Free text. */
  vendorPartner?: string;
  /** Short description of the legal entity / company itself. Distinct from `description` which describes the service. */
  vendorDescription?: string;
  /** Link to the recipient's privacy policy. HTTPS. */
  privacyPolicyUrl?: string;
  // Custom fields (e.g., `title`, `description`, `purposes` translations) flow
  // through. We keep this open via the index signature.
  [key: string]: unknown;
}

/** A handler can be either a function or a string of JS code (legacy Klaro). */
export type ServiceHandler = string | ((opts: ServiceHandlerOpts) => unknown) | undefined;

export interface ServiceHandlerOpts {
  service: Service;
  config: ConsentConfig;
  vars: Record<string, unknown>;
  consents?: Record<string, boolean>;
  confirmed?: boolean;
}

/**
 * Per-service metadata surfaced by `<simplecmp-contextual-notice>`
 * when the service isn't in `config.services`. Currently only
 * `purposes` is read (rendered as the "Zwecke: …" line in the
 * notice). Additional fields can be added later (vendor, privacy
 * policy URL, …) as the contextual-notice's UI grows. Keyed by
 * the synthetic service id used in `data-name` — typically the
 * library entry's id (e.g. `youtube`, `google-tag-manager`).
 */
export type LibraryFallback = Record<
  string,
  {
    purposes?: readonly string[];
    // L2 Provider-Informationen modal fields (REQ-19). Same shape as
    // the optional fields on `Service` — integrators populate these
    // for services NOT in `config.services` so the L2 modal can
    // render disclosure data without bundling the full services
    // library into the FE payload.
    vendor?: string;
    vendorCountry?: string;
    vendorAddress?: string;
    vendorOptOutUrl?: string;
    vendorPartner?: string;
    vendorDescription?: string;
    privacyPolicyUrl?: string;
  }
>;

/** Klaro/SimpleCMP consent-config shape — what ConsentManager reads. */
export interface ConsentConfig {
  services: Service[];
  storageName?: string;
  cookieName?: string; // legacy alias
  storageMethod?: string;
  cookieDomain?: string;
  cookiePath?: string;
  cookieExpiresAfterDays?: number;
  default?: boolean;
  required?: boolean;
  optOut?: boolean;
  callback?: (consent: boolean, service: Service) => void;
  // REQ-3
  consentVersion?: string | number;
  consentVersionPolicy?: 'any' | 'major';
  // REQ-5
  respectGPC?: boolean;
  /**
   * Global toggle for the click-to-enable affordance on blocked embeds.
   * When true (default), the engine inserts a
   * `<simplecmp-contextual-notice>` as a sibling of every blocked
   * `[data-name]` element so visitors can grant consent inline.
   * Per-service `Service.noAutoPlaceholder` overrides this for one
   * service; `data-no-placeholder` on an element overrides for one
   * element. Set this to `false` to disable globally — typically only
   * needed when the integrator authors their own placeholders.
   */
  autoContextualPlaceholder?: boolean;
  /**
   * Per-service metadata for services NOT in `config.services` but
   * known to a library (e.g. `simplecmp/services-library`). When a
   * `<simplecmp-contextual-notice>` renders in state 2 (library-known
   * but not in config), it looks up the synthetic service name here
   * to surface purposes (and potentially other library metadata) in
   * the notice text — without shipping the whole library to the FE.
   * Typically populated by a CMS plugin (TYPO3 ext, future WordPress
   * plugin) when universal blocking is enabled.
   */
  libraryFallback?: LibraryFallback;
  // i18n
  lang?: string;
  languages?: string[];
  fallbackLang?: string;
  translations?: Record<string, unknown>;
  /**
   * Per-language tone selector. Languages with a T/V distinction
   * (du/Sie, tu/vous, …) ship a curated informal overlay alongside the
   * default formal pack; pass `{ de: 'informal' }` (etc.) to opt that
   * language into the casual register.
   *
   * Tone overlays sit between the bundled defaults and the consumer's
   * own `translations` — manual entries in `translations` always win
   * over the tone preset. Languages that don't have an informal pack
   * silently stay formal; values other than `'informal'` are treated
   * as `'formal'` (no overlay).
   *
   * Currently shipped informal packs: `de`. Add more by dropping a
   * `<lang>.json` into `src/engine/translations/informal/` and
   * registering it in that directory's `index.ts`.
   */
  tones?: Record<string, 'formal' | 'informal'>;
  /**
   * Banner button-row template. Picks one of the curated layouts
   * shipped by the bundle — each preserves the "equal visual
   * styling across Accept / Decline / Configure" compliance baseline
   * (`docs/legal-compliance.md` §1.2 + §2.3).
   *
   * - `'standard'` (default) — three buttons horizontally: Configure
   *   | Decline | Accept. The recommended DACH-compliant posture
   *   with a Settings-layer fallback.
   * - `'compact'` — Decline | Accept only. Configure is hidden so
   *   the first layer is denser; the Settings dialog opens via the
   *   persistent `floatingTrigger` instead.
   * - `'stacked'` — three buttons stacked vertically with full-
   *   width treatment. Optimised for narrow viewports / assistive
   *   tech.
   *
   * Legacy `hideLearnMore` / `hideDeclineAll` flags are honored on
   * top of the layout choice — when set, they hide the respective
   * button regardless of layout.
   */
  layout?: 'standard' | 'compact' | 'stacked';
  // Other custom fields (privacyPolicy, imprint, elementID, noAutoLoad, ...)
  [key: string]: unknown;
}

export interface VersionMismatchInfo {
  storedVersion: unknown;
  configVersion: unknown;
  policy: 'any' | 'major';
}

/** What `manager.notify(...)` calls dispatch to. */
export interface ConsentWatcher {
  update(manager: ConsentManager, name: string, data: unknown): void;
}

// --- internal helpers ------------------------------------------------------

/** A store that may also have keyed access (StorageStore variants). */
function isKeyedStore(s: Store): s is KeyedStore {
  return typeof (s as KeyedStore).getWithKey === 'function';
}

function escapeRegexStr(str: string): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
}

/** Run a service handler; supports both function form and Klaro's string-eval form. */
function executeHandler(handler: ServiceHandler, opts: ServiceHandlerOpts): unknown {
  if (handler === undefined) return undefined;
  if (typeof handler === 'function') return handler(opts);
  // String-based handler: legacy Klaro pattern, retained for compatibility.
  // The `Function` constructor is the only practical way to evaluate
  // user-supplied JS source from a config — the handler comes from the
  // integrator, not from end-user input.
  const fn = new Function('opts', handler) as (opts: ServiceHandlerOpts) => unknown;
  return fn(opts);
}

// --- ConsentManager --------------------------------------------------------

export class ConsentManager {
  readonly config: ConsentConfig;
  readonly store: Store;
  readonly auxiliaryStore: KeyedStore;

  consents: Record<string, boolean>;
  confirmed = false;
  changed = false;
  /** REQ-3: populated when stored consentVersion didn't match the configured one. */
  versionMismatch?: VersionMismatchInfo;

  private states: Record<string, boolean> = {};
  private initialized: Record<string, boolean> = {};
  private executedOnce: Record<string, boolean> = {};
  private readonly watchers = new Set<ConsentWatcher>();
  private savedConsents: Record<string, boolean>;

  constructor(config: ConsentConfig, store?: Store, auxiliaryStore?: KeyedStore) {
    this.config = config;

    const managerLike: StoreManagerLike = {
      storageName: this.storageName,
      cookieDomain: this.cookieDomain,
      cookiePath: this.cookiePath,
      cookieExpiresAfterDays: this.cookieExpiresAfterDays,
    };

    if (store !== undefined) {
      this.store = store;
    } else {
      const Ctor = stores[this.storageMethod] ?? stores.cookie;
      // The `cookie` fallback is always populated; cast away the optional.
      this.store = new (Ctor as NonNullable<typeof Ctor>)(managerLike);
    }

    this.auxiliaryStore = auxiliaryStore ?? new SessionStorageStore(managerLike);

    this.consents = this.defaultConsents;
    this.loadConsents();
    this.applyConsents();
    this.savedConsents = { ...this.consents };
  }

  // --- accessors ---------------------------------------------------------

  get storageMethod(): string {
    return this.config.storageMethod ?? 'cookie';
  }

  get storageName(): string {
    // `cookieName` is the legacy alias; preserved for backwards compatibility
    return this.config.storageName ?? this.config.cookieName ?? 'klaro';
  }

  get cookieDomain(): string | undefined {
    return this.config.cookieDomain;
  }

  get cookiePath(): string | undefined {
    return this.config.cookiePath;
  }

  get cookieExpiresAfterDays(): number {
    return this.config.cookieExpiresAfterDays ?? 120;
  }

  get defaultConsents(): Record<string, boolean> {
    const consents: Record<string, boolean> = {};
    for (const service of this.config.services) {
      consents[service.name] = this.getDefaultConsent(service);
    }
    return consents;
  }

  // --- watchers ----------------------------------------------------------

  watch(watcher: ConsentWatcher): void {
    this.watchers.add(watcher);
  }

  unwatch(watcher: ConsentWatcher): void {
    this.watchers.delete(watcher);
  }

  notify(name: string, data: unknown): void {
    for (const watcher of this.watchers) {
      watcher.update(this, name, data);
    }
  }

  // --- core API ----------------------------------------------------------

  getService(name: string): Service | undefined {
    return this.config.services.find((s) => s.name === name);
  }

  /**
   * Default consent for a service. REQ-5: GPC signal forces non-required
   * services to default-deny when `navigator.globalPrivacyControl === true`
   * and `config.respectGPC !== false`.
   */
  getDefaultConsent(service: Service): boolean {
    // Per-service `required` overrides `config.required` (`??` preserves an
    // explicit `service.required: false` against a `config.required: true`
    // default). Mirrors the resolution in `changeAll()`.
    const required = service.required ?? this.config.required ?? false;
    // Required (strictly-necessary) services always consent — including
    // under a GPC signal, which only governs non-essential processing.
    if (required) {
      return true;
    }
    if (
      this.config.respectGPC !== false &&
      typeof navigator !== 'undefined' &&
      (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    ) {
      return false;
    }
    // `??` (not `||`) so an explicit `service.default: false` is honored
    // against a `config.default: true` instead of being swallowed back to
    // the config default.
    return service.default ?? this.config.default ?? false;
  }

  changeAll(value: boolean): number {
    let changedServices = 0;
    for (const service of this.config.services.filter((s) => !s.contextualConsentOnly)) {
      // Required services always consent — never togglable by the
      // visitor's accept-all/decline-all action. Per-service
      // `required` overrides `config.required`: `??` preserves an
      // explicit `service.required: false` against a `config.required:
      // true` default. The previous `||` chain treated `config.required`
      // as a global "force every service to true" override, ignoring
      // both the per-service negation AND the visitor's `value`.
      const required = service.required ?? this.config.required ?? false;
      const target = required ? true : value;
      if (this.updateConsent(service.name, target)) {
        changedServices++;
      }
    }
    return changedServices;
  }

  updateConsent(name: string, value: boolean): boolean {
    const changed = (this.consents[name] || false) !== value;
    this.consents[name] = value;
    this.notify('consents', this.consents);
    return changed;
  }

  resetConsents(): void {
    this.consents = this.defaultConsents;
    this.states = {};
    this.confirmed = false;
    this.applyConsents();
    this.savedConsents = { ...this.consents };
    this.store.delete();
    this.notify('consents', this.consents);
  }

  getConsent(name: string): boolean {
    return this.consents[name] || false;
  }

  // --- storage -----------------------------------------------------------

  loadConsents(): Record<string, boolean> {
    const consentData = this.store.get();
    if (consentData === null) return this.consents;

    const parsed = JSON.parse(decodeURIComponent(consentData)) as unknown;

    // REQ-3: support both legacy and versioned storage shapes.
    // Legacy: `{ [serviceName]: bool }`. Versioned: `{ __v, consents }`.
    let storedVersion: unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      '__v' in (parsed as object) &&
      'consents' in (parsed as object)
    ) {
      const wrapper = parsed as { __v: unknown; consents: Record<string, boolean> };
      storedVersion = wrapper.__v;
      this.consents = wrapper.consents;
    } else {
      this.consents = parsed as Record<string, boolean>;
    }

    // REQ-3: version-mismatch check. Discard stored consent on mismatch and
    // reuse Klaro's existing `changed=true` UX so the existing
    // `changeDescription` message appears.
    const configVersion = this.config.consentVersion;
    if (
      configVersion !== undefined &&
      storedVersion !== undefined &&
      !this._versionsCompatible(storedVersion, configVersion)
    ) {
      this.versionMismatch = {
        storedVersion,
        configVersion,
        policy: this.config.consentVersionPolicy ?? 'any',
      };
      this.consents = this.defaultConsents;
      this.confirmed = false;
      this.changed = true;
    } else {
      this._checkConsents();
      this.notify('consents', this.consents);
    }

    return this.consents;
  }

  /**
   * REQ-3: compare stored vs configured version. Default policy `'any'`
   * invalidates on any difference. `'major'` tolerates patch/minor bumps
   * (semver-like, takes the part before the first `.`). Both values are
   * stringified before comparison so `'1'` and `1` behave the same.
   */
  private _versionsCompatible(stored: unknown, current: unknown): boolean {
    const s = String(stored);
    const c = String(current);
    const policy = this.config.consentVersionPolicy ?? 'any';
    if (policy === 'major') {
      return s.split('.')[0] === c.split('.')[0];
    }
    return s === c;
  }

  saveAndApplyConsents(eventType?: string): void {
    this.saveConsents(eventType);
    this.applyConsents();
  }

  changedConsents(): Record<string, boolean> {
    const cc: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(this.consents)) {
      if (this.savedConsents[k] !== v) cc[k] = v;
    }
    return cc;
  }

  /**
   * REQ-3: wrap the stored payload with the current `consentVersion` when
   * configured, so a later visit can detect a mismatch. Without
   * `consentVersion`, the legacy `{[name]: bool}` shape is preserved.
   */
  saveConsents(eventType?: string): void {
    const payload =
      this.config.consentVersion !== undefined
        ? { __v: this.config.consentVersion, consents: this.consents }
        : this.consents;
    const v = encodeURIComponent(JSON.stringify(payload));
    this.store.set(v);
    this.confirmed = true;
    this.changed = false;
    // Version on disk is now in sync; clear any prior mismatch info.
    this.versionMismatch = undefined;
    const changes = this.changedConsents();
    this.savedConsents = { ...this.consents };
    this.notify('saveConsents', {
      changes,
      consents: this.consents,
      type: eventType ?? 'script',
    });
  }

  /**
   * Apply current consent decisions to the host page's tagged elements
   * (`<script data-name>`, `<iframe data-name>`, `<img data-name>`) and
   * remove cookies for declined services.
   *
   * `dryRun` performs no DOM mutations, just counts how many services
   * would change. `interactive` and `serviceName` scope the operation
   * to a single service.
   */
  applyConsents(dryRun?: boolean, interactive?: boolean, serviceName?: string): number {
    let changedServices = 0;

    // Initialize each service via its `onInit` handler the first time we see it.
    for (const service of this.config.services) {
      if (serviceName !== undefined && serviceName !== service.name) continue;
      const vars = service.vars ?? {};
      const handlerOpts: ServiceHandlerOpts = {
        service,
        config: this.config,
        vars,
      };
      if (!this.initialized[service.name]) {
        this.initialized[service.name] = true;
        executeHandler(service.onInit, handlerOpts);
      }
    }

    for (const service of this.config.services) {
      if (serviceName !== undefined && serviceName !== service.name) continue;
      const state = this.states[service.name];
      const vars = service.vars ?? {};
      const optOut = service.optOut !== undefined ? service.optOut : (this.config.optOut ?? false);
      const required =
        service.required !== undefined ? service.required : (this.config.required ?? false);
      // opt-out and required services are always treated as confirmed
      const confirmed = this.confirmed || optOut || dryRun || interactive || false;
      const consent = (this.getConsent(service.name) && confirmed) || required;
      const handlerOpts: ServiceHandlerOpts = {
        service,
        config: this.config,
        vars,
        consents: this.consents,
        confirmed: this.confirmed,
      };

      if (state !== consent) changedServices++;
      if (dryRun) continue;

      executeHandler(consent ? service.onAccept : service.onDecline, handlerOpts);
      this.updateServiceElements(service, consent);
      this.updateServiceStorage(service, consent);

      if (service.callback !== undefined) service.callback(consent, service);
      if (this.config.callback !== undefined) this.config.callback(consent, service);

      this.states[service.name] = consent;
    }

    // Second pass: `[data-name]` elements whose service is NOT in
    // `config.services`. Phase 1 server-side rewriting and universal
    // pre-consent blocking can produce these — e.g. an admin removes a
    // service from the registry but the library/host gating keeps
    // marking embeds with that `data-name`. Without this pass, the
    // element stays blocked at `about:blank` with no contextual notice
    // (silent white void). The contextual-notice component's render-
    // mode logic handles the visible UI; here we just ensure the
    // notice gets inserted + `updateServiceElements` runs so the
    // visitor's "Ja" click on a state-2 (library-known) notice can
    // actually swap the src back in.
    if (!dryRun && typeof document !== 'undefined') {
      const knownNames = new Set(this.config.services.map((s) => s.name));
      const seen = new Set<string>();
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-name]'))) {
        const name = el.getAttribute('data-name');
        if (name === null || name === '' || knownNames.has(name) || seen.has(name)) {
          continue;
        }
        if (serviceName !== undefined && serviceName !== name) continue;
        seen.add(name);
        const syntheticService: Service = { name, purposes: [] };
        // For unconfigured services the consent map starts empty;
        // `getConsent` returns false. The visitor's "Ja" click on the
        // state-2 notice runs `updateConsent(name, true)` before
        // re-entering this code path, so the consent value reflects
        // the in-progress acceptance.
        const consent = this.getConsent(name);
        this.updateServiceElements(syntheticService, consent);
      }
    }

    this.notify('applyConsents', { changedServices, serviceName });
    return changedServices;
  }

  /** Toggle / replace `<script>`, `<iframe>`, `<img>` etc. tags marked with `data-name="<service>"`. */
  updateServiceElements(service: Service, consent: boolean): void {
    if (typeof document === 'undefined') return;

    if (consent) {
      if (service.onlyOnce && this.executedOnce[service.name]) return;
      this.executedOnce[service.name] = true;
    }

    const elements = document.querySelectorAll<HTMLElement>(`[data-name='${service.name}']`);
    for (const element of Array.from(elements)) {
      const parent = element.parentElement;
      if (!parent) continue;
      const ds = dataset(element);
      const { type, src, href } = ds;
      const attrs = ['href', 'src', 'type'] as const;

      // Placeholder: just toggle visibility. Integrator-authored markup;
      // no auto-notice is needed because the placeholder IS the notice.
      if (type === 'placeholder') {
        if (consent) {
          element.style.display = 'none';
          ds['original-display'] = element.style.display;
        } else {
          element.style.display = ds['original-display'] || 'block';
        }
        continue;
      }

      if (element.tagName === 'IFRAME') {
        const iframe = element as HTMLIFrameElement;
        if (consent && iframe.src === src) {
          // already active — leave alone
          console.debug(
            `Skipping ${element.tagName} for service ${service.name}, as it already has the correct type...`
          );
          continue;
        }
        const newElement = document.createElement(element.tagName) as HTMLIFrameElement;
        for (const attribute of Array.from(element.attributes)) {
          if (attribute.name === 'style') {
            const [styleProperty = '', styleValue = ''] = attribute.value.split(':');
            (newElement.style as unknown as Record<string, string>)[styleProperty.trim()] =
              styleValue.trim();
          } else {
            newElement.setAttribute(attribute.name, attribute.value);
          }
        }
        newElement.innerText = element.innerText;
        // legacy `script.text` mirror
        (newElement as unknown as { text?: string }).text = (
          element as unknown as { text?: string }
        ).text;

        if (consent) {
          if (ds['original-display'] !== undefined) {
            newElement.style.display = ds['original-display'];
          }
          if (ds.src !== undefined) newElement.src = ds.src;
        } else {
          // `about:blank` (not the empty string) — `src=""` is treated
          // as a relative URL by browsers, so the iframe would load the
          // host page recursively inside itself. `about:blank` is the
          // standard "explicitly empty document" URL.
          newElement.src = 'about:blank';
          if (ds['modified-by-klaro'] !== undefined && ds['original-display'] !== undefined) {
            newElement.setAttribute('data-original-display', ds['original-display']);
          } else {
            if (element.style.display !== undefined) {
              newElement.setAttribute('data-original-display', element.style.display);
            }
            newElement.setAttribute('data-modified-by-klaro', 'yes');
          }
          newElement.style.display = 'none';
        }
        parent.insertBefore(newElement, element);
        parent.removeChild(element);
        this._toggleAutoPlaceholder(newElement, service, consent);
      } else if (element.tagName === 'SCRIPT' || element.tagName === 'LINK') {
        const scripted = element as HTMLScriptElement & HTMLLinkElement;
        if (consent && scripted.type === (type ?? '') && scripted.src === src) {
          console.debug(
            `Skipping ${element.tagName} for service ${service.name}, as it already has the correct type or src...`
          );
          continue;
        }
        const newElement = document.createElement(element.tagName) as HTMLScriptElement &
          HTMLLinkElement;
        for (const attribute of Array.from(element.attributes)) {
          newElement.setAttribute(attribute.name, attribute.value);
        }
        if (element.hasAttribute('nonce')) {
          newElement.setAttribute('nonce', (element as HTMLScriptElement).nonce ?? '');
        }
        newElement.innerText = element.innerText;
        (newElement as unknown as { text?: string }).text = (
          element as unknown as { text?: string }
        ).text;
        if (consent) {
          newElement.type = type ?? '';
          if (src !== undefined) newElement.src = src;
          if (href !== undefined) newElement.href = href;
        } else {
          newElement.type = 'text/plain';
        }
        parent.insertBefore(newElement, element);
        parent.removeChild(element);
        this._toggleAutoPlaceholder(newElement, service, consent);
      } else {
        // images and others — modify in place
        const generic = element as unknown as Record<string, string | undefined>;
        if (consent) {
          for (const attr of attrs) {
            const attrValue = ds[attr];
            if (attrValue === undefined) continue;
            if (ds[`original-${attr}`] === undefined) ds[`original-${attr}`] = generic[attr] ?? '';
            generic[attr] = attrValue;
          }
          if (ds.title !== undefined) (element as HTMLElement).title = ds.title;
          if (ds['original-display'] !== undefined) {
            element.style.display = ds['original-display'];
          } else {
            element.style.removeProperty('display');
          }
        } else {
          if (ds.title !== undefined) element.removeAttribute('title');
          if (ds['original-display'] === undefined && element.style.display !== undefined) {
            ds['original-display'] = element.style.display;
          }
          element.style.display = 'none';
          for (const attr of attrs) {
            const attrValue = ds[attr];
            if (attrValue === undefined) continue;
            if (ds[`original-${attr}`] !== undefined) {
              generic[attr] = ds[`original-${attr}`];
            } else {
              element.removeAttribute(attr);
            }
          }
        }
        applyDataset(ds, element);
        this._toggleAutoPlaceholder(element, service, consent);
      }
    }
  }

  /**
   * Click-to-enable affordance: when a `[data-name]` element is blocked
   * by absent consent, insert a `<simplecmp-contextual-notice>` as its
   * immediate following sibling so the visitor can grant consent
   * inline; when consent flips on, remove that notice.
   *
   * Idempotent — a duplicate call with `consent: false` won't insert a
   * second notice if one is already there. Skips when:
   *
   * - the global `config.autoContextualPlaceholder` is `false`
   * - the per-service `service.noAutoPlaceholder` is true
   * - the per-element `data-no-placeholder` attribute is present
   *
   * The auto-inserted notice is marked
   * `data-simplecmp-auto-placeholder data-simplecmp-for="<service>"`
   * so the remove path can identify and prune it without affecting any
   * integrator-authored `<simplecmp-contextual-notice>` siblings.
   */
  private _toggleAutoPlaceholder(anchor: HTMLElement, service: Service, consent: boolean): void {
    if (typeof document === 'undefined') return;
    const existing = anchor.nextElementSibling;
    const matchedExisting =
      existing?.hasAttribute('data-simplecmp-auto-placeholder') &&
      existing.getAttribute('data-simplecmp-for') === service.name
        ? existing
        : null;

    if (consent) {
      if (matchedExisting !== null) matchedExisting.remove();
      return;
    }
    if (this.config.autoContextualPlaceholder === false) return;
    if (service.noAutoPlaceholder === true) return;
    if (anchor.hasAttribute('data-no-placeholder')) return;
    if (matchedExisting !== null) return;

    const notice = document.createElement('simplecmp-contextual-notice');
    // `service-name` attribute is set for DOM-inspection ergonomics
    // (devtools, integration tests, ad-hoc querySelector) but the
    // component-side property is set explicitly below — relying on
    // Lit's attribute→property sync alone is fragile when the element
    // is created and the attribute is set before the custom-element
    // upgrade has finished.
    notice.setAttribute('service-name', service.name);
    notice.setAttribute('data-simplecmp-auto-placeholder', '');
    notice.setAttribute('data-simplecmp-for', service.name);
    // Propagate `data-blocked-source` (set by Phase 1 server-side
    // rewriter — see TYPO3 ext `HtmlRewriter`) to the notice so its
    // `_renderMode()` can pick the right UI: `library` → state 2
    // (Ja only), `host` → state 3 (informational, no buttons),
    // absent → defaults to state 2 / state 1 depending on config
    // membership.
    const blockedSource = anchor.getAttribute('data-blocked-source');
    if (blockedSource !== null) {
      notice.setAttribute('data-blocked-source', blockedSource);
    }
    // Per-instance overrides (REQ-19): if a content editor pasted
    // `data-simplecmp-title` / `-description` on the embed itself,
    // surface them on the auto-inserted notice so its render
    // resolvers can consume them. Integrators authoring notices
    // directly can put these attributes on the <simplecmp-contextual-
    // notice> element instead — same effect.
    for (const attr of ['data-simplecmp-title', 'data-simplecmp-description']) {
      const v = anchor.getAttribute(attr);
      if (v !== null) notice.setAttribute(attr, v);
    }
    // The component reads `serviceName`, `config`, and `manager` as Lit
    // properties (not attributes) — without them, `_resolveService()`
    // returns undefined and the notice renders `nothing`. The UI mounter
    // sets these on integrator-authored notices; for engine-inserted
    // ones we have to do it ourselves. Cast through unknown so the
    // engine module stays independent of the UI component's exported
    // type (ADR-0007 keeps `src/engine` UI-free).
    type NoticeProps = {
      manager: ConsentManager;
      config: ConsentConfig;
      serviceName: string;
    };
    const props = notice as unknown as NoticeProps;
    props.serviceName = service.name;
    props.manager = this;
    props.config = this.config;
    anchor.insertAdjacentElement('afterend', notice);
  }

  /** Delete cookies set by a service when consent is revoked. */
  updateServiceStorage(service: Service, consent: boolean): void {
    if (consent) return;
    if (!service.cookies || service.cookies.length === 0) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const cookies = getCookies();
    for (const entry of service.cookies) {
      let cookiePattern: unknown = entry;
      let cookiePath: string | undefined;
      let cookieDomain: string | undefined;
      if (Array.isArray(cookiePattern)) {
        [cookiePattern, cookiePath, cookieDomain] = cookiePattern as [
          unknown,
          string | undefined,
          string | undefined,
        ];
      } else if (
        cookiePattern !== null &&
        typeof cookiePattern === 'object' &&
        !(cookiePattern instanceof RegExp)
      ) {
        const cp = cookiePattern as { pattern?: unknown; path?: string; domain?: string };
        cookiePattern = cp.pattern;
        cookiePath = cp.path;
        cookieDomain = cp.domain;
      }
      if (cookiePattern === undefined) continue;
      let regex: RegExp;
      if (cookiePattern instanceof RegExp) {
        regex = cookiePattern;
      } else if (typeof cookiePattern === 'string') {
        regex = cookiePattern.startsWith('^')
          ? new RegExp(cookiePattern)
          : new RegExp(`^${escapeRegexStr(cookiePattern)}$`);
      } else {
        continue;
      }
      for (const cookie of cookies) {
        if (regex.exec(cookie.name) === null) continue;
        console.debug(
          'Deleting cookie:',
          cookie.name,
          'Matched pattern:',
          regex,
          'Path:',
          cookiePath,
          'Domain:',
          cookieDomain
        );
        let deleted = deleteCookie(cookie.name, cookiePath, cookieDomain);
        // If no domain was specified, also try `.<host>` since some services
        // (Facebook pixel etc.) explicitly set the dotted form.
        if (!deleted && cookieDomain === undefined) {
          deleted = deleteCookie(cookie.name, cookiePath, `.${window.location.hostname}`);
        }
        if (!deleted) {
          console.warn(
            `SimpleCMP: cookie "${cookie.name}" still present after deletion attempt for service "${service.name}". It may be set on a path/domain we cannot reach from JS, or another script re-set it.`
          );
        }
      }
    }
  }

  /**
   * Reconcile stored consents against the configured services list. Adds
   * default values for services missing from storage; removes orphan
   * consents for services that no longer exist. Sets `changed=true` if
   * the service set differs from what was stored.
   */
  private _checkConsents(): void {
    let complete = true;
    const services = new Set(this.config.services.map((s) => s.name));
    const storedConsents = new Set(Object.keys(this.consents));

    // Drop orphans
    for (const key of Object.keys(this.consents)) {
      if (!services.has(key)) delete this.consents[key];
    }
    // Fill missing
    for (const service of this.config.services) {
      if (!storedConsents.has(service.name)) {
        this.consents[service.name] = this.getDefaultConsent(service);
        complete = false;
      }
    }
    this.confirmed = complete;
    if (!complete) this.changed = true;
  }
}

// Default export retained for the legacy `import ConsentManager from './consent-manager'`
// pattern Klaro's lib.js uses.
export default ConsentManager;

// Internal helper export — used by recorder tests for typing only
export type { Store, KeyedStore };

// Re-export the auxiliary-store helper so lib.js can do
// `new SessionStorageStore(manager)` without a separate import path.
export { SessionStorageStore };

// Suppress unused-imports check on stores' isKeyedStore until consumed
void isKeyedStore;
