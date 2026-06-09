# Changelog

All notable changes to SimpleCMP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches 1.0. Until then, breaking changes may occur in minor versions.

## [Unreleased]

### Added

- **`cmsBridge.reportGeneration` — server-driven cross-session re-report.**
  Cross-session dedup was a one-way client decision: once the bridge POSTed a
  detection it wrote a 7-day `localStorage` marker and refused to re-POST,
  with no way for the receiver to say "I dropped that row, resend it" — so a
  detection an admin deleted never resurfaced on already-reporting browsers.
  The new option carries a per-source monotonic counter (default `0`) in the
  init config; markers now encode the generation they were written under
  (`<gen>.<ts>`), and a marker older than the configured generation is treated
  as a miss → re-POST. Legacy bare-timestamp markers read as generation `0`,
  so any bump invalidates them. Travels in the config (not the webhook
  response) so a fully-deduped bridge still learns of a reset on its next page
  load. See `docs/cms-bridge-webhook.md`.

- **`/v1/health.dataHash` on the reference server** — sha256 over the
  service JSON files (computed via
  `simplecmp/services-library@v0.3.1`'s `ServicesLibrary::dataHash()`).
  Stable across README / CI / docs commits, so downstream consumers
  can distinguish *content* drift from arbitrary commit churn. The
  hash lives in the SQLite `meta` table and is populated by
  `bin/rebuild-from-library.php` + `bin/seed.php`; legacy databases
  pre-dating the meta entry simply omit the field until the next
  rebuild backfills it.

### Fixed

- **`getDefaultConsent` honors an explicit `service.default: false`.**
  It previously used `service.default || service.required`, so an
  explicit `false` was swallowed (`false || undefined`) and fell through
  to `config.default` — a service couldn't opt out of a global
  `default: true`. It also ignored `config.required` and applied the GPC
  suppression to required services. Now resolves `required` as
  `service.required ?? config.required ?? false` (required services
  always consent, even under a GPC signal) and uses `??` for the default,
  matching the precedence already used by `changeAll()`.

### Security

- **Slash-bounded regex *origin* matchers are now anchored to a full-host
  match.** `originMatches` compiled a `"/…/"` origin matcher unanchored,
  so `/tracker\.com/` would match any host *containing* it — e.g.
  `eviltracker.com.attacker.net` — letting a hostile host impersonate a
  known service in the classifier and the universal-blocking host gate.
  The source is now wrapped as `^(?:…)$`. Cookie-name regexes are
  deliberately left partial (e.g. `/^_ga/` is a prefix matcher). No
  bundled service uses the regex-origin form, so this only affects
  custom/admin-authored configs.

## 0.3.0 — 2026-05-27

First tagged release. Captures the rewrite-track and the
accumulated feature work since the Klaro fork, plus REQ-19 Phase B
(L2 Provider-Informationen modal for blocked-embed placeholders).

Headline of this release:

- **L2 Provider-Informationen modal** (`<simplecmp-provider-info-modal>`)
  rendered from the contextual notice's new "Weitere Informationen ›"
  link. Closes the layered-disclosure parity gap with the DACH-
  market accepted compliance shape (banner first-view → service
  expansion / placeholder modal → linked Datenschutzerklärung).
  Recipient name, full postal address, country, privacy policy URL,
  opt-out URL, partner / joint-controllers, provider description —
  all read from a service's new optional vendor* fields.
- **Per-instance data-attribute overrides** on the blocked embed
  itself: `data-simplecmp-title`, `data-simplecmp-description`. The
  engine's auto-placeholder flow propagates them from the embed
  anchor to the inserted notice; the notice resolvers consult them
  as the highest-priority source. This is the durable
  differentiator vs. every commercial + open-source CMP surveyed,
  which all lock customization at the per-service level.
- **`Service` + `LibraryFallback` types extended** with optional
  fields: `vendor`, `vendorCountry`, `vendorAddress`,
  `vendorOptOutUrl`, `vendorPartner`, `vendorDescription`,
  `privacyPolicyUrl`. Integrators surface them via `config.services`
  or via `libraryFallback` for library-known-but-not-configured
  services. TYPO3 ext (`SimpleCMP/t3-simplecmp`) and library
  (`SimpleCMP/services-library` ≥ v0.3.0) ship the matching pieces.

Captured in REQ-19 in `docs/requirements.md`. Full background +
research: `docs/research/2026-05-blocked-embed-placeholder-cmp-survey.md`.

### Fixed

- **Cookie deletion now warns when it silently fails.** `deleteCookie`
  returns a boolean reflecting post-write visibility; `updateServiceStorage`
  emits a `console.warn` naming the cookie and the service when both
  deletion attempts (with-domain + dotted-host fallback) leave the
  cookie behind. Previously the engine + visitor both treated the
  revocation as successful even if the cookie was set on a path/domain
  unreachable from JS. 3 regression tests in
  `src/engine/utils/cookies.test.ts`.
- **Recorder listener sets snapshotted before dispatch.** `_announce`
  and `_announceSettled` now iterate `[...set]` instead of the live
  Set. A listener that called `.off()` (or `.on()`) on itself or
  another listener mid-dispatch previously perturbed the in-flight
  iteration with order-dependent behavior. Now additions are queued
  for the next event (DOM convention); removals don't take effect
  until the next event.
- **`SimpleCmpElement` watcher subscription tracking.** Previously
  the base class sourced the manager to unwatch from Lit's
  `changed.get('manager')`, which could drift from the manager the
  watcher was actually attached to when `disconnectedCallback` /
  `connectedCallback` ran between the property swap and the deferred
  `willUpdate`. Now tracks the target in `_watcherManager` and
  collapses lifecycle hooks into idempotent `_syncWatcher` /
  `_detachWatcher` helpers. Also fixed a quieter double-subscribe on
  the standard mount path (connect subscribed once, then initial
  willUpdate subscribed again). 5 regression tests in
  `tests/base.test.ts`.
- **Port-smuggling bypass in `decideBlock` closed.** `new URL(url).host`
  includes the port for non-default ports, so a URL like
  `https://tracker.com:8443/x` did NOT match a bare `tracker.com`
  library entry. Asymmetric port handling now: same-origin check
  stays port-strict (a page on `localhost:3000` doesn't auto-trust
  `localhost:8080`); matcher lookup uses `hostname` (port-stripped)
  so consent decisions apply per-host, not per-host-port.

### Added — tests

- **`decideBlock` URL-parsing fuzz** (`src/runtime-patches/index.test.ts`):
  28 table-driven cases covering pass-through edges (empty, about:blank,
  unparseable, data:/javascript:/file:/blob:, same-origin, unknown
  host, consented service), block decisions (plain http(s),
  protocol-relative, userinfo prefix, mixed-case, whitespace-trimmed,
  subdomain, IDN → Punycode, IPv4, IPv6 brackets, trailing-dot,
  default-port stripped, non-default port stripped, query + fragment),
  and asymmetry (port-mismatched URL matches bare-host library entry;
  same-origin check stays port-strict).

### Added

- **Purposes line in the contextual notice.** A muted "Zwecke:
  Marketing, Statistik" line renders below the description when the
  service has known purposes — gives the visitor a clear "what AM
  I consenting to?" signal at the point of consent. Two data
  sources, in precedence order: (1) `service.purposes` for state-1
  configured services; (2) new `ConsentConfig.libraryFallback?.<name>.purposes`
  for state-2 library-known unknowns. Integrators (TYPO3 ext, future
  WordPress plugin) populate `libraryFallback` to surface library
  purposes for state-2 services without shipping the entire library
  to FE. New `LibraryFallback` type exported from
  `src/engine/index.ts`. State 3 (truly unknown hosts) intentionally
  omits purposes — we have no data and the visitor has no consent
  path anyway.
- **Three-state contextual notices for library-known and host-derived
  blocks (ADR-0013 Phase 4 step 4c).** Closes the "white void" the
  visitor used to see when a `[data-name]` element's service wasn't
  in `config.services`. The notice now picks one of three render
  modes from `data-blocked-source` on the anchor:
  - **state 1** (service in `config.services`) — full notice with
    `accept-once` + `accept-always` (if stored) + `configure` buttons.
    Unchanged from before.
  - **state 2** (`data-blocked-source="library"`, service NOT in
    config) — visitor sees the `accept-once` ("Ja") button only.
    `accept-always` is hidden because there's no persistent toggle to
    wire it to; `configure` is hidden because the modal has no entry
    for an unconfigured service. The one-time consent grant is
    defensible because the visitor recognises the library-derived
    brand (e.g. "youtube").
  - **state 3** (`data-blocked-source="host"`, universal-block caught
    an otherwise-unknown third-party host) — informational notice
    with NO buttons. The visitor has no basis to grant informed
    consent to an unknown vendor; the only path forward is contacting
    the site admin. New i18n key `contextualConsent.descriptionUnknownHost`
    in EN + DE.
  Companion changes:
  - `ConsentManager._toggleAutoPlaceholder` copies `data-blocked-source`
    from the anchor onto the engine-inserted notice so the render-mode
    logic can pick it up.
  - `ConsentManager.applyConsents` adds a second pass that processes
    `[data-name]` elements whose service is NOT in `config.services` —
    synthesizes a minimal `Service` and dispatches through the
    existing pipeline. Without this, removing a service from
    `config.services` while Phase 1 server-side rewriting still
    produces `data-name` would leave a blank iframe with no notice.
  - `<simplecmp-contextual-notice>` `:host` switched to flex column
    with `justify-content: center` so the notice content centers
    inside aspect-ratio-constrained wrappers (Bootstrap's
    `.ratio ratio-16x9` etc.) instead of clinging to the top with
    ~300px of white below.
  - `initLit()` re-runs `manager.applyConsents()` at the end of
    mountUI for the body-deferred init path (ADR-0013 Phase 4 step
    1b) so the auto-placeholder logic catches `[data-name]` elements
    that didn't exist when the manager was constructed in `<head>`.
- **Universal pre-consent blocking — runtime patches (ADR-0013 Phase
  2).** New opt-in `interceptRuntime` config field on `init()`. When
  enabled, SimpleCMP installs prototype-level patches on
  `HTMLScriptElement.prototype.src`,
  `HTMLIFrameElement.prototype.src`,
  `HTMLImageElement.prototype.src`, `window.fetch`,
  `XMLHttpRequest.prototype.open`+`send`, and
  `navigator.sendBeacon`. JS-injected calls to configured
  third-party hosts (matched via `config.services[].origins`) are
  blocked until the visitor consents; same-origin and unconfigured
  hosts pass through untouched. Pairs naturally with the TYPO3 ext's
  server-side rewriter shipped in Phase 1 — the rewriter catches
  declarative tags, the runtime patches close the JS-injected gap.
  Pass `true` for defaults or an object for `sameOriginHosts`
  / `onBlock` overrides. Off by default — see
  `src/runtime-patches/README.md` and `docs/adr/0013-universal-blocking-implementation-plan.md`.
- **`?simplecmp_discover=1` discover-mode override.** When the page URL
  carries this query parameter, the CMS bridge ignores the bandwidth
  controls that normally suppress repeat visits for that page load:
  `crossSessionDedupMs` is forced to `0` (no localStorage marker
  written or read), `sampleRate` is forced to `1` (always in scope),
  and `respectDoNotTrack` is forced to `false`. Intended for
  admin-driven sitemap sweeps run from a CMS backend (e.g. the TYPO3
  ext's *Discover trackers* page) where every page load needs to
  POST regardless of the visitor-side dedup state. The visitor-facing
  default — no param, no flags — is unchanged. Three Playwright specs
  in `tests/bridge/discover-mode.spec.ts` cover the override and the
  control case.

### Added

- **Recorder visibility for runtime-blocked calls.** With
  `interceptRuntime` enabled, URLs swallowed at the prototype-setter
  level used to be invisible to the recorder (no network request →
  no `PerformanceObserver` entry → no detection → silent BE log).
  `init()` now wraps the patches' `onBlock` hook to feed a synthetic
  `RawDetection` through `Recorder.recordSyntheticDetection(raw)`,
  so blocked calls flow through the same classifier + bridge +
  webhook path as observed requests. Admins recover the
  "discover unknown trackers via the detection log" workflow under
  universal blocking. Integrator-supplied `onBlock` callbacks still
  fire alongside the internal feed. New public method
  `Recorder.recordSyntheticDetection(raw)` for direct producers.
- **`interceptRuntime.universalBlock: true` — strict block-all-third-party
  posture.** Widens the FE matcher so any non-same-origin call to a
  host that DOESN'T match a configured service is also blocked, using
  the host itself as the synthetic service id. Pairs with the per-CMS
  universal-blocking switch (TYPO3 Site Set
  `simplecmp.universalBlocking.enabled`) where the admin has opted in
  to maximum protection. Off by default — narrow mode (configured
  services only) stays the default for plain `interceptRuntime: true`
  callers. `buildHostMatcher` gains a `{ blockAllUnknown?: boolean }`
  options arg for direct consumers.

### Changed

- **`InterceptRuntimeOptions.sameOriginHosts` is now additive instead
  of replacing.** `window.location.host` is *always* included
  implicitly; entries you pass are added on top. Lets integrators
  forward an admin allowlist without accidentally stripping own-host
  protection. Behaviour change for callers that previously passed an
  array expecting replacement — explicit own-host entries become
  harmless duplicates.
- **`init()` is now safe to call before `document.body` is parsed.**
  The DOM-free setup (manager creation, recorder start, runtime-patch
  installation) runs immediately; the banner/modal mount is deferred
  to `DOMContentLoaded` when body isn't ready yet. Lets integrators
  wire the SimpleCMP bundle + the inline `init()` call into `<head>`
  so the runtime patches install BEFORE any inline body script can
  dispatch third-party requests — previously `init()` would throw on
  the first `document.body.appendChild(...)` inside `mountUI`. The
  returned handle's `show()` / `hide()` queue if mount is deferred
  and replay once it lands. `handle.manager` is available immediately
  regardless. No API change — pre-body callers just stop throwing.

### Fixed

- **`changeAll(false)` now correctly declines non-required services
  even when `config.required: true` is set.** The previous operator
  chain (`service.required || this.config.required || value`) treated
  `config.required` as a global force-true override, so visitors
  could never decline anything on configs that used the config-level
  required default. Fix uses the same per-service-overrides-default
  pattern as `applyConsents` line 461 (`service.required ??
  this.config.required ?? false`), and short-circuits `value` only
  when the resolved required is true. An explicit `service.required:
  false` now properly overrides a `config.required: true` default.
- **XHR `.open()` reuse no longer carries a stale block marker.** An
  XMLHttpRequest instance whose first `.open()` was blocked retained
  the internal `__simplecmpBlockedService` marker forever — a
  subsequent `.open()` with a benign URL still triggered `.send()`'s
  silent suppression code path, breaking legitimate later requests
  on the same instance. Fix clears the marker at the top of every
  `.open()` so it only reflects the current call.
- **State-2 "Ja" click now actually unblocks the iframe.** When the
  visitor accepted a state-2 contextual notice (library-known but
  not in `config.services`), the engine swapped the iframe's src
  from `about:blank` to the real URL — but with `universalBlock:
  true` the runtime patch's `src` setter re-blocked the assignment
  because the URL's host (e.g. `www.youtube-nocookie.com`) didn't
  match the consent grant keyed on the data-name (`youtube`). The
  iframe stayed at `about:blank` even after the click. Fix: the
  `src` setter on `HTMLScriptElement` / `HTMLIFrameElement` /
  `HTMLImageElement` now short-circuits when the element carries a
  `data-name` and consent for that name is granted. Engine-managed
  elements defer to data-name consent; unmarked third-party calls
  go through the normal host-based decideBlock path.
- **Bandwidth-control options now reach the bridge from the public
  `init()` config.** The schema-v2 work added `crossSessionDedupMs`,
  `flushDebounceMs`, `maxBatchSize`, `sampleRate`, and
  `respectDoNotTrack` to the `CmsBridge` constructor but
  `SimpleCMPConfig.cmsBridge` was still only forwarding
  `source / dedupTtlMs / timeoutMs`, so consumers couldn't actually
  tune the new knobs from the surface API. The `Pick<>` is widened
  and each option threads into the constructor call.

### Added — testing

- **Playwright wire-contract suite for the CMS bridge**
  (`tests/bridge/`, 11 specs against a real browser). Locks in the
  schema-v2 contract: payload shape (envelope + batched
  `detections[]`, `status:'known'` rows carry `matchedService`),
  in-debounce coalescing, `maxBatchSize` force-flush, `pagehide` →
  `sendBeacon` flush via in-page event dispatch (real navigation
  tears down the page context before Playwright captures the
  beacon), `localStorage` cross-session dedup with the TTL=0
  override, `navigator.doNotTrack` respect + override, feedback-loop
  suppression of the bridge's own host. Caught the
  bandwidth-control-options-not-forwarded bug above. New fixture
  page `demos/_test-bridge.html` loads the bundle without
  auto-initing so specs drive `SimpleCMP.init({...})` directly with
  per-test config.

### Changed (breaking)

- **CMS bridge schema bumped to v2 — batched detections.** The bridge
  now POSTs `{ detections: [...] }` instead of a single `detection`
  object. Receivers must iterate the array. Schema v1 is no longer
  emitted; receivers that hard-code v1 will reject the v2 payloads with
  a 400 until they're updated.
- **Bridge POSTs `status:'known'` detections too**, not just unknowns.
  Library-recognized cookies now reach the receiver so backends can
  surface them for admin curation (e.g. as "Erkannt" in the TYPO3 BE).
  The `'detectionSettled'` subscription pattern still applies — the
  bridge sees the final classification, not the initial in-flight state.
- **Batching + bandwidth controls.** Detections queue in memory and
  flush via a 1.5s debounce or `navigator.sendBeacon` on `pagehide`.
  Cross-session dedup via `localStorage`
  (`simplecmp-reported:${source}:${kind}:${identifier}`, default 7d TTL)
  keeps return-visitor traffic near zero.
  `navigator.doNotTrack === '1'` skips all POSTs.
  New options: `crossSessionDedupMs`, `flushDebounceMs`, `maxBatchSize`,
  `sampleRate`, `respectDoNotTrack`. See `docs/cms-bridge-webhook.md`
  for the full v2 contract.

### Added

- **Cross-classifier parity test fixture**
  (`tests/classifier-parity-fixture.json` + matching
  `tests/classifier-parity.test.ts`). Shared with the PHP side in
  `simplecmp-typo3/Tests/Unit/Classifier/`. 10 cases covering
  literal / regex / host-qualified matchers — every change to the
  matching logic must produce the same `(cookie, matcher,
  observedOrigins) → boolean` mapping on both sides. Caught a
  PHP-side regression during ADR-0010 rollout (`DetectionListPresenter`
  forgot to handle the object form).

- **Host-qualified cookie matchers (ADR-0010).** Extends
  `matches.cookies` to accept an object form
  `{ name, requireOrigin }` so generic cookie names (Stripe's `m`,
  GTM's `td`, Bing's MR/MC0/CC, …) can be classified safely: the
  matcher fires only when the recorder has *also* observed the
  qualifying origin in the current session. Sites that happen to set
  a cookie called `m` without ever loading anything from
  `m.stripe.com` keep it `unknown` instead of false-classifying as
  Stripe. `LocalClassifier` becomes mildly stateful — tracks observed
  origins via non-cookie detections — and re-classifies previously
  `unknown` cookies through the existing `enrichDetection` pathway
  when a qualifying origin arrives late. `LayeredClassifier`
  re-validates Service-DB lookup responses against the
  host-qualifier (the DB middleware only checks the name part).
  Backwards-compatible — older consumers ignore object entries.
  No protocol-version bump. `docs/service-db-protocol.md` updated
  with the new shape; `docs/adr/0010-host-qualified-cookie-matchers.md`
  for the design.

- **Recorder: `'detectionSettled'` event.** New event that fires once
  per detection *after* classification is final. For detections that
  don't trigger an async lookup it follows `'detection'` in the same
  tick; for detections where the classifier kicked off a Service-DB
  lookup it fires after the lookup resolves (or errors out). The
  optional `pending?: Promise<void>` field on the `Classifier`
  interface lets `LayeredClassifier` signal "async work in flight";
  `LocalClassifier` omits it. Existing `'detection'` consumers are
  unchanged. (REQ-N7.)

- **Heading typography tokens.** Two new design tokens for sites that
  want different fonts or sizes for headings vs body text:
  `--simplecmp-font-family-heading` (defaults to inherit
  `--simplecmp-font-family`, so existing installs are visually
  unchanged) and `--simplecmp-font-size-heading` (default `20px`).
  Heading rules in `banner.ts` (h2) and `modal.ts` (h1) read the new
  tokens; mirrored in `default.css` for the light-DOM fallback path.
  Enables per-surface heading control without affecting body styling.
- **Recorder: `ignoreCookies` option.** New
  `RecorderOptions.ignoreCookies?: readonly string[]` short-circuits
  ingestion for the listed cookie names before classification, so the
  recorder no longer reports its own consent cookie as an unknown
  tracker on every page load. `startRecorder()` auto-prepends the
  resolved consent `storageName` to the list; integrators can still
  extend it for other infra-owned cookie names.
- **i18n: analytics, personalization, security purpose translations.**
  Bundled EN/DE translation maps gain titles and descriptions for the
  three remaining purpose keys; previously these fell back to the
  English `asTitle(key)` form in both languages, leaving the banner's
  `{purposes}` interpolation mixed-language ("Marketing, Werbung,
  Analytics, Personalization & Security").
- **Accessibility CI gate (REQ-6 follow-up).** Playwright-based
  axe-core suite (`tests/a11y/*.spec.ts`) runs on every CI build as a
  parallel job. Scans demos 1, 4, 5, 6 (skipping the demos that load
  external resources, which would make CI flaky) against WCAG 2.1 AA;
  blocks PRs on `serious` or `critical` violations, surfaces lower
  severities as non-blocking log entries. Browser binaries cached by
  lockfile hash so cold-install only happens on dep bumps.
- **Phase 4 — CMS Bridge (REQ-9).** Webhook-based alerting for unknown
  trackers in production. When the Recorder produces a detection with
  `status: 'unknown'` (no local-services match, no Service-DB hit), the
  bridge POSTs a JSON payload to `cmsBridgeUrl`. Schema documented in
  `docs/cms-bridge-webhook.md` (schemaVersion 1; page context, library
  identity, detection echo). Configurable Bearer auth via `cmsBridgeAuth`
  (structurally identical to `ServiceDbAuth` so one CMS plugin token
  works for both endpoints). Per-`${kind}:${identifier}` dedup with 1 h
  TTL by default, overridable via `cmsBridge.dedupTtlMs`. Query strings
  and URL fragments are stripped from `page.url` and `detection.firstSeenOn`
  for privacy. Failure modes split 4xx (keep dedup, receiver said no) vs
  5xx / network errors (clear dedup so a future detection can retry),
  with `_warnOnce` gating per error category. Misconfig warning fires
  when `cmsBridgeUrl` is set without `record: true`. Bridge suppresses
  detections whose `origin` matches its own host so the bridge's webhook
  POSTs (and any sibling polling on the same host) don't generate
  synthetic "unknown tracker" alerts about the bridge itself. 13 unit
  tests in `src/cms-bridge/bridge.test.ts` plus an end-to-end test in
  `tests/index.test.ts` guarding the "double-fire on enrichment" gotcha
  where a Service-DB hit re-announces a detection as known.
- Initial repository scaffolding: TypeScript, tsup, Vitest, Biome, GitHub Actions CI
- Architecture decision records:
  - ADR-0001: Record architecture decisions
  - ADR-0002: Fork Klaro! as the consent UI engine
  - ADR-0003: Build targets — ESM, CJS, IIFE
- BSD-3-Clause license aligned with Klaro! upstream
- Project README and contribution guidelines
- Imported Klaro! 0.7.22 (commit `db9f1ac`) into `src/core/` as the initial
  consent UI snapshot. IDE configurator and upstream build infrastructure were
  deliberately excluded. See `docs/upstream-tracking.md`.
- JSX runtime via Preact compat (esbuild alias `react`/`react-dom` →
  `preact/compat`); `.js` files are loaded as JSX so Klaro's mixed entries
  build without renaming.
- Stylesheet pipeline: `pnpm build:css` and `pnpm build:css:min` run Dart Sass
  against `src/core/scss/klaro.scss` and emit `dist/styles/klaro.css` +
  `dist/styles/klaro.min.css`. `pnpm build` chains JS + CSS.
- Runtime dependencies: `preact ^10.19.6`, `classnames ^2.5.1`,
  `prop-types ^15.8.1`. Dev: `sass ^1.83.0`, `esbuild ^0.28.0`.
- `src/index.ts` wired to Klaro: `init(config)` renders the consent UI; `show`,
  `addEventListener`, `getManager`, `updateConfig` are re-exported. Public types
  `SimpleCMPConfig` and `RenderOptions` exposed.
- SimpleCMP-specific config fields (`record`, `serviceDbUrl`, `cmsBridgeUrl`)
  emit a `console.warn` at init time because Phase 2/3/4 are not yet
  implemented.
- `src/core/lib.d.ts` shim types the narrow Klaro surface that
  `src/index.ts` consumes. SimpleCMP-authored, kept narrow on purpose.
- Vitest config (`vitest.config.ts`) gets two custom Vite plugins
  (`klaroJsxInJs`, `emptyAssetImports`) plus `resolve.alias` and `define` to
  mirror tsup's behaviour. End-to-end render test against happy-dom.
- esbuild defines: `VERSION` (from package.json) and `module.hot` (false) so
  Klaro's webpack-specific globals resolve correctly under tsup/Vite.
- Translations gebündelt: tsup esbuild plugin (`yamlPlugin`) and matching
  Vite plugin parse Klaro's 25 YAML language files at build time via `js-yaml`
  and inline the result. `src/index.ts` seeds `klaro.defaultTranslations` on
  import. Bundle grows from 80 KB → 137 KB; `js-yaml` does not ship at runtime.
- `hu.yml` (Hungarian) fails to parse upstream — plugins emit a build warning
  and substitute `{}`. Hungarian users get English fallback. See
  `docs/upstream-tracking.md`.
- Build-time devDeps: `js-yaml ^4.1.1`, `@types/js-yaml ^4.0.9`.
- **REQ-1 — Impressum-Link separat von Datenschutz.** Erste echte Modifikation
  am Klaro-Fork. `SimpleCMPConfig.imprint` (gleiche Shape wie `privacyPolicy`)
  wird in `consent-notice.jsx` und `consent-modal.jsx` ausgewertet und als
  zweiter Link in einer eigenen Footer-Zeile (`<p className="cn-policy-links">`,
  `cm-policy-links`) gerendert. Englische Translation `Imprint` ergänzt;
  DE/FR + 18 weitere Sprachen hatten den Eintrag aus Upstream. Siehe
  `docs/requirements.md` (REQ-1) und `docs/upstream-tracking.md`
  (Divergenz-Log).
- **REQ-2 — "Alle ablehnen" gleichberechtigt zu "Alle akzeptieren".** Klaro
  upstream hatte keine SCSS-Regel für `cm-btn-danger`, sodass der Decline-Button
  das muted-gray Default-Styling erbte (Asymmetrie zur grünen Accept-Variante).
  Hinzugefügt: `cm-btn-danger { background-color: red1 }` in
  `src/core/scss/klaro.scss`. Beide Buttons sind nun visuell gleichwertig.
  Zusätzlich warnt `init()` jetzt mit Verweis auf BGH "Cookie II" und DSK 2022,
  wenn `hideDeclineAll: true` gesetzt ist. Siehe `docs/requirements.md` (REQ-2).
- **REQ-3 — Consent-Versionierung mit automatischer Re-Abfrage.** Neue Felder
  `SimpleCMPConfig.consentVersion` und `consentVersionPolicy` (`'any'`/`'major'`).
  Storage-Format wird zu `{ __v, consents }` gewrapt, wenn `consentVersion`
  gesetzt ist (sonst altes Klaro-Format, backwards-compat). Bei Mismatch:
  Stored Consent wird in `loadConsents` verworfen, Banner erscheint erneut
  über Klaros bestehende `changeDescription`-UX. Neues Event
  `consentVersionMismatch` über `simplecmp.addEventListener` abonnierbar.
  Siehe `docs/requirements.md` (REQ-3).
- **REQ-5 — GPC-Signal-Erkennung (Global Privacy Control).** `getDefaultConsent`
  in `consent-manager.js` erkennt `navigator.globalPrivacyControl === true`
  und setzt nicht-required Services beim ersten Besuch auf opt-out. Per
  Config abschaltbar via `respectGPC: false` (Default `true`). Required-
  Services bypassen das Signal. CCPA/CPRA-konform und vorbereitet für eine
  potenzielle DSGVO-Auslegung in der EU. Siehe `docs/requirements.md` (REQ-5).
- **REQ-4 — Floating Withdrawal-Trigger.** Neues Modul `src/floating-trigger.ts`
  rendert einen persistenten Cookie-Settings-Button außerhalb von Klaros
  Render-Tree. Aktivierbar via `SimpleCMPConfig.floatingTrigger: true |
  { position, label }`. Keyboard-accessible (Tab-Stop, aria-label,
  `:focus-visible` Outline), respektiert `prefers-reduced-motion`,
  idempotent bei Re-Init. CSS-Regeln für `.simplecmp-floating-trigger`
  und 4 Positions-Modifier in `src/core/scss/klaro.scss` (themable via
  `--simplecmp-trigger-bg/-fg/-focus`). Klick öffnet das Consent-Modal
  via `klaro.show()`. `unmountFloatingTrigger()` exportiert für
  programmatisches Entfernen. Siehe `docs/requirements.md` (REQ-4).
- **REQ-6 — Accessibility (WCAG 2.1 AA).** Modal in `consent-modal.jsx`
  bekommt `role="dialog"`, `aria-modal`, `aria-labelledby`, `tabindex="-1"`,
  Focus-Management (vorheriger Focus wird gespeichert, Wrapper fokussiert,
  Restore beim Unmount), Esc-to-close (außer `mustConsent`), und
  Tab/Shift-Tab Focus-Trap. Klaros Default war: Modal fokussierte den
  Close-Button beim Mount, kein Trap, kein Esc, keine Dialog-ARIA. SCSS
  bekommt `:focus-visible`-Outline auf allen interaktiven Elementen
  innerhalb `.klaro`, plus `prefers-reduced-motion`-Block. Neues
  `docs/accessibility.md` mit Audit-Methodik, Color-Contrast-Tabelle
  (Default-Theme: `green1` borderline) und Screenreader-Checkliste.
- **ADR-0004 — Recorder architecture.** Architektur-Entscheidungen für den
  Record-Modus (Phase 2): Coordinator + drei Watcher (Cookie/DOM/Network)
  + Classifier, in-memory Storage mit opt-in `sessionStorage` im Dev,
  Activation-Heuristik mit Production-Hostname-Warning,
  Customer-Workflow-Utilities `exportConfig()` und `assertNoUnknown()`,
  drei Communication-Channels. Status accepted.
- **REQ-7 — Record-Modus.** Phase-2-Implementation in `src/recorder/`:
  `types.ts`, `classifier.ts` (LocalClassifier), drei Watcher-Klassen,
  `recorder.ts` (Coordinator), `index.ts` (Subpath-Public-API). Gewired
  in `src/index.ts`: `SimpleCMPConfig.record` ist `boolean | RecorderOptions`,
  `getRecorder()` exportiert. `recorderDetection` über Klaros Event-Bus
  (kleine Erweiterung in `lib.js`: `executeEventHandlers` re-exportiert
  als `fireEvent`). 38 neue Tests + Integrations-Tests in
  `tests/index.test.ts`. Gesamt 59/59 grün. Bundle: ESM 145 → 160 KB,
  IIFE-min 113 → 123 KB. Siehe ADR-0004 + `docs/requirements.md` (REQ-7).
- Dependencies: `js-yaml ^4.1.1` und `@types/js-yaml` sind devDeps; Recorder
  bringt KEINE Runtime-Dependency mit (nutzt nur `MutationObserver`,
  `PerformanceObserver`, `setInterval` aus dem Browser).
- vitest config: happy-dom-Settings (`disableJavaScriptFileLoading`,
  `disableIframePageLoading`, `disableComputedStyleRendering`) deaktivieren
  Auto-Loading von Test-URLs, sodass DomWatcher-Tests synthetische `<script>`/
  `<iframe>`-Tags einfügen können ohne echten Netzwerk-I/O.
- **ADR-0005 — Service DB protocol.** Service DB als HTTP/JSON-Vertrag,
  nicht als zentral gehosteter Service. Multi-Implementer-Modell
  (PHP+SQLite-Reference, CMS-Plugins, künftige Community-DB).
  `serviceDbUrl` ist Config; Frontend-Client speaks one protocol.
  Path-based Versioning, Reserved `extensions`-Namespace, read-only in
  Phase 3, opt-in `sessionStorage`-Persistenz im Dev. Status accepted.
- **REQ-8 — Service DB.** Phase-3-Implementation in zwei Teilen:
  - **Frontend:** `src/service-db/` mit `ServiceDbClient` (lookup +
    lookupBatch, localStorage-TTL-Cache, stale-while-revalidate, Bearer-
    Auth, soft-fallback bei Errors), `LayeredClassifier` (komponiert
    DB + LocalClassifier, local wins on conflict). Wired in `init()`:
    bei `serviceDbUrl` gesetzt → Recorder bekommt LayeredClassifier
    statt LocalClassifier. Async-Enrichment patcht Detection im Recorder
    nachträglich, fires re-event. 22 Tests im Frontend, 79/79 total grün.
  - **Reference-Backend:** `reference-server/` (PHP 8.3 + SQLite,
    ~500 LOC, kein Framework). 6 Routen unter `/v1/`. ddev-Config inkl.;
    `cd reference-server && ddev start` und es läuft unter
    `https://simplecmp-service-db.ddev.site`. Ordner ist outside npm
    via `package.json.files`. Eigene PHPUnit-Suite.
  - **Seeds:** 23 manuell kuratierte Services (GA, GTM, Matomo, Hotjar,
    Stripe, YouTube, Vimeo, Cloudflare, Facebook Pixel, LinkedIn, TikTok,
    Pinterest, Hubspot, Mailchimp, Clarity, Sentry, Maps, reCAPTCHA, Ads,
    Fonts, Typekit, jsdelivr, cdnjs) mit deutschen Übersetzungen.
  - **Spec:** `docs/service-db-protocol.md` als konsumentenfreundliche
    Form für CMS-Plugin-Autoren (Endpoints, Schema, curl-Beispiele).
  - **`SimpleCMPConfig`** erweitert um `serviceDbUrl?: string` und
    `serviceDbAuth?: { token, header?, scheme? }`. Bundle: ESM 160 → 169 KB.
- `lib.js`-Modifikation: `executeEventHandlers` zusätzlich als `fireEvent`
  exportiert, damit das Service-DB-Subsystem dieselbe Bus-Mechanik
  nutzen kann wie REQ-3 (`consentVersionMismatch`). Schon dokumentiert
  in `docs/upstream-tracking.md`.
- **ADR-0006 — Hard-Fork from Klaro.** Strategische Entscheidung: vollständiger
  UI-Rewrite, Klaros JSX-Komponenten und SCSS verlassen, Engine als TS rewrite,
  Recorder/Service-DB unverändert. Public API stabil. Supersedes ADR-0002.
- **ADR-0007 — UI architecture.** Lit-basierte Web Components, Shadow DOM
  default mit Light-DOM-Mode opt-in, native `<dialog>`-Element, CSS Custom
  Properties für Theming. Bootstrap-Adapter als reines CSS-File.
- **ADR-0008 — Build outputs.** Engine wird ESM-only, UI bleibt ESM + IIFE
  für Direkteinbindung. CJS dropt. Drei Subpath-Exports
  (`simplecmp`, `simplecmp/engine`, `simplecmp/ui`). Supersedes Teile von
  ADR-0003.
- **Rewrite-Track als REQ-Sequenz.** `docs/requirements.md` enthält jetzt
  REQ-11 bis REQ-17 als sieben-stufigen Rewrite-Plan: Utils-Extract →
  Stores/ConsentManager → Lib-Funktionen → Lit-UI → Translations →
  Themes → Cleanup. REQ-N2 (Headless-Modus) wird durch REQ-11–13
  erledigt.

### Fixed

- **Modal focus trap (hand-rolled) + `aria-labelledby`.** Native
  `<dialog>.showModal()` is supposed to trap Tab navigation, but the
  trap fails when the `<dialog>` is rendered inside Shadow DOM — Tab
  from the last focusable walked past the host to the page underneath.
  `<simplecmp-modal>` now ships a Tab/Shift+Tab keydown handler that
  walks the dialog subtree (including nested shadow roots so
  `<simplecmp-purpose-group>` children participate) and wraps focus at
  the boundaries. The `<dialog>` also carries an explicit
  `aria-labelledby="simplecmp-modal-title"` pointing at the existing
  `<h1>` — native `<dialog>` has implicit `role=dialog` +
  `aria-modal=true` in showModal state but no accessible name unless
  the markup wires one up.
- **Default primary token darkened to pass WCAG AA contrast.** The
  previous `--simplecmp-color-primary` (`#1a936f`) on white scored
  3.85:1 — below WCAG 2.1 AA's 4.5:1 threshold for normal text.
  Darkened to `#15775a` (5.30:1); hover token shifts from `#15775a`
  to `#0f5d44`. The axe-core `color-contrast` rule is no longer
  disabled in the a11y CI gate — the documented brand exception is
  gone. Sites overriding `--simplecmp-color-primary` are unaffected;
  sites running default colors see a slightly darker green on the
  Accept button. Demos, `default.css`, and `docs/accessibility.md`
  updated to match.

### Changed

- **CMS bridge wires onto `'detectionSettled'` instead of `'detection'`.**
  Fixes the race where the bridge POSTed before the Service-DB lookup
  could upgrade a detection to `known`. Sites that configure both
  `serviceDbUrl` and `cmsBridgeUrl` no longer see well-known trackers
  (`_ga`, `_fbp`, …) in their webhook stream. Documented in
  `docs/cms-bridge-webhook.md` — the "Known limitation: race with the
  Service DB" block is replaced by a "Coordination with the Service DB"
  section describing the settled-event behaviour. (REQ-N7.)
- **Modal: decline + accept-all stay visible after consent.** Previously
  the modal hid both bulk-toggle buttons (`hideDeclineAll`-gated decline
  + `acceptAll`-gated accept) once `manager.confirmed` flipped. A
  returning user who re-opened the modal from the floating trigger was
  left with only "Save" and had to flip each switch manually. Drop the
  `!manager.confirmed` gate from both — visibility now depends only on
  the config flags. The Save button's label still flips between "Accept
  selected" (pre-consent) and "Save" (post-consent) to convey intent.
- `LICENSE-KLARO` now reproduces the upstream BSD-3 notice verbatim, including
  the "various authors" attribution line.
- Upstream Klaro! URL corrected throughout the docs to
  `https://github.com/KIProtect/klaro`.
- Biome ignore extended to `src/core/` so upstream Klaro code isn't
  reformatted (ADR-0002).
- **REQ-11 / Stage A — utils to TypeScript.** `src/core/utils/{maps,strings,
  config,cookies,compat,i18n}.js` ported to `src/engine/utils/*.ts` with
  full strict-mode types. Vite plugin `tsFromJs` bridges `.js` imports
  during the migration window.
- **REQ-12 / Stage B — stores + ConsentManager to TypeScript.**
  `src/engine/stores.ts` (Store/KeyedStore + 4 implementations) and
  `src/engine/consent-manager.ts` (~590 LOC, REQ-3 + REQ-5 preserved).
  Klaro upstream's `for...in Object.keys()` bug in `resetManagers` fixed.
- **REQ-13 / Stage C — engine/UI split.** `src/engine/index.ts` holds
  state machine, event bus, manager cache, validation, translation
  registry. `src/core/lib.js` reduced to a slim UI wrapper.
- **REQ-14 / Stage D — Lit-based Web Components UI.** Eight components
  (`<simplecmp-banner>`, `<simplecmp-modal>`, `<simplecmp-trigger>`,
  `<simplecmp-policy-links>`, `<simplecmp-purpose-group>`,
  `<simplecmp-service-toggle>`, `<simplecmp-contextual-notice>` plus
  `SimpleCmpElement` base). Modal uses native `<dialog>` (focus trap,
  Escape, `:modal` for free). Hybrid Shadow / Light DOM via
  `mode="light"` attribute. `initLit()` wires components to the engine.
  41 component tests + 9 init-flow tests added.
- **REQ-15 / Stage E — translations YAML → JSON.** 26 language packs as
  JSON files in `src/engine/translations/`. Bespoke YAML esbuild + Vite
  plugins removed; `js-yaml` and `@types/js-yaml` dropped. Native TS
  JSON imports replace the build-time inlining.
- **REQ-16 / Stage F — themes.** `dist/styles/default.css` ships the
  default visual theme as a standalone artifact (Light DOM users link
  it directly). `dist/styles/bootstrap.css` adapter maps `--simplecmp-*`
  to `--bs-*` tokens — no JS, no fork. `domMode: 'shadow' | 'light'`
  config option chooses between encapsulated and host-CSS modes.
- **REQ-17 / Stage G — Klaro cleanup, ESM-only.** `src/core/`,
  `src/floating-trigger.ts` deleted. `init()` is now Lit-only; legacy
  Klaro/Preact path removed. `preact`, `classnames`, `prop-types`,
  `sass` deps dropped. CJS build target dropped per ADR-0008. tsup +
  vitest configs simplified — no JSX-in-JS transform, no React aliases,
  no SCSS pipeline. IIFE bundle: 268 KB → 133 KB; ESM: 226 KB → 161 KB.

[Unreleased]: https://github.com/simplecmp/simplecmp/compare/HEAD
