# SimpleCMP

> An open-source consent manager that simplifies cookie compliance for static sites and CMS.

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](LICENSE)
[![Status: Early Development](https://img.shields.io/badge/Status-Early%20Development-orange.svg)]()

**SimpleCMP** is a consent manager (CMP) designed to be straightforward to integrate,
easy to adapt to common frontend frameworks, and helpful in actively detecting cookies
and external connections that need consent. Originally hard-forked from
[Klaro!](https://github.com/KIProtect/klaro) 0.7.22, since rewritten in TypeScript with
a Lit-based UI; the original BSD-3-Clause notice is preserved in `LICENSE-KLARO`.

> ⚠️ **Status: Early development.** SimpleCMP is in the initial design phase. APIs, file
> structures, and features will change without notice. Not ready for production use.

## Why SimpleCMP?

Existing CMPs either focus on enterprise compliance dashboards (OneTrust, Usercentrics) or
lightweight banners (Klaro!, vanilla-cookieconsent). What's missing in the open-source space:

- **A record mode** that automatically discovers cookies and external connections during
  development, so you don't have to manually catalog every tracker.
- **A shared service database** of well-known cookies and services that any installation can
  query, so common cases work out of the box.
- **A CMS-friendly hook**: in production, optionally notify your CMS via API when an unknown
  cookie or connection is detected, so admins are alerted before compliance issues compound.

SimpleCMP provides all three on top of a battle-tested consent UI.

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

See [docs/adr/](docs/adr/) for architecture decision records, including ADR-0006
(hard-fork rationale) and ADR-0007 (Lit Web Components).

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

SimpleCMP ships with 27 bundled language packs; the consent UI auto-detects
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
- ✅ **Phase 3** — Service DB: client + protocol + 23-service PHP+SQLite reference backend (REQ-8)
- ✅ **Phase 4** — CMS Bridge: webhook for production alerts on unknown trackers (REQ-9)
- 🚧 **Phase 5** — CMS plugins: WordPress, TYPO3, Contao (separate repos) (REQ-10)
  - 🚧 [TYPO3 v14 plugin](https://github.com/WapplerSystems/simplecmp-typo3) —
    iterations 1–10 shipped (FE bundle integration, service-DB endpoint,
    CMS-bridge receiver, BE module for detection review + service
    curation, three-state model with library-aware approve flow, Banner
    Design module with live preview, 3-table architecture with
    `ClassifierLookup` unioning registry + bundled library, webhook
    schema v2 with batched detections, four-state detection model
    adding *Verworfen* (durable cross-visitor dismissal), full registry
    *Dienste* tab with source tagging and Verwaist orphan handling).
  - ⬜ WordPress plugin
  - ⬜ Contao plugin

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
