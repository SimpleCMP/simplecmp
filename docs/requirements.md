# SimpleCMP — Requirements

Lebendes Dokument. Hier sammeln wir das *Was* (Anforderungen, Acceptance
Criteria), nicht das *Wie* (Architektur). Architekturentscheidungen gehen
weiterhin in `docs/adr/`. Roadmap-Phasen siehe `CLAUDE.md` und `README.md`.

Kategorien:

- [Must-have für v1.0 (DSGVO/DACH-Markt)](#must-have-für-v10-dsgvodach-markt)
- [Roadmap-Features (Phase 2–5)](#roadmap-features-phase-2-5)
- [Release-Härtung für v1.0](#release-härtung-für-v10)
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
- CSS-Styling der Policy-Link-Container ist erledigt (im Rahmen von REQ-14
  / REQ-16): Banner-Shadow-DOM via `static styles` in
  `src/ui/components/banner.ts` (`.cn-policy-links`), Modal-Shadow-DOM via
  `static styles` in `src/ui/components/modal.ts` (`.policy-links` —
  Klassenname leicht geändert beim Lit-Rewrite), Light-DOM-Konsumenten und
  die Standalone-Component `<simplecmp-policy-links>` über
  `src/ui/styles/default.css` und `bootstrap.css`. Alle Stellen nutzen
  `--simplecmp-font-size-sm` und `--simplecmp-color-text-muted` aus den
  Theme-Tokens. Audit am 2026-05-13.

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
      (#15775a) → 5.3:1 ✓ AA (2026-05-18: von `#1a936f`/3.5:1 auf `#15775a`
      gedunkelt, um WCAG AA für normalen Text zu erfüllen).
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
- `axe-core`-Run im CI ist verdrahtet: separater Job in
  `.github/workflows/ci.yml`, Playwright + `@axe-core/playwright`,
  scannt die Demos 1 / 4 / 5 / 6 (die ohne externe Resourcen, sonst
  flaky bei CI-Netzwerkschwächen) gegen WCAG 2.1 AA. Blockt PRs bei
  `serious` / `critical`-Verstößen; `moderate` / `minor` werden geloggt
  aber blockieren nicht. Color-Contrast-Rule deaktiviert mit
  dokumentierter Brand-Exception für `green1` (siehe
  `docs/accessibility.md`).

### REQ-19 — Geschichtete DSGVO-Auskunft für blockierte Embeds

**Status:** ⬜ offen — Designentscheidungen gesperrt 2026-05-27,
Implementierung steht aus. Notwendig für v1.0-Release-Bereitschaft.

**Warum:** Die aktuelle `<simplecmp-contextual-notice>` (geliefert über
`1c99f35`/`f148528`/`78a64b0` im Mai 2026) zeigt nur einen
Platzhalter-Body — keine zweite Ebene mit Empfänger-Identität, voller
Adresse, Datenschutz-URL. Die im DACH-Markt akzeptierte
Compliance-Form ist eine **geschichtete Auskunft** (Banner-Erstebene →
Service-Aufklappung / Platzhalter-Mehr-Informationen-Modal →
verlinkte Datenschutzerklärung). Borlabs und Real Cookie Banner
liefern alle drei Ebenen; SimpleCMP nur Ebene 1 + 3. Ohne L2-Ebene
fehlt die "Same-Layer"-Auskunft, die das DSK-OH Telemedien für die
Einwilligungs-Klick-Aktion fordert. Vollständige Wettbewerber- und
Rechtsanalyse: `docs/research/2026-05-blocked-embed-placeholder-cmp-survey.md`.

**Gesperrte Designentscheidungen (2026-05-27):**

1. **Provider-Daten als flache `vendor*`-Felder** auf jedem Service-
   Eintrag. Initial-Entscheidung 2026-05-27 war "normalisieren"
   (separate `providers/<id>.json`-Dateien), zweitens revidiert auf
   "nested `provider`-Objekt", **final auf flache Felder revidiert
   nach Sichtung der bestehenden Library-Schema**: Service-Einträge
   haben bereits `vendor`, `vendorCountry`, `privacyPolicyUrl`,
   `description` als flache Felder mit Test-Enforcement. Statt einen
   stilistischen Bruch zwischen alten flachen Feldern und neuem
   genesteten Objekt einzuführen, werden **vier neue flache Felder**
   ergänzt: `vendorAddress` (Adresse vollständig), `vendorOptOutUrl`
   (Service-spezifische Opt-Out-URL), `vendorPartner` (gemeinsame
   Verantwortliche / Partner, Freitext), `vendorDescription`
   (Provider-Beschreibung, getrennt von der Service-`description`).
   Spätere Normalisierung (via `providerId`-Referenz) bleibt
   non-breaking, wenn ein konkreter Bedarf entsteht.

   Vendor-Frequenz-Audit bestätigt diesen Pfad: **336 unterschiedliche
   `vendor`-Strings bei 369 Service-Einträgen** — nahezu 1:1
   Long-Tail-Verteilung. Nur ~25-30 Services (Googles 12, Microsofts
   4, Adobes 4-5) profitieren von Normalisierung; die übrigen ~340
   sind 1:1, wo flache Felder genauso geeignet sind.
2. **L2-Provider-Informationen-Modal** zu `<simplecmp-contextual-notice>`
   hinzufügen. Inhalt: Provider-Name, vollständige Adresse,
   Beschreibung, Datenschutz-URL, Opt-Out-URL. Trigger: ein
   "Weitere Informationen ›"-Link im Platzhalter-Body. Wiederverwendbar
   für die Banner-Services-Tab-Aufklappung.
3. **Pro-Content-Blocker Roh-HTML-Template-Override** auf v1.x
   verschoben. Data-Attribut-Primitive auf dem eingebetteten Element
   decken 90% der Fälle ab; Roh-HTML hat XSS-/CSP-Implikationen, die
   einen separaten Review verdienen.
4. **Top ~25 Service-Einträge mit eingebetteten Provider-Daten
   kuratieren** (Googles 12, Microsofts 4, Adobes 4-5, plus
   Single-Service-Big-N wie Meta, Stripe, Vimeo, X, TikTok, LinkedIn
   wo vorhanden). Long-Tail-Einträge bleiben mit `vendor`-String;
   Renderer degradiert mit "Adresse: nicht angegeben"-Hinweis.

**Acceptance Criteria (skizziert):**

- [ ] Schema-Erweiterung in `simplecmp/services-library`: vier neue
      optionale flache Felder auf jedem Service-Eintrag —
      `vendorAddress`, `vendorOptOutUrl`, `vendorPartner`,
      `vendorDescription`. Ergänzt bestehende flache Felder (`vendor`,
      `vendorCountry`, `privacyPolicyUrl`, `description`).
- [ ] Top ~25 Service-Einträge mit eingebetteten Provider-Daten
      kuratiert (Multi-Service-Vendors + Single-Service-Big-N per
      Frequenz-Audit).
- [ ] Renderer-Verhalten bei fehlenden Feldern: L2-Modal synthetisiert
      minimale Anzeige aus den vorhandenen flachen Feldern; fehlende
      Felder werden ausgeblendet oder mit "nicht angegeben" markiert.
- [ ] Neue `<simplecmp-provider-info-modal>`-Komponente (Lit),
      gemeinsam genutzt von Banner-Services-Tab und Contextual-Notice.
- [ ] `<simplecmp-contextual-notice>` bekommt einen "Weitere
      Informationen ›"-Link, der das Modal öffnet.
- [ ] Per-Instance-Daten-Attribute auf eingebetteten Elementen
      werden unterstützt: `data-simplecmp-title`, `-description`,
      `-preview-image`, `-i18n='{"de":{...}}'`. Auflösungsreihenfolge:
      Instance > Service-Library-Overlay > Engine-Default.
- [ ] Ein-Klick-Konsens ist ausreichend (keine zwei-Schritt-
      Bestätigung) — der Klick auf "Inhalt laden" ist die
      Einwilligungs-Aktion, sofern L2-Mehr-Infos vor dem Klick
      erreichbar ist.
- [ ] i18n-Strings für DE + EN: Modal-Titel, Feldlabels, Schließen-
      Button. Geschätzt ~8 neue Strings.
- [ ] Dokumentation in der services-library README aktualisiert
      (eingebettetes `provider`-Schema, Fallback-Verhalten).

**Hinweise:**

- **Per-Instance-Customization bleibt der echte Unterschied** —
  kein anderer CMP (kommerziell oder Open-Source) liefert per-
  Embed-Overrides als First-Class-Feature. Daten-Attribute auf dem
  eingebetteten Element sind CMS-agnostisch; TYPO3/Gutenberg/Contao-
  Plugins werden zu dünnen Emittern.
- **Thumbnail-Fetcher ist kein v1.0-Scope.** Server-seitiger
  Abruf (privacy-clean) wird in Phase-5-CMS-Plugins implementiert,
  wenn ein konkreter Bedarf entsteht. Bis dahin: generisches
  Platzhalter-Bild als Default.
- **Verschiedene CMS-Plugin-Schemas müssen angepasst werden.**
  Die TYPO3-Extension (`t3-simplecmp`) konsumiert die Library über
  `ServicesLibrary::services()`; mit der Provider-Trennung muss
  die `ClassifierLookup`-Logik die Provider-Referenz mit auflösen.
  Per Bundle-Sync-Phase-1 wird die Bundle-Änderung automatisch
  weitergegeben; PHP-seitige Anpassung ist separater Schritt.
- **Implementierungsphasen:** Phase A = Library-Schema-Split,
  Phase B = Engine-Rendering (Daten-Attribute + L2-Modal),
  Phase C = TYPO3-Ext-Anpassung (folgt automatisch + ggf. PHP-
  Anpassung), Phase D = TYPO3-BE-Provider-Katalog (post-v1.0).
  Phase A + B = v1.0-Scope.

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

**Status:** ✅ erledigt 2026-05-13 — Implementation in `src/cms-bridge/`,
Schema-Dokumentation in [docs/cms-bridge-webhook.md](cms-bridge-webhook.md).

Webhook-Notifications für unbekannte Tracker in Production.

- [x] Config: `cmsBridgeUrl: string`, optional `cmsBridgeAuth: CmsBridgeAuth`
      (Bearer-by-default, custom `header` / `scheme` möglich; strukturell
      identisch zu `ServiceDbAuth`, damit ein CMS-Plugin denselben Token
      für beide Endpoints verwenden kann). Zusätzlich
      `cmsBridge?: { source, dedupTtlMs, timeoutMs }` für Advanced-Overrides.
- [x] Bei Detektion eines unbekannten Items (Recorder + Service-DB-Miss):
      `fetch(cmsBridgeUrl, { method: 'POST', body: JSON.stringify(payload) })`
      mit `Content-Type: application/json` und optionalem Auth-Header.
      Verdrahtet in `startRecorder()` über `recorder.on('detection', ...)`.
- [x] Rate-Limiting / De-Duplication clientseitig: Dedup nach
      `${kind}:${identifier}` mit konfigurierbarer TTL (Default 1 h). Map
      lebt im Speicher; reset bei `init()`-Re-Call oder Hard-Navigation.
- [x] Schema des Webhook-Payloads dokumentiert in
      `docs/cms-bridge-webhook.md` — aktuell **schemaVersion 2**
      (batched `detections[]`, jede Detection mit
      `status: 'known' | 'unknown'` und optionalem
      `matchedService`). `page.url` und `detection.firstSeenOn`
      werden um Query-Strings/Fragmente gekürzt (Privacy-Default —
      Session-Tokens / Magic-Link-Params).
- [x] Test: 23 Unit-Tests in `src/cms-bridge/bridge.test.ts` plus
      11 Playwright wire-contract Specs in `tests/bridge/` gegen
      einen echten Browser (Payload-Shape, Batching, Cross-Session-
      Dedup, DNT, `pagehide`/`sendBeacon`, Feedback-Loop-
      Suppression). Plus End-to-End-Tests in `tests/index.test.ts`,
      die das "Double-Fire bei Enrichment"-Problem absichern.

**Hinweise:**

- **Double-Fire-Gotcha:** Der `LayeredClassifier` veröffentlicht jede
  Detection synchron mit `status: 'unknown'` und stößt parallel einen
  Service-DB-Lookup an. Bei DB-Treffer ruft er `recorder.enrichDetection()`,
  was die Detection mit `status: 'known'` erneut veröffentlicht. Der
  Bridge-Filter auf `status === 'unknown'` plus die TTL-Dedup-Map fangen
  das ab; der End-to-End-Test in `tests/index.test.ts` schützt das gegen
  Regressionen.
- **Failure-Modes asymmetrisch:** 4xx (Receiver hat explizit abgelehnt)
  hält die Dedup-Map, damit wir nicht hämmern. 5xx und Netzwerkfehler
  löschen den Map-Eintrag, damit die nächste Detection es nochmal
  versuchen kann. Beides ist `console.warn`-gateed pro Error-Kategorie
  pro Session.
- **Kein Retry mit Backoff:** Bewusst nicht gebaut. Die Bridge ist
  Monitoring-Telemetry, nicht consent-kritisch; eine verlorene Webhook
  bedeutet ein verpasster Alert auf einer Seite, beim nächsten Aufruf
  (post-TTL) feuert es wieder. Retry mit Auth-Token gegen eine
  fehlerhafte Receiver-URL hätte schlechtes DoS-Verhalten.
- **Misconfig-Warning:** Wenn `cmsBridgeUrl` gesetzt ist aber `record`
  fehlt, gibt `init()` ein `console.warn` aus — sonst wäre die Bridge
  stumm und die Konfiguration silent broken.

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

## Release-Härtung für v1.0

Punkte, die wir bis zum 1.0-Cut wollen, aber die Pre-1.0 (mit kleiner
Nutzerschaft und schnellem lokalen Entwicklungs-Loop) keinen akuten
Druck haben. Bewusst hier aufgehoben, damit sie zur 1.0-Vorbereitung
wieder hochkommen.

### REQ-18 — Bundle-Sync CI Phase 2 (Verhaltens-Gates)

**Status:** ⬜ offen — bewusst auf v1.0-Vorbereitung verschoben 2026-05-27.

**Warum:** Phase 1 des `sync-bundle.yml`-Workflows
(`SimpleCMP/t3-simplecmp@7f348ea`, geliefert 2026-05-26) gated jeden
Bundle-Sync von Upstream auf *interne Konsistenz*: Bundle-Integrität
(Dateigröße, Syntax-Check, Symbol-Präsenz) + PHPUnit Unit + PHPUnit
Functional. Was Phase 1 NICHT abdeckt, sind *Verhaltens-Regressionen*,
die ein Besucher sehen würde:

- Banner mountet auf einer echten TYPO3-Seite überhaupt
- Accept / Decline persistiert (Cookie + Banner unmount)
- Universal-Blocking server-seitig (`HtmlRewriter`-Middleware)
- Universal-Blocking Phase 2 Runtime-Patches (JS-injected `src`-Swaps)
- Click-to-enable contextual-notice neben blockierten Iframes
- Bridge-POST-Round-Trip (Cookie pflanzen → Webhook empfängt → BE-Tabelle hat Zeile)
- BE-Modul-State-Derivation gegen ein frisches Bundle

Pre-1.0-Begründung für Defer: Der lokale Dev-Loop
(`pnpm build` → auto-sync → `cache:flush` → Browser-Refresh) ist
schnell und effektiv. Upstreams eigene Playwright-Bridge-Suite
(`SimpleCMP/simplecmp tests/bridge/`, 11 Specs in echtem Chromium)
exerciert das Bundle bereits in einem Browser, BEVOR der Dispatch in
diesen Workflow geht. Die *inkrementelle* Abdeckung, die Phase 2 hier
hinzufügt, ist die TYPO3-seitige Integrations-Klebe — eine schmale
Scheibe, deren häufigste Bruch-Vektoren (API-Name geändert) bereits
durch Phase 1's `BUNDLE`-Symbol-Präsenz-Check abgefangen werden.

Eine TYPO3-in-CI-Stack zu pflegen hat laufende Kosten (Schema-
Migrations, TYPO3-Patch-Updates, Composer-Drift). Pre-1.0 wo APIs
explizit instabil sind, ist diese Steuer zu teuer für den Gewinn.
Post-1.0 wenn externe Nutzer auf Stabilität angewiesen sind, dreht
sich die Rechnung.

**Skizze in Memory:** Phase-2-Plan ist ausgearbeitet in
`bundle_sync_automation.md` (Memory-File). Drei Lieferungen sind dort
beschrieben:

- A. **TYPO3 in CI booten.** Empfehlung Compose mit FrankenPHP-on-Alpine
  (spiegelt Sven's reference-server Dockerfile-Ansatz aus
  `library.simplecmp.eu`). Alternativen: Service-Containers
  (eine-Image-pro-Service-Limit) oder ein minimaler `php -S`-basierter
  Standalone-Install ohne Docker.
- B. **Bestehende 5 BE-Playwright-Specs in CI:** smoke,
  classifier-state-derivation, dismiss-flow, library-browser,
  registry-banner-state. Laufen lokal gegen dev14; brauchen nur
  Stack-Pointer + Healthcheck-Wait.
- C. **~7 neue FE-Smoke-Specs in `Tests/Playwright/fe/`:** Banner-Mount,
  Accept-all → Cookie + unmount, Decline-all → Cookie + unmount,
  Universal-Blocking server-side rewrite (`Server-Timing: rewriter`
  Header + `data-name` + `src="about:blank"`), Universal-Blocking
  Phase-2 Runtime-Patch (JS-injected src swallowed), Contextual-Notice
  neben blockiertem Iframe, Bridge-POST-Round-Trip.

**Acceptance Criteria (skizziert):**

- [ ] Test-Stack in CI bootbar — Stack-Form (Compose vs. php -S vs.
      Service-Containers) zu lock vor Start.
- [ ] Die 5 bestehenden BE-Playwright-Specs laufen in CI auf jedem
      `bundle-sync`-Dispatch.
- [ ] ~7 neue FE-Smoke-Specs unter `Tests/Playwright/fe/` decken das
      oben gelistete Bundle-FE-Verhalten ab.
- [ ] `fixtures/db.ts` env-aware: lokal `ddev mysql`, in CI direkt
      gegen den MariaDB-Service-Container.
- [ ] Phase-2-Gates verdrahtet NACH den existierenden PHPUnit-Gates
      in `.github/workflows/sync-bundle.yml`.
- [ ] Stack-README in `Tests/Playwright/ci/README.md` damit ein
      Entwickler ihn lokal zum Debuggen hochfahren kann.

**Abhängigkeit:** Triggert spätestens dann, wenn ein realer externer
Nutzer das Bundle konsumiert — also unmittelbar vor v1.0-Release.

---

## Nice-to-have, später

### REQ-N1 — Mehrstufiger Banner (Notice → Modal)

Banner mit drei Buttons (Akzeptieren / Ablehnen / Einstellungen), zweite Ebene
mit feingranularen Toggles. Klaro hat das ansatzweise, Konfiguration ist aber
fragmentiert.

### REQ-N2 — Headless-Modus

Nur Consent-State, Storage, Events — keine UI. Für SPAs (Vue, React, Svelte),
die ihre eigene UI rendern wollen.

**Status:** ✅ erledigt 2026-05-13 — `simplecmp/engine`-Subpath-Export in
`package.json` verdrahtet, eigener tsup-Entry baut `dist/engine.mjs` +
`dist/engine.d.ts`. Smoke-Test in `tests/engine-headless.test.ts` deckt
Manager-Erzeugung, Persistenz, Legacy-`apps`-Migration und Event-Bus ab und
bestätigt, dass der Engine-Import keine UI-Komponenten mountet.

### REQ-N3 — Tag-Manager-Friendly

Built-in `dataLayer.push({ event: 'consent_update', ... })`-Hook für GTM und
ähnliche.

### REQ-N4 — Geo-aware Defaults (Region-Engine)

**Status:** ✅ Umgesetzt 2026-06-11 — Engine + alle Konsumenten. Design +
Acceptance Criteria 2026-06-11 ([ADR-0015](adr/0015-region-aware-consent-regimes.md)).

**Umsetzung (Shipped):**

- **Phase A — Engine-Kern** (`bfa7e35`): `regions.ts` (Regime-Typ,
  Region→Regime-Tabelle, `resolveRegime`); `getDefaultConsent` regime-gesteuert,
  GPC-Pfad (REQ-5) darin generalisiert; Vitest-Abdeckung der Acceptance Criteria.
- **Phase B — Public API** (`db4af78`): `region` / `regimeDefault` / `regimes`
  als Config-Eingaben, `getRegime()` + „Banner zeigen?"-Signal exponiert.
- **Phase C — UI** (`a41e003`): Opt-out-Hinweis-Banner (nicht-blockierend) +
  dauerhafter „Do Not Sell or Share"-Trigger.
- **Phase D — Konsumenten:** TYPO3 serverseitige Region-Auflösung
  (`t3-simplecmp@b5e1925`, `regimeDefault` + `regionHeader` Site-Settings);
  Shopify `getRegion()`-Wiring + `sale_of_data`-Mapping
  (`simplecmp-shopify@84bb155`).

**Warum:** Datenschutzregime unterscheiden sich fundamental nach **Aufenthaltsort
der betroffenen Person** und **Niederlassung des Verantwortlichen** — NICHT nach
Serverstandort und NICHT nach Staatsangehörigkeit (DSGVO Art. 3). EU/EWR/UK/CH =
**Opt-in** (DSGVO/ePrivacy: nicht-essentielle Verarbeitung erst nach
Einwilligung). US-Bundesstaaten (CCPA/CPRA Kalifornien, VCDPA, CPA, CTDPA, UCPA …)
= **Opt-out**: Verarbeitung per Default erlaubt, Verbraucher hat Widerspruchsrecht
(„Do Not Sell or Share"), GPC ist als Opt-out-Signal rechtlich anerkannt. Eine
CMP, die US-Besuchern eine EU-Opt-in-Wand aufzwingt, ist über-konform, aber
UX-/Conversion-schädlich und für US-/DTC-Händler die schlechtere Wahl. **Beide
Regimes müssen ab Start unterstützt werden.**

**Designentscheidung (siehe [ADR-0015](adr/0015-region-aware-consent-regimes.md)):**

- Die Engine macht **keine** clientseitige Geo-Erkennung (unzuverlässig + wäre ein
  Pre-Consent-Drittanbieter-Call). Die **Region wird serverseitig gesetzt**
  (CDN-/Edge-Header, GeoIP, bei Shopify `getRegion()`).
- Modell: **Baseline-Regime (händlergesetzt, Default `opt-in`) + optionaler
  Region-Override (Besucher-Jurisdiktion, serverseitig)**. Ein EU-Händler wählt
  schlicht Baseline `opt-in` für alle (häufigster, sicherster Fall); Region ist
  eine optionale Verfeinerung, um US-Besuchern die leichtere Opt-out-Erfahrung zu
  geben.
- Unbekannte/nicht gemappte Region → striktestes Regime (`opt-in`).

**Acceptance Criteria:**

- Config: `regimeDefault?: 'opt-in' | 'opt-out' | 'none'` (Default `'opt-in'`);
  `region?: string` (serverseitig gesetzte Besucher-Jurisdiktion, z. B. `'DE'`,
  `'GB'`, `'US-CA'`, `'US'`); `regimes?: Record<string, Regime>` (Override der
  eingebauten Region→Regime-Tabelle).
- Eingebaute Default-Tabelle: EU/EWR-Codes + `GB` + `CH` → `opt-in`; bekannte
  US-Opt-out-Staaten (`US-CA`, `US-CO`, `US-CT`, `US-VA`, `US-UT`, …) + Catch-all
  `US` → `opt-out`; sonst → `regimeDefault`.
- **opt-in:** nicht-essentielle Services default-deny; Banner ist eine
  Entscheidungs-Wand (Accept/Decline/Save), `mustConsent`-artig.
- **opt-out:** nicht-essentielle Services default-**allow**; Banner ist ein
  *Hinweis* (nicht-blockierend, dismissbar) + dauerhafter „Do Not Sell or
  Share"-Zugang; GPC erzwingt Opt-out.
- **none:** default-allow, kein automatisches Banner (nur Einstellungs-Trigger).
- **GPC (REQ-5) komponiert über das Regime:** GPC=true erzwingt in BEIDEN Regimes
  default-deny für nicht-essentielle Services (sicheres Verhalten); feinkörnigeres
  „GPC nur für sale/share" ist eine spätere Verfeinerung.
- Die Engine exponiert das aufgelöste Regime (`getRegime()` / Feld) und ein
  „Banner zeigen?"-Signal, damit die UI Opt-in-Modal vs. Opt-out-Hinweis rendern
  kann.
- `getDefaultConsent` (`consent-manager.ts`) wird vom Regime gesteuert; der
  REQ-5-GPC-Pfad wird darin generalisiert (keine Doppel-Logik).
- Tests (Vitest): Default-Consents je Regime; Region→Regime-Auflösung inkl.
  Override-Map; GPC-Override in beiden Regimes; unbekannte Region → `opt-in`;
  `none` → kein Auto-Banner.

**Cross-cutting:** lebt in der Engine, konsumiert von TYPO3 / Shopify / WordPress.
Bei Shopify liefert `getRegion()` die Region und das `sale_of_data`-Signal bildet
das US-Opt-out ab. Kein Client-Geo-IP. **Consent Mode v2 bleibt separat**
(optionales Plugin/Hook, nicht Teil dieser REQ — siehe „Bewusst nicht im Core").

### REQ-N5 — Server-side Consent Token

Signiertes JWT/HMAC-Token, das das Backend prüfen kann, bevor es
Tracking-Requests akzeptiert. Schließt eine häufige Audit-Lücke.

### REQ-N6 — CSP-strict-Build

`'unsafe-inline'` vermeiden. Wir haben das fast geschenkt durch separate CSS;
inline-styles in den JSX-Komponenten müssten geprüft und ersetzt werden.

### REQ-N7 — CMS Bridge: wait for Service-DB before firing webhook

**Status:** ✅ erledigt 2026-05-17 — via neuem `'detectionSettled'`
Recorder-Event. Bridge hängt jetzt an diesem Event statt an
`'detection'`; das Settled-Event feuert erst, nachdem das asynchrone
`LayeredClassifier`-Lookup abgeschlossen ist. Detections, die das
Service-DB-Lookup als `known` klassifiziert, erzeugen kein Webhook.
Doku-Block "Known limitation" in `cms-bridge-webhook.md` entfernt;
durch einen "Coordination with the Service DB"-Abschnitt ersetzt.

**Ursprünglicher Bericht:** entdeckt 2026-05-14 beim TYPO3-Integrationstest
([WapplerSystems/simplecmp-typo3](https://github.com/WapplerSystems/simplecmp-typo3)).

Wenn `serviceDbUrl` UND `cmsBridgeUrl` gleichzeitig konfiguriert sind,
feuert die Bridge sofort beim ersten `status: 'unknown'`-Announcement
— bevor der asynchrone DB-Lookup eine Chance hat, das Item als `known`
zu klassifizieren. Folge: bekannte Tracker (`_ga`, `_fbp` etc.) tauchen
sowohl im Service-DB-Hit als auch in der Webhook-Tabelle des CMS auf.
Per `docs/cms-bridge-webhook.md` aktuell als "Known limitation"
dokumentiert.

Vorschlag für die Behebung:

- `cmsBridge.gracePeriodMs?: number` (Default `0` = aktuelles Verhalten);
  bei positivem Wert verzögert die Bridge das Posten um diese Spanne
  und checked erneut den Status der Detection vor dem Senden.
- ODER: ein neues Recorder-Event `detectionSettled` (feuert nach
  beendetem DB-Lookup), an dem die Bridge statt am `detection`-Event
  hängt. Architektonisch sauberer aber größere Änderung.

**Abhängigkeit:** sinnvoll erst zu fixen, wenn ein realer Admin die
`tx_simplecmptypo3_detection`-Tabelle ansieht — das passiert mit
Iteration 4 der TYPO3-Extension (BE-Modul für Service-Pflege +
Detection-Review). Bis dahin kein Druck.

**Acceptance Criteria (skizziert):**

- [ ] Neuer Config-Schlüssel oder Event, dokumentiert.
- [ ] Unit-Test: Detection mit DB-Hit → kein Webhook nach Grace-Period.
- [ ] Unit-Test: Detection ohne DB-Hit → Webhook nach Grace-Period.
- [ ] Doku in `docs/cms-bridge-webhook.md` aktualisiert; "Known
      limitation"-Block entfernt.

### REQ-N8 — Opt-in-Blocking für Drittanbieter-Stylesheets (Google Fonts)

**Status:** umgesetzt (2026-06-10). Phase A (Engine) + Phase B (Rewriter +
Schalter, Default aus) + Phase C (C1 Stylesheet-Kind, C2 stylesheet-scoped
Per-Host-Allow, C3 First-Run-Nudge + Self-Hosting-Hinweis) + Decision-Doc +
admin-facing README-Section geliefert.

**Hintergrund:** Der Universal-Blocking-Rewriter (ADR-0013) schreibt seit
2026-05-30 nur noch Resource-Hint-`<link>`-rels um (preconnect / preload / …);
`rel="stylesheet"` bleibt bewusst unangetastet, damit kein Drittanbieter-CSS
(Bootstrap-CDN, Font Awesome, **Google Fonts**) zerbricht — Stylesheets sind
render-kritisch und haben keine Click-to-load-Recovery. Siehe
`docs/decisions/2026-05-30-link-rewrite-rel-policy.md` im TYPO3-Plugin
(Part A umgesetzt).

Folge: dynamisch geladene Google Fonts (`<link rel="stylesheet"
href="fonts.googleapis.com/…">`) werden per Default nicht blockiert — der
prominenteste DACH-Abmahn-Fall (LG München I, 20.01.2022, Az. 3 O 17493/20).
Der ehrliche Fix ist Self-Hosting; eine als „compliance-first" positionierte
CMP sollte aber zumindest etwas anbieten.

**Vorschlag (zwei Teile):**

1. **Per-Site-Opt-in** `universalBlocking.blockStylesheets` (Default **aus**):
   blockt Drittanbieter-`rel="stylesheet"` **mit Consent-Reinjection** —
   `href` → `data-src` strippen und das `<link>` bei Accept neu injizieren
   (Cookiebot-Modell), kein dauerhafter Strip. Docs führen mit „Self-Hosting"
   und rahmen den Schalter als Best-Effort.
2. **Drittanbieter-Stylesheet-Hosts** (`fonts.googleapis.com`,
   `fonts.gstatic.com`, …) im Detection-/Discover-Flow sichtbar machen, mit
   einem „Self-Hosting empfohlen"-Hinweis — der Recorder hat das Primitive
   bereits.

**Caveat (muss dokumentiert bleiben):** auch mit Schalter ist serverseitiges
`<link>`-Rewriting leaky — der Browser-Preload-Scanner kann das Stylesheet vor
dem Eingriff laden, und `@import url(...)` innerhalb eines Stylesheets entkommt
komplett. Also Best-Effort, nicht „jetzt compliant".

**Abhängigkeit:** braucht Cross-Repo-FE-Engine-Arbeit in `simplecmp`
(Stylesheet-Block-and-Reinject — die Engine hat aktuell keinen
Stylesheet-Recovery-Pfad) plus TYPO3-BE-Schalter + Detection-Hinweis im
Plugin. Feature, kein Fix — deshalb von Part A (dem reinen `<link>`-rel-Fix)
entkoppelt.

**Warum zurückgestellt** (Deep-Research 2026-05-30): keine etablierte CMP
schreibt beliebige `<link>`-Stylesheets automatisch um — Self-Hosting ist der
Konsens (Complianz, Usercentrics, Google selbst); Default-Blocking zerbricht
Seiten und liefert wegen Preload-Scanner / `@import` trügerische Sicherheit.
Daher opt-in und später.

**Acceptance Criteria:**

- [x] **Phase A (Engine, `simplecmp@d9023a2`):** Stylesheet-Block-and-Reinject —
      `<link data-name data-href>` bleibt ohne Consent blockiert (kein `href`),
      Engine reinjiziert `href` aus `data-href` bei Consent und re-blockt bei
      Widerruf. Fixte zwei latente `<link>`-Bugs (Skip-Guard prüfte nur `src`;
      No-Consent-Pfad strippte `href` nicht). +Tests.
- [x] **Phase B (TYPO3, `t3-simplecmp@ad289e1`):** Site-Set-Feld
      `universalBlocking.blockStylesheets` (**Default aus**); `HtmlRewriter`
      schreibt Drittanbieter-`rel="stylesheet"` nur bei aktivem Schalter um
      (`data-href`, `href` gestrippt). Same-Origin + Allowlist bleiben
      ausgenommen. +Tests.
- [x] **Phase C1 (TYPO3, `t3-simplecmp@c7e1872`-Reihe):** Blockierte Stylesheets
      werden als eigener `stylesheet`-Detection-Kind erfasst (statt generischem
      `link`), damit das BE sie getrennt anzeigen/behandeln kann. +Tests.
- [x] **Phase C2 (TYPO3, `t3-simplecmp@c7e1872`):** Stylesheet-scoped Per-Host-Allow.
      Neue Tabelle `tx_t3simplecmp_allowed_stylesheet_host` + Repository, keyed by
      `source` (= `DiscoverSource::forSite()`), den der Rewriter ebenfalls ableitet.
      Pro blockierter Stylesheet-Zeile **[Stylesheet erlauben]**; der Rewriter lässt
      das CSS des Hosts durch — **nur Stylesheets**: Scripts/iframes desselben Hosts
      bleiben geblockt (bewusst enger als die host-weite `universalBlocking.allowlist`).
      Rewriter-Precision- + Repository-Functional-Tests. Browser-verifiziert.
- [x] **Phase C3 (TYPO3, `t3-simplecmp@0fea98f`):** First-Run-Nudge + Self-Hosting-
      Hinweis. Detection-Listen-Callout, sichtbar nur in der präzisen Lücke (Site hat
      `universalBlocking.enabled` an, `blockStylesheets` aus) und nur bei vorhandener
      Drittanbieter-`<link>`-Evidenz; rahmt den IP-Leak, führt mit Self-Hosting, bietet
      pro Site einen „In den Website-Einstellungen aktivieren"-Deeplink + *Discover*.
      Self-clearing pro Site beim Aktivieren. Pro Zeile ein „Self-Hosting empfohlen"-
      Hinweis. Browser-verifiziert (an→aus→an, Per-Site-Self-Clearing).
- [x] **Docs (Decision + README):** Default-aus + Nudge-Begründung dokumentiert in
      `t3-simplecmp/docs/decisions/2026-06-10-stylesheet-blocking-default-off.md`;
      Feld-Beschreibung führt mit Self-Hosting, rahmt Best-Effort, dokumentiert
      Preload-Scanner- / `@import`-Leaks. Admin-facing How-to-Section „Blocking
      third-party stylesheets (Google Fonts)" + Status-Eintrag #14 in
      `t3-simplecmp/README.md` (`@fe09222`).

**Default-Entscheidung (2026-06-10):** Schalter bleibt **aus**, NICHT an (trotz
`universalBlocking.enabled=true`): ein blockiertes Stylesheet scheitert
*sichtbar* und ohne Besucher-Recovery (anders als Script/iframe) → Default-an
würde Sites beim Upgrade zerlegen. Aktivierung ist ein geführter Opt-in
(First-Run-Nudge). Ein späterer Flip auf Default-an ist eine geteilte
Compliance-Entscheidung (wie der `enabled=true`-Flip → Sven). Siehe Decision-Doc.

**Referenzen:** Decision-Doc
`docs/decisions/2026-05-30-link-rewrite-rel-policy.md` (Part B = dieses REQ) im
TYPO3-Plugin; Research-Survey
`docs/research/2026-05-blocked-embed-placeholder-cmp-survey.md`.

---

### REQ-N9 — Kompatibilität mit StaticFileCache (Full-Page-HTML-Cache)

**Status:** offen, ungetestet (2026-06-08).

**Hintergrund:** `EXT:staticfilecache` (und ähnliche Full-Page-Caches) liefert
fertig gerendertes HTML direkt vom Webserver aus, ohne PHP. SimpleCMP hat
mehrere per-Request-PHP-Mechanismen, die mit eingefrorenem HTML kollidieren
können. Das TYPO3-Plugin hat aktuell **kein** StaticFileCache-Bewusstsein.

**Befund (analysiert, nicht getestet):**

1. **Client-seitige Teile: kompatibel.** Banner, Modal, Consent-Speicher
   (Cookie/localStorage), Theme, Click-to-Enable sind reines JS im HTML —
   statisches Caching ist hier egal. Ebenso die `/api/simplecmp/*`-Routen
   (dynamische POST-/API-Routen, werden nicht seitengecacht).

2. **Universal Blocking (HtmlRewriter): reihenfolge-abhängig, Compliance-Risiko.**
   Der Rewriter (PSR-15-Middleware, `after: typo3/cms-frontend/content-length-headers`)
   schreibt das HTML auf dem Rückweg um. Ob der Full-Page-Cache das
   **umgeschriebene** (geblockte) HTML speichert, hängt von der relativen
   Middleware-Reihenfolge ab. Fängt der Cache das HTML **vor** dem Rewriter ab,
   serviert die statische Datei die **ungeblockten** Drittanbieter-Tags →
   Pre-Consent-Tracking bei jedem Cache-Hit (Compliance-Bruch). Muss
   verifiziert und ggf. die Order erzwungen werden.

3. **CMS-Bridge-Nonce: bricht nach der TTL.** `RegisterAssets` backt pro Render
   einen HMAC-Nonce mit 1h-TTL ins Inline-`init` (`cmsBridgeAuth.token`,
   `BridgeNonceService::DEFAULT_TTL_SECONDS = 3600`). Eine statisch gecachte
   Seite friert den Nonce ein → nach 1h liefern alle Besucher der Cache-Datei
   einen abgelaufenen Nonce → Bridge-POSTs → 401 → Drift-/Detektions-Meldung
   hört still auf. (Record-Mode / Discover sind admin-getrieben und
   unbetroffen.)

**Vorschlag:**

1. **Nonce nicht mitcachen** — als nicht-gecachtes `USER_INT`-Fragment rendern
   oder per winzigem, nicht-gecachtem Endpoint nachladen (entspricht dem
   `cmsBridgeAuth.getToken`-Callback-Ansatz; siehe Begründung für die
   1h-TTL-Entscheidung). Dann überlebt die Bridge das Full-Page-Caching.
   Fallbacks: TTL hochsetzen (schwächt die Auth) oder Bridge-Seiten vom Cache
   ausnehmen.
2. **Rewriter-Order verifizieren** — sicherstellen, dass der Full-Page-Cache
   das post-Rewrite-HTML (geblockte Tags) speichert; sonst Order anpassen bzw.
   die nötige Konfiguration dokumentieren.
3. **Doku** — Abschnitt „Betrieb mit StaticFileCache" im Plugin (welche Seiten
   cachebar, Nonce-Ausnahme, Verifikation des Blockings im Static-File).

**Acceptance Criteria (skizziert):**

- [ ] Cache-Hit einer Seite mit Drittanbieter-Embed enthält `src="about:blank"`
      (Blocking bleibt im Static-File erhalten) — verifiziert.
- [ ] Bridge funktioniert auf einer > 1h gecachten Seite (Nonce nicht
      eingefroren) — eine Detektion landet im BE.
- [ ] Plugin-Doku-Abschnitt „Betrieb mit StaticFileCache".

**Abhängigkeit:** primär TYPO3-Plugin (`t3-simplecmp`: Nonce-Rendering +
Middleware-Order + Doku); ggf. kleine FE-Engine-Ergänzung in `simplecmp` für
einen Token-Refresh-Callback. Reine Hardening/Kompatibilität, kein v1.0-Blocker.

**Referenzen:** ADR-0013 (Universal Blocking / HtmlRewriter);
`Classes/Service/BridgeNonceService.php` + `Classes/EventListener/RegisterAssets.php`
im TYPO3-Plugin (Nonce-Erzeugung/-Einbettung).

---

### REQ-N10 — Google Consent Mode v2 (Signal-Hook)

**Status:** 🟦 in Arbeit — Design 2026-06-12 ([ADR-0016](adr/0016-google-consent-mode-v2-hook.md);
getrieben von Shopify-ADR-0003). Vorher: als „optionales Plugin/Hook in Phase 5"
geparkt (siehe „Bewusst nicht in v1.0"). **AC nachgeschärft 2026-06-12** nach
Design-Review ([Review-Doc](research/2026-06-req-n10-consent-mode-v2-review.md)):
Returning-Visitor-Replay, Wechselwirkung mit Universal Blocking, dynamische
`ads_data_redaction`, Signal-Abdeckung im `default`-Kommando, Shim-Form.

**Warum:** Ein CMP signalisiert Google-Tags die Einwilligung (`gtag('consent', …)` /
dataLayer), damit das **bestehende** GA4 / Google Ads des Händlers sie respektiert —
es betreibt KEINE eigene Daten-Pipeline (das ist Analytics-App-Territorium, doppelte
Zählung, Datenhoheit beim Anbieter). Shopifys nativer Banner sendet nur **Basic**
Consent Mode und erreicht GTM / hartkodiertes gtag nicht; **Advanced Consent Mode v2**
zu senden ist die eigentliche CMP-Lücke. Gilt für ALLE Hosts (Shopify/TYPO3/WordPress)
→ Engine-Feature, nicht Host-spezifisch.

**Designentscheidung:** Opt-in-Hook in der Engine, Default aus, keine
Verhaltensänderung ohne Konfiguration. Mapping **purpose-basiert** (`Service.purposes`),
damit beliebige Händler-Dienste ohne Google-spezifisches Feld pro Dienst funktionieren.
Die Engine **lädt kein** gtag/GTM — sie pusht nur Consent-Kommandos in den dataLayer,
den der händlereigene Tag liest.

**Acceptance Criteria:**

- Config: `consentMode?: boolean | ConsentModeConfig`. `true` = aktiviert mit
  Default-Mapping. `ConsentModeConfig`: `purposeSignals?` (purpose-id → Google-Signale;
  Default `analytics → ['analytics_storage']`, `marketing → ['ad_storage',
  'ad_user_data', 'ad_personalization']`), `waitForUpdate?` (ms, Default 500),
  `dataLayerEvent?` (`boolean | string`; Default **an** mit Event-Name
  `'simplecmp_consent_update'`, `false` = aus — GTM-Nutzer sind die Hauptzielgruppe,
  hartkodiertes gtag reagiert ohnehin auf das Consent-Kommando selbst),
  `redactAdsData?` (Default false, Semantik siehe unten).
- **Bootstrap (vor Consent):** `window.dataLayer` + `gtag`-Shim sicherstellen — Shim
  in kanonischer Form `function gtag(){dataLayer.push(arguments)}` (GTM liest
  `arguments`-Objekte; ein Array-Push bricht dessen Consent-Auswertung) — dann
  `gtag('consent','default', { …Signale, security_storage:'granted', wait_for_update })`.
  Das `default`-Kommando enthält **alle im Purpose-Mapping vorkommenden Signale** plus
  `security_storage:'granted'`; nicht gemappte Signale (z. B. `functionality_storage`)
  werden bewusst **weggelassen** — unset ≠ denied; wer sie steuern will, mappt sie
  über `purposeSignals`. Default-Zustand jedes Signals leitet sich aus dem
  **bestehenden** Default-Consent ab, der bereits **Regime** (REQ-N4: opt-in →
  `denied`, opt-out → `granted`) und **GPC** (REQ-5: erzwingt `denied`) zusammenführt.
  Keine neue Policy-Logik.
- **Replay (Returning Visitor):** Liegt beim Init **gespeicherter Consent** vor,
  emittiert der Hook unmittelbar nach `default` ein `gtag('consent','update', …)` mit
  dem gespeicherten Zustand — innerhalb des `waitForUpdate`-Fensters. Ohne Replay
  hängt jeder wiederkehrende Besucher dauerhaft auf `default: denied` und GA4 verliert
  sämtlichen Repeat-Traffic (klassischer CMP-Consent-Mode-Bug). Nicht darauf
  verlassen, dass `notify('consents')` beim Restore zufällig feuert — expliziter
  Codepfad + Test.
- **Update (bei jeder Entscheidung):** über `manager.watch`/`notify('consents')`. Ein
  Signal ist `granted`, wenn mindestens ein **eingewilligter** Dienst einen darauf
  gemappten Zweck trägt, sonst `denied` → `gtag('consent','update', {…})` + (sofern
  `dataLayerEvent` nicht `false`) `dataLayer.push({event, …})`.
- **Redaction:** `redactAdsData: true` aktiviert `ads_data_redaction` **dynamisch**
  nach Googles Muster — `gtag('set','ads_data_redaction', true)` solange
  `ad_storage = denied`, `false` sobald granted; emittiert **vor** dem
  `default`-Kommando und bei jedem Update neu. Kein statischer Passthrough.
  `url_passthrough` bleibt bewusst außerhalb des Scopes (Tag-/Händler-Konfiguration,
  keine CMP-Aufgabe).
- **Reihenfolge:** `default` muss vor der Google-Tag-Bibliothek laufen — nutzt die
  bestehende `<head>`-Priorität (wie Universal Blocking); keine neuen Constraints außer
  „Engine im `<head>` laden".
- **Wechselwirkung Universal Blocking (ADR-0012) — zwei bewusste Compliance-Haltungen,
  nicht nur ein Konfig-Konflikt:** Advanced Consent Mode setzt voraus, dass das
  Google-Tag **pre-consent lädt** und cookielose Pings sendet. Das ist nicht nur
  technisch unvereinbar mit Load-Blocking, sondern eine **Compliance-Abwägung**: die
  cookielosen Pings sind ein Netzwerk-Call an Google **vor** der Einwilligung, den
  mehrere DACH/EU-Aufsichtsbehörden als zustimmungspflichtigen Datentransfer werten.
  Daher pro signal-relevantem Dienst eine explizite Wahl (kein stilles Defaulting):
  - **(1) Blockieren** (strikteste Haltung, unser Default/Erbe): kein Call an Google
    bis Consent; Consent Mode für diesen Dienst aus.
  - **(2) Signal-Gating** (Consent Mode v2): Tag lädt, cookielose Pings pre-consent,
    volle Messung nach Consent — bessere Messbarkeit, schwächere Striktheit.

  Ein Dienst darf **nicht gleichzeitig** load-blockiert UND signal-gegated sein
  (sonst stilles Degradieren zu Basic). Host-Integrationen müssen die Abwägung
  **sichtbar machen** (die Shopify-„GA4 erkannt"-Karte benennt beide Haltungen +
  den Pre-Consent-Ping-Trade-off, statt still zu Variante 2 zu lenken) — wir bleiben
  ehrlich bei genau dem Punkt, den wir kommerziellen CMPs vorwerfen.
- **Grenzen:** kein Laden von gtag/GTM; nur Google-Signale (Meta o. Ä. außerhalb des
  Scopes); FE-Best-Effort-Reihenfolge (Tag vor Engine = `default` kann verpasst werden,
  dokumentiert); keine `region`-Arrays im `default`-Kommando — die Region ist bereits
  serverseitig pro Besucher aufgelöst (REQ-N4), ein pauschales Region-Mapping im
  Kommando wäre redundant.
- Tests (Vitest): Default-Kommando je Regime (opt-in→denied / opt-out→granted); GPC
  erzwingt denied; **Replay: gespeicherter Consent → `default` gefolgt von `update`
  im selben Init**; Update-Mapping (purpose→Signale, granted nur bei eingewilligtem
  Dienst); **Shim-Form: `dataLayer`-Einträge sind `arguments`-Objekte, keine Arrays**;
  **Redaction dynamisch an `ad_storage` gekoppelt**; dataLayer-Event per Default an,
  `dataLayerEvent: false` deaktiviert; nur gemappte Signale + `security_storage` im
  `default`; aus = keine globalen Schreibzugriffe.

**Cross-cutting:** Engine-Feature, konsumiert von Shopify (Bridge + Dashboard-Karte +
Detektions-Hinweis „GA4 erkannt"), später TYPO3/WordPress. Verifikation per Google
Tag Assistant (`default: denied` → `update: granted`), keine GA4-Property nötig.

---

### REQ-N11 — Banner-Barrierefreiheit (WCAG 2.2 AA / BFSG)

**Status:** 🟦 in Arbeit 2026-06-12 (getrieben vom Shopify-Tier-2 / Built-for-Shopify;
BFSG-relevant). Audit + Live-Pass (Shopify-Dev-Store) durchgeführt.

**Warum:** Der Consent-Banner ist die folgenreichste a11y-Fläche der CMP — kann ein
Screenreader-/Tastatur-Nutzer ihn nicht wahrnehmen/bedienen, kann er **keine gültige
Einwilligung** geben (= Compliance-Fehler). BFSG (in Kraft 06/2025) verlangt
Barrierefreiheit im E-Commerce; ein WCAG-AA-konformer Banner ist DACH-Verkaufsargument.

**Audit-Befund:** Der **Modal** ist solide (natives `<dialog>`+`showModal`,
Shadow-DOM-bewusster Fokus-Trap, Esc, Fokus-rein, `aria-labelledby`, Close-`aria-label`).
Der **Banner** war die Lücke: `role="dialog"` **ohne** `aria-modal`, **ohne** Fokus-Move
(Live-Pass: Fokus blieb auf `body`), **ohne** `aria-live` → für AT nicht angekündigt, und
`role="dialog"` auf einem nicht-modalen, nicht-fokussierten Balken ist semantisch falsch.

**Designentscheidung (Rollen):** Der Banner ist ein **nicht-modaler Hinweis** → er ist ein
**`role="region"`-Landmark mit `aria-label` + `aria-live="polite"`** (angekündigt beim
Erscheinen), **NICHT** `role="dialog"` (ein Dialog behauptet, der Rest der Seite sei
beiseitegestellt + müsse Fokus erhalten — `aria-modal` auf einem nicht-inertenden Balken
würde AT belügen). Der **Modal bleibt der echte Dialog** (Trap/Esc/Fokus). Opt-in/Wall =
Default-Deny-Semantik, kein visueller Trap.

**Acceptance Criteria:**

- Banner-Container: `role="region"` + `aria-live="polite"` + Accessible Name
  (`aria-labelledby` Überschrift, sonst `aria-label`); `tabindex="-1"` (programmatisches
  Fokus-Ziel, **kein** Tab-Stopp). Nicht `role="dialog"`.
- `autoFocus` (opt-in): bewegt Fokus in die Region; **Fokus-Rückgabe** an das vorherige
  Element beim Schließen (WCAG 2.4.3).
- Bedienelemente: Mindest-Zielgröße **24×24** (WCAG 2.5.8) via `min-block/inline-size`.
- Reduced Motion (`prefers-reduced-motion`) + Kontrast AA (1.4.3) bereits erfüllt
  (`tokens.ts` / frühere Token-Abdunklung).
- Test (Vitest): Banner ist `region` + `aria-live=polite` + `tabindex=-1` + benannt.
- `auditDom()` erweitert um Check **`dom-accessible-names`** (Regressions-Guard):
  Banner-`region` muss einen Accessible-Name aus `aria-label`/`aria-labelledby`
  tragen (Inhalt zählt für eine Region **nicht**), jeder Aktions-Button einen Namen
  aus aria-Attribut **oder** Textinhalt; fehlender Name ⇒ `severity: 'critical'`.
  Check ist **angehängt** (nicht umsortiert), damit indexbasierte Server-Mirror
  stabil bleiben. Zwei Vitest-Fälle (pass + gestrippter Region-Name ⇒ fail).

- **Live-Pass (2026-06-12, Shopify-Dev-Store, deployter Bundle `1dd9504`):**
  Accessibility-Tree zeigt `region "Cookie settings"` + benannte Buttons; Banner
  stiehlt keinen Fokus (non-modal); Modal = natives `<dialog>` `:modal` mit
  `aria-labelledby` → "Cookie settings", Fokus springt beim Öffnen auf *Close*,
  Esc schließt, Fokus kehrt zum auslösenden Button zurück (2.4.3). Alle Kriterien
  bestanden. **REQ-N11 vollständig.**

**Cross-cutting:** Engine-UI (`src/ui/`), konsumiert von allen Hosts (Shopify/TYPO3/WP);
nach Fix Bundle in Shopify re-vendoren.

---

### REQ-N12 — Zeitbasierter Einwilligungs-Ablauf (Re-Consent-Kadenz)

**Status:** ✅ Umgesetzt (Engine, 2026-06-16).

**Rechtlicher Hintergrund:** Es gibt **keinen gesetzlichen Ablauf** für eine
Einwilligung (EDSA-Leitlinien 05/2020 §110). Aufsichts-Best-Practice ist eine
Erneuerung in Intervallen: CNIL/ICO ~6 Monate, AEPD ≤24 Monate. Die **zwingende**
Re-Consent-Pflicht ist die *materielle Änderung* (DSK: jede Änderung der Cookies/
Drittdienste lässt die gebündelte Einwilligung entfallen) — die deckt bereits die
Service-Listen-Abgleichung in `_checkConsents()` + `consentVersion` (REQ-3) ab.
REQ-N12 ergänzt die *weichere* zeitbasierte Schicht. Siehe `consent-legal-findings`
(Recherche + Re-Verifikation 2026-06-16).

**Engine:** Neues Config-Feld `consentExpiryDays?: number`. `saveConsents` stempelt
`ts` in den gespeicherten Datensatz (`{ __v?, ts, consents }`); `loadConsents`
verwirft gespeicherte Einwilligung, die älter als das Limit ist, und zeigt den
Banner erneut (gleiche `changed`/`changeDescription`-UX wie der Versions-Mismatch),
via `_isConsentExpired`. **Default aus** (`undefined`/`0`); Datensätze **ohne `ts`
werden grandfathered** (nie zwangs-abgelaufen) — Aktivieren invalidiert also nicht
rückwirkend alle Besucher. Kein Server-Speicher, keine PII — die Altersmarke liegt
im Cookie des Besuchers.

**Hosts:** Shopify wired (`ShopSettings.consentExpiryDays`, Default 180; Admin-
Dropdown Never/6/12/24 Mo; durch `/config` + Metafeld + Bridge). Plus der abgeleitete
`consentVersion` aus den *verarbeitungsrelevanten* Feldern (Dienste + Signal-Vendors),
damit eine neue/umklassifizierte Erkennung automatisch re-promptet (REQ-3) — ohne
manuellen Bump. TYPO3-Verdrahtung offen (Svens Seite).

**Acceptance:** frische Einwilligung im Fenster wird honoriert; veraltete wird
verworfen + re-prompted; `consentExpiryDays:0`/fehlend = aus; fehlendes `ts` =
grandfathered; `ts` wird bei Save gestempelt. 6 Engine-Tests +
`storefront-config`/`settings`-Tests (Shopify).

---

## Bewusst nicht in v1.0

Diese Punkte sind diskutiert und abgelehnt. Bitte erst neu aufmachen, wenn
sich die Begründung ändert.

| Was | Warum nicht |
|---|---|
| **IAB TCF v2.x** | Eigene Welt: Vendor-Liste, GVL-Updates, Encoding-Spec, Dutzende Edge Cases. Wenn Ad-Tech-Kunden das brauchen, eigenes Plugin/Phase. |
| **Google Consent Mode v2** | ~~Als optionales Plugin/Hook in Phase 5, nicht im Core.~~ **Aktiviert 2026-06-12 als Opt-in-Config-Hook → [REQ-N10](#req-n10--google-consent-mode-v2-signal-hook) / [ADR-0016](adr/0016-google-consent-mode-v2-hook.md).** Bleibt aus per Default; kein Core-Verhalten ohne Konfiguration. |
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
