# 0015. Region-aware consent regimes (opt-in / opt-out)

- **Status:** accepted
- **Date:** 2026-06-11
- **Deciders:** Ilja Melnicenko

## Context

REQ-N4 ("Geo-aware Defaults") asks for jurisdiction-correct consent defaults:
GDPR-style **opt-in** in the EU, CCPA-style **opt-out** in US states. Today the
engine has only one behaviour — non-required services default-deny and the
banner blocks until the visitor decides — plus the GPC handling from REQ-5
(`getDefaultConsent` forces default-deny when `navigator.globalPrivacyControl`
is set). There is no notion of *which legal regime applies to this visitor*.

This matters now because the Shopify app (the monetised consumer) targets the
US/DTC market, where forcing an EU opt-in wall is over-compliant and actively
harmful to conversion and analytics coverage. The capability is cross-cutting:
TYPO3 and the future WordPress plugin need it too, so it belongs in the shared
engine, not in any one host.

Two questions had to be settled:

1. **Who determines the region, and how?**
2. **What does each regime actually do**, and how do they compose with GPC,
   the merchant's own situation, and unknown regions?

### Legal framing (not legal advice; basis for the model)

Applicability of privacy law is **not** decided by where the server is hosted,
nor by the visitor's citizenship. GDPR Art. 3 turns on:

- **Art. 3(1) — establishment:** if the *controller* (the business) is
  established in the EU, GDPR governs its processing regardless of server or
  visitor location.
- **Art. 3(2) — targeting/monitoring:** a non-EU controller is caught when it
  offers goods/services to, or monitors, people **who are in the EU**
  (physical presence, not citizenship).

US state laws (CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA, …) are the inverse:
processing is allowed by default and the consumer has a **right to opt out** of
the "sale"/"sharing" of personal data and targeted advertising ("Do Not Sell or
Share"); GPC is a legally recognised opt-out signal under CPRA/Colorado.

Consequence for the model: an **EU-established business typically applies opt-in
to everyone** (Art. 3(1), and it's the simplest safe posture), while region is
the lever that lets a US-facing business give US visitors the lighter, legally
correct opt-out experience. So the merchant's baseline matters as much as geo.

## Decision

### 1. The region is server-supplied; the engine never geo-locates

The browser cannot reliably determine the visitor's jurisdiction (no JS geo
API; timezone/language are spoofable). The IP — the only reliable signal — is
visible **server-side**. Doing geo client-side would also require a pre-consent
call to a third-party geo service, which is exactly what a CMP exists to
prevent. So the host sets a `region` value; the engine consumes it.

- TYPO3 / generic hosts: CDN/edge geo headers or GeoIP.
- Shopify: the Customer Privacy API's `getRegion()`.

### 2. Three regimes: `opt-in`, `opt-out`, `none`

| Regime | Default for non-required services | Banner | GPC |
|---|---|---|---|
| `opt-in` (GDPR/ePrivacy) | **deny** | blocking decision wall (accept / decline / save) | forces deny |
| `opt-out` (US states) | **allow** | non-blocking **notice** + persistent "Do Not Sell or Share" control | forces deny |
| `none` (unregulated) | allow | none (settings trigger only) | forces deny |

`opt-out` is not a weaker opt-in: tracking runs by default, the UI is a notice
rather than a wall, and the engine exposes a persistent opt-out entry point.

### 3. Baseline regime + optional region override; unknown → strictest

Resolution order for the effective regime:

1. `config.region` is looked up in `config.regimes` (merchant override map), then
2. in a **built-in, overridable** region→regime table — EU/EEA codes + `GB` +
   `CH` → `opt-in`; recognised US opt-out states (`US-CA`, `US-CO`, `US-CT`,
   `US-VA`, `US-UT`, …) and catch-all `US` → `opt-out`;
3. otherwise fall back to `config.regimeDefault` (**default `opt-in`**).

So an EU merchant sets nothing (or `regimeDefault: 'opt-in'`) and every visitor
gets the wall; a US-facing merchant supplies `region` per request to relax US
visitors to opt-out. **Unknown/unmapped region resolves to `opt-in`** —
under-protecting is the dangerous failure; over-protecting only shows a banner
that wasn't strictly required.

### 4. GPC generalises across regimes (subsumes REQ-5)

`getDefaultConsent` becomes regime-driven, and the existing REQ-5 GPC path moves
inside it: when `respectGPC !== false` and GPC is set, non-required services
default-deny in **every** regime (a safe blanket opt-out). Finer-grained "GPC
governs only sale/share" is deferred — a documented future refinement, not v1.

### 5. The engine exposes the resolved regime + a show-banner signal

The UI layer reads the resolved regime (`getRegime()` / a manager field) to
render an opt-in modal vs. an opt-out notice vs. nothing, and a "should the
banner auto-show?" signal. The engine stays UI-free; it only computes state.

### 6. Consent Mode v2 stays out of this (and out of core)

Per the existing requirements decision, Google Consent Mode v2 is an optional
plugin/config-hook, **not** core, and is **not** part of REQ-N4. On Shopify it
is Shopify's Customer Privacy API that forwards our `setTrackingConsent` to
Google downstream — the engine does not emit `gtag('consent', …)`.

## Consequences

### Positive

- **Jurisdiction-correct and cross-cutting.** One engine capability serves
  TYPO3, Shopify, and WordPress; the Shopify `sale_of_data` signal maps onto the
  opt-out regime.
- **Right experience per market.** US/DTC merchants get the conversion-friendly
  opt-out notice instead of an unnecessary consent wall, without us shipping a
  legally wrong default.
- **Safe by default.** No config → opt-in for everyone; unknown region → opt-in.
- **No new privacy leak.** Region comes from the host; the engine makes no
  client-side geo call.
- **Cleans up REQ-5.** GPC stops being a special case and becomes one input to
  the regime-driven default.

### Negative

- **Correctness depends on the host supplying an accurate `region`.** A wrong or
  missing value silently falls back to opt-in (safe) or, if mis-mapped to
  opt-out, could under-protect — so the built-in table and the "unknown →
  opt-in" rule must be conservative, and hosts must be told `region` is their
  responsibility.
- **More states in the engine.** `getDefaultConsent`, banner-show logic, and the
  UI now branch on regime; more test surface.
- **Opt-out UX is new work in the UI layer** (notice vs. wall, persistent "Do
  Not Sell or Share"), beyond the engine change.

### Neutral

- **The built-in region→regime table will drift** as US state laws change; it's
  intentionally overridable (`config.regimes`) and treated as a sensible default,
  not a legal source of truth.
- **Per-purpose GPC granularity** (sale/share only) and a full **US-state matrix**
  are deferred; the v1 model is opt-in / opt-out / none with a blanket GPC.
- **`none` regime** is offered but most deployments will use opt-in or opt-out.

## References

- [REQ-N4 — Geo-aware Defaults](../requirements.md) — the requirement + acceptance criteria
- [REQ-5 — GPC handling] — generalised into the regime-driven default (see `src/engine/consent-manager.ts`)
- GDPR Art. 3 (territorial scope); CCPA/CPRA + VCDPA/CPA/CTDPA/UCPA (US opt-out + GPC)
- `docs/legal-compliance.md` — project legal basis (territorial-scope section to be added)
- Shopify Customer Privacy API `getRegion()` / `sale_of_data` — the Shopify-side region + opt-out mapping
