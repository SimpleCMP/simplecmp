# SimpleCMP — Developer Onboarding Guide

Welcome. This guide takes you from zero to productive across the SimpleCMP
project. It assumes you're a strong general developer comfortable on the
command line, that you'll drive a lot of the exploration with an AI coding
agent (Codex), and that you come from a **WordPress** background with **no prior
TYPO3 or Shopify** experience.

**Your destination is the WordPress plugin** (not built yet). Everything before
that is about understanding the shared core and studying the two existing
host integrations (TYPO3, Shopify) as worked examples you'll port from. So:

- **Core engine + services library** — essential, do these properly.
- **TYPO3 extension** — important: it's the most complete reference integration
  and the closest architectural sibling to a future WordPress plugin. Spend real
  time here even though TYPO3 is unfamiliar.
- **Shopify app** — **optional / lighter read.** Useful for contrast (hosted SaaS,
  frontend-only blocking) but not on the critical path to the WordPress plugin.

> Paths in this guide are **relative to each repository's root** (e.g.
> `src/engine/`, `Classes/EventListener/RegisterAssets.php`). When a path could
> be ambiguous, the repo is named explicitly. Pick any working directory you
> like for your clones — this guide calls it **`$WORKSPACE`**.

---

## The mental model (read this first)

SimpleCMP is **one framework-agnostic TypeScript engine** plus **a shared
service database**, wrapped by **thin per-CMS host adapters** that (a) inject the
engine into pages, (b) feed detected trackers back to a backend, and (c) let an
admin curate them. Internalise this before reading any code:

```
        ┌──────────────────────────────────────────────┐
        │  simplecmp  — the engine (TypeScript, no CMS)  │
        │  src/engine (state machine) + src/ui (Lit)     │
        │  + recorder + service-db client + audit        │
        │  → ships as a built JS bundle                  │
        └──────────────────────────────────────────────┘
              ▲ vendors bundle           ▲ vendors bundle
              │                          │
   ┌──────────┴─────────┐     ┌──────────┴───────────┐     ┌─────────────────────┐
   │ t3-simplecmp       │     │ simplecmp-shopify    │     │ (your future)       │
   │ TYPO3 v14 ext (PHP)│     │ Remix/RR7 app (TS)   │     │ WordPress plugin    │
   └────────────────────┘     └──────────────────────┘     └─────────────────────┘
              ▲                          ▲                          ▲
              └──── all also vendor ─────┴──────────────────────────┘
                    services-library (curated tracker JSON + PHP loader)
```

A host adapter's job is always the same three things, expressed in that host's
idioms:
1. **Inject** the engine bundle + a per-site `init({...})` config into every page.
2. **Receive** the trackers the engine's recorder discovers (a webhook + a
   service-DB lookup endpoint) and store them.
3. **Let an admin review/curate** detections and decide what shows on the banner.

The TYPO3 extension does all three in PHP. The WordPress plugin will do the same
three in PHP — which is exactly why TYPO3 is the most valuable reference for you.

**The five repositories** (all under the `SimpleCMP` GitHub org):

| Repo | What it is | Language | You need it |
|---|---|---|---|
| `simplecmp` | The engine + UI + recorder + bridge + audit. The heart. | TypeScript | **Yes** |
| `services-library` | Curated tracker definitions (JSON) + thin PHP loader. | JSON + PHP | **Yes** |
| `t3-simplecmp` | TYPO3 v14 extension. Reference integration #1. | PHP | **Yes** |
| `simplecmp-shopify` | Shopify app. Reference integration #2. | TypeScript | Optional |
| `website` | The public site (simplecmp.eu). | HTML/CSS | Skim only |

**Anchors that exist in (almost) every repo — point Codex at these on day one:**
`CLAUDE.md` (repo context + conventions), `docs/adr/` (the *why* behind decisions),
`docs/requirements.md` (the `REQ-N*` feature specs with acceptance criteria),
`README.md`, `CHANGELOG.md`.

---

## Phase 0 — Tooling: get your machine ready (~1 hour)

You need these installed regardless of which repos you touch. Versions below are
what the repos pin/expect.

| Tool | Version | Used by | Notes |
|---|---|---|---|
| **git** | any recent | all | |
| **Node.js** | **22** (`.node-version` pins 22; engine allows ≥20) | simplecmp, shopify | Use `fnm` or `nvm` so you can pin per-repo. |
| **pnpm** | **9.15.9** (`packageManager` field) | simplecmp, shopify | `corepack enable && corepack prepare pnpm@9.15.9 --activate`, or `npm i -g pnpm@9`. |
| **PHP** | **8.3+** | services-library, t3, future WP | t3's dev site runs on PHP 8.4. |
| **Composer** | 2.x | services-library, t3, WP | |
| **DDEV** + **Docker** | recent | t3 (TYPO3 site), future WP site | DDEV is the easiest way to stand up a local TYPO3 v14 *and* WordPress instance. |
| **Shopify CLI** | ≥ 4 (needs Node ≥ 22.12) | shopify only | Skip unless you do the optional Shopify phase. |

Recommended setup:

```bash
# Node version manager (fnm shown; nvm is fine too)
curl -fsSL https://fnm.vercel.app/install | bash    # then restart shell
fnm install 22 && fnm use 22

# pnpm via corepack (ships with Node)
corepack enable
corepack prepare pnpm@9.15.9 --activate

# PHP + Composer: install via your OS package manager (brew/apt) — PHP 8.3+
# DDEV: https://ddev.readthedocs.io/en/stable/users/install/ddev-installation/
```

> **Gotcha:** a *non-interactive* shell may not load `fnm`/`nvm` and can fall
> back to a system Node 20. If a build/CLI complains about the Node version,
> make sure your shell has activated Node 22 first.

Clone the repos into one workspace folder so cross-repo work (e.g. vendoring) is easy:

```bash
mkdir -p "$WORKSPACE" && cd "$WORKSPACE"
git clone git@github.com:SimpleCMP/simplecmp.git
git clone git@github.com:SimpleCMP/services-library.git
git clone git@github.com:SimpleCMP/t3-simplecmp.git
git clone git@github.com:SimpleCMP/simplecmp-shopify.git   # optional
```

> **Branching note:** `simplecmp` and `services-library` develop on `main`.
> **`t3-simplecmp`'s default/active branch is `release/v14`, not `main`** — after
> cloning, `git switch release/v14` and target that branch for PRs.

---

## Phase 1 — The core engine `simplecmp` (1–2 days; your comfort zone)

This is pure TypeScript with no CMS dependency — the most approachable entry
point and the actual heart of the product. Start here to build confidence before
the unfamiliar CMS layers.

### 1.1 Get it running

```bash
cd "$WORKSPACE/simplecmp"
fnm use 22                 # or nvm use
pnpm install
pnpm test:run              # vitest — fast, and the best executable spec of behaviour
pnpm demo                  # builds the bundle + serves the demos/ pages locally
```

`pnpm demo` builds and starts a local server; open the URL it prints. The
`demos/` directory is a guided tour of the engine — work through them in order:

- `01-basic.html` — banner + modal, the minimal happy path.
- `02-recorder.html` — **record mode**: watch the engine detect cookies/connections live.
- `03-service-db.html` — classification against the service database.
- `04-lit-ui.html` — the full Lit UI (banner + preferences modal + trigger).
- `07-cms-bridge.html` — the engine posting detections to a backend webhook.
- `08-intercept-runtime.html` — universal pre-consent blocking (runtime patches).

Keep the browser DevTools open while you click — the recorder/bridge are easiest
to understand by watching network + console.

### 1.2 Read the source, in this order

| Directory | What it is | Why it matters |
|---|---|---|
| `src/engine/` | The UI-free `ConsentManager` state machine + translations + config/cookie/i18n utils. | **The core of the core.** Headless consumers (and a WP plugin) import *only* this. |
| `src/ui/` | Lit web components (`<simplecmp-banner\|modal\|trigger\|contextual-notice>`). | The consent UI. Engine/UI separation is a hard rule (ADR-0007). |
| `src/recorder/` | Cookie watcher + MutationObserver + PerformanceObserver. | The "record mode" differentiator — auto-discovers trackers. |
| `src/service-db/` | Client for the shared registry. | How the engine asks "what is this cookie?" |
| `src/cms-bridge/` | Posts unknown trackers to a backend webhook (schema v2, HMAC nonce, batching, dedup). | The link between the browser and *your* backend. **Study this closely — the WP plugin must receive these POSTs.** |
| `src/audit/` | Config- and DOM-level DSGVO/ePrivacy compliance checks. | Drives the compliance grading; derived from `docs/legal-compliance.md`. |
| `core.ts` / `deferred.ts` | The 2-tier bundle split: a tiny synchronous critical core (consent + blocking) + a lazily-loaded tier (UI + recorder). | How the bundle is shaped for performance (ADR-0019). |
| `src/runtime-patches/` | The browser-side monkey-patches behind universal blocking. | FE half of pre-consent blocking. |

### 1.3 Read these ADRs (in `docs/adr/`)

`0006` (hard-fork from Klaro — the project's origin), `0007` (Lit UI / engine-UI
split), `0008` (build targets: ESM + IIFE), `0004` (recorder), `0005`
(service-DB protocol), `0019` (bundle split). Also skim
`docs/legal-compliance.md` — the entire product is compliance-driven, and the
audit checks map back to it.

### 1.4 Understand the build outputs (you'll consume these from WordPress)

`pnpm build` produces, in `dist/`, both an **IIFE** drop-in
(`simplecmp.global.js`, sets `window.SimpleCMP`) and an **ESM** build. The IIFE
file is what a CMS plugin typically enqueues as a `<script>`. Note these are not
yet published to npm; integrations currently **vendor** (copy in) the built
bundle.

**Phase 1 goal:** you can explain the engine/UI split, run the demos, and trace
a single tracker from "recorder sees it" → "classifier can't match it" → "bridge
POSTs it to a webhook."

---

## Phase 2 — The shared service library `services-library` (½ day)

A **data repository**: ~360+ curated tracker definitions as JSON, plus a thin
PHP loader. Conceptually simple but load-bearing — every host integration relies
on it.

### 2.1 Get it running

```bash
cd "$WORKSPACE/services-library"
composer install
vendor/bin/phpunit            # the schema/contract tests
```

### 2.2 Explore

- Open a few `data/services/*.json` files: `google-analytics.json`, `youtube.json`,
  `stripe.json`. Learn the schema by reading real entries — cookie matchers,
  `origins` / `aliasOrigins`, `vendor*` disclosure fields, `i18n` overlays.
- Read `src/ServicesLibrary.php` (the loader). Two facts to remember:
  `services()` returns a **Generator** (don't `count()` it), and `dataHash()` is
  the content fingerprint used to detect drift between a vendored copy and the
  hosted upstream.
- Read `docs/` in this repo and the protocol doc it references
  (`simplecmp/docs/service-db-protocol.md`).

### 2.3 Key concepts

- **Host-qualified cookie matchers (ADR-0010 in the `simplecmp` repo):** generic
  cookie names (e.g. Stripe's `m`) must be pinned to an origin to avoid false
  positives.
- **`aliasOrigins`:** multi-TLD coverage for a single vendor (e.g. YouTube's
  `youtube-nocookie.com`), flattened into `origins` at load time.
- **This library is consumed by *vendoring*** — the TYPO3 ext and Shopify app
  each copy the JSON + loader into their own tree (it is deliberately **not** on
  Packagist). It's also served live from `library.simplecmp.eu` (the
  `reference-server/` inside the `simplecmp` repo). **Your WordPress plugin will
  vendor this same data + a PHP loader.**

**Phase 2 goal:** you understand the JSON schema well enough to add or correct a
service entry, and you know how a host integration consumes the library.

---

## Phase 3 — The TYPO3 extension `t3-simplecmp` (2–4 days; the important stretch)

This is unfamiliar territory but the **single most valuable thing you can study**
before building the WordPress plugin: it's the most complete host integration and
its architecture maps almost one-to-one onto what you'll build in WordPress.
Don't try to become a TYPO3 expert — focus on the **integration seams**.

### 3.1 A 5-minute TYPO3 mental model (mapped to WordPress)

| Concept | TYPO3 | WordPress analog |
|---|---|---|
| Plugin unit | "Extension" | Plugin |
| Inject scripts/config into pages | Event listener (`RegisterAssets`) using the AssetCollector | `wp_enqueue_script` + `wp_add_inline_script` / `wp_localize_script` |
| Custom HTTP endpoints | PSR-15 middleware | `register_rest_route` (REST API) or `admin-ajax` |
| Admin screens | Backend module (Extbase controllers + Fluid templates) | Admin pages (`add_menu_page`) |
| Per-site config | "Site Set" settings | Options API / settings page |
| DB tables + edit forms | TCA | `$wpdb` + custom tables / CPTs |
| Server-side HTML rewriting | PSR-15 middleware (`HtmlRewriter`) | Output buffering on `template_redirect` |

That table *is* your porting cheat-sheet. Keep it.

### 3.2 Stand up a local TYPO3 v14 instance (DDEV)

The extension needs a running TYPO3 to be meaningful. The cleanest dev setup is a
fresh TYPO3 v14 DDEV site that loads **your clone** via a Composer *path
repository* (so edits in your clone are live).

```bash
# 1. Create a TYPO3 site project (follow the official "Get TYPO3 with DDEV"
#    tutorial for the exact current v14 commands — versions move):
mkdir -p "$WORKSPACE/t3site" && cd "$WORKSPACE/t3site"
ddev config --project-type=typo3 --docroot=public
ddev start
ddev composer create "typo3/cms-base-distribution:^14"
ddev typo3 setup        # creates the DB + an admin user (follow prompts)

# 2. Point the site at your local extension clone via a path repository.
#    Edit the site's composer.json to add, as the FIRST entry of "repositories":
#      { "type": "path", "url": "../t3-simplecmp", "options": { "symlink": true } }
ddev composer require simplecmp/t3-simplecmp:@dev

# 3. Activate + build:
ddev typo3 extension:setup
ddev typo3 database:updateschema
ddev typo3 cache:flush
ddev launch                       # opens the frontend
ddev launch /typo3/               # opens the backend
```

Then wire SimpleCMP into the site's Site Set:
- Add `simplecmp/t3-simplecmp` to the site's `config.yaml` `dependencies`.
- Configure the `simplecmp:` block in the site's `settings.yaml` (service-DB URL,
  bridge, universal blocking toggle, etc. — the available keys live in the
  extension's `Configuration/Sets/SimpleCmp/settings.definitions.yaml`).
- `ddev typo3 cache:flush` and reload the frontend — you should see the banner.

> If standing up TYPO3 from scratch is fiddly, this is the single best thing to
> pair with the team on. The *concepts* below matter more than getting a pristine
> site on the first try.

### 3.3 Map the integration seams (in `Classes/`)

Read these in order — each is the TYPO3 expression of an engine concept and the
direct precedent for a WordPress equivalent:

| File / area | What it does | WordPress precedent |
|---|---|---|
| **`EventListener/RegisterAssets.php`** | *Start here.* Injects the engine bundle + builds the FE `init({...})` config from Site Set settings + the service registry + translations. | The "enqueue script + localize config" of the WP plugin. |
| **`Middleware/` (ServiceDbApi)** | Serves `/api/simplecmp/v1/{health,services,lookup}` and the `/api/simplecmp/webhook` bridge receiver. | A set of REST routes in WP. |
| **`Service/ClassifierLookup`** | Unions the admin-curated registry + the vendored services-library at lookup time. | Same union logic, in WP. |
| **`Controller/` + `Backend/`** | The admin module: the **four-state detection review** (curated / recognised / unknown / dismissed), and the *Detektionen* / *Dienste* / *Bibliothek* tabs. | The WP admin pages. |
| **`UniversalBlocking/` (HtmlRewriter)** | Server-side pre-consent blocking: rewrites third-party tags to a blocked shape before the page is flushed. | Output buffering on `template_redirect` in WP. |
| **`Library/`** | The vendored copy of `services-library` (data + loader). | You'll vendor the same way. |
| **`Tracker/`** | Tracker provider wiring (GTM/GA4/Matomo) + Consent Mode. | Later, optional. |

### 3.4 Read these (in the t3 repo + the `simplecmp` repo)

- t3 `README.md` (the four-state model table is the clearest summary of the BE UX).
- `simplecmp` ADRs `0012` / `0013` (universal blocking), `0005` (service-DB protocol),
  `docs/cms-bridge-webhook.md` (the webhook contract your backend must honour).
- The extension's `docs/` (reST manual).

### 3.5 Run its tests

```bash
cd "$WORKSPACE/t3-simplecmp"
composer install
composer test:unit          # fast, pure PHP
composer test:functional    # boots a real TYPO3 + DB per test (needs a DB; see CI workflow)
```

> **Expect TYPO3 v14 quirks** (Extbase binds *bare* query params not the
> namespaced form; backend QueryBuilder applies default restrictions; backend
> ES-module assets cache stickily across `cache:flush`; specific events for asset
> injection). When something behaves oddly, it's very often a documented v14
> gotcha rather than your bug — ask the team / check the repo docs before fighting
> it.

**Phase 3 goal:** you can trace one tracker end-to-end through TYPO3 — *visitor
loads a page → recorder detects an unknown cookie → bridge POSTs it to the webhook
→ it appears in the backend "Detektionen" list as Unknown → admin curates it into
the registry → it now drives the banner.* If you can narrate that, you understand
what the WordPress plugin must reproduce.

---

## Phase 4 — The Shopify app `simplecmp-shopify` (OPTIONAL — lighter read)

**Skip or skim this unless you have spare time.** It is *not* on the critical path
to the WordPress plugin. Its value is contrast: Shopify is hosted SaaS, so there's
**no server-side HTML rewriter** (blocking is frontend-only) and the detection
backend is a **hosted app**, not in-store code (see its `docs/adr/0001-...`). It's
a different shape of the same idea.

If you do want it running (requires a free Shopify Partner account + a development
store + the Shopify CLI):

```bash
cd "$WORKSPACE/simplecmp-shopify"
fnm use 22
pnpm install
pnpm test:run                # the server-side logic has unit + integration tests
# Live storefront/admin requires Shopify CLI + a dev store; pair with the team:
pnpm dev                     # = `shopify app dev` (creates a tunnel, links the app)
```

What to skim if curious:
- `extensions/simplecmp-consent/` — the Theme App Extension (storefront engine
  injection + Customer Privacy API bridge). The injection seam.
- `app/routes/` — the embedded Remix/React-Router-7 admin (Polaris web components).
- `app/routes/proxy.*` — the App Proxy detection backend (reuses the engine
  recorder + cms-bridge **unmodified** — good proof the engine is truly portable).
- `app/lib/` — the testable server logic. (Tests must **not** live under
  `app/routes/` — Remix treats those as routes and the build breaks.)

**Phase 4 goal (if attempted):** appreciate that the *same engine* drives a
totally different host, and why the guarantees differ.

---

## Phase 5 — Your destination: the WordPress plugin

There is **no WordPress repo yet** — building it is the goal. With Phases 1–3
done, you have the two things you need: a deep understanding of the engine/bridge
contracts, and a complete worked example (TYPO3) whose architecture maps directly
onto WordPress.

### 5.1 What a WordPress plugin must do (the same three jobs)

1. **Inject** the engine + config on the frontend:
   - `wp_enqueue_script()` the vendored engine bundle (the IIFE `simplecmp.global.js`
     from `simplecmp`'s `dist/`), and `wp_add_inline_script()` (or
     `wp_localize_script()`) the per-site `init({...})` config. This is the WP
     analog of `RegisterAssets.php`.
2. **Receive + classify** detections:
   - Register REST routes (`register_rest_route`) mirroring the **Service-DB
     protocol** (`/v1/health`, `/services`, `/lookup`) and the **CMS-bridge
     webhook** (`docs/service-db-protocol.md` + `docs/cms-bridge-webhook.md` in
     `simplecmp`). Honour the schema-v2 envelope and the HMAC-nonce auth model.
   - Vendor the `services-library` JSON + a PHP loader and implement the
     registry-∪-library classification (port `ClassifierLookup`).
3. **Admin review/curate UI:**
   - WP admin pages reproducing the four-state detection model and a registry
     editor. Port the BE module's behaviour, not its TYPO3 chrome.
4. **(Optional, later)** universal pre-consent blocking via output buffering on
   `template_redirect` — the WP analog of TYPO3's `HtmlRewriter`. The frontend
   half (runtime patches) comes free with the engine.

Region engine, Consent Mode v2, GPC, audit, the contextual-notice UI — all of
that is already in the engine; the plugin just configures it.

### 5.2 Reference material to lean on

- **TYPO3 ext** — your primary template. For each WP feature, open the
  corresponding `Classes/...` file and port the *logic*.
- `simplecmp/docs/service-db-protocol.md` and `simplecmp/docs/cms-bridge-webhook.md`
  — the exact wire contracts your endpoints must implement.
- `simplecmp/docs/requirements.md` — the `REQ-N*` specs (and their acceptance
  criteria) apply across all hosts.
- The **vendoring pattern** (how t3 copies the bundle + library in-tree) — read
  `simplecmp/scripts/sync-bundle.mjs` and how the t3 ext stores its vendored
  `Library/` + bundle.

### 5.3 Local WordPress dev

DDEV does WordPress too:

```bash
mkdir -p "$WORKSPACE/wpsite" && cd "$WORKSPACE/wpsite"
ddev config --project-type=wordpress --docroot=web   # or your preferred layout
ddev start
# install WordPress (ddev wp core download / config / install, or the WP UI),
# then symlink/clone your plugin into wp-content/plugins/.
```

You already know this terrain — that's the point. The unfamiliar parts
(the engine contracts, the four-state model, the bridge protocol) are exactly
what Phases 1–3 taught you.

### 5.4 A sensible first contribution *before* the WP plugin

To learn the team's workflow (CI gates, branch conventions, review) on something
low-risk and CMS-agnostic, pick a small fix in **`simplecmp`** or
**`services-library`** first — e.g. a service-library data correction, or a small
engine improvement with a test. Get one PR green end-to-end, then start the
plugin.

---

## Working with Codex + per-repo cheat-sheet

**Point your agent at the anchors.** On entering any repo, have Codex read
`CLAUDE.md`, `docs/adr/`, and `docs/requirements.md` first — they're dense, current,
and answer most "why is it like this?" questions without spelunking.

**Run the CI gates locally before pushing** (each repo's `.github/workflows/`
shows the authoritative commands):

| Repo | Install | Test | Lint/format | Build |
|---|---|---|---|---|
| `simplecmp` | `pnpm install` | `pnpm test:run` | `pnpm biome check .` (CI runs `check`, **not** just `lint`) | `pnpm build` |
| `services-library` | `composer install` | `vendor/bin/phpunit` | — | — (data repo) |
| `t3-simplecmp` | `composer install` | `composer test:unit` / `composer test:functional` | per CI | — |
| `simplecmp-shopify` | `pnpm install` | `pnpm test:run` | `pnpm lint` (and CI lint) | `pnpm build` |

**Conventions:**
- **Branches:** `main` for `simplecmp` / `services-library` / `simplecmp-shopify`;
  **`release/v14`** for `t3-simplecmp`.
- **Commits:** Conventional Commits (`feat(scope): …`, `fix(scope): …`, etc.).
- **TypeScript:** strict mode, `import type` for type-only imports, single quotes,
  semicolons. Keep `src/engine/` UI-free (ADR-0007).
- **Env gotcha (repeat):** make sure your shell has Node 22 active for the
  pnpm/Shopify-CLI repos; a stray system Node 20 in a non-interactive shell causes
  confusing failures.

---

## Suggested rhythm

- **Days 1–3:** Phase 0 (tooling) → Phase 1 (core engine) → Phase 2 (services
  library). No CMS knowledge needed; builds confidence in the actual core.
- **Days 4–7:** Phase 3 (TYPO3) — the deliberate stretch; the most important
  reference for your goal.
- **Optional:** Phase 4 (Shopify) as a lighter contrast read whenever convenient.
- **Then:** Phase 5 — a small warm-up PR in `simplecmp`/`services-library`, then
  start the WordPress plugin using TYPO3 as the template.

Welcome aboard.
