# 0017. Multi-vendor consent signals (vendor-adapter registry)

- **Status:** accepted
- **Date:** 2026-06-13
- **Deciders:** Ilja Melnicenko

## Context

[ADR-0016](0016-google-consent-mode-v2-hook.md) shipped a Google-only Consent
Mode v2 emission hook (`src/engine/consent-mode.ts`): it derives granted/denied
from the engine's regime/GPC-composed consent state and signals the merchant's
existing Google tags via `gtag('consent', …)`. The Shopify Tier-2 roadmap then
asked to extend "consent signalling" to other ad vendors (Meta, TikTok,
Pinterest, Microsoft UET).

Research into each vendor's actual consent mechanism showed they do **not**
share one model:

- **Google** — full `gtag('consent', default/update, {analytics_storage,
  ad_storage, ad_user_data, ad_personalization})`; cookieless-ping model.
- **Microsoft UET** — `window.uetq.push('consent', 'default'/'update',
  { ad_storage })`. Google-shaped; queue-array based; Microsoft mandated the
  signal as of May 2025.
- **Meta Pixel** — `fbq('consent', 'grant'|'revoke')`. No granular signals; a
  single grant/revoke.
- **TikTok** — **no in-page consent API at all.** The only compliant option is
  not loading the pixel until consent.
- **Pinterest** — mostly load-gated; has a `pintrk('set', {consent})` flag, but
  Pinterest's own guidance is "don't execute until opt-in."

Two transport caveats also surfaced:

- **`uetq` is safe to pre-create** (a queue array like `dataLayer`; `uet.js`
  drains it). **`fbq` is not** — pre-defining `window.fbq` makes Meta's own
  loader snippet bail (`if(f.fbq)return`) and never load `fbevents.js`, breaking
  the merchant's pixel. So a Meta adapter must only signal an *already-present*
  `fbq`.
- Even when present, a `fbq('consent','revoke')` emitted after the page's
  `fbq('track')` cannot retroactively prevent the first event. Hard
  pre-consent suppression for Meta is therefore a **load-gating** guarantee, not
  a signalling one.

## Decision

Generalize `consent-mode.ts` into a small **vendor-adapter registry** rather
than special-casing each vendor in the Shopify app.

- The vendor-neutral machinery stays shared: a `ConsentView.granted(purpose)`
  derived from `services[].purposes` + the active state function, and the
  single manager watcher that fires `default` / replay / `update`.
- A `ConsentVendorAdapter` only defines its transport. Built-in adapters:
  - **`google`** — the ADR-0016 behaviour verbatim (gtag/dataLayer, the
    `purposeSignals` map, `waitForUpdate`, `dataLayerEvent`, `redactAdsData`).
    **Default-on** for back-compat.
  - **`meta`** — `fbq('consent','grant'|'revoke')`, gated on `adPurposes`
    (default `['marketing']`); **emits only when `window.fbq` already exists**.
  - **`microsoftUet`** — `uetq.push('consent', mode, { ad_storage })`, gated on
    `adPurposes`; safely pre-creates the queue.
- Config: `consentMode: true` (or an object without `vendors`) → `['google']`,
  identical to today. Opt into more via
  `consentMode: { vendors: ['google','meta','microsoftUet'] }`.

**No TikTok or Pinterest adapter.** They have no usable in-page consent API, so
the correct mechanism is the existing **universal pre-consent blocking**
(load-gating). Shipping a no-op "signal" for them would be misleading.

## Consequences

- Cross-cutting: TYPO3, WordPress, and the Shopify app all inherit Meta + UET
  signalling by flipping a config flag — no per-host transport code. Aligns with
  the "minimal Shopify-specific base changes" rule.
- Meta signalling is **best-effort on the pre-consent path** (it reliably
  handles the update/withdrawal path and the pixel-present-at-init case). The
  hard guarantee for Meta/TikTok/Pinterest is load-gating; UI copy and docs must
  say so rather than imply the signal blocks the first hit.
- Back-compat is total: `consentMode: true` is unchanged, and the existing
  Google tests pass untouched.

## Alternatives considered

- **A Shopify-only signalling layer.** Rejected: the Shopify Web Pixel runs in a
  `strict` sandbox and only reports liveness to the backend — storefront `fbq`/
  `uetq` signalling must run in page context, which is exactly where the
  engine's `installConsentMode` already executes via the bridge. A Shopify layer
  would also deny TYPO3/WP the same capability.
- **A no-op TikTok/Pinterest adapter for symmetry.** Rejected as misleading;
  load-gating is the real answer and already exists.
