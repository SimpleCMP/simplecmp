# 0008. Build outputs — ESM-only engine, ESM/IIFE for UI, drop CJS

- **Status:** accepted
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler
- **Supersedes (in part):** ADR-0003

## Context

ADR-0003 (2026-05-02) chose three output formats: ESM, CJS, IIFE. The
reasoning at the time was sensible: support modern bundlers (ESM),
legacy Node and bundler tooling (CJS), and direct `<script>`
inclusion in CMS-style integrations (IIFE).

A year and a half later, the CommonJS landscape has shifted:

- Node 18+ is the floor in `package.json.engines`. All actively
  supported Node versions (18, 20, 22, 24) handle ESM natively.
- Vite, esbuild, Webpack 5, Rollup, Parcel all consume ESM as
  first-class. CJS-from-ESM interop happens at the bundler layer.
- TypeScript-first projects ship ESM as default — `"type": "module"`
  in `package.json`.
- npm packages of comparable scope (Lit, vitest, esbuild itself)
  are ESM-first or ESM-only.
- The CJS build pipeline costs maintenance: separate output, separate
  type-declarations (`.d.cts`), conditional exports complexity.

ADR-0006 commits us to a full UI rewrite using Lit (ADR-0007). That's
the natural moment to revisit build outputs — the engine becomes
modern TypeScript, the UI becomes Web Components. Carrying CJS into
this is a step backwards.

## Decision

### Engine: ESM-only

`simplecmp/engine` ships as ESM only. Subpath:

```jsonc
// package.json
{
  "exports": {
    "./engine": {
      "types": "./dist/engine/index.d.ts",
      "import": "./dist/engine/index.mjs"
    }
  }
}
```

No CJS, no IIFE. Engine is for code that has a build pipeline anyway —
Vue/React/Svelte/Node SSR, CMS-plugin frameworks. They consume ESM.

### UI: ESM + IIFE

`simplecmp/ui` ships as ESM (for bundler users) and IIFE (for direct
`<script>` inclusion in CMS templates):

```jsonc
{
  "exports": {
    "./ui": {
      "types": "./dist/ui/index.d.ts",
      "import": "./dist/ui/index.mjs"
    }
  },
  "unpkg": "./dist/ui/simplecmp.global.js",
  "jsdelivr": "./dist/ui/simplecmp.global.js"
}
```

The IIFE bundle includes the engine (Web Components need it to do
anything useful), exposed as `window.SimpleCMP`. Consumers who want
*just* the engine via `<script>` use a custom build — that's a niche
case, not worth a third bundle.

### Default entry point: convenience wrapper

`simplecmp` (no subpath) re-exports the most common surface:

```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    },
    "./engine": { ... },
    "./ui": { ... }
  }
}
```

`init({...})`, `getRecorder()`, `addEventListener()`, `show()` etc.
are exported from the root for backwards compatibility with
existing consumer code. Importing the root pulls both engine and
default UI; importing `simplecmp/engine` pulls only the engine.

```ts
// All-in-one (existing pattern, still works)
import { init } from 'simplecmp';

// Engine-only (new pattern, no UI loaded)
import { createEngine } from 'simplecmp/engine';

// UI customization
import { defineSimpleCmpComponents } from 'simplecmp/ui';
```

### Drop: CJS, the old `simplecmp.cjs` / `.d.cts`

CJS users who absolutely need it can use the bundler interop layer.
We don't ship `.cjs` outputs.

If a serious CJS use case surfaces post-rewrite, we can add a CJS
build later — but it's no longer the default and not in the
critical path.

### Build pipeline

`tsup` continues to drive the build but with simplified config:

- Engine entry: `src/engine/index.ts` → `dist/engine/index.mjs`
  (ESM only, with `.d.ts`)
- UI entry: `src/ui/index.ts` → `dist/ui/index.mjs` (ESM, with `.d.ts`)
- IIFE entry: `src/ui/iife.ts` → `dist/ui/simplecmp.global.js`
  (minified, exposes `window.SimpleCMP`)
- CSS: `dist/themes/default.css`, `dist/themes/bootstrap.css`,
  hand-authored CSS files copied/minified by esbuild

Drops from current build config:

- React → preact/compat alias
- JSX-in-`.js` loader hack
- sass-loader (no SCSS in `src/` after the rewrite; recovery period:
  `src/core/scss/` stays during migration, build still emits the
  Klaro CSS until `src/core/` is deleted)
- prop-types runtime dep (TS-types replace it)

### Backwards compat during the migration

ADR-0006 specifies a staged migration. During migration:

- The old build keeps emitting `dist/simplecmp.cjs` and `.d.cts`
  until the cutover stage, so `pnpm run ci` stays green and
  consumers (Sven's TYPO3 sites) don't break mid-stream.
- Cutover stage: `package.json.exports` is updated, `dist/*.cjs`
  files stop being generated, README documents the change in
  the changelog as a breaking change for that release.

Version bump: this lands in 0.x — the project is pre-1.0 per
`package.json`, so breaking changes in minor versions are explicitly
allowed by `CONTRIBUTING.md`.

## Consequences

### Positive

- **Smaller built artifact total**: dropping CJS halves the
  declaration-files surface and removes a parallel build pass.
- **Cleaner exports**: `package.json` stops needing the
  `import`/`require` conditional juggling that's a known footgun
  for dual-package hazards.
- **Faster local builds** during development: one tsup pass for
  engine, one for UI, no CJS round.
- **Type-safety end-to-end**: TS handles the engine and UI
  surfaces directly; consumers see clean types via `.d.ts`.
- **Incentive to modernise consumer code**: Sven's TYPO3 build
  pipeline is already ESM-friendly; no change needed there. The
  drop affects exotic consumer setups only.

### Negative

- **CJS users lose direct support**. Mitigations: (a) bundlers
  handle ESM-from-CJS transparently; (b) if a user actually
  hits this, we can reconsider in a follow-up minor.
- **Older Node-only test scripts** that import SimpleCMP from
  CJS would break. None of our current tests do this — vitest
  uses ESM.
- **One less knob in the build**: if a future Phase 5 CMS plugin
  has a build pipeline that requires CJS source, we'd need to add
  it back. Acceptable risk; cost of re-adding is low (~2h of
  tsup config).

### Neutral

- **Three sub-paths** (`simplecmp`, `simplecmp/engine`, `simplecmp/ui`)
  vs. previously one. Slightly more package.json complexity but
  unlocks the engine-only use case that ADR-0006 promises.
- **IIFE is preserved** because TYPO3 templates and similar use
  cases still rely on `<script>`-tag direct includes. ESM-only
  there would force consumers into module bundlers they don't
  want.
- **TypeScript declaration files** are now ESM-shaped (`.d.ts`,
  not `.d.cts`). Bundlers route correctly via `package.json.exports`.

## References

- ADR-0003 — Build targets — ESM, CJS, IIFE *(partially superseded
  by this ADR — ESM and IIFE survive, CJS dropped)*
- ADR-0006 — Hard-fork from Klaro (parent decision)
- ADR-0007 — UI architecture (consumer of these build outputs)
- [Node ESM since 12.x](https://nodejs.org/api/esm.html) — ESM is
  not new
- [Are the types wrong?](https://arethetypeswrong.github.io/) —
  diagnostic for dual-package hazards (the thing we avoid by
  going single-format)
- "Pure ESM packages" by sindresorhus —
  https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c
