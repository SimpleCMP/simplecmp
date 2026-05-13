# SimpleCMP — Requirements

Lebendes Dokument. Hier sammeln wir das *Was* (Anforderungen, Acceptance
Criteria), nicht das *Wie* (Architektur). Architekturentscheidungen gehen
weiterhin in `docs/adr/`. Roadmap-Phasen siehe `CLAUDE.md` und `README.md`.

Kategorien:

- [Must-have für v1.0 (DSGVO/DACH-Markt)](#must-have-für-v10-dsgvodach-markt)
- [Roadmap-Features (Phase 2–5)](#roadmap-features-phase-2-5)
- [Nice-to-have, später](#nice-to-have-später)
- [Bewusst nicht in v1.0](#bewusst-nicht-in-v10)

Status-Legende: ⬜ offen · 🟦 in Arbeit · ✅ erledigt · ⏸️ pausiert / blockiert

---

## Must-have für v1.0 (DSGVO/DACH-Markt)

### REQ-1 — Impressum-Link separat von Datenschutz

**Status:** ✅ erledigt 2026-05-02

**Warum:** In Deutschland verlangen TMG/MStV einen eigenen Impressum-Link auf
jeder Seite. Klaro kennt nur `privacyPolicy` als Single-Link. Praktisch jede
deutsche Site braucht beides nebeneinander.

**Acceptance Criteria:**

- [x] Config nimmt zusätzlich zu `privacyPolicy` ein optionales `imprint`-Feld
      mit gleicher Shape (`string | { [lang]: string; default?: string }`).
      `SimpleCMPConfig.imprint` ist explizit dokumentiert in `src/index.ts`.
- [x] Im Consent-Notice und im Modal werden beide Links angezeigt, wenn
      konfiguriert. Reihenfolge: Datenschutz zuerst, dann Impressum (DSGVO-
      Bezug primär), getrennt durch ` · `. Render in einer separaten
      `<p className="cn-policy-links">` (Notice) bzw. `cm-policy-links` (Modal),
      damit es unabhängig von Translation-Substitution funktioniert.
- [x] Translation-Strings für `imprint` in `en` ergänzt.
      DE/FR + 18 weitere Sprachen hatten den Schlüssel `consentNotice.imprint.name`
      bereits aus Upstream. Sprachen ohne Eintrag (cs, hu, oc, sr_cyrl) fallen
      auf den Literal `"Imprint"` zurück.
- [x] `// SimpleCMP modification (REQ-1):` Marker an allen geänderten Stellen
      in `consent-notice.jsx`, `consent-modal.jsx`, `en.yml`.
- [x] Eintrag im Divergenz-Log in `docs/upstream-tracking.md` (3 Zeilen).
- [x] Test: `tests/index.test.ts` rendert init() mit beiden URLs und
      verifiziert beide `<a href="…">`-Tags im DOM (5/5 Tests grün).

**Hinweise:**

- Klaros bestehende Translation-Schema kennt `consentNotice.imprint.name`
  schon, das hat REQ-1 erheblich kleiner gemacht als zunächst erwartet —
  20/25 Sprachen hatten das aus Upstream.
- Die Render-Position (eigene Footer-Zeile statt Substitution in der
  Description) wurde gewählt, weil die Description-Strings in den Übersetzungen
  meistens `{privacyPolicy}` nicht enthalten und ein Substitution-only-Ansatz
  unzuverlässig wäre.
- CSS-Styling für `.cn-policy-links` und `.cm-policy-links` steht noch aus —
  eigenes Issue, weil das in den Themes/SCSS verankert sein muss.

---

### REQ-2 — "Alle ablehnen" gleichberechtigt zu "Alle akzeptieren"

**Status:** ✅ erledigt 2026-05-02

**Warum:** BGH-Urteil "Cookie II" und Beschluss der Datenschutzkonferenz (DSK)
2022: Ablehnen muss genauso prominent und mit gleichem Aufwand möglich sein wie
Akzeptieren. Klaro bietet das per Config (`acceptAll`, `mustConsent`), aber
nicht als Default.

**Acceptance Criteria:**

- [x] SimpleCMP-Default: "Alle ablehnen" wird auf der ersten Banner-Ebene
      angezeigt. Klaro rendert den Decline-Button standardmäßig
      (`hideDeclineAll` ist undefined → button visible) — wir mussten am
      Default nichts ändern, nur sicherstellen, dass es so bleibt.
- [x] "Akzeptieren" und "Ablehnen" visuell gleich gewichtet. Klaro upstream
      hatte **keine** SCSS-Regel für `cm-btn-danger` — Decline erbte das graue
      `cm-btn`-Default, während Accept als `cm-btn-success` bright green war.
      Asymmetrie behoben durch Hinzufügen von `&.cm-btn-danger { background-color:
      red1 }` in `src/core/scss/klaro.scss`. Beide Buttons jetzt gleich
      prominent, gleiche Größe (vom existierenden `.cm-btn` Default), klare
      Signal-Farben.
- [x] Override per Config möglich, aber dann `console.warn`. `init()` ruft
      jetzt `warnOnComplianceRisks(config)`; bei `hideDeclineAll: true` wird
      mit Verweis auf BGH I ZR 7/16 ("Cookie II") und DSK 2022 gewarnt.
- [x] Test: zwei DOM-Tests in `tests/index.test.ts` — einer prüft beide
      Buttons + Klassen, der andere die Compliance-Warning bei
      `hideDeclineAll: true`. 7/7 Tests grün.

**Hinweise:**

- Die Klassen `cm-btn-success` und `cm-btn-danger` werden bereits von Klaros
  JSX gesetzt — wir haben nur die fehlende SCSS-Regel ergänzt. Keine
  JSX-Änderung nötig.
- Visuelle Gleichwertigkeit ist über Farbintensität definiert, nicht
  Color-Hue. Wer für sein Theme andere Farben will, kann `--red1`/`--green1`
  CSS-Custom-Properties überschreiben — Klaros bestehender Theming-Mechanismus.
- Der `acceptAll: true` Path zeigt einen extra "Accept All" Button im **Modal**
  (consent-modal.jsx). Auch der nutzt `cm-btn-success`. Symmetrie zum
  Decline-All Button im selben Modal ist durch unsere SCSS-Änderung gegeben.

---

### REQ-3 — Consent-Versionierung mit automatischer Re-Abfrage

**Status:** ✅ erledigt 2026-05-02

**Warum:** Bei Änderungen an Services oder Datenschutzerklärung muss neu
gefragt werden, sonst ist der gespeicherte Consent ungültig. Klaro hat ein
`privacyPolicy.version` Feld, das Verhalten beim Versionssprung ist aber
unvollständig.

**Acceptance Criteria:**

- [x] Config: `consentVersion: string | number` und
      `consentVersionPolicy: 'any' | 'major'` (Default `'any'`). Beide Felder
      explizit in `SimpleCMPConfig` mit JSDoc-Hinweisen "wann inkrementieren"
      (neuer Service, neuer Verarbeitungszweck, neuer Drittlandsempfänger,
      geänderte Datenschutzerklärung).
- [x] Bei abweichender Version: Storage-Eintrag wird in `loadConsents`
      verworfen, `confirmed=false` + `changed=true` werden gesetzt — Klaros
      bestehende "changeDescription"-Anzeige greift dann automatisch.
      Backwards-kompatibel: ohne `consentVersion` bleibt das alte
      Klaro-Format `{ [serviceName]: bool }` erhalten.
- [x] Event `consentVersionMismatch` mit `{ storedVersion, configVersion,
      policy }` wird in `getManager()` gefeuert, sobald ein neuer Manager
      erkennt, dass sein Storage-Inhalt verworfen werden musste.
      Subscription via `simplecmp.addEventListener('consentVersionMismatch',
      handler)`.
- [x] Storage-Format: `{ __v: <version>, consents: { ... } }`. Das `__v`
      Property ist namespace-mäßig sehr unwahrscheinlich mit einem
      Service-Namen zu kollidieren.
- [x] Tests: 4 neue Tests in `tests/index.test.ts` decken Mismatch, Match,
      Major-Policy und Legacy-Backwards-Compat ab. 11/11 Tests grün.
- [x] Doku: JSDoc auf den Config-Feldern; Divergenz-Eintrag in
      `docs/upstream-tracking.md` (zwei modifizierte Files).

**Hinweise:**

- Test-Setup nutzt `getManager(config)` mit explizitem Argument statt
  `getManager()`, weil Klaros `defaultConfig` nur in `setup()` gesetzt wird —
  wir gehen den `render()`-Pfad. Der Cache ist per `storageName`, also
  kein Drift.
- Event-Tests vermeiden `addEventListener` bewusst, weil Klaros lib.js
  Event-Buffer auf Modulebene persistiert und über Vitest-Tests hinweg
  leaken würde. Stattdessen wird die `manager.versionMismatch`-Property
  direkt inspiziert. Die 4 Zeilen Event-Wiring in `getManager()` sind klein
  genug, dass Lesen-und-Vertrauen pragmatischer ist als ein flaky Test.
- `consentVersionPolicy: 'major'` zerlegt am ersten `.` und vergleicht den
  Anfang. Funktioniert für `1.5` vs `1.0` (= same major), kennt aber kein
  echtes Semver — `1.0.0-rc1` würde wie `1` behandelt. Reicht für die
  praktischen Anwendungsfälle.

---

### REQ-4 — Withdrawal genauso einfach wie Erteilung

**Status:** ✅ erledigt 2026-05-02

**Warum:** DSGVO Art. 7(3). Persistenter "Cookie-Einstellungen"-Trigger muss
auf jeder Seite zugänglich sein, nicht nur beim ersten Besuch.

**Acceptance Criteria:**

- [x] Helper `simplecmp.show()` ist exportiert; wird in der Public-API-
      Dokumentation als Pattern beworben (JSDoc-Kommentar an `show`).
- [x] Eingebauter "Floating Trigger" via Config:
      `floatingTrigger: true | { position, label }`. Default-Position
      `'bottom-right'`. Implementiert in `src/floating-trigger.ts`,
      gemounted via `init()` in `src/index.ts`.
- [x] Trigger ist keyboard-accessible: regulärer `<button type="button">`
      (= Tab-Stop), `aria-label` aus `options.label` oder Default
      `"Cookie settings"`, `:focus-visible` Outline-Ring im SCSS,
      `prefers-reduced-motion` respektiert.
- [x] Tests: 4 neue Tests decken Default (kein Trigger), Mount mit
      `true`, Mount mit Options (Position + Label), und Idempotenz
      (Re-Init verdoppelt nicht). 18/18 Tests grün.
- [x] Position über CSS-Klasse `pos-{bottom-right|bottom-left|top-right|top-left}`.
      4 Position-Modifier in `klaro.scss` (außerhalb `.klaro`-Wrapper-Scope,
      weil der Trigger nicht zu Klaros Render-Tree gehört).
- [x] Themable via CSS-Custom-Properties `--simplecmp-trigger-bg`,
      `--simplecmp-trigger-fg`, `--simplecmp-trigger-focus`. Default-Farben
      werden inline gesetzt mit Custom-Property-Fallback.

**Hinweise:**

- Trigger lebt **außerhalb** von Klaros Render-Tree. Persistiert deshalb
  über Klaro-Re-Renders und Sprachwechsel hinweg. Wird nicht entfernt,
  wenn Klaros Modal schließt — Sinn der Sache.
- `mountFloatingTrigger` ist idempotent: bestehende Instanz wird vor
  Mounting entfernt. Mehrfaches `init()` führt zu genau einem Trigger.
- `unmountFloatingTrigger` ist als Public-API-Re-Export verfügbar, falls
  Konsumenten den Trigger programmatisch wieder entfernen wollen.
- Kein Translation-System für das Label, weil der Trigger außerhalb
  Klaros `t()`-Kontext sitzt. Konsumenten müssen ihren bevorzugten Text
  selbst übergeben (z.B. `label: 'Cookie-Einstellungen'`). Default ist EN
  pragmatisch — andere Sprachen brauchen explizite Übergabe.
- Inline-SVG-Icon (Cookie/Shield-Motiv) ist im Bundle enthalten, kein
  externer Asset-Request.

---

### REQ-5 — GPC-Signal-Erkennung (Global Privacy Control)

**Status:** ✅ erledigt 2026-05-02

**Warum:** In Kalifornien rechtlich verbindlich (CCPA/CPRA), in der
EU-Diskussion zur DSGVO-Auslegung relevant. Browser senden den Header
`Sec-GPC: 1` bzw. setzen `navigator.globalPrivacyControl = true`.

**Acceptance Criteria:**

- [x] Wenn `navigator.globalPrivacyControl === true` und kein vorhandener
      Consent gespeichert ist: Default-Consent für nicht-required Services
      = `false`. Implementiert in `consent-manager.js` `getDefaultConsent`.
- [x] Banner wird trotzdem angezeigt — wir setzen nur den Default-State.
      `confirmed` bleibt `false`, sodass Klaros normaler Banner-Fluss greift.
      User darf jederzeit umentscheiden.
- [x] Per Config abschaltbar: `respectGPC: false`. Default ist `true`.
      In `SimpleCMPConfig` mit JSDoc dokumentiert.
- [x] Required-Services (`required: true`) bypassen GPC, weil sie für den
      Site-Betrieb nötig sind und nicht consent-basiert.
- [x] Tests: 3 neue Tests (GPC=true → deny, GPC=undefined → keine Änderung,
      GPC + respectGPC=false → ignoriert). 14/14 Tests grün.

**Hinweise:**

- GPC betrifft nur den **Default-State auf erstem Besuch**. Wenn ein User
  früher schon Consent erteilt hat, wird der gespeicherte Consent gelesen —
  GPC überschreibt das nicht (sonst könnten User sich nicht mehr für eine
  Site entscheiden, die sie regelmäßig besuchen).
- Test-Setup nutzt `Object.defineProperty(navigator, 'globalPrivacyControl',
  { value: true, configurable: true })` und resettet auf `undefined` im
  `beforeEach`. happy-dom unterstützt das.
- Kein Compliance-Warning bei `respectGPC: false` — anders als REQ-2's
  `hideDeclineAll`, weil GPC in DE noch keine harte Pflicht ist (im
  Gegensatz zu Kalifornien). Die JSDoc-Empfehlung "nur mit klarem
  Compliance-Grund" reicht hier.

---

### REQ-6 — Accessibility: WCAG 2.1 AA

**Status:** ✅ erledigt 2026-05-02 — automatisierbare Items abgehakt, manuelle
Punkte in `docs/accessibility.md` dokumentiert

**Warum:** Verpflichtend für öffentliche Stellen (BFSG ab 2025), Best Practice
für alle. Klaro ist nicht audited.

**Acceptance Criteria:**

- [x] Modal hat Focus-Trap. `_handleKeyDown` in `consent-modal.jsx` fängt
      Tab/Shift+Tab ab und cycelt am ersten/letzten fokussierbaren Element.
- [x] Modal-Wrapper bekommt Focus beim Öffnen (`tabindex="-1"`,
      `componentDidMount` ruft `focus()`). Vorher fokussierte Element wird
      gemerkt; Focus-Restore beim Unmount auf das vorherige Element, falls
      noch im DOM.
- [x] Sichtbarer Focus-Ring auf allen interaktiven Elementen via
      `:focus-visible` Regel in `klaro.scss` (innerhalb `.klaro`-Scope).
- [x] Buttons haben sinnvolle Labels: alle bestehenden Buttons haben
      Text-Content oder `aria-label`. Auditiert in `docs/accessibility.md`.
- [x] Color-Contrast in Audit dokumentiert: `dark1`/`dark2` mit `#fff` bestens
      (12.6:1 / 10.4:1 = AAA). `red1` (#da2c43) → 4.6:1 ✓ AA. `green1`
      (#1a936f) → 3.5:1 ⚠️ — passes UI 3:1, **fails normal text 4.5:1**.
      Bewusst nicht geändert (Brand-Farbe), Themer-Empfehlung in Audit-Doc.
- [x] `prefers-reduced-motion: reduce` Block in `klaro.scss` drückt
      transition/animation-duration auf 0.001ms, deckt Klaros Switch-Toggles,
      Modal-Animationen und Control-Transitions ab.
- [x] `Esc` schließt Modal (außer `mustConsent: true`). Implementiert in
      `_handleKeyDown`, getestet mit beiden Pfaden.
- [x] `docs/accessibility.md` neu erstellt: Audit-Methodik, Ist-Zustand
      vor SimpleCMP, was wir geändert haben, Color-Contrast-Tabelle,
      Screenreader-Walkthrough-Checkliste für manuelle Releases.

**Hinweise:**

- Notice (`consent-notice.jsx`) ist nicht angefasst worden — sie ist ein
  Banner, kein Modal-Dialog, und Upstream hat dort schon `role="dialog"`,
  `aria-labelledby`, `aria-describedby`. Hard-Focus-Trap auf der Notice
  wäre eher schädlich (User soll die Site weiter benutzen können).
- Vitest-Tests testen die Esc-Funktionalität via
  `document.dispatchEvent(new KeyboardEvent(...))`. Preact flushed setState
  asynchron, deshalb `await new Promise(r => setTimeout(r, 0))` zwischen
  Dispatch und Assertion.
- Color-Contrast für `green1` ist als manueller Punkt im Audit-Doc
  festgehalten — ein Theme-Switch zu z.B. `#0f7458` (≈5.4:1) wäre die
  einfachste Lösung, ist aber eine eigene Brand-Entscheidung.
- `axe-core`-Run im CI ist als Open Item im Audit-Doc notiert; wird mit
  einem späteren Playwright-Setup nachgezogen.

---

## Roadmap-Features (Phase 2–5)

Diese stehen bereits in `CLAUDE.md`. Hier nur Acceptance-Criteria-Skizzen, die
mit der Implementierung verfeinert werden.

### REQ-7 — Record-Modus (Phase 2)

**Status:** ✅ erledigt 2026-05-02 — Architektur in
[ADR-0004](adr/0004-recorder-architecture.md), Implementation in
`src/recorder/`

Auto-Detect von Cookies und externen Verbindungen während Entwicklung.
Enthält:

- [x] `cookie-watcher`: pollt `document.cookie`, diffed gegen vorherigen
      Zustand. Konfigurierbares Polling-Interval (default 1000 ms).
- [x] `dom-watcher`: `MutationObserver` auf `documentElement` (subtree),
      reagiert auf `<script>`, `<iframe>`, `<img>`, `<link>`, `<audio>`,
      `<video>`, `<source>`, `<track>`, `<embed>`, `<object>`. Initial-Scan
      auf `start()` deckt schon vorhandene Tags ab.
- [x] `network-watcher`: `PerformanceObserver` für `entryTypes: ['resource']`,
      plus initialer `getEntriesByType('resource')`-Drain.
- [x] `classifier`: `LocalClassifier` matcht gegen `config.services`
      (`cookies` Klaro-Tuple/RegExp/exact, `origins` `string`/`*.suffix`/
      `RegExp`). Stable Interface für Phase-3-Service-DB-Erweiterung.
- [x] Aktivierung: opt-in via `record: true` (oder `RecorderOptions`-Objekt).
      Hostname-Heuristik gibt `console.warn` aus, wenn Hostname nicht
      nach Dev/Local aussieht; per `silenceProductionWarning: true`
      unterdrückbar (gewollter Production-Monitoring-Pfad, ADR-0004 Section H).
      Kein `process.env.NODE_ENV`-Check (Library kontrolliert keinen
      Bundler-Define).
- [x] Dev-Konsole: pro Detection ein `console.info`-Log, periodischer
      `console.table`-Snapshot via `summaryIntervalMs` (default 30 s).
- [x] Customer-Workflow-Utilities (ADR-0004 Section K):
      `recorder.exportConfig()` → JSON-Snippet mit known services + Stubs
      für unknown items; `recorder.assertNoUnknown()` → wirft mit Liste
      aller unbekannten Detections (CI-Hook).
- [x] Drei Communication-Channels (ADR-0004 Section F):
      `simplecmp.addEventListener('recorderDetection', ...)` über Klaros
      Event-Bus, `simplecmp.getRecorder()` für direkten Zugriff,
      Console-Logs.
- [x] Optional: `sessionStorage`-Persistenz im Dev (`persistInDev: true`),
      hard-gated auf Dev-Hostnames. Schema-Version inline für Future-
      Migrations.
- [x] Tests: 4 separate Test-Files mit insgesamt 38 neuen Tests
      (`classifier.test.ts`, drei `watchers/*.test.ts`, `recorder.test.ts`)
      plus Integrations-Tests in `tests/index.test.ts`. 59/59 Tests grün.

**Hinweise:**

- Recorder-Code ist NICHT vom Klaro-Fork abgeleitet — eigenständig in
  TypeScript geschrieben (ADR-0004 Section I), darf frei evolvieren.
- Watcher haben jeweils Dependency-Injection für Tests: `readCookies`-
  Callback, `performance`-Stub, `PerformanceObserver`-Klassen-Override.
- happy-dom-Defaults wollen `<script>`/`<iframe>`-URLs aktiv laden;
  `vitest.config.ts` deaktiviert das via `disableJavaScriptFileLoading` /
  `disableIframePageLoading`. Tests provoke synthetic events ohne
  echten Netzwerk-I/O.
- Bundle-Größe: ESM 145 → 160 KB (+15 KB); IIFE-min 113 → 123 KB.
  `js-yaml` und Tests landen wie bisher nicht im Runtime-Bundle.

### REQ-8 — Service DB (Phase 3)

**Status:** ✅ erledigt 2026-05-02 — Architektur in
[ADR-0005](adr/0005-service-db-protocol.md), Spec in
[docs/service-db-protocol.md](service-db-protocol.md), Implementation in
`src/service-db/` (Frontend) + `reference-server/` (PHP+SQLite, ddev)

Geteilte Registry bekannter Services. Vertrag statt Service: Frontend
spricht protocol gegen jeden conformant backend (Reference, CMS-Plugin,
Community-DB).

- [x] Endpoint-Schema (HTTP/JSON) festgeschrieben in
      `docs/service-db-protocol.md` und vom Frontend-Client (TS-Types) +
      Reference-Backend (PHP) implementiert. Vier Endpunkte unter `/v1/`:
      `health`, `services`, `services/:id`, `lookup` (POST batch).
- [x] Client-API: `ServiceDbClient.lookup({ cookie?, origin? })` plus
      `lookupBatch()` für batched HTTP-Requests. Async, Promise-basiert,
      TS-typed. `LayeredClassifier` integriert das in den
      Recorder-Classifier-Vertrag aus ADR-0004.
- [x] localStorage-Cache mit 24h-TTL, stale-while-revalidate-Pattern,
      `Cache-Control: max-age=...`-Override, in-flight-Coalescing.
- [x] Default-Endpoint **NICHT** zentral hosted. Stattdessen Multi-
      Implementer-Modell: PHP+SQLite-Reference per ddev local, CMS-Plugins
      hosten eigene Endpoints (Phase 5). `serviceDbUrl` ist Config.
- [x] Fallback bei Netzfehler: Frontend gibt `null` zurück, gibt
      `console.warn` einmal pro Fehlerkategorie pro Session aus.
      `LayeredClassifier` fällt automatisch auf den `LocalClassifier`
      zurück. Recorder bricht nie wegen DB-Ausfall.
- [x] Tests: 22 Frontend-Tests (`client.test.ts` + `layered-classifier.test.ts`)
      decken Cache, Fallback, stale-while-revalidate, Auth, Conflict-
      Resolution. Plus PHPUnit-Tests im Reference-Backend für die
      Lookup-Logik. Total 79/79 grün.
- [x] Authoring (REQ-Section J in ADR-0005): Read-only API in v1.
      CMS-Plugin-Admin in Phase 5. Reference-Backend: keine Auth (public
      data). CMS-Plugins können `Authorization`-Header nutzen, Frontend
      unterstützt das via `serviceDbAuth`.
- [x] Seed-Daten: 23 manuell kuratierte Services mit DE-Übersetzungen
      (Google Analytics, GTM, Matomo, Hotjar, Stripe, YouTube, Vimeo,
      Cloudflare, Facebook Pixel, LinkedIn, TikTok, Pinterest, Hubspot,
      Mailchimp, Microsoft Clarity, Sentry, Google Maps, reCAPTCHA,
      Google Ads, Google Fonts, Adobe Fonts, jsdelivr, cdnjs).
      Beigesteuert per JSON-PR in `reference-server/seeds/services/`.

**Hinweise:**

- Reference-Backend liegt in `reference-server/`, **nicht** im npm-Paket.
  `package.json.files` lässt es draußen. Die `docs/`- und das ADR
  bleiben aber im Repo, weil die Spec für Konsumenten relevant ist.
- ddev-Config in `reference-server/.ddev/config.yaml`. Zwei Befehle und
  der Backend läuft: `cd reference-server && ddev start`. Endpoint dann
  unter `https://simplecmp-service-db.ddev.site/v1/...`.
- **Phase 3.5 offen:** Open Cookie Database (Apache-2.0, ~10k Einträge)
  evaluieren. Quellqualität variiert; selektive Übernahme als separates
  Issue. Phase 3 selbst ist nicht blockiert.
- Recorder Bundle-Wachstum: ESM 160 → 169 KB (+9 KB für Service-DB-Client +
  LayeredClassifier).

### REQ-9 — CMS Bridge (Phase 4)

**Status:** ⬜ offen — Phase 4, blockiert durch REQ-7

Webhook-Notifications für unbekannte Tracker in Production.

- [ ] Config: `cmsBridgeUrl: string`, optional `cmsBridgeAuth: string` (Bearer-Token).
- [ ] Bei Detektion eines unbekannten Items (Recorder + Service-DB-Miss):
      `fetch(cmsBridgeUrl, { method: 'POST', body: JSON.stringify(...) })`.
- [ ] Rate-Limiting / De-Duplication clientseitig (gleiches Item nicht 100x).
- [ ] Schema des Webhook-Payloads dokumentiert.
- [ ] Test: Mock-Server bekommt korrekt strukturierten Payload.

### REQ-10 — CMS-Plugins (Phase 5)

**Status:** ⬜ offen — Phase 5, **eigene Repos** laut ADR-0006

WordPress, TYPO3, Contao. Nicht in diesem Repo. Hier nur:

- [ ] Stabile Public-API in `src/index.ts`, gegen die Plugins linken können.
- [ ] Versions-Compat-Matrix in der Doku.

---

## Rewrite-Track (Phase 1.5 — Hard-Fork from Klaro)

[ADR-0006](adr/0006-hard-fork-from-klaro.md), [ADR-0007](adr/0007-ui-architecture-lit.md)
und [ADR-0008](adr/0008-build-targets-esm-only-engine.md) committen einen
vollständigen UI-Rewrite. Der Engine-Kern wird als TypeScript neu gebaut,
die Klaro-JSX-Komponenten werden durch Lit-basierte Web Components ersetzt.
Public API bleibt stabil — Konsumenten müssen `init({...})`-Aufrufe nicht
ändern.

Sieben Stages, jede mit grünem `pnpm run ci` als Akzeptanz:

### REQ-11 — Engine-Extract: Utils zu TS

**Status:** ✅ erledigt 2026-05-13 — Implementation in `src/engine/utils/`
(`compat.ts`, `config.ts`, `cookies.ts`, `i18n.ts`, `maps.ts`, `strings.ts`).

`src/core/utils/{maps,strings,config,cookies,compat,i18n}.js` werden zu
TypeScript in `src/engine/utils/`. Pure Logic, keine UI-Berührung. Updates
der Imports in `src/core/` damit Klaro-JSX weiter funktioniert.
`api.js` (KlaroApi-Klasse) bleibt vorerst — sie ist optional und wird mit
der UI-Migration entfernt.

### REQ-12 — Engine-Extract: Stores + ConsentManager

**Status:** ✅ erledigt 2026-05-13 — Implementation in `src/engine/stores.ts`
und `src/engine/consent-manager.ts`.

`stores.js` (Cookie/LocalStorage/SessionStorage-Wrapper) und
`consent-manager.js` (State-Management, Versioning aus REQ-3, GPC aus
REQ-5) werden TS in `src/engine/`. Tests für REQ-3/REQ-5 bleiben grün.

### REQ-13 — Engine-Extract: Lib-Funktionen

**Status:** ✅ erledigt 2026-05-13 — Implementation in `src/engine/index.ts`.
UI-freier Public-Entry für die Engine.

Engine-Anteile von `lib.js` (`getManager`, `addEventListener`, `fireEvent`,
`validateConfig`, `defaultTranslations`-Verdrahtung, `version`) zu TS in
`src/engine/index.ts`. UI-Anteile (`render`, `renderContextualConsentNotices`,
`setup`) bleiben in `src/core/lib.js` bis REQ-14.

### REQ-14 — UI-Rewrite: Lit Web Components

**Status:** ✅ erledigt 2026-05-13 — Implementation in `src/ui/components/`
(`banner.ts`, `modal.ts`, `trigger.ts`, `purpose-group.ts`, `service-toggle.ts`,
`policy-links.ts`, `contextual-notice.ts`). Mount-Logik in `src/ui/init.ts`,
i18n-Brücke in `src/ui/i18n-bridge.ts`.

`<simplecmp-banner>`, `<simplecmp-modal>`, `<simplecmp-trigger>`,
`<simplecmp-service-toggle>`, `<simplecmp-purpose-group>`,
`<simplecmp-policy-links>` als Lit-Klassen. Native `<dialog>` für Modal.
Hybrid Shadow/Light-DOM-Mode. A11y nach REQ-6-Standards. Lit als
Runtime-Dep ergänzt, Preact + prop-types + classnames raus.

### REQ-15 — Translations: YAML zu JSON, lazy-load

**Status:** ✅ erledigt 2026-05-13 — Implementation in `src/engine/translations/`
(27 JSON-Sprachpakete inkl. `de`, `en`; Registry in `index.ts`). Kein
YAML-Plugin mehr in `tsup.config.ts` / `vitest.config.ts`.

`src/core/translations/*.yml` → `src/translations/*.json`. Inline `de` +
`en` im Bundle, andere Sprachen via dynamic-import on demand.
`yamlPlugin` aus tsup/vitest entfällt (keine YAML mehr im Source).

### REQ-16 — Themes: Default + Bootstrap-Adapter

**Status:** ✅ erledigt 2026-05-13 — Implementation in `src/ui/styles/`
(`default.css`, `bootstrap.css`, `tokens.ts`). SCSS-Pipeline entfernt;
`build:themes` kopiert die CSS-Dateien per `cpSync` nach `dist/styles/`.

Default-Theme (CSS Custom Properties) als Component-internes
`static styles`. Bootstrap-Adapter als separate `dist/themes/bootstrap.css`
(mappt `--simplecmp-*` auf `--bs-*`). SCSS-Pipeline wird komplett
entfernt — nur noch hand-authored CSS.

### REQ-17 — Klaro-Cleanup + Build-Targets

**Status:** ✅ erledigt 2026-05-13 — `src/core/` entfernt, Build-Pipeline auf
ESM (.mjs) + IIFE (.global.js) umgestellt (`tsup.config.ts`). `LICENSE-KLARO`
bleibt im Repo als historisches Artefakt.

`src/core/` wird komplett gelöscht. `LICENSE-KLARO` aus
`package.json.files` ausgeschlossen (im Repo bleibt es als historisches
Artefakt). Build-Pipeline auf ESM-only Engine + ESM/IIFE UI umgestellt
(ADR-0008). README-Acknowledgements an Klaro überarbeitet. Bundle-
Größenmessung dokumentiert (Engine-only Bundle vs. Engine+UI).

---

## Nice-to-have, später

### REQ-N1 — Mehrstufiger Banner (Notice → Modal)

Banner mit drei Buttons (Akzeptieren / Ablehnen / Einstellungen), zweite Ebene
mit feingranularen Toggles. Klaro hat das ansatzweise, Konfiguration ist aber
fragmentiert.

### REQ-N2 — Headless-Modus

Nur Consent-State, Storage, Events — keine UI. Für SPAs (Vue, React, Svelte),
die ihre eigene UI rendern wollen.

**Status:** wird durch den Rewrite-Track abgedeckt — die Engine-Extraction
(REQ-11 bis REQ-13) liefert ein UI-freies `simplecmp/engine`-Subpath-Export,
das genau das ermöglicht. Wird als erledigt markiert, sobald REQ-13 abgeschlossen
ist.

### REQ-N3 — Tag-Manager-Friendly

Built-in `dataLayer.push({ event: 'consent_update', ... })`-Hook für GTM und
ähnliche.

### REQ-N4 — Geo-aware Defaults

DSGVO-Default in EU, CCPA-Default in CA. Geo-Detection clientseitig nicht
zuverlässig — Config-Flag, das vom Server gesetzt wird.

### REQ-N5 — Server-side Consent Token

Signiertes JWT/HMAC-Token, das das Backend prüfen kann, bevor es
Tracking-Requests akzeptiert. Schließt eine häufige Audit-Lücke.

### REQ-N6 — CSP-strict-Build

`'unsafe-inline'` vermeiden. Wir haben das fast geschenkt durch separate CSS;
inline-styles in den JSX-Komponenten müssten geprüft und ersetzt werden.

---

## Bewusst nicht in v1.0

Diese Punkte sind diskutiert und abgelehnt. Bitte erst neu aufmachen, wenn
sich die Begründung ändert.

| Was | Warum nicht |
|---|---|
| **IAB TCF v2.x** | Eigene Welt: Vendor-Liste, GVL-Updates, Encoding-Spec, Dutzende Edge Cases. Wenn Ad-Tech-Kunden das brauchen, eigenes Plugin/Phase. |
| **Google Consent Mode v2** | Klein, aber Google-spezifisch. Als optionales Plugin in Phase 5 oder als Config-Hook, nicht im Core. |
| **Cross-Domain-Consent-Sync** | Komplex (iframe-postMessage), Nische. |
| **A/B-Testing der Banner-Variante** | Sinnvoll, aber außerhalb des Compliance-Cores. Kann Drittanbieter-Tool machen. |
| **Eigenes Backend-as-a-Service** | SimpleCMP ist eine Library. Service-DB ist ein lesbarer Endpoint, mehr nicht. Kein Account-System, kein Dashboard. |

---

## Pflege

- Status-Updates direkt in dieser Datei, im Idealfall mit PR-Referenz.
- Wenn aus einem REQ ein nicht-trivialer Architekturentscheid wird (z.B.
  "Wie speichern wir Consent-Versionen?"), eigenen ADR anlegen und von hier
  verlinken.
- Wenn ein REQ neu entsteht: vergib die nächste freie Nummer (REQ-11, REQ-N7).
  Nummern werden nicht recycled, auch wenn ein Punkt gestrichen wird —
  setze stattdessen den Status auf ⏸️ mit Begründung.
