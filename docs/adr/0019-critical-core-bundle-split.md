# 0019. Critical-core bundle split — sync core + lazy deferred tier

- **Status:** accepted
- **Date:** 2026-06-15
- **Deciders:** Ilja Melnicenko

## Context

The slim English-only engine (ADR-0018) plus two idle-defer flags (`deferRecorder`,
`deferRender`) brought the Shopify storefront's mobile Total Blocking Time from
~600 ms down to ~189 ms (3-run medians, benchmarkIndex ~1355). But the
Built-for-Shopify Lighthouse delta stuck at ~12 points, and a per-metric
breakdown showed **why**: the remaining delta is no longer TBT — it is **LCP**.

Measured (2026-06-15, `simplecmp.myshopify.com`, mobile):

- WITH the embed: LCP ~3.5 s; WITHOUT: ~2.0 s → **+1570 ms**, while TBT is only
  189 ms and CLS/FCP/SI are flat.
- The **LCP element is the hero `<img>`, not the banner** (`PerformanceObserver`,
  live) — so `deferRender` is correct and the late-painting banner is *not*
  mis-selected as LCP.
- The regression **vanishes on desktop** (hero painted at 404 ms unthrottled).
  A delta that only appears under 4× mobile CPU throttle is **main-thread-bound**:
  the hero image cannot paint until the main thread finishes **parsing and
  initializing the ~145 KB engine IIFE**.

`deferRecorder`/`deferRender` defer the *execution* of the recorder and the UI
mount, but every module still lives in **one bundle**, so it is all **parsed**
synchronously on the critical path. Parsing is the cost still blocking the hero
paint. The defers have maxed out the TBT lever; the LCP lever is **the synchronous
parse**.

What actually has to run synchronously on the critical path is small: the consent
manager and `interceptRuntime` (pre-consent blocking must install before body
scripts), plus Consent Mode v2's early `default`. The large parts — the Lit UI
(banner/modal/trigger), the recorder + watchers + classifier, the CMS bridge, the
service-DB client, the audit engine — are all *deferrable* and, on a storefront,
several are *unused* (service-DB, audit).

## Decision

Add a **critical-core build** that splits the engine into two tiers, loaded
through native ES-module dynamic `import()` so the browser resolves chunk URLs
itself (no host-supplied paths):

1. **`src/core.ts` — the critical core (sync).** A new, additive entry that
   bundles only what must run on the critical path: config validation/warnings,
   English fallback translations (ADR-0018), `getManager`, the theme adapter,
   `interceptRuntime` (blocking) and Consent Mode v2 — all installed
   **synchronously** in `init()`. It then schedules the deferred tier at idle.

2. **`src/deferred.ts` — the deferred tier (lazy chunk).** Exports a
   `mountDeferred(config, manager)` that mounts the Lit UI and starts the recorder
   (classifier + service-DB + CMS bridge). `core.ts` reaches it via
   `await import('./deferred.js')` from inside its idle callback, so esbuild's
   ESM **code-splitting** emits it as a separate chunk that is fetched and parsed
   **after** the critical path.

3. **Build target: ESM with `splitting: true`** for the core entry →
   `dist/core.mjs` + a shared deferred chunk. Managed hosts load
   `<script type="module" src=".../core.mjs">`; the chunk loads relatively.

4. **Drop-in IIFEs stay single-file and unchanged.** The full `simplecmp.global.js`
   and the slim `simplecmp.core.global.js` (ADR-0018) keep their static imports —
   esbuild inlines any dynamic import in a non-splitting IIFE, so the zero-config
   `<script>` story is untouched. `src/index.ts` is **not restructured into dynamic
   imports** — its only change is the behaviour-preserving recorder-factory
   extraction (point 5), so existing consumers and the canonical
   `simplecmp`/`engine` ESM entries are unaffected.

5. **Shared recorder factory.** The recorder-construction logic is extracted to a
   pure `src/recorder/start.ts` helper used by both `src/index.ts` (wrapped for its
   `activeRecorder` singleton) and `src/deferred.ts`, so the tier split adds no
   duplicated recorder wiring.

6. **Managed hosts adopt the core.** Shopify's theme app-embed loads `core.mjs`
   as a module (it already injects locale + config); TYPO3 (already ES-module
   based) can follow. Both keep blocking synchronous and pay the UI/recorder parse
   only at idle.

## Consequences

### Positive

- The hero image no longer waits on the UI/recorder/bridge parse — only the small
  core parses synchronously → recovers the mobile **LCP** term that the defers
  could not touch. (Re-measure to confirm the delta drop.)
- Storefront drops service-DB + audit parse entirely (unused there).
- The browser resolves the deferred chunk URL via the module graph — **no
  host-configured chunk path**, no orchestration race (unlike a two-IIFE +
  manual `<script>` scheme, which was considered and rejected below).
- Additive: drop-in IIFEs and `src/index.ts` are untouched; the split is opt-in.

### Negative

- A new entry + build target + the `core.ts`/`deferred.ts` pair to maintain, and a
  small amount of focused `init()` orchestration duplicated between `index.ts` and
  `core.ts` (deliberate — the alternative was threading conditional dynamic-imports
  through the proven shared `index.ts`).
- Managed hosts move from a classic `<script>` to `<script type="module">` and must
  serve the extra chunk file as an asset (one-time wiring per host).
- Pre-consent **blocking stays synchronous in the core**, so any per-resource
  matcher overhead is not removed by the split — but it is bounded by the measured
  189 ms TBT, so it is not the dominant LCP term.

### Neutral

- No behaviour change for IIFE/`simplecmp`/`engine` consumers.
- Builds on ADR-0018 (slim core) and ADR-0008 (ESM is canonical); the split is the
  ESM path taken to its conclusion for managed hosts.
- `deferRecorder`/`deferRender` remain valid and compose with the split (the core's
  idle scheduling subsumes them for the deferred tier).

## Alternatives considered

- **Two IIFEs orchestrated by host `<script>` tags** (core IIFE + deferred IIFE
  that registers onto `window.SimpleCMP`) — rejected: the core would need a
  host-supplied URL to inject/await the deferred file, plus init-before-deferred
  race handling. ESM dynamic import resolves the URL and the ordering natively.
- **Convert `src/index.ts` to dynamic imports throughout** — rejected: pollutes the
  canonical entry and the full IIFE, and risks every existing consumer for a
  managed-host-only win. The additive `core.ts` keeps the blast radius contained.
- **Accept the borderline ~12-point delta** — rejected: it is over the BfS
  ≤10-point budget on slower-than-test devices, and the cause (synchronous parse)
  is fixable.

## Implementation sketch

- Extract `src/recorder/start.ts` (pure `createRecorder(config)` → `{ recorder,
  dispose }`); refactor `index.ts`'s `startRecorder` to wrap it (behaviour-preserving;
  existing tests stay green).
- Add `src/deferred.ts` exporting `mountDeferred(config, manager)` (UI mount +
  recorder start via the shared factory).
- Add `src/core.ts`: lean `init()` (validate → seed `en` + `config.translations` →
  `getManager` → theme → blocking → consent-mode → `scheduleIdle(async () => (await
  import('./deferred.js')).mountDeferred(...))`), plus `show()`/`VERSION`/handle.
- tsup: add an ESM `{ core: 'src/core.ts' }` target with `splitting: true`,
  `SLIM_BUILD: 'true'`. Keep all existing targets.
- Tests: `core.ts` arms blocking synchronously, mounts UI only after the idle
  import resolves, and a destroy() before idle cancels the mount.
- Shopify: load `core.mjs` as a module from the embed; serve the chunk; re-measure
  mobile Lighthouse and record the LCP/delta change in `docs/BUILT-FOR-SHOPIFY.md`.
