# 0006. Hard-fork from Klaro: full UI rewrite, drop upstream tracking

- **Status:** accepted
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler
- **Supersedes:** ADR-0002

## Context

ADR-0002 set up SimpleCMP as a fork of Klaro!: import the source verbatim,
modify in place, log every divergence. The reasoning: don't reinvent a
battle-tested consent UI, save weeks of edge-case work, retain the option
to merge upstream security fixes.

Twelve months in, that calculus has changed.

**On the upside-of-the-fork side**, what we've actually used:

- `consent-manager.js` and `lib.js` core logic (state, storage, applyConsents)
  — kept and leaned on heavily. Solid.
- 26 translations in `translations/*.yml` — all imported.
- Component JSX (`consent-modal.jsx`, `consent-notice.jsx`, ...) — modified
  for REQ-1 (imprint), REQ-2 (decline button class), REQ-6 (a11y).

**On the cost-of-the-fork side**, what's getting expensive:

- Klaro hasn't released since the snapshot (0.7.22, March 2025). The
  "merge upstream security fixes" benefit isn't materialising.
- ADR-0002's "don't reformat upstream wholesale" rule means our
  TypeScript-first preference can't apply to `src/core/`. We carry
  `.d.ts` shims (`lib.d.ts`, `maps.d.ts`, `translations/index.d.ts`)
  to type code we don't own.
- Klaro's JSX hardcodes class names (`cm-btn-success`, `cookie-notice`).
  That blocks Bootstrap-style integrations, framework-agnostic UI,
  and class-mapping configurability — all real customer needs that
  surfaced during Phase 3 review.
- Preact-compat aliasing, JSX-in-`.js` loader hacks, sass-mixin
  language: each is a build-time concession to Klaro's idiom.
- Every REQ that adds UI features touches `src/core/components/*.jsx`
  with `// SimpleCMP modification` markers. By REQ-6 we modified
  `consent-modal.jsx` to the point that re-merging upstream would be
  manual conflict-resolution anyway.

**The strategic question**: is the fork still serving us, or are we
paying the cost of upstream-tracking discipline without realizing
its benefits?

This ADR concludes: the latter. The cost is real and growing; the
benefit hasn't materialised. Time to declare independence.

The trigger conversation (with Sven, 2026-05-02) put it succinctly:

- He's the primary integrator (TYPO3 sites, agency clients).
- He knows the requirements firsthand — **so the usual "we don't know
  what customers want" risk for a UI rewrite is mitigated**.
- He values *modern stack* and *frontend-independence* over
  *Klaro-merge-compatibility*.

## Decision

We hard-fork from Klaro.

### Replaced (full rewrite as TypeScript / Web Components)

- All of `src/core/components/*.jsx` (10 files, Preact-based UI)
- All of `src/core/scss/*.scss` (Klaro's SCSS-mixin theme)
- `src/core/lib.js` — JSX wrapper that called `reactRender(<App/>, ...)`
- `src/core/klaro.js`, `klaro-no-translations.js` — entry-point variants
- `src/core/themes.js` — themes registration

### Rewritten as TypeScript (logic preserved, language modernised)

- `src/core/consent-manager.js` → `src/engine/consent-manager.ts`
- `src/core/stores.js` → `src/engine/stores.ts`
- `src/core/utils/{config,cookies,i18n,maps,strings,compat,api}.js`
  → `src/engine/...` as TS

### Untouched (already SimpleCMP-authored TS)

- `src/recorder/` — recorder, watchers, classifier, types
- `src/service-db/` — client, layered classifier
- `reference-server/` — PHP+SQLite backend
- All 23 service seeds in `reference-server/seeds/`
- `src/floating-trigger.ts` — already a SimpleCMP module; will become
  the basis for `<simplecmp-trigger>`

### Translation strategy

- 26 YAML files in `src/core/translations/` → JSON in
  `src/translations/<lang>.json`
- German + English ship inline in the bundle; other languages are
  lazy-loaded on demand.
- Klaro's `hu.yml`-broken issue resolves itself — we own the JSON,
  no malformed input to work around.

### Public API stability

The consumer-facing API stays compatible:

```ts
init({ storageName, services, privacyPolicy, imprint, consentVersion,
       floatingTrigger, record, serviceDbUrl, ... })
addEventListener(event, handler)
getRecorder() / getManager() / show() / unmountFloatingTrigger()
```

Existing integrations (Sven's TYPO3 sites, future CMS plugins) don't
need to change their `init()` calls. Internals change radically;
contract doesn't.

### Decisions delegated to follow-up ADRs

- **UI tech stack** (Lit vs. vanilla custom elements, Shadow DOM
  strategy, native `<dialog>`) → ADR-0007.
- **Build targets** (drop CJS, ESM-only engine, ESM+IIFE for UI) →
  ADR-0008.

These are concrete enough to make alone but follow from this strategic
decision.

### Migration approach

We do NOT do a big-bang switch. Instead, the rewrite happens in stages
with ongoing CI green:

1. New code goes into `src/engine/` and `src/ui/` directories alongside
   the old `src/core/`. Both coexist during migration.
2. `src/index.ts` is rewritten to use the new engine + UI when ready.
3. Tests get refactored stage-by-stage; old tests stay green until
   their target code is replaced.
4. Final stage: delete `src/core/`, remove `LICENSE-KLARO` from
   `package.json.files`, update README acknowledgements.

Detailed stage plan in `docs/requirements.md` REQ-N (rewrite track,
to be added).

## Consequences

### Positive

- **Frontend-independence** is achievable. Engine has zero UI deps;
  UI is replaceable. Consumers using Vue/React/vanilla can use the
  engine without inheriting Lit either.
- **Modern stack throughout**: TypeScript-first, native `<dialog>`,
  CSS Custom Properties, ESM-only where possible, no preact-compat.
- **Bootstrap and other framework integration** becomes trivial. UI
  uses Light-DOM-mode + standard semantic markup; host's Bootstrap
  CSS applies directly. Or build your own Bootstrap-styled UI from
  the same engine.
- **Build pipeline simplifies**: no JSX-in-`.js` loaders, no
  Preact-compat aliases, no sass mixin parser. esbuild + Lit's
  built-in template compiler is all we need.
- **CMS plugins (Phase 5)** can render their own native UI in the
  CMS admin (TYPO3 backend module, WP settings page, Contao DCA)
  using the engine directly, without wrapping a Preact tree.
- **Maintenance ownership becomes straightforward**: every line is
  ours, no "is this Klaro-derived or SimpleCMP-original" question.
- **Type safety end-to-end**: no more `.d.ts` shims for code we don't
  own. All public API surfaces TS-typed.
- **TypeScript-first** without the ADR-0002 "don't reformat upstream"
  constraint.

### Negative

- **~3 weeks of focused work** to extract the engine, write the UI,
  port translations, and rewrite tests. Phase 4 (CMS Bridge) and
  Phase 5 (CMS plugins) wait until this is done.
- **Klaro's accumulated edge-case fixes** (iOS Safari focus quirks,
  iframe contextual consent placement, mobile responsive details)
  must be re-derived. Sven knows the major ones from agency
  experience, but minor papercut bugs are inevitable.
- **Translations need re-binding**. Content is identical (BSD-3 from
  Klaro is permissive about content reuse), but the wiring from
  config keys to UI strings is a new layer.
- **Loss of "we can backport Klaro fixes"** as an escape hatch. If
  Klaro ships a CVE fix, we'd review and apply manually as we'd do
  for any third-party reference, not as a fork-merge.

### Neutral

- **License**: Klaros code is BSD-3, content is BSD-3 as
  redistributed. After the rewrite, no Klaro source files ship in
  `dist/`, so the BSD-3 retention requirement no longer applies to
  the published artifact. `LICENSE-KLARO` stays in the repo as a
  historical artifact and credit; README acknowledges Klaro as the
  original inspiration. Pure SimpleCMP code is BSD-3 of our own.
- **Documentation**: existing ADRs (0001 ADR process, 0004 Recorder,
  0005 Service DB) stay valid. ADR-0002 (Fork Klaro) is superseded
  by this. ADR-0003 (build targets) is partially superseded by
  ADR-0008.
- **Public API contract** stays — we already designed it as a thin
  wrapper around Klaros internals, so the rewrite doesn't break
  consumers.
- **`src/recorder/` and `src/service-db/` were never Klaro-derived**.
  They keep their structure, type-cleanly across the boundary.

### Risks not accepted

We do **not**:

- Re-implement Klaro's IDE configurator (was excluded from the
  original import too).
- Maintain backwards compatibility with consumers who imported
  internal Klaro modules. Anyone who did was relying on
  undocumented internals; the public API in `src/index.ts` is the
  contract.
- Promise feature parity with Klaro 0.7.22 day-one. We promise
  Compliance-REQ parity (REQ-1 through REQ-6, all already shipped).
  Niche Klaro features (e.g., contextual consent on per-iframe basis)
  ship if customers ask, on demand.

## References

- ADR-0001 — record architecture decisions (process)
- ADR-0002 — Fork Klaro! as the consent UI engine *(superseded by this ADR)*
- ADR-0003 — Build targets (partially superseded by ADR-0008)
- ADR-0004 — Recorder architecture (unchanged; recorder stays)
- ADR-0005 — Service DB protocol (unchanged; service-DB stays)
- ADR-0007 — UI architecture: Lit-based Web Components (follow-up)
- ADR-0008 — Build outputs: ESM-only engine (follow-up)
- Klaro project: https://github.com/KIProtect/klaro (acknowledged
  inspiration; original code base for v0.0.x – v0.x.x of SimpleCMP)
