# CLAUDE.md

This file provides context for [Claude Code](https://docs.anthropic.com/claude/docs/claude-code)
when working in this repository. It is read automatically when Claude Code starts in this
project directory.

## Project mission

SimpleCMP is an open-source Consent Management Platform (CMP) that aims to make cookie and
tracking compliance straightforward for both static sites and content-managed sites. The
core differentiators against existing CMPs (Klaro!, vanilla-cookieconsent, OneTrust,
Usercentrics, CCM19) are:

1. **Record mode** — actively detects cookies and external connections during development,
   so developers don't have to manually catalog every tracker.
2. **Shared service database** — a community-maintained registry of well-known cookies and
   services, queryable by any installation.
3. **CMS bridge** — optional webhook to notify a CMS backend when unknown cookies or
   connections appear in production.

## Project status

**Early development.** APIs, file structures, and features are unstable and will change
without backward-compatibility guarantees until v1.0.

## Architecture decisions (summary)

Detailed ADRs live in `docs/adr/`. Short summary:

- **Hard-fork from Klaro! (ADR-0006).** SimpleCMP started as a fork of Klaro! 0.7.22
  but has since diverged completely — REQ-11–17 rebuilt the engine in TypeScript
  and replaced the Preact UI with Lit-based Web Components (ADR-0007). The original
  Klaro! copyright is preserved in `LICENSE-KLARO` for the engine logic that
  carried forward. No Klaro source remains.
- **Engine / UI separation.** `src/engine/` is the UI-free state machine; `src/ui/`
  ships the Lit components. Headless consumers (REQ-N2) only import `src/engine/`.
- **TypeScript with strict mode** including `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax`.
- **Single-package repository** rather than monorepo. CMS integrations (WordPress, TYPO3,
  Contao plugins) live in separate repositories.
- **Two build targets (ADR-0008)**: ESM (.mjs) for bundlers / Node ≥ 20, IIFE
  (.global.js) for `<script>` drop-in. No CJS — modern only.
- **Biome** for linting and formatting (single tool, faster than ESLint+Prettier).
- **Vitest + happy-dom** for tests (browser-like environment without launching a real
  browser).
- **tsup** for builds (zero-config TypeScript bundler).
- **pnpm** as package manager.
- **BSD-3-Clause** license, matching Klaro! upstream.

## Repository layout

```
simplecmp/
├── src/
│   ├── index.ts              ← public API entry point
│   ├── engine/               ← UI-free state machine, ConsentManager, translations
│   │   ├── translations/     ← bundled JSON language packs (REQ-15)
│   │   └── utils/            ← config/cookies/i18n/maps helpers
│   ├── ui/                   ← Lit-based Web Components (REQ-14, ADR-0007)
│   │   ├── components/       ← <simplecmp-banner|modal|trigger|...> elements
│   │   └── styles/           ← tokens.ts + default.css + bootstrap.css adapter
│   ├── recorder/             ← record-mode: detects cookies & connections
│   └── service-db/           ← client for the shared service registry
├── tests/                    ← Vitest test files
├── docs/
│   └── adr/                  ← architecture decision records
├── .github/
│   ├── workflows/ci.yml      ← CI: typecheck, lint, test, build
│   ├── ISSUE_TEMPLATE/       ← bug & feature issue templates
│   └── pull_request_template.md
├── dist/                     ← build output (gitignored)
├── package.json
├── tsconfig.json
├── tsup.config.ts            ← build configuration
├── vitest.config.ts
├── biome.json                ← lint + format config
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE                   ← SimpleCMP BSD-3-Clause
└── LICENSE-KLARO             ← original Klaro! BSD-3-Clause notice
```

## Conventions

### Code style

- TypeScript everywhere. Avoid `any`; use `unknown` if the type is genuinely unknown and
  narrow at the use site.
- Single quotes for strings, semicolons required, trailing commas where ES5 allows.
- Imports: type imports must use `import type { ... }` (enforced by Biome and
  `verbatimModuleSyntax`).
- Functions and modules: small and composable. Side-effecting code at module top level
  is forbidden — `init()` must be explicit.
- Public API surface stays in `src/index.ts`. Internal modules don't get re-exported
  unless there is a deliberate reason.

### Commit messages

Conventional Commits (https://www.conventionalcommits.org):

```
type(scope): subject

body (optional)

footer (optional)
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

Scope examples: `core`, `recorder`, `service-db`, `themes`, `build`, `deps`.

### Branching

- `main` — always deployable
- Feature branches: `feat/<short-description>` or `fix/<short-description>`
- PRs require: passing CI, at least one self-review, all conversations resolved

### Testing

- Unit tests live next to the code (`src/recorder/cookie-watcher.test.ts`) or in `tests/`
  for integration tests.
- Each new feature should ship with at least one test.
- happy-dom is the default environment; for tests that need a real browser API,
  request a different environment via `// @vitest-environment` directives.

### Version management

- Pre-1.0: minor versions for new features, patch for fixes. Breaking changes are allowed
  and noted in CHANGELOG.md.
- 1.0+: strict semver.

## What Claude Code should do by default

- When asked to implement a feature, first check `docs/adr/` to see if a relevant decision
  exists. If a feature would conflict with an ADR, raise it before implementing.
- Check `docs/requirements.md` for an existing REQ entry. If the work matches one, follow
  its acceptance criteria. If it's a new requirement, propose adding a REQ entry before
  implementing.
- When adding dependencies, prefer minimal, well-maintained, BSD/MIT/Apache-licensed
  packages. Avoid GPL/AGPL dependencies (they'd impose copyleft on downstream users).
- When writing tests, use happy-dom and Vitest's built-in matchers. Don't add Jest-style
  setup files unless really needed.
- When editing public API, update `src/index.ts` exports and the README quick-start
  example if relevant.
- When changing component visuals, keep `src/ui/styles/default.css` in sync with the
  component's `static styles` block — the file header documents the drift risk.

## Roadmap

Phases 1–4 of the upstream library are shipped. Phase 5 is in progress
on the TYPO3 plugin side; WordPress + Contao not started.

- ✅ **Phase 1 — Core:** TypeScript engine, Lit-based UI, build pipeline, default + Bootstrap themes
- ✅ **Phase 2 — Recorder:** cookie watcher, MutationObserver, PerformanceObserver
- ✅ **Phase 3 — Service DB:** protocol + client + PHP+SQLite reference backend
- ✅ **Phase 4 — CMS Bridge:** webhook receiver + HMAC-nonce auth + schema v2 (batched detections, status:'known' surfaced, bandwidth controls)
- 🚧 **Phase 5 — CMS plugins:**
  - 🚧 TYPO3 v14 ([`WapplerSystems/simplecmp-typo3`](https://github.com/WapplerSystems/simplecmp-typo3)) — 10 iterations shipped including 3-table architecture, four-state detection model with durable Verworfen dismissal, full *Dienste* registry tab with library-orphan handling
  - ⬜ WordPress plugin
  - ⬜ Contao plugin

## Useful resources

- Klaro! upstream: https://github.com/KIProtect/klaro
- IAB TCF spec: https://iabeurope.eu/tcf/
- CCM19 (commercial reference): https://www.ccm19.de
- DPMA (German trademark registry): https://register.dpma.de
- EUIPO (EU trademark registry): https://www.tmdn.org/tmview/
