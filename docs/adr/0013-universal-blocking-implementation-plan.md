# 0013. Implementation plan for universal pre-consent blocking

- **Status:** accepted
- **Date:** 2026-05-21
- **Deciders:** Ilja Melnicenko
- **Supersedes:** —
- **Related:** ADR-0012 (strategic decision); this ADR is the
  implementation plan it gates.

## Context

ADR-0012 commits SimpleCMP to shipping universal pre-consent
blocking of third-party requests via server-side HTML rewriting
plus runtime JS monkey-patching. That ADR captures the *what* and
*why*; this ADR captures the *how*: phasing, the architecture
decisions inside each layer, the performance budget that gates
production rollout, and the risk register.

ADR-0012's original implementation gate listed three preconditions
(1.0 reached, A shipped, second CMS plugin in scope). The "A first"
gate was dropped 2026-05-21 because Interpretation A — bridging BE
detections into the FE banner — turned out not to address the felt
problem (Ilja: *"right now its actually working how we want it to
work, i think we need just general blocking, which is in #23"*).

Two of ADR-0012's three gates are now decisions about timing:

- **1.0 reached** — softened to "Phase 0 design spike can run in
  parallel with 1.0 work, on a feature branch". Implementation
  phases 1+ still wait for 1.0.
- **Second CMS plugin in scope** — confirmed: **WordPress** will
  be the second plugin. Phase 3 (cross-CMS abstraction) triggers
  when WordPress plugin work begins in earnest.

The remaining open implementation questions — hook choice in TYPO3,
parser choice, scope of the rewriter, runtime patch surface,
performance budget — are resolved in this ADR.

## Decision

### Phasing

Five phases, with explicit exit criteria between them so we don't
half-ship a fragile rewriter under deadline pressure.

**Phase 0 — Design spike** (1–2 weeks; starts immediately on a
feature branch, parallel to 1.0 work). Two prototypes plus a
measurement report. Exit criteria:

- HTML-rewriter prototype on dev14 hits the performance budget
  defined below on 5 representative pages.
- FE monkey-patch prototype blocks a programmatically-injected
  third-party script on a dev page and doesn't break the existing
  banner / modal / recorder flow.
- All 12 critical design calls in this ADR have a documented
  answer (even if "punt for now, revisit in Phase 1").
- Clear "go/redesign" recommendation captured in a Phase 0 report.

**Phase 1 — TYPO3 rewriter productionised** (~5 days, gated by 1.0
+ Phase 0 green). Middleware wired into the FE pipeline running
last; per-Site-Set toggle + host allowlist; cache integration;
functional tests.

**Phase 2 — FE runtime patches** (~5 days, parallelisable with
Phase 1). `createElement('script'|'iframe')`, `XHR.open`, `fetch`,
`sendBeacon`. Gated by `interceptRuntime: true` config so sites can
opt in. Playwright specs covering GTM-style loaders, fetch
interception, image-pixel blocking.

**Phase 3 — Cross-CMS abstraction** (~3 days, gated by WordPress
plugin work starting). Factor out library-origin-matcher, host
allowlist storage, runtime patch loader as CMS-agnostic; the
TYPO3-specific glue stays in the TYPO3 ext.

**Phase 4 — Hardening + documentation** (~3 days). Three to five
real sites tested; documented fragility surface; migration guide
from manual `[data-name]` opt-in to universal blocking; ADR-0012
trigger list updated based on lessons learned.

Total estimate: ~2.5 weeks of focused work plus integration time
across sites. The Phase 0 spike narrows that estimate considerably.

### Performance budget

Two cost scenarios:

**Cache hit** (90%+ of production requests with TYPO3 output cache
warm): rewritten body is in cache. **Rewriter cost = 0.** Not
budgeted.

**Cache miss** (cold cache, post-content-save, first visitor after
invalidation): rewriter runs. Cost added to server render time.

| Tier | Typical page | Worst-case page |
|---|---|---|
| Target (barely noticeable) | <30 ms | <80 ms |
| Acceptable (measurable, no architectural issue) | <80 ms | <200 ms |
| Abort signal (needs redesign) | >150 ms consistently | >400 ms consistently |

Anchored against:
- TYPO3 v14 typical page render uncached: 50–150 ms on a clean
  dev14 install. Adding 30 ms is +20–60% relative — noticeable in
  dev tools, invisible to humans against typical network latency.
- Google Core Web Vitals: TTFB <200 ms is "good", 200–500 ms is
  "needs improvement", >500 ms is "poor". The rewriter sits in the
  TTFB path on cache misses. We aim to stay in "good" for typical
  pages and accept "needs improvement" for worst-case.
- Production reverse-proxy upstream timeouts (Varnish, nginx) are
  typically 5–15 s. We don't approach that; >1 s on the rewriter
  alone would represent a deeply broken implementation.

**Definitions:**
- **Typical page** — HTML 30–80 KB, 5–15 third-party tags. Most
  production page renders.
- **Worst-case page** — HTML >200 KB, 30+ third-party tags. List
  views with embedded media, long blog posts with many embeds,
  complex landing pages.

### Measurement method (Phase 0 deliverable)

1. Baseline numbers on dev14 without the rewriter for 5 page types:
   homepage with embeds, blog post with iframes, large list view,
   inline-JS-heavy page, `<script type="module">` page.
2. With-rewriter numbers for the same 5 pages.
3. `Server-Timing: rewriter;dur=NN` header emitted in dev mode so
   per-request cost is visible in DevTools.
4. Phase 0 report tabulates baseline vs. with-rewriter, absolute
   and relative.

If any of the 5 pages exceeds the abort-signal tier, Phase 0 ends
with redesign rather than Phase 1 kickoff.

### Critical design calls — defaults to validate in Phase 0

| # | Call | Default | Risk if wrong |
|---|---|---|---|
| 1 | Hook in TYPO3 | PSR-15 frontend middleware running last | Conflicts with other middlewares; output-cache write timing |
| 2 | HTML parser | `Masterminds/HTML5` (real-world HTML tolerant) | `DOMDocument` faster but stricter; fails on malformed pages |
| 3 | Buffering | Buffer entire response, rewrite once | Memory pressure on very large pages; streaming is harder |
| 4 | Tag scope | `<script>`, `<iframe>`, `<img>`, `<link rel=stylesheet>`, `<source>`, `<video poster>`, `<audio>` | Miss → blocking gap; over-block → break pages |
| 5 | Inline scripts | Skip — runtime patches handle JS-injected calls | Slower path; runtime patches must catch everything inline scripts do |
| 6 | Module scripts | `<script type="module" src>` get the same treatment | ESM execution semantics differ; data-name swap may break module resolution |
| 7 | Host allowlist semantics | Wildcard `*.example.com` matches apex + all subdomains (same as library) | Inconsistency between admin mental model and library matchers |
| 8 | Inline CSS `url(...)` | Skip in Phase 0; revisit if a real site needs it | Fonts/images leak through; usually low-risk |
| 9 | `<link rel=preconnect>` / `prefetch` | Strip third-party hints | Mild perf cost; ignoring leaks DNS info |
| 10 | CSP interaction | Document that strict CSP needs nonces; defer auto-nonce | Sites with `script-src 'self'` may break if we inject inline replacement |
| 11 | Per-element override | Honour `data-no-rewrite` on integrator-marked elements | Allows escape hatch for misclassified cases |
| 12 | Per-host override | The admin-curated allowlist (Phase 1 BE UI) | Required for vendor's own services, CDNs |

### Risk register

| Risk | Mitigation |
|---|---|
| Performance regression on every page render | Phase 0 benchmark + abort exit criterion |
| Fragile inline-JS handling (string-concat URLs sneak through) | Runtime patches as the safety net; honest documentation |
| CSP breakage on hardened sites | Per-Site-Set opt-out + documented compatibility note |
| Library-matcher inconsistency between recorder and rewriter | Single source of truth — `ClassifierLookup` / upstream library matcher used by both |
| WordPress plugin author blocked on TYPO3-specific patterns | Phase 3 forces CMS-agnostic abstraction before adding WP plugin |
| Maintenance burden from missed hosts | Push contributions back to the library; surface honest "best-effort" framing |
| Cache invalidation interacts badly with reverse proxies | Phase 0 verifies cacheability of rewritten body; document any extra invalidation rules |

### Out of scope (explicitly)

- **Service Workers** — rejected in ADR-0012.
- **CSP-only enforcement** — rejected (no placeholder support).
- **Auto-host-detection from prior detections** — possible Phase 5
  nice-to-have ("we've seen this host, want to allowlist?") but
  not in the core mechanism.
- **`<noscript>` rewriting** — irrelevant to our blocking model.
- **Email-template content** — separate TYPO3 pipeline; not our
  problem.
- **Interpretation A** — dropped 2026-05-21 (see ADR-0012 revision
  note + `universal_pre_consent_blocking.md` memory).

## Consequences

### Positive

- Phasing with explicit exit criteria + a measurable performance
  budget means we can't half-ship under deadline pressure. Phase 0
  is cheap enough that it can run in parallel to 1.0 work, and a
  failed spike informs the design rather than blocking 1.0.
- Performance budget framed against TYPO3's actual render-time
  characteristics + Core Web Vitals thresholds, not arbitrary
  numbers — admins and contributors can reason about whether a
  rewriter overhead is acceptable for their site.
- Critical design calls captured up-front means Phase 1
  implementation doesn't get derailed by re-litigating decisions.

### Negative

- The ~2.5-week estimate doesn't include the WordPress plugin's
  own implementation effort; Phase 3's abstraction work is on top.
- Real-world testing (Phase 4) on 3–5 sites is the kind of work
  that surfaces issues that double the timeline. Plan accordingly.
- We commit to ongoing maintenance of the rewriter + runtime
  patches — both are stateful surfaces that bug reports will pile
  up against.

### Neutral

- This ADR makes concrete decisions but each is reversible at low
  cost given how additive the feature is. The biggest commitment
  (and the only one hard to reverse cheaply) is the choice to do
  server-side rewriting AT ALL — that one is settled in ADR-0012.
- The 12 design calls are guidance for Phase 0, not contracts.
  Phase 0 surfaces evidence that may change any of them.

## References

- ADR-0012 — Universal pre-consent blocking strategic decision.
- `universal_pre_consent_blocking.md` memory — conversational
  context and the "A dropped" decision.
- `be_discover_trackers.md`, `click_to_enable_blocked_services.md`
  — adjacent shipped features whose patterns inform the design
  (per-site Site-Set toggles, library-driven copy, the
  `data-name + data-src` shape).
