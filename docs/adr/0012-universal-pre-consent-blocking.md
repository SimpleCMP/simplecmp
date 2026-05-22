# 0012. Universal pre-consent blocking of third-party requests

- **Status:** accepted; implementation in progress (Phase 0 done 2026-05-21; remaining gates lifted same day)
- **Date:** 2026-05-21
- **Deciders:** Ilja Melnicenko

## Context

SimpleCMP today follows the Klaro-inherited opt-in pattern: the
integrator marks each blockable element with `data-name="<service>"
data-src="..."` (or `data-type="text/plain"`), and the engine
swaps `src` / `type` in and out as consent flips. The pattern is
clean for technical integrators, but it has one structural
limitation — **anything the integrator forgot to mark loads
freely**, regardless of whether consent for that service exists.

For the German consumer-CMP market this is a meaningful gap.
Surveying what other CMPs ship:

- **Klaro upstream**: same opt-in pattern as SimpleCMP today.
- **Borlabs Cookie / Real Cookie Banner (paid WordPress plugins)**:
  per-platform pre-built "Content Blockers" (YouTube, Maps, Vimeo,
  Spotify, etc.) that recognise embed shortcodes / Gutenberg blocks
  in WP content APIs and rewrite them server-side before output.
  Strong support for the *recognised* set, manual fallback for
  everything else. Effectively a curated subset of universal
  blocking.
- **CCM19 (commercial German)**: the only consumer-grade CMP doing
  true universal pre-consent blocking. Two-layer approach: a
  server-side PHP module post-processes the rendered HTML before
  flush (swapping every third-party `<script src>` / `<iframe src>`
  to neutralised variants), plus a runtime JS shim that monkey-
  patches `document.createElement('script'|'iframe')`,
  `XMLHttpRequest.prototype.send`, and `fetch` to catch JS-injected
  calls. The capability is a substantial part of what justifies
  their licence fee — and a real differentiator for sites whose
  compliance posture requires fail-closed defaults.
- **OneTrust / Usercentrics (enterprise SaaS)**: sidestep the
  problem by mandating every third-party tag go through Google Tag
  Manager. GTM tag firing is then gated by their SDK. Workable for
  customers already in a GTM shop; not applicable to the OSS
  small-to-medium market.

The strategic implication: as SimpleCMP grows past Phase 5 and the
TYPO3 plugin matures, the gap to CCM19 will become the most
visible feature comparison point for German agencies and
in-house TYPO3 admins evaluating CMP options. "Klaro plus a
nice BE" isn't enough to displace a paid product that ships
universal blocking out of the box.

### Adjacent work that doesn't close the gap

Two features either shipped or planned in 2026-05 take steps in
this direction without delivering universal blocking:

- **Click-to-enable on blocked-service placeholders** (shipped
  2026-05-21) — improves the recovery UX *for elements that are
  already marked*. Doesn't change what gets marked.
- **Bridge BE detections into FE banner as provisional services**
  (task #22, Interpretation A from the same conversation) — when
  the recorder + library classifier resolves a third-party as a
  known service, the engine auto-enrols it on the banner so the
  next page load blocks it. Substantially narrows the "I forgot to
  think about this iframe" gap *for elements covered by the
  library*. Doesn't help with library-unknown trackers or with
  scripts that bypass `[data-name]` marking entirely.

A is a meaningful improvement and the right next step. It is **not**
a substitute for universal blocking — admins who want every
third-party request gated by consent, including scripts they don't
know about, still need the heavier mechanism.

### Why an ADR now, with implementation later

The decision to ship universal blocking is strategically settled.
What's not settled is when and how. Writing the ADR now while the
reasoning is fresh:

- Locks in the chosen mechanism so future-us doesn't re-litigate
  Service Workers as the "cleaner" answer every six months.
- Documents the rejected alternatives with concrete reasoning so
  third-party contributors landing in 2027 understand why the code
  is shaped this way.
- Gates implementation behind explicit triggers so we don't half-
  ship a fragile rewriter under deadline pressure.

## Decision

SimpleCMP commits to shipping universal pre-consent blocking of
third-party requests as a post-1.0 feature, via a two-layer
mechanism:

1. **Server-side HTML rewriting in each host CMS plugin.** The
   TYPO3 plugin (and the future WordPress / Contao plugins) gain
   an output-stage post-processor that scans the rendered HTML
   for third-party subresource references and rewrites them to
   the existing `data-name + data-src + src=""` shape before the
   response is flushed. This catches everything declarative —
   `<script src>`, `<iframe src>`, `<img src>`, `<link href>`,
   inline `<style>` with `url(...)` — for any host not on the
   site's allowlist.

2. **Runtime JS monkey-patching in the FE bundle.** A new
   optional `interceptRuntime: true` mode patches
   `document.createElement('script'|'iframe')`, the prototype
   methods of `XMLHttpRequest` and the global `fetch`, intercepting
   JS-initiated third-party calls that the server-side rewriter
   can't see. Patched calls are gated by the same consent state
   as declarative subresources.

The two layers cover different attack surfaces and are deliberately
shipped together: server-side alone misses dynamic content;
runtime alone misses declarative content that fires during HTML
parse before any JS runs.

### Considered alternatives

**Service Workers.** Technically the cleanest answer — a SW
intercepts every subresource fetch synchronously, can return a
synthetic block response or pass through, and works across
declarative and dynamic content uniformly. **Rejected** because:

- The SW must be registered before the first navigation it
  controls. That means the site admin has to wire SimpleCMP's SW
  into their host page boot, which violates the "drop the bundle
  in and go" promise of SimpleCMP.
- Many TYPO3 sites already register their own SW for PWA / push /
  offline. Two competing SWs on the same scope is a coordination
  problem we'd inherit forever.
- SW registration is HTTPS-only and has scope timing quirks.
  Private-browsing modes in some browsers block SWs entirely; the
  fail-closed promise leaks.
- The SW adds an asynchronous gate to every subresource fetch on
  every page, including same-origin assets. The perf cost is
  measurable; the perf cost of the server rewriter is paid once
  at render time.

If the user-side ecosystem shifts (e.g. browsers gain a "consent
proxy" hook above the SW layer, or Web Platform standardises
something like `navigator.consent` enough that the SW pattern
becomes ubiquitous and unobjectionable), the SW path is worth
revisiting. Until then, server+runtime is the better fit.

**CSP-only enforcement.** Forbid all non-allowlisted hosts via a
`Content-Security-Policy` header. **Rejected**: CSP errors don't
fire JS callbacks, so we cannot render a placeholder where the
blocked content used to be. The visitor sees blank or broken UI
with no path back to consent. CSP also can't dynamically expand
based on user click without server-side header changes per
session — incompatible with click-to-enable. CSP remains a
reasonable defence-in-depth layer alongside this work; not a
replacement for it.

**MutationObserver-as-blocker.** Observe new tags via
`MutationObserver`, neutralise them before they execute.
**Rejected**: `MutationObserver` callbacks fire **asynchronously
after** the mutation, not synchronously before. For `<script src>`
the browser fires the request as it parses the tag; the MO
callback arrives after the network request and often after the
script has executed. For inline `<script>` the text-set executes
before MO sees the node. The pattern catches some JS-injected
content but the race makes the contract unreliable. Runtime
monkey-patching (above) achieves the same intent without the
race.

**Integrator-marked-only (current state).** The Klaro/SimpleCMP
status quo. **Rejected** as the long-term answer because it
shifts the compliance burden onto every site that uses
SimpleCMP, asks integrators to mark every embed (and notice every
addition over the lifetime of the site), and fails closed only
when the integrator remembered. That's the gap CCM19 is selling
into; this ADR commits to closing it.

## Consequences

### Positive

- **Closes the biggest feature gap with CCM19** in the German
  consumer-CMP market. SimpleCMP becomes a credible displacement
  for sites whose compliance posture requires fail-closed
  defaults.
- **Compliance posture aligned with strict GDPR / TDDDG
  reading.** "Block first, ask second" is the legally safe
  default; opt-in marking is the legally risky one.
- **Integration friction collapses.** Sites stop needing to
  `data-name`-tag every embed by hand. The mechanism catches
  things the integrator hadn't thought about and surfaces them
  through the existing detection + adopt flow.
- **The mechanism is composable with everything we already ship.**
  Rewritten elements use the same `data-name + data-src` shape
  the engine already handles. Runtime-patched calls flow through
  the same consent state. No new render path; no parallel UI.

### Negative

- **Perf cost on every page render.** The server-side rewriter
  has to scan and potentially rewrite every HTML response. The
  perf impact depends on response size and host-list lookup
  efficiency. Sites with output cache layers (TYPO3 Reverse
  Proxy, CDN) inherit cache invalidation work — the rewritten
  version is the cacheable response.
- **Fragility surface, even after careful implementation.** Inline
  minified JS that builds URLs by concatenation, third-party
  loaders that bypass `document.createElement` (e.g. by writing
  into an existing element's `outerHTML`), CSS-loaded fonts via
  `@import`, `<link rel="preconnect">` hints — each is an edge
  case that needs explicit handling. The contract is "best
  effort", not "absolute". This needs to be documented honestly.
- **Maintenance burden grows substantially.** The host-list
  ("which domains are third-party for this site?") needs to be
  maintained per Site Set. The runtime-patch monkey-patching has
  to keep pace with browser DOM changes. Bug reports against
  "the rewriter missed X" will be a steady stream.
- **Per-site opt-out is mandatory.** Some sites have their own
  output transformation pipeline (custom middlewares, ESI tags,
  reverse proxies that do their own filtering) and SimpleCMP's
  rewriter would conflict. A Site Set flag
  `simplecmp.universalBlocking: false` must be respected.
- **Cannot fix the iframe-`src=""`-resolves-to-host-page bug
  (task #21) before this lands** — the engine has to set
  `src="about:blank"` instead, which is a small fix but worth
  doing alongside this work, not after.
- **Discovery becomes multi-pass under universal blocking.** A
  tracker chain (GTM → GA + Meta Pixel + LinkedIn Insight; Meta
  Pixel → fbevents.js → error-log beacon) only surfaces its first
  link in the detection log. Downstream URLs only fire if the
  upstream loader actually loads, which requires consent — so admin
  workflow becomes: crawl → curate → accept → re-crawl. Discovered
  during Phase 4 fixture verification (2026-05-22). See
  `docs/phase4/fragility-surface.md` for the full discussion and
  the three options for making this single-pass when prioritised.
- **Detection-table row explosion from cache-bust query params.**
  Trackers that suffix `&_=Date.now()` (Hotjar, jQuery non-cache
  fetches, many ad networks) generate a new detection row per
  visit because the recorder dedups by full URL. Visible mainly
  to admins of high-traffic sites with universal blocking on; not
  a coverage gap but a curation-noise issue. Mitigation deferred
  pending a deliberate design choice on URL normalisation
  granularity. Trade-off: stripping cache-bust keys loses
  path-level detail for legitimately query-driven trackers
  (campaign IDs, A/B variants).
- **Multi-TLD vendor coverage is a per-service curation gap, not
  a structural one.** Library entries cover one canonical apex
  domain; vendors that run across multiple TLDs (Meta on
  `.facebook.com` + `.facebook.net` + `.fbcdn.net`; Google on
  `googletagmanager.com` + `googletagservices.com` + `doubleclick.net`)
  leak the un-curated TLDs as **Unbekannt** even though they're
  obviously the same vendor. Workaround: ad-hoc library PRs to
  extend `origins` per vendor. Generalisation options (per-service
  `aliasOrigins`, vendor-level origin lists, audit script) tracked
  in the memory system.
- **Library-known services not in `config.services` get
  blocked-without-UI.** Phase 1 rewrites the embed to
  `about:blank` (because the host matches a library service), but
  the engine has no entry in `config.services` to drive the
  consent UI — so the visitor sees a blank iframe with no
  click-to-enable affordance. Admin recovers by adopting the
  library service into their registry (Bibliothek → Übernehmen).

### Neutral

- This ADR makes a direction decision, not an implementation
  decision. The exact API surface (`autoBlock: 'never' | 'known'
  | 'all'`?), the storage of the host-list, and the ergonomics
  of the Site Set toggle are settled when the work is picked up.
- The mechanism is additive. Sites that don't enable it continue
  to operate exactly as today.
- Click-to-enable + bridge-detection (the work shipping in
  May/June 2026) is the right scaffolding to land this on top of
  — the placeholder UI, the per-service allowlist, the
  detection-driven service catalog are all reusable here.

## Implementation status

All implementation gates removed 2026-05-21. The ADR's original
gates were author caution about pre-1.0 churn risk + premature
cross-CMS abstraction; Ilja's direction is "proceed without those
guardrails." Notes for future selves so the rationale isn't lost:

- **Pre-1.0 churn risk** — accepted. The blocking mechanism is
  additive (opt-in via config flag) and doesn't break existing
  consumers. Pre-1.0 instability of *other* APIs (engine,
  contextual-notice copy, library schema) may force re-work
  inside the blocking code, but that's a cost we'll absorb.
- **Cross-CMS abstraction** — deferred but not gating. The TYPO3
  rewriter will accumulate TYPO3-specific patterns; when a second
  CMS plugin lands (WordPress, Contao, or another), Phase 3
  factors out what's shared. Until then, single-CMS specifics
  in `Classes/UniversalBlocking/` are acceptable.
- **Interpretation A** — dropped (see also revision history at
  the bottom of this file).

Status: Phase 0 prototypes done 2026-05-21; Phase 1+2
productionisation is now the active work, can start anytime. See
ADR-0013 for the phase breakdown.

## Triggers to revisit *this* ADR

This ADR is a direction-setting document, not the implementation
spec. It should be reopened on any of:

1. **The Service-Worker rejection rationale stops applying.** If
   browsers ship a standardised consent-aware proxy hook, or the
   PWA scope-conflict problem becomes solvable in spec, the SW
   path may become preferable to server+runtime. The
   `navigator.consent` W3C draft is one possible trigger here
   (cross-referenced with ADR-0011).
2. **Standardised universal consent signals become enforceable
   without the host doing work.** If GPC + EU Art. 21(5) +
   `navigator.consent` together create a binding "no third-party
   loads without consent" expectation at the browser layer, the
   need for this mechanism in the CMP collapses.
3. **A SimpleCMP user implementing this independently produces a
   pattern significantly better than server+runtime.** Open
   source surprises happen; a contributor PR with a working
   alternative deserves a fair re-evaluation.

## References

- [Click-to-enable placeholder feature memory](../../docs/adr/) —
  the shipped scaffolding work in May 2026.
- Task #22 (Interpretation A — bridge BE detections into the FE
  banner) — must ship first.
- Task #23 (this ADR's implementation work) — gated on the above.
- [`universal_pre_consent_blocking.md`](https://github.com/SimpleCMP/simplecmp/blob/main/docs/adr/0012-universal-pre-consent-blocking.md)
  conversation memory (Claude session 2026-05-21) — captures the
  strategic framing including the competitive landscape and the
  "we definitely WANT B" decision.
- CCM19 product pages (publicly visible) — reference implementation
  shape for the server+runtime approach.
- W3C `navigator.consent` draft —
  https://www.w3.org/community/consent/ (potential trigger to
  revisit; see ADR-0011 Tier 2).
- Service Workers MDN —
  https://developer.mozilla.org/docs/Web/API/Service_Worker_API
  (the rejected alternative reasoning).
