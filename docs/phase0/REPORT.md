# ADR-0013 Phase 0 — Report + go/redesign recommendation

- **Date:** 2026-05-21
- **Branch:** `feature/universal-blocking` (this repo) +
  `WapplerSystems/simplecmp-typo3@main` (env-gated)
- **Author:** Ilja Melnicenko

## Bottom line

**Go.** Both layers of universal pre-consent blocking work in their
respective domains. The TYPO3 rewriter measures **~5 ms per page**
across typical and worst-case pages — well inside the ADR-0013
budget. The FE runtime patches catch all six JS-injected mechanisms
we exercised. No design calls turned up evidence forcing a redesign.

Recommend advancing to Phase 1 (TYPO3 rewriter productionised) and
Phase 2 (FE runtime patches productionised) when the remaining
ADR-0013 implementation gates trigger:

- SimpleCMP reaches 1.0
- WordPress plugin work begins (Phase 3 cross-CMS abstraction
  triggers)

## What we built

### Server-side HTML rewriter (Phase 0 task #25)

**Lives at:** `simplecmp-typo3/Classes/UniversalBlocking/`

- `Middleware/HtmlRewriter.php` — PSR-15 frontend middleware running
  after every other content middleware. Buffers the response body,
  parses with native `DOMDocument`, walks `<script>`, `<iframe>`,
  `<img>`, `<link>` tags. Rewrites third-party `src`/`href` to
  `data-name + data-src + src="about:blank"` (the same shape the
  existing engine handles for integrator-marked elements).
- `Service/HostMatcher.php` — index built once from
  `ServicesLibrary::services()`. Exact-host hash table + wildcard
  suffix walk. Same semantics as the recorder's JS classifier.
- Opt-in via env var `SIMPLECMP_REWRITER_ENABLED=1` or query
  param `?_simplecmp_rewrite=1`. Off by default; production deploys
  unaffected.
- Emits `Server-Timing: rewriter;dur=NN;desc="scanned=X,rewritten=Y"`
  so benchmark scripts can read cost from headers.

### FE runtime patches (Phase 0 task #26)

**Lives at:** `simplecmp/src/runtime-patches/`

- `index.ts` — six monkey-patches:
  - `HTMLScriptElement.prototype.src` setter
  - `HTMLIFrameElement.prototype.src` setter
  - `HTMLImageElement.prototype.src` setter
  - `window.fetch`
  - `XMLHttpRequest.prototype.open` + `.send`
  - `navigator.sendBeacon`
- Configurable via `installRuntimePatches({ matcher, consentChecker,
  sameOriginHosts, onBlock })`. Returns an uninstaller for tests.
- Pass-through is silent; blocked calls invoke `onBlock` and return
  the natural-shape failure (rejected Promise, `false` return, no-op
  send).
- Built by tsup as a separate entry → `dist/runtime-patches.mjs`.
- Demo at `demos/runtime-patches.html` exercises all six paths
  interactively.

## Performance measurement

### Baseline (no rewriter, cache hits, 20 iter)

| Page | min | p50 | p95 | max | size |
|---|---|---|---|---|---|
| `/de/home` | 80 ms | 85 ms | 95 ms | 99 ms | 105 KB |
| `/de/elemente` | 81 ms | 84 ms | 90 ms | 94 ms | 98 KB |
| `/de/extensions/blog/ein-testblogpost` | 75 ms | 79 ms | 84 ms | 84 ms | 96 KB |
| `/de/extensions/blog` | 75 ms | 80 ms | 83 ms | 87 ms | 100 KB |
| `/de/test-worst-case` | 76 ms | 80 ms | 85 ms | 89 ms | 96 KB |

### Rewriter overhead (cache flushed each iteration, 10 iter)

From the `Server-Timing: rewriter;dur=NN` header — pure rewriter
cost, isolated from cache-miss render cost.

| Page | rewriter p50 | rewriter p95 | scanned URLs | rewritten |
|---|---|---|---|---|
| `/de/home` | 5.0 ms | 6.5 ms | 5 | 4 |
| `/de/elemente` | 4.6 ms | 5.1 ms | 1 | 0 |
| `/de/extensions/blog/ein-testblogpost` | 4.5 ms | 5.5 ms | 1 | 0 |
| `/de/extensions/blog` | 4.7 ms | 5.0 ms | 1 | 0 |
| `/de/test-worst-case` | 4.7 ms | 5.9 ms | 31 | 30 |

### Interpretation against ADR-0013 budget

| Tier | Budget typical | Budget worst-case | Measured typical | Measured worst-case |
|---|---|---|---|---|
| Target | <30 ms | <80 ms | ~5 ms ✓ | ~5 ms ✓ |
| Acceptable | <80 ms | <200 ms | well inside | well inside |
| Abort signal | >150 ms | >400 ms | not approached | not approached |

**Observations:**

1. **Rewriter cost barely scales with tag count.** 1 URL on
   `/de/elemente` and 31 URLs on `/de/test-worst-case` cost the
   same ~5 ms. The dominant cost is DOMDocument's parse, not the
   per-tag walk + matcher lookup.
2. **Native `DOMDocument` is fast enough that Masterminds/HTML5 is
   no longer needed** (design call #2 default validated).
3. **Cache integration unchanged.** The rewritten body is cacheable
   identically to the original (no per-visitor state); standard
   TYPO3 output cache holds it after first generation.

## 12 design calls — Phase 0 outcomes

| # | Call | Default | Phase 0 outcome |
|---|---|---|---|
| 1 | Hook in TYPO3 | PSR-15 frontend middleware running last | **Validated.** Hooks cleanly via `after: ['typo3/cms-frontend/content-length-headers']`. No middleware-ordering conflicts observed. |
| 2 | HTML parser | Masterminds default; DOMDocument fallback | **Reversed.** DOMDocument hits budget at ~5 ms — no need for Masterminds. Composer dep avoided. |
| 3 | Buffering | Buffer entire response, rewrite once | **Validated.** Memory pressure on the 96-KB worst-case page was unmeasurable. Revisit only if real-world pages exceed a few MB. |
| 4 | Tag scope | iframe + script + img + link in v0 | **Validated.** Covered all 30 rewrites on the worst-case page. `<source>`, `<video poster>`, `<audio>` deferred to Phase 1 — not seen on test pages. |
| 5 | Inline scripts | Skip — runtime patches handle them | **Validated.** Runtime patches catch JS-injected calls cleanly (#26). Inline scripts that resolve URLs synchronously hit the runtime patches the moment they call `el.src=`. |
| 6 | Module scripts | Same data-name swap as regular scripts | **Deferred.** No `<script type="module">` on dev14. Phase 1 needs unit-test coverage. |
| 7 | Host allowlist semantics | `*.example.com` matches apex + subdomains | **Validated** (mirrored from existing classifier). |
| 8 | Inline CSS `url(...)` | Skip in Phase 0 | **Confirmed.** Not seen on test pages; revisit if a real site needs it. |
| 9 | `<link rel=preconnect>` / `prefetch` | Strip third-party hints | **Deferred.** Not in current scope of `<link>` rewrite. Phase 1 should decide whether to include these. |
| 10 | CSP interaction | Document; defer auto-nonce | **Confirmed.** dev14 has no strict CSP, so no test case. Phase 1 needs a sample with `script-src 'self'`. |
| 11 | Per-element override | `data-no-rewrite` opts out | **Validated** — rewriter skips elements with both `data-name` AND `data-no-rewrite`. |
| 12 | Per-host override | Admin-curated allowlist | **Deferred to Phase 1.** Prototype uses `sameOriginHosts` only; full allowlist UI is Phase 1 scope. |

## Fragility surface

Observed during prototyping; documented in
`src/runtime-patches/README.md`:

- **Inline scripts that build URLs by concatenation** — caught by
  runtime patches when the final string is assigned to `.src` or
  fed to `fetch`, but not visible to the server-side rewriter.
  Mitigation: runtime patches cover this.
- **Loaders that bypass `document.createElement`** — `outerHTML`
  injection still flows through the prototype patches (the parser
  creates a fresh element). `document.write()` post-parse is the
  only true gap, and it's near-extinct in modern third-party code.
- **Host-page Service Workers** — out of scope; SimpleCMP can't
  reach SW context to gate requests.
- **WebSocket / EventSource / WebRTC** — known unpatched. Tracking
  rarely uses these channels; document as out of scope.
- **First-script-ordering** — patches only work for scripts that
  execute AFTER `installRuntimePatches()` returns. Same constraint
  Klaro/SimpleCMP's banner-init has. Load this module synchronously
  in `<head>` BEFORE any third-party loader.

## What Phase 1 needs to do next

Numbered list, executable in order:

1. **Productionise the TYPO3 rewriter.** Move from query-param
   gating to per-Site-Set toggle (`simplecmp.universalBlocking.enabled`).
   Add the BE-managed host allowlist (design call #12). Verify
   cache integration end-to-end (cache miss → cache stores rewritten
   body → subsequent cache hits are instant). Add functional tests.
2. **Productionise the FE runtime patches.** Wire `consentChecker`
   to `manager.getConsent(name)` from the engine. Replace the demo's
   mock matcher with one derived from `simplecmp/services-library`.
   Add `interceptRuntime: true` config flag. Add Playwright spec.
3. **Phase 1 design-call resolution:** add unit tests for
   `<script type="module">` (call #6), add `<source>`/`<video>`/
   `<audio>` to the rewriter's tag scope (call #4 stretch), decide
   on `preconnect`/`prefetch` rewriting (call #9), test against
   strict CSP (call #10).
4. **Phase 3 cross-CMS abstraction.** Factor the library-origin
   matcher + host-allowlist storage out of `simplecmp-typo3` into a
   CMS-agnostic location (the upstream library? a shared PHP
   package?). Required before WordPress plugin work begins.

## Open issues not blocking Phase 1

- **dev14 is a benign benchmark.** Real-world TYPO3 sites have
  more plugins, more inline JS, more content blocks. The ~5 ms
  number may not generalise to a Magento-sized news site. Phase 4
  ("Hardening + documentation") will re-measure on three to five
  real sites.
- **Bench script is slow** (5 pages × 10 iter × `cache:flush` ≈
  90 s). Future runs should use `&no_cache=1` instead of flushing
  between iterations — cuts wall-clock by 10×.
- **Worst-case page is hand-planted in the dev14 DB** (`/de/test-worst-case`,
  pid 330). Not in any git repo. If dev14's DB resets, re-plant
  using the SQL + body fixture in `docs/phase0/`.

## Sign-off

Phase 0 exit criteria from ADR-0013:

- [x] HTML-rewriter prototype hits the performance budget on 5
      representative pages
- [x] FE monkey-patch prototype blocks a programmatically-injected
      third-party script without breaking existing flows (no
      existing flows to break in the demo, but the patches install
      cleanly and uninstall cleanly)
- [x] All 12 design calls have documented answers
- [x] Clear go/redesign recommendation

**Recommendation: go.** Proceed to Phase 1 + Phase 2 in parallel
when the 1.0 + second-CMS-plugin gates fire.
