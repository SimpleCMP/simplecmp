# 0003. Build targets — ESM, CJS, IIFE

- **Status:** partially superseded by [ADR-0008](0008-build-targets-esm-only-engine.md)
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler

> **Note:** ESM and IIFE survive in ADR-0008. CJS was dropped: the
> CommonJS landscape has matured to the point where bundler interop
> handles ESM→CJS transparently, and the cost of maintaining a
> separate CJS output exceeded its benefit. Original decision
> preserved below as historical record.

## Context

SimpleCMP must support two distinct integration paths:

1. **Modern frontend stacks** that use bundlers (Vite, Webpack, Rollup, esbuild) and
   import via `import { init } from 'simplecmp'`. This audience expects ESM with
   first-class TypeScript types, source maps, and tree-shaking.
2. **CMS-style direct inclusion** where the integration is a `<script src="...">` tag
   in a layout template — typical for WordPress, TYPO3, Contao, static sites, and
   any environment without a bundler.

Historically, **UMD** (Universal Module Definition) bundles tried to serve both. UMD
detects whether AMD, CommonJS, or no module system is present and adapts. Today, UMD is
mostly obsolete: AMD is dead, CommonJS is best served by a dedicated `.cjs` build, and
browsers either use `<script type="module">` (ESM) or expect a global (IIFE).

## Decision

We ship three build outputs from `tsup`:

| Format | File extension       | Use case                                                     |
| ------ | -------------------- | ------------------------------------------------------------ |
| ESM    | `simplecmp.mjs`      | Modern bundlers; Node.js with `"type": "module"`             |
| CJS    | `simplecmp.cjs`      | Legacy bundlers; older Node.js; some build tools             |
| IIFE   | `simplecmp.global.js` | Direct browser `<script>` inclusion; exposes `window.SimpleCMP` |

The IIFE bundle is minified for production CDN use; ESM and CJS are unminified to play
nicely with downstream bundlers.

`package.json` declares the appropriate entry points:

- `main` → CJS
- `module` → ESM
- `types` → declarations
- `unpkg` and `jsdelivr` → IIFE (so `https://unpkg.com/simplecmp` resolves to the
  global bundle)
- `exports` field declares conditional resolution for modern tools

## Consequences

### Positive

- Both target audiences (bundler users and CMS integrators) get a first-class
  experience.
- The IIFE bundle works in any browser without requiring `<script type="module">`,
  which still has compatibility quirks in some CMS templates.
- ESM enables tree-shaking for users who only need a subset of the API.

### Negative

- Three outputs increase build time and final package size (in npm terms — though only
  one is loaded at runtime).
- We must test all three formats in CI (currently we test ESM via Vitest; IIFE testing
  is on the roadmap).

### Neutral

- We deliberately skip classic UMD. Users who need an AMD-compatible build can request
  it; until then, IIFE serves all browser-direct cases.

## References

- tsup documentation: https://tsup.egoist.dev
- "Pure ESM packages" by sindresorhus: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c
- The state of UMD in 2024+: discussions in the bundler ecosystem (Vite, esbuild) have
  largely deprecated UMD as a primary target.
