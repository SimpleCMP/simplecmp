# 0018. Localization distribution — sliceable locale packs

- **Status:** proposed
- **Date:** 2026-06-15
- **Deciders:** Ilja Melnicenko

## Context

The engine ships translations as **26 JSON language packs** (REQ-15) under
`src/engine/translations/`, plus six `informal/` tone overlays (ADR-0017-era tone
work). `translations/index.ts` **statically imports all 26** into a single
`bundledTranslations` object, and `src/index.ts` merges the whole set into the
engine at init (`update(defaultTranslations, convertToMap(bundledTranslations))`);
`config.translations` can then override/extend at runtime, and unknown keys fall
back to English.

Consequences of that shape today:

- **Every build artifact carries all 26 locales** — the ESM `.mjs`, the IIFE
  `.global.js`, and therefore every downstream host (TYPO3, the Shopify
  storefront embed, a `<script>` drop-in). It's ~60–80 KB of JSON, ~15–20 KB
  gzipped — **roughly a quarter of the ~59 KB gzip bundle.**
- **Not tree-shakeable.** Because every pack is referenced by the exported
  `bundledTranslations` object, a bundler cannot drop the locales a site never
  shows. `config.translations` lets a consumer *add/override*, but nothing lets
  them *exclude* the baked-in 26.
- This is a measured contributor to the Shopify storefront performance budget
  (see `simplecmp-shopify` perf work, 2026-06-15) — the deferred "per-locale
  translations" lever is the same problem.

Meanwhile every real host **already knows the active locale at render time**:
Shopify Liquid exposes `request.locale.iso_code` (and already inlines a config +
the metafield blocklist into `<head>`), TYPO3 has the site language. So shipping
25 unused locales to the browser is pure waste for managed hosts — but the
zero-config `<script>` drop-in genuinely benefits from "all languages present,
auto-selected," because it has no build step and may not know the locale ahead of
time.

This pulls in two directions, which is the decision to record.

## Decision

Keep the convenient all-bundled artifact, **and** add a sliceable path so managed
hosts ship only what they render:

1. **Split `translations/index.ts` into per-locale modules** + an aggregator. Each
   `<lang>.json` becomes individually importable; the `bundledTranslations`
   all-in object is rebuilt from them (no behaviour change for current importers).
   Same for `informal/`.

2. **Add per-locale subpath exports** in `package.json`, e.g.
   `"./translations/*": "./dist/translations/*.mjs"`, so ESM/bundler consumers can
   `import de from 'simplecmp/translations/de'` and tree-shake the rest.

3. **Add an English-only "core" engine entry** (e.g. `simplecmp/core` or a build
   flag) that bundles **only `en`** as the runtime fallback and expects the host
   to supply the active locale via the existing `config.translations` hook. This
   is the artifact managed hosts adopt.

4. **Keep the current full artifacts as the default** (`.` ESM + the full IIFE):
   **non-breaking** — existing consumers and the CDN drop-in keep "all locales,
   auto-selected." Slimming is **opt-in** via the core entry + per-locale imports.

5. **Hosts inject the active locale.** Shopify inlines the rendered locale's pack
   next to the config/blocklist it already emits; TYPO3 feeds the site language.
   English remains the runtime fallback everywhere.

The full IIFE remains the zero-config story; managed integrations move to
`core + injected locale` to cash in the bundle savings.

## Consequences

### Positive

- Managed hosts (Shopify, TYPO3, future WP/Contao) drop ~15–20 KB gzip of unused
  locales → smaller bundle, less parse/execute (helps the Shopify TBT budget).
- Per-locale exports are tree-shakeable for any bundler consumer.
- Scales cleanly as the locale count grows — adding a language no longer taxes
  every host.
- Reuses the existing `config.translations` merge seam; English fallback unchanged.

### Negative

- More build artifacts + `exports` surface to maintain (full IIFE, core, per-locale
  dist files); the build (`tsup`/`build:themes`-style step) grows.
- A footgun: a consumer who picks the **core** entry but forgets to inject a locale
  gets English only. Needs a clear console warning when the active locale isn't
  English and no pack was supplied.
- Each host needs wiring to inject its locale (one-time per host).

### Neutral

- No behaviour change for current `.`/IIFE consumers (full set stays the default).
- `informal/` tone overlays follow the same per-locale split.
- Doesn't change runtime selection (`language()`), fallback, or the
  `config.translations` contract.

## Alternatives considered

- **Status quo (all 26 bundled everywhere)** — rejected: measured weight on every
  host, not tree-shakeable, scales badly with locale count.
- **Async per-locale fetch** (core ships no packs, fetches `translations/<lang>.json`
  on demand) — rejected as the default: a consent banner must render fast, and an
  extra request risks a flash / late banner. Could be an *optional* loader later,
  but host-injection is strictly better for managed hosts (locale known at render,
  zero extra requests).
- **Make `.` English-only (breaking)** — rejected: breaks existing zero-config
  consumers; the slim path should be opt-in.

## Implementation sketch (when accepted)

- Refactor `src/engine/translations/index.ts` → per-locale modules + aggregator;
  mirror for `informal/`.
- Add a `tsup` entry / output for per-locale packs + a `core` engine entry that
  bundles only `en`; wire `package.json` `exports`.
- Add the missing-locale console warning to `src/index.ts` init.
- Update consumers: Shopify bridge inlines `request.locale.iso_code`'s pack into
  `config.translations`; TYPO3 feeds the site language. Re-measure the Shopify
  Lighthouse delta.
- Docs: README distribution section + the host integration notes.
