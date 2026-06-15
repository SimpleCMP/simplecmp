# SimpleCMP 

> An open-source consent manager that simplifies cookie compliance for static sites and CMS. 

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](LICENSE)
[![Status: Early Development](https://img.shields.io/badge/Status-Early%20Development-orange.svg)]()

**SimpleCMP** is a consent manager (CMP) designed to be straightforward to integrate,
easy to adapt to common frontend frameworks, and helpful in actively detecting cookies
and external connections that need consent. Originally hard-forked from
[Klaro!](https://github.com/KIProtect/klaro) 0.7.22, since rewritten in TypeScript with
a Lit-based UI; the original BSD-3-Clause notice is preserved in `LICENSE-KLARO`.

> ⚠️ **Status: Early development (pre-1.0 — latest `v0.4.0`).** APIs, file
> structures, and features may change in minor versions until 1.0. It already
> powers the TYPO3 and Shopify integrations, but is not yet npm-published.

## Why SimpleCMP?

Existing CMPs either focus on enterprise compliance dashboards (OneTrust, Usercentrics) or
lightweight banners (Klaro!, vanilla-cookieconsent). What's missing in the open-source space:

- **A record mode** that automatically discovers cookies and external connections during
  development, so you don't have to manually catalog every tracker.
- **A shared service database** of well-known cookies and services that any installation can
  query, so common cases work out of the box.
- **A CMS-friendly hook**: in production, optionally notify your CMS via API when an unknown
  cookie or connection is detected, so admins are alerted before compliance issues compound.
- **Per-instance customization of blocked-embed placeholders** (REQ-19). When the engine
  auto-inserts a `<simplecmp-contextual-notice>` next to a blocked iframe, content editors
  can override the title / description / preview image *per embed* via plain
  `data-simplecmp-*` attributes on the embed itself — no CMS-specific control needed.
  No other commercial or open-source CMP we surveyed offers this; everyone else locks
  customization at the per-service level.
- **DSGVO-conformant layered disclosure out of the box.** The contextual notice's "Weitere
  Informationen ›" link opens a Provider-Informationen modal (recipient legal entity,
  address, privacy policy URL, opt-out URL, transfer basis) sourced from the curated
  [`simplecmp/services-library`](https://github.com/SimpleCMP/services-library). Matches
  the German-market accepted three-layer-disclosure pattern.

SimpleCMP provides all of this on top of a battle-tested consent UI.

## What it does

Beyond the four differentiators above, SimpleCMP ships a complete consent layer:

- **Accessible consent UI** — Lit Web Components: a banner, a full preferences
  modal, a floating re-open trigger, and contextual notices on blocked embeds.
  WCAG 2.2 AA (labelled `region`, focus management, ≥24px targets, reduced-motion).
- **Region-aware regimes (REQ-N4 / ADR-0015)** — drive opt-in (GDPR), opt-out
  (US / CCPA "Do Not Sell"), or no-banner behaviour from a `region` input. Honours
  **Global Privacy Control** (GPC; ADR-0011).
- **Consent Mode v2 + multi-vendor signals (REQ-N10 / ADR-0016, ADR-0017)** — an
  optional `consentMode` hook emits Google's `gtag('consent', …)` plus a GTM
  dataLayer event, and (ADR-0017) Meta Pixel + Microsoft UET vendor signals, from
  the consent state. It *signals* the merchant's existing tags; it never loads
  them itself.
- **Universal pre-consent blocking (ADR-0012/0013)** — blocks third-party
  scripts / iframes / pixels before consent, with click-to-enable placeholders;
  plus opt-in **stylesheet blocking** for third-party CSS such as Google Fonts
  (REQ-N8).
- **Compliance audit (`src/audit/`)** — config-level and DOM-level DSGVO /
  ePrivacy checks (equal-prominence buttons, WCAG contrast, accessible names)
  driven by [`docs/legal-compliance.md`](docs/legal-compliance.md). Run
  `auditDom()` from the console against a live banner.
- **Theme framework adapters** — `config.theme` rebinds the design tokens onto
  Bootstrap 5 / Tailwind 4 / Bulma / Pico host variables, alongside the default
  hand-authored theme.
- **Informal tone (Sie/Du)** — an optional `tones` overlay for informal address
  (German reviewed; fr/it/es/nl draft).
- **Internationalization** — 26 bundled language packs, auto-detected from
  `<html lang="…">`. Managed hosts can instead ship the English-only slim core
  and inject the active locale at render time (ADR-0018).

## Architecture

SimpleCMP began as a fork of [Klaro!](https://github.com/KIProtect/klaro) 0.7.22 in
April 2026 and has since diverged completely: the engine was rewritten in TypeScript
(`src/engine/`) and the Preact UI was replaced with Lit-based Web Components
(`src/ui/`). The original Klaro! copyright is preserved in `LICENSE-KLARO`. The four
pieces sitting on top of the consent state machine:

- **Recorder** (`src/recorder/`): a development- and monitoring-time mode that observes
  `document.cookie`, `MutationObserver` on `<script>` / `<iframe>` / `<img>` / `<link>`
  tags, and `PerformanceObserver` for outgoing connections. Reports unknown items
  through the event bus, the console, and a workflow-friendly API
  (`exportConfig()`, `assertNoUnknown()`).
- **Service DB Client** (`src/service-db/`): speaks the HTTP/JSON protocol in
  [docs/service-db-protocol.md](docs/service-db-protocol.md) against any conformant
  backend (a CMS plugin, the PHP+SQLite reference in `reference-server/`, or a
  community DB). Caches with stale-while-revalidate; falls back to local
  classification on any failure.
- **CMS Bridge** (`src/cms-bridge/`): an optional webhook that POSTs a JSON payload to
  a configurable CMS endpoint when the recorder detects an unknown tracker in
  production. Per-`${kind}:${identifier}` dedup with a 1 h TTL by default. Webhook
  schema in [docs/cms-bridge-webhook.md](docs/cms-bridge-webhook.md).
- **Themes** (`src/ui/styles/`): hand-authored CSS with custom-property tokens.
  Ships `default.css` and a Bootstrap-adapter `bootstrap.css` that re-maps the
  tokens onto `--bs-*` variables.

**Headless mode.** Consumers who only want the state machine (SPAs with their own
UI — Vue, React, Svelte) can import from `simplecmp/engine`:

```ts
import { getManager, addEventListener } from 'simplecmp/engine';
```

That subpath ships the engine without the Lit UI, recorder, or service-DB client.

**Critical-core split (ADR-0019).** Managed hosts (Shopify, TYPO3) that want the
smallest synchronous footprint can import `simplecmp/core`. It arms the consent
manager + pre-consent blocking + Consent Mode **synchronously**, then lazy-loads
the Lit UI and recorder at browser idle via dynamic `import()` — so the on-load
parse stays small and the late banner never delays enforcement. Paired with the
English-only slim build (ADR-0018) + a host-injected locale, this is what keeps
the consent layer's measured mobile cost negligible. The zero-config `<script>`
drop-in keeps using the full IIFE, unchanged.

So there are three entry points: `simplecmp` (full drop-in), `simplecmp/engine`
(headless state machine), and `simplecmp/core` (managed-host critical-core split).

See [docs/adr/](docs/adr/) for architecture decision records, including ADR-0006
(hard-fork rationale), ADR-0007 (Lit Web Components), ADR-0018 (localization
distribution), and ADR-0019 (critical-core bundle split).

## Installation

Not yet published. Once released:

```bash
# As npm package
pnpm add simplecmp

# As browser global
<script src="https://unpkg.com/simplecmp"></script>
```

## Quick start

```ts
import { init } from 'simplecmp';

init({
  storageName: 'simplecmp-myapp',
  privacyPolicy: 'https://example.com/privacy',
  imprint: 'https://example.com/imprint',
  floatingTrigger: { label: 'Cookie settings' },
  services: [
    {
      name: 'analytics',
      title: 'Analytics',
      purposes: ['analytics'],
      cookies: [/^_ga/, '_gid'],
      required: false,
      default: false,
    },
  ],
});
```

Or as a browser global:

```html
<link rel="stylesheet" href="https://unpkg.com/simplecmp/dist/styles/default.css">
<script src="https://unpkg.com/simplecmp"></script>
<script>
  SimpleCMP.init({ /* config */ });
</script>
```

### Localization

SimpleCMP ships with 26 bundled language packs; the consent UI auto-detects
the language from `<html lang="…">`. One string is **not** taken from the
bundled packs and must be passed by integrators of non-English sites: the
floating "cookie settings" button's accessible label. Override it via
`floatingTrigger.label`:

```ts
init({
  // ...
  floatingTrigger: { label: 'Cookie-Einstellungen' },
});
```

The label drives both the visible button text (when shown) and the
`aria-label` exposed to screen readers, so localizing it is an
accessibility concern, not just a cosmetic one.

### Click-to-enable on blocked embeds

Mark a third-party embed with `data-name="<service>" data-src="..."`
(and `src=""` so the browser doesn't preload it) and SimpleCMP will
automatically insert a `<simplecmp-contextual-notice>` placeholder
next to the blocked element. Visitors see a small, themed card with
*Show once*, *Always show* (after a banner decision exists), and
*Open settings* — granting consent inline for that one service
without going back to the full modal.

```html
<iframe
  data-name="youtube"
  data-src="https://www.youtube-nocookie.com/embed/<id>"
  src=""
  allowfullscreen></iframe>
```

The notice text comes from three places, in order of precedence:

1. **`service.placeholderTitle` / `service.placeholderDescription`** —
   explicit per-service override on the JS init config (or, for CMS
   integrators, on the registry / library entry).
2. **The translated `<name>.title?` + `contextualConsent.description`
   template** for the active language.
3. **`asTitle(service.name)` + default i18n template** as the
   ultimate fallback.

Three opt-outs are available when the auto-insert is unwanted:

- Per-element: add `data-no-placeholder` to the blocked element.
  Useful when the integrator authors their own placeholder UI for
  that one embed.
- Per-service: set `service.noAutoPlaceholder: true` in the config.
- Globally: set `autoContextualPlaceholder: false` at the config
  top level.

For the integrator-authored path, place a
`<simplecmp-contextual-notice service-name="<name>"></...>` next
to the blocked element and add `data-no-placeholder` to the
element itself. The component reads the same translation chain as
the auto-inserted version, so you get the per-service copy plus
full control over placement and surrounding markup.

## Development

Requires Node.js ≥ 20 and pnpm.

```bash
pnpm install        # install dependencies
pnpm dev            # build in watch mode
pnpm test           # run tests in watch mode
pnpm test:run       # run tests once
pnpm typecheck      # TypeScript check without emit
pnpm check          # Biome lint + format check
pnpm check:fix      # Biome auto-fix
pnpm build          # build dist/
pnpm ci             # full pipeline (typecheck + check + test + build)
```

## Roadmap

- ✅ **Phase 1** — Core: TypeScript engine, Lit-based UI (REQ-11–17), build pipeline, default + Bootstrap themes
- ✅ **Phase 2** — Recorder: cookie / DOM / network detection (REQ-7)
- ✅ **Phase 3** — Service DB: client + protocol + a PHP+SQLite reference backend that rebuilds from [`services-library`](https://github.com/SimpleCMP/services-library) (REQ-8)
- ✅ **Phase 4** — CMS Bridge: webhook for production alerts on unknown trackers (REQ-9)
- 🚧 **Phase 5** — Platform integrations (separate repos):
  - 🚧 [**TYPO3 v14** (`SimpleCMP/t3-simplecmp`)](https://github.com/SimpleCMP/t3-simplecmp)
    — the most complete integration (v0.6.0+). FE bundle + engine integration,
    service-DB endpoint, CMS-bridge receiver, a backend detection-triage module
    (four-state model: *kuratiert / erkannt / unbekannt / verworfen*), the
    *Dienste* registry tab, a *Bibliothek* browser over the vendored
    services-library (adopt / bulk-adopt / unadopt / recommendations), a
    *Discover trackers* sitemap sweep, a **Theme Designer** module (framework
    picker, position, tone, text overrides, compliance audit), managed
    **GA4 / GTM / Matomo trackers** with Consent Mode v2, region-aware regimes,
    and universal pre-consent + stylesheet blocking.
  - 🚧 [**Shopify app** (`SimpleCMP/simplecmp-shopify`)](https://github.com/SimpleCMP/simplecmp-shopify)
    — the monetized integration. Storefront banner via Theme App Extension,
    consent-gated Web Pixel, Google Consent Mode v2, region engine, drift
    detection, and an embedded admin. Tier-1 (MVP) complete.
  - ⬜ WordPress plugin
  - ⬜ Contao plugin

Several engine capabilities (region-aware regimes, GPC, Consent Mode v2,
universal blocking, the compliance audit) are **cross-cutting** — built in this
core repo so every platform integration inherits them.

The API surface is still pre-1.0 and may change. For granular feature status and
acceptance criteria, see [docs/requirements.md](docs/requirements.md).

## License

BSD-3-Clause. See [LICENSE](LICENSE).

This project incorporates code from [Klaro!](https://github.com/KIProtect/klaro) by
KIProtect GmbH, which is also BSD-3-Clause licensed. The original copyright notice is
preserved in [LICENSE-KLARO](LICENSE-KLARO).

## Acknowledgements

Built on the foundations laid by:

- [Klaro!](https://github.com/KIProtect/klaro) — KIProtect GmbH
- [vanilla-cookieconsent](https://github.com/orestbida/cookieconsent) — Orest Bida
- [CookieBlock-Consent-Crawler](https://github.com/dibollinger/CookieBlock-Consent-Crawler) — ETH Zürich

Without their work, SimpleCMP wouldn't exist.
