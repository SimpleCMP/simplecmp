# Changelog

All notable changes to SimpleCMP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches 1.0. Until then, breaking changes may occur in minor versions.

## [Unreleased]

### Added

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
  severities as non-blocking log entries. The `color-contrast` rule is
  disabled with a documented brand exception for the `green1` button
  color (3.5:1) — see `docs/accessibility.md`. Browser binaries cached
  by lockfile hash so cold-install only happens on dep bumps.
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
