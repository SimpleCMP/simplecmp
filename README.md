# SimpleCMP

> An open-source consent manager that simplifies cookie compliance for static sites and CMS.

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](LICENSE)
[![Status: Early Development](https://img.shields.io/badge/Status-Early%20Development-orange.svg)]()

**SimpleCMP** is a consent manager (CMP) designed to be straightforward to integrate, easy to
adapt to common frontend frameworks, and helpful in actively detecting cookies and external
connections that need consent.

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

SimpleCMP is built on a fork of [Klaro!](https://github.com/KIProtect/klaro) (BSD-3-Clause)
as its consent UI engine. On top of that, SimpleCMP adds:

- **Recorder**: a development-time mode that observes `document.cookie`, `MutationObserver`
  on script/iframe tags, and `PerformanceObserver` for outgoing connections.
- **Service DB Client**: looks up detected cookies and domains against a shared registry of
  known services (Google Analytics, Matomo, YouTube, etc.).
- **CMS Bridge**: an optional webhook that notifies a configurable backend API when an
  unknown cookie or connection is observed in production.
- **Themes**: prebuilt stylesheets (Tailwind, Bootstrap, Default) for drop-in integration.

See [docs/adr/](docs/adr/) for architecture decision records.

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
  // configuration goes here
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

## Development

Requires Node.js ≥ 18.18 and pnpm.

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

- **Phase 1** — Core: forked Klaro! engine, build pipeline, default theme
- **Phase 2** — Recorder: cookie/connection detection in development mode
- **Phase 3** — Service DB: client + initial registry
- **Phase 4** — CMS Bridge: webhook for production alerts
- **Phase 5** — CMS plugins: WordPress, TYPO3, Contao (separate repos)

For concrete features and acceptance criteria, see
[docs/requirements.md](docs/requirements.md).

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
