# ADR-0013 Phase 4 — Universal blocking fragility surface

- **Date:** 2026-05-22
- **Status:** living document — update when new gaps are discovered

This doc captures what universal pre-consent blocking does NOT catch
when `simplecmp.universalBlocking.enabled` is on (TYPO3) /
`interceptRuntime: { universalBlock: true }` is set (JS API direct).
Use it to:

- Decide whether universal blocking is right for your site.
- Plan a CDN allowlist before flipping the switch.
- Understand what additional measures (CSP, server-side egress
  filtering, etc.) you still need for full third-party isolation.

The companion doc `docs/migrating-from-data-name.md` covers the
positive side — how to opt in if you're already using the manual
`[data-name]` pattern.

## TL;DR

| | Covered |
|---|---|
| Declarative `<script src>`, `<iframe src>`, `<img src>`, `<link href>` | ✅ rewritten server-side |
| `<noscript><img>` content | ✅ rewritten server-side (parser walks noscript) |
| JS-injected `el.src = '...'` for script / iframe / img | ✅ patched prototype |
| `window.fetch(url)` | ✅ patched |
| `XMLHttpRequest.prototype.open(...)` + `send()` | ✅ patched |
| `navigator.sendBeacon(url, ...)` | ✅ patched |
| Any non-same-origin host (with `universalBlock: true`) | ✅ blocked using host as synthetic service id |
| CSS-triggered network (fonts, background-images) | ❌ **not covered** |
| Dynamic `import('https://…')` ESM | ❌ not covered |
| `<img srcset>` candidate URLs | ❌ not covered (Phase 1 only walks `src`) |
| WebSocket / EventSource / WebRTC | ❌ not covered |
| Service workers registered by the host page | ❌ out of scope by design |
| Scripts that execute BEFORE the SimpleCMP bundle | ❌ **timing gap — see below** |

## What's caught — the covered surface

### Phase 1 (server-side `HtmlRewriter`)

Native `DOMDocument` parser walks the response body. Every
`<script>`, `<iframe>`, `<img>`, `<link>` (including those inside
`<noscript>`) is checked. If the `src` / `href` host:

- matches the site's own host or admin allowlist → pass through
- otherwise → rewritten to `data-name="<service-id>" data-src="<url>" src="about:blank"`

The synthetic service id is the library service name when known, the
host itself otherwise (`unknown-tracker.com`).

Cost: ~5 ms p50 on a 30-iframe worst-case page. Linear in document
size; native DOM parse dominates.

### Phase 2 (FE runtime patches)

Six prototype-level patches installed in `<head>` before any inline
body script runs:

- `HTMLScriptElement.prototype.src` setter
- `HTMLIFrameElement.prototype.src` setter
- `HTMLImageElement.prototype.src` setter
- `window.fetch`
- `XMLHttpRequest.prototype.open` + `send`
- `navigator.sendBeacon`

Same matcher as Phase 1; same synthetic-service-id rule when
`universalBlock: true`. Blocked URLs are swallowed to `''` /
returned with rejected promises / dropped silently depending on the
mechanism.

`onBlock` callback fires per block. SimpleCMP's `init()` internally
wraps this to feed a synthetic `Detection` into the recorder so the
bridge + BE detection table still surface the call — admin doesn't
lose visibility just because the network never saw the request.

## Fragility surface — what's NOT caught

### CSS-triggered third-party network

The browser fetches CSS resources via its own parser, not JS, so the
runtime patches can't see them. Phase 1 rewrites `<link rel="stylesheet">`
elements with `href` attributes — but **once a stylesheet is loaded,
its `@font-face url(...)`, `background-image: url(...)`, `@import
url(...)`, etc. are out of our reach**.

Concrete leaks:
- Google Fonts loaded by a stylesheet whose `<link href>` was
  same-origin (`@import url(https://fonts.googleapis.com/...)` inside).
- Tracker pixels embedded in CSS as `background-image: url(...)`.
- Cursor sprite sheets, custom font files, decorative SVGs pulled
  from third-party CDNs.

**Workarounds:**
- CSP `font-src` / `img-src` / `style-src` directives. Server-side
  policy; doesn't go through SimpleCMP at all.
- Inline critical CSS, audit external stylesheets for `url(https://...)`
  patterns.
- If a specific font CDN is acceptable, add it to
  `simplecmp.universalBlocking.allowlist`.

### Dynamic ESM imports

`import('https://cdn.example.com/module.js')` uses the module loader,
which is not one of our patched mechanisms. The request bypasses
both layers entirely.

In practice this is rare in modern trackers — most still use
`document.createElement('script')` for compatibility. But any
modern-Lit-style first-party app that dynamically imports from a
CDN will leak.

**Workaround:** import from same-origin only. If you use a
public-CDN strategy (esm.sh, jsdelivr, etc.), allowlist the host or
self-host the bundles.

### `<img srcset>` candidates

Phase 1 walks the `src` attribute on `<img>` elements, not `srcset`.
A responsive image with:
```html
<img src="about:blank" srcset="https://cdn.example.com/img-2x.jpg 2x">
```

(where `src` is rewritten by Phase 1 but `srcset` is untouched) will
have the browser load the 2x candidate from the third-party CDN.

**Workaround:** Phase 1 could be extended to walk `srcset` too —
small change. Filed as a follow-up; not implemented because no
real-world case has surfaced yet.

### WebSocket / EventSource / WebRTC

Neither layer patches these. Trackers rarely use them, but realtime
analytics (LiveChat, Drift, Intercom) sometimes opens a WebSocket
post-consent. If the loader was blocked, the WebSocket never opens
either — so this is a downstream-of-the-blocked-loader gap, not a
first-class leak. Real-world impact: minimal.

### Scripts that execute BEFORE the SimpleCMP bundle

**This is the most important caveat.** The runtime patches install
when SimpleCMP's bundle script executes. Any third-party `<script>`
that appears in the document AHEAD of the SimpleCMP bundle script
runs WITHOUT the patches in effect.

The TYPO3 ext puts the bundle in the AssetCollector's priority bucket
(head-injected via `['priority' => true]`). That's the right place
for SimpleCMP-managed sites — both the bundle and the inline
`SimpleCMP.init(...)` call land in `<head>` before any body script.

But sites that:
- Use the JS API directly (not the TYPO3 integration) and put
  `<script src="simplecmp.global.js">` at the end of `<body>` — every
  inline body script runs first, leaks.
- Have third-party scripts in `<head>` via TYPO3 extensions other
  than SimpleCMP, where another extension's `AssetCollector` calls
  happen in priority order — order is undefined, may or may not race.

**Rule of thumb:** SimpleCMP must be the first script in `<head>`.
Period. Anything that runs before it is a free pass to third-party
network land.

### First-party JS that calls third-party APIs via CSS / SVG / image errors

Edge cases worth mentioning:
- A SVG with `<image href="...">` — does the renderer trigger image
  fetches? Yes, and our `HTMLImageElement.prototype.src` patch
  doesn't see SVG image elements (they're `SVGImageElement`).
- `<embed>` and `<object>` — not patched, not rewritten by Phase 1.
- Web Components that fetch their own resources via custom logic —
  out of scope.

## Operational quirks (data-side, not coverage gaps)

### Cache-bust URLs explode the detection table

Trackers often append `&_=Date.now()` (Hotjar, jQuery `.cache: false`,
many ad networks) to defeat browser caching. The recorder dedups by
`${kind}:${identifier}` — full URL — so each unique cache-bust value
becomes a new detection row.

A site with universal blocking on and one Hotjar pixel firing per
visit will accumulate one row per visit, none bumping the existing
counter.

**Workaround (deferred):** see
`/home/ilja/.claude/projects/-home-ilja-ddev-simplecmp/memory/decisions_deferred.md`
"Cascading-discovery limitation" section for the broader discussion.
Possible mitigation: normalize cache-bust query keys (`_`, `t`, `v`,
`cb`, `nocache`) at the recorder dedup boundary. Trade-off: loses
path-level detail for query-driven trackers (campaign IDs etc.).

### Cascading discovery: only the first layer surfaces

A tag manager (GTM, Segment) blocked at its loader URL means the
trackers it would have loaded never appear in the detection log
either. Admin curates GTM → grants consent → next visit shows GA,
Meta Pixel, etc. → admin curates those too.

Multi-pass discovery is the workflow today. See `decisions_deferred.md`
for the three options to make this single-pass if it ever becomes
worth building.

### Multi-TLD vendor coverage

The library entry for `facebook.json` lists only `*.facebook.com`.
Meta also runs on `connect.facebook.net`, `*.fbcdn.net`,
`*.fbsbx.com`. Detections on those hosts show as **Unbekannt** even
though they're obviously Meta.

Same gap for YouTube-nocookie (`*.youtube-nocookie.com`).

See `decisions_deferred.md` for the proposed `aliasOrigins` /
`vendorOrigins` schema generalisation. Until then, ad-hoc PRs to
extend individual library entries close one vendor at a time.

### Library-known but not in `config.services` → no consent UI

If Phase 1 rewrites a tag for a library service the admin hasn't
curated to their registry, the engine has no service to drive the
consent UI. Visitor sees a placeholder iframe at `about:blank` with
no "click to enable" notice; clicking it does nothing.

**Workaround:** the BE detection log surfaces these as **Erkannt** —
admin Übernimmt them, banner gains a new toggle, visitor gets a
proper consent path on next visit.

## Performance posture

| | p50 | Worst case (30 iframes) |
|---|---|---|
| Phase 1 server-side rewriter | ~5 ms | ~5 ms |
| Phase 2 patches (per-block decision) | ~0.05 ms | scales with block count |
| Recorder synthetic-detection feed | ~0.1 ms / block | bounded by dedup |

Phase 0's `~5 ms p50` measurement carried over — the rewriter scales
with document size, not third-party count. Patches scale with
per-element URL assignment, dominated by string parsing
(`new URL(url)`). No reason to revisit perf at current scale.

## Open follow-ups

In rough priority order:

1. **`<img srcset>` rewrite** in Phase 1. ~10 LOC + test.
2. **Cache-bust query-key normalisation** at the recorder dedup
   boundary. Needs a design choice on which keys to strip.
3. **Multi-TLD vendor coverage** via `aliasOrigins` schema extension
   in `simplecmp/services-library`. Bigger.
4. **Discover-mode auto-consent for curated services** so multi-pass
   crawls become single-pass. UX + privacy-posture trade-off.
5. **SVG `<image>` element patch.** Add `SVGImageElement.prototype.href`
   to the patch list.

All deferred until a real-world site surfaces the pain. Tracked in
the memory system, not in GitHub issues, because pre-1.0 churn
makes issue lists go stale fast.

## Related docs

- `docs/migrating-from-data-name.md` — opt-in guide for integrators
  on the manual pattern.
- `docs/adr/0012-universal-pre-consent-blocking.md` — the strategic
  decision.
- `docs/adr/0013-universal-blocking-implementation-plan.md` — the
  phasing.
- `docs/phase0/REPORT.md` — Phase 0 prototype + measurement.
- `src/runtime-patches/README.md` — patch internals + first-script
  ordering caveat.
