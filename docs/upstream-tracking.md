# Klaro! Upstream Tracking

This file tracks the relationship between SimpleCMP's `src/core/` and its
[Klaro!](https://github.com/KIProtect/klaro) upstream. Per
[ADR-0002](adr/0002-fork-klaro-as-engine.md), `src/core/` is a fork; we record
here what we imported, what we excluded, and where we have diverged.

## Current baseline

| Field             | Value                                                |
| ----------------- | ---------------------------------------------------- |
| Upstream repo     | https://github.com/KIProtect/klaro                   |
| Upstream version  | 0.7.22                                               |
| Upstream commit   | `db9f1aca906a392990c58c58475366a091012ea7`           |
| Upstream date     | 2025-03-27                                           |
| Imported on       | 2026-05-02                                           |
| Imported by       | initial scaffolding import                           |

## What was imported

All files were copied **verbatim** from `klaro/src/` into
`simplecmp/src/core/`, preserving relative paths. No reformatting, no header
insertion. The license and attribution requirement of BSD-3 is satisfied by
`LICENSE-KLARO` at the project root.

Files imported (64 total):

- `klaro.js`, `klaro-no-translations.js`, `lib.js`
- `consent-manager.js`, `stores.js`, `themes.js`, `translations.js`
- `components/*.jsx` (10 files — the consent UI)
- `utils/*.js` (8 files)
- `scss/*.scss` (9 files — including `ide.scss`; see note below)
- `translations/*.yml` + `*.yaml` + `en.trans` + `index.js` (28 files)
- `translations/README.md` → renamed to `translations/UPSTREAM-README.md` to
  avoid colliding with future SimpleCMP-authored READMEs

## What was deliberately excluded

| Path                              | Reason                                                              |
| --------------------------------- | ------------------------------------------------------------------- |
| `src/components/ide/`             | Graphical configurator app; not in SimpleCMP Phase 1 scope          |
| `src/ide.js`                      | IDE entry point; depends on `components/ide/`                       |
| `src/translations/ide/`           | IDE-only translations                                               |
| `src/.eslintrc.js`                | We use Biome, not ESLint                                            |
| `examples/`, `dist/`              | Upstream's manual test pages and prebuilt bundles                   |
| `webpack.*.js`, `babel.config.js`, `postcss.config.js` | Replaced by tsup                                  |
| `releases.json`, `releases.yml`   | Upstream changelog data, not source                                 |

`scss/ide.scss` was kept even though the IDE itself was excluded. It is small,
self-contained, not imported by `klaro.scss`, and might be useful if we ever
want to reuse parts of the IDE styling. Safe to delete later if unused.

## Build adaptation status

### Done

- **Translations gebündelt (24/25 Sprachen).** A custom esbuild plugin
  (`yamlPlugin` in `tsup.config.ts`) and the matching Vite plugin in
  `vitest.config.ts` parse `.yml` / `.yaml` imports at build time via
  `js-yaml` and inline the resulting JS object. Klaro's `import en from
  './en.yml'` resolves to the parsed object; `js-yaml` itself does not ship at
  runtime. `src/index.ts` then merges the bundle's `defaultTranslations` Map
  on import (mirroring what upstream `klaro.js` does on its own).
  - **Known issue:** upstream `hu.yml` (Hungarian) is malformed at line 54 —
    unquoted `{title}` and `{link}` placeholders inside an unquoted value
    confuse YAML 1.2's flow-mapping rules. Both plugins fall back to
    `export default {}` for that file and emit a build warning. Hungarian
    users currently get the English fallback. Fix upstream is a one-liner
    (quote the value); ours to flag and possibly PR.
- **JSX runtime via Preact compat.** `tsup.config.ts` aliases `react` and
  `react-dom` to `preact/compat` (and `react/jsx-runtime` to
  `preact/jsx-runtime`). Mirrors Klaro's webpack alias.
- **`.js` files containing JSX.** Klaro's `lib.js` and `consent-manager.js` use
  JSX inside `.js` files (Klaro relied on babel-loader to detect JSX). esbuild
  is configured with `loader: { '.js': 'jsx' }` so the existing extensions
  don't need to change. Vitest mirrors this via a custom Vite plugin
  (`klaroJsxInJs` in `vitest.config.ts`).
- **Side-effect SCSS/CSS/YAML imports.** `lib.js` does
  `import './scss/klaro.scss'`. We map `.scss`, `.css`, `.yml`, `.yaml` to
  esbuild's `empty` loader so these imports become no-ops in the JS bundle.
  Vitest has an equivalent `emptyAssetImports` plugin.
- **Stylesheet build.** A separate `pnpm build:css` invokes Dart Sass on
  `src/core/scss/klaro.scss` and emits `dist/styles/klaro.css` (expanded) and
  `dist/styles/klaro.min.css` (compressed). `pnpm build` chains both.
- **Runtime dependencies added:** `preact`, `classnames`, `prop-types`. The
  last one Klaro imports without declaring; we declare it explicitly.
- **Biome ignore.** `src/core/` is excluded from Biome's lint+format scope so
  upstream code is not reformatted (per ADR-0002). When you add new code under
  `src/core/`, it inherits the ignore — keep it that way for files derived
  from upstream, and create non-derived helpers under `src/` instead.
- **Sass deprecation noise.** Klaro uses legacy `@import` and global
  `map-get`/`darken` calls. Until Dart Sass 3.0 forces the migration, the
  `build:css*` scripts pass `--silence-deprecation=import,global-builtin` to
  keep the build output readable.
- **Webpack-specific globals replaced at build time.** Klaro's `lib.js` reads
  `VERSION` (set by webpack's DefinePlugin) and `module.hot` (HMR sentinel).
  Both are replaced via esbuild's `define`: `VERSION` from `package.json`,
  `module.hot` to `false` so the dev-time `require('preact/debug')` branch is
  dead-code-eliminated.
- **`src/index.ts` wired to Klaro.** `init(config)` calls `klaro.render`;
  `show`, `addEventListener`, `getManager`, `updateConfig` are re-exported.
  SimpleCMP-specific config fields (`record`, `serviceDbUrl`, `cmsBridgeUrl`)
  live alongside Klaro's config and currently emit `console.warn` because
  the corresponding phases aren't implemented.
- **TypeScript shim for the core.** `src/core/lib.d.ts` is a SimpleCMP-authored
  sibling `.d.ts` typing only the surface we re-export. Narrow on purpose.
- **End-to-end test passes.** `tests/index.test.ts` calls `init` against
  happy-dom and verifies a `<div id="klaro">` appears in the document.

### Open

- [ ] Decide whether to keep `.jsx`/`.js` or migrate `src/core/` to TS+TSX.
      Migration eases typing but conflicts with ADR-0002's "don't reformat
      upstream wholesale" — probably staged, file-by-file.
- [ ] CI matrix runs Node 18/20/22 but our local Node is 24; confirm pnpm
      `packageManager` pin still resolves on those versions.
- [ ] Vitest config and tsup config carry the same alias/loader/define triples.
      Once the surface stabilizes, factor them into a shared module so the two
      pipelines can't drift apart.

## Divergences from upstream

None yet — this is the initial unmodified snapshot. Record substantial
modifications below as they happen, with file path, summary, and rationale.

| Date | File | Change | Rationale |
| ---- | ---- | ------ | --------- |
| 2026-05-02 | `src/core/translations/hu.yml` | _no source change_; build plugin treats parse failures as `export default {}` and warns | Upstream YAML is malformed (unquoted `{...}` placeholders, line 54). Avoiding inline fix for now to keep upstream diff minimal; track as known issue. |
| 2026-05-02 | `src/core/components/consent-notice.jsx` | Added `imprintUrl` resolution (mirrors `ppUrl`), `imprintLink` builder, and a `cn-policy-links` footer paragraph that renders both privacy and imprint links. | REQ-1: German TMG/MStV requires a separate imprint link. Klaro upstream renders only `privacyPolicy`. |
| 2026-05-02 | `src/core/components/consent-modal.jsx` | Same imprint resolution + `cm-policy-links` footer. | REQ-1: see above; modal needs symmetric treatment. |
| 2026-05-02 | `src/core/translations/en.yml` | Added `consentNotice.imprint.name = "Imprint"`. | REQ-1: most other languages had this in upstream Klaro; only en was missing. |
| 2026-05-02 | `src/core/scss/klaro.scss` | Added a `cm-btn-danger` rule (background `red1`) inside the existing `.cm-btn` block. | REQ-2: Klaro upstream has no rule for `cm-btn-danger`, so the decline button inherits the muted gray default while the accept button is bright green. BGH "Cookie II" + DSK 2022 require equal prominence — coloring decline red gives visual parity. |
| 2026-05-02 | `src/core/consent-manager.js` | `loadConsents` and `saveConsents` recognize a versioned wrapper `{ __v, consents }` in addition to the legacy bare object. Added `_versionsCompatible(stored, current)` helper. Sets `versionMismatch` + `changed=true` on mismatch. | REQ-3: Klaro upstream stores only the consents map; SimpleCMP needs a policy version so re-asking can be triggered when the privacy notice changes. Backwards-compatible: legacy storage still reads, and unversioned configs still write the legacy shape. |
| 2026-05-02 | `src/core/lib.js` | In `getManager`, when a freshly-constructed manager has `versionMismatch`, fire `executeEventHandlers('consentVersionMismatch', info)`. | REQ-3: surface the mismatch through Klaro's existing event system so consumers can subscribe via `simplecmp.addEventListener('consentVersionMismatch', ...)`. |
| 2026-05-02 | `src/core/consent-manager.js` | `getDefaultConsent` returns `false` for non-required services when `navigator.globalPrivacyControl === true` (and `config.respectGPC !== false`). | REQ-5: GPC signal is mandatory in California (CCPA/CPRA) and increasingly relevant for DSGVO interpretation in the EU. Klaro upstream has no GPC handling. |
| 2026-05-02 | `src/core/scss/klaro.scss` | Appended a `.simplecmp-floating-trigger` block (with `pos-*` modifier classes and `:focus-visible` outline) outside the `.klaro` wrapper scope. | REQ-4: floating settings trigger lives outside Klaro's render tree but ships its style with the same CSS bundle to keep deployment simple. Themable via `--simplecmp-trigger-bg/-fg/-focus` CSS custom properties. |
| 2026-05-02 | `src/core/components/consent-modal.jsx` | Modal wrapper carries `role="dialog"`, `aria-modal`, `aria-labelledby`, `tabindex="-1"`. `componentDidMount` records previous focus, focuses the wrapper, attaches a document-level keydown handler. `componentWillUnmount` detaches the handler and restores focus. The keydown handler implements Escape-to-close (when `!mustConsent`) and Tab/Shift+Tab focus trap. The close button no longer holds the initial focus. | REQ-6: WCAG 2.1 AA dialog pattern. Klaro upstream had no role/aria, no focus trap, no Esc handler; the close button was the focus target on open. |
| 2026-05-02 | `src/core/scss/klaro.scss` | Inside `.klaro` scope: `:focus-visible` outline rules for `button`/`a`/`input`/`[tabindex]`, plus `@media (prefers-reduced-motion: reduce)` block that drops all transition/animation durations to 0.001ms. | REQ-6: visible focus indicator (Klaro relied on browser defaults, often invisible against the dark theme), and respect for the user's motion preference (Klaro had switch + control transitions but no reduced-motion handling). |
| 2026-05-02 | `src/core/lib.js` | Re-export `executeEventHandlers` under the public name `fireEvent` so external SimpleCMP code (the recorder) can dispatch through Klaro's lib-level event bus. | REQ-7 / ADR-0004 section F: surface `recorderDetection` events on the same bus as `consentVersionMismatch` so consumers use one mental model. |

## Updating the baseline

When pulling a newer Klaro release in:

1. Diff the upstream tree against the imported `src/core/` snapshot (excluding
   files listed under "What was deliberately excluded").
2. Apply changes file-by-file, re-applying SimpleCMP modifications on top.
3. Update the "Current baseline" table above.
4. Note new or removed files in this document.
5. Run `pnpm ci` and verify behaviour.
