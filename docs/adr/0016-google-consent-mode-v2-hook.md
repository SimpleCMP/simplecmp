# 0016. Google Consent Mode v2 emission hook (engine)

- **Status:** accepted
- **Date:** 2026-06-12
- **Deciders:** Ilja Melnicenko

## Context

The roadmap parked **Google Consent Mode v2** as "an optional plugin/hook
in Phase 5, not core" (`docs/requirements.md`, REQ table). Phase 5 (CMS
plugins) is underway, and the Shopify app's
[ADR-0003](https://github.com/SimpleCMP/simplecmp-shopify/blob/main/docs/adr/0003-phase2-consent-mode-v2-not-forwarding.md)
chose **Consent Mode v2 gating** over server-side analytics forwarding as
its next step. That decision rests on a fact that is **not Shopify-specific**:

- A CMP's job for Google tags is to **signal consent** (`gtag('consent',
  …)` / dataLayer), so the merchant's *existing* GA4 / Google Ads respect
  it — not to run a competing data pipe.
- Shopify's native banner only emits **Basic** consent mode and doesn't
  reach GTM or a hardcoded gtag; emitting **Advanced** Consent Mode v2 is
  the gap real CMPs fill. The same is true on TYPO3 and WordPress — every
  host's merchants paste Google tags.

So the capability belongs in the shared engine (per the cross-cutting /
minimal-host-changes principle), consumed by each host's integration
layer. This ADR specifies the engine hook; [REQ-N10](../requirements.md)
holds the acceptance criteria.

## Decision

Add an **opt-in Consent Mode v2 emission hook** to the engine. Off by
default; no behaviour change unless configured.

### Config

```ts
consentMode?: boolean | ConsentModeConfig;

interface ConsentModeConfig {
  // purpose id -> Google signals it grants. Default:
  //   analytics -> ['analytics_storage']
  //   marketing -> ['ad_storage','ad_user_data','ad_personalization']
  purposeSignals?: Record<string, GoogleConsentSignal[]>;
  waitForUpdate?: number;            // ms for the `default` command (default 500)
  dataLayerEvent?: boolean | string; // also push a GTM event (default 'simplecmp_consent_update')
  redactAdsData?: boolean;           // ads_data_redaction passthrough (default false)
}
type GoogleConsentSignal =
  | 'ad_storage' | 'analytics_storage' | 'ad_user_data' | 'ad_personalization'
  | 'functionality_storage' | 'personalization_storage' | 'security_storage';
```

`consentMode: true` enables it with the default purpose map.

### Behaviour

1. **Bootstrap (before consent).** On init the engine ensures
   `window.dataLayer` and a `gtag` shim exist, then emits
   `gtag('consent', 'default', { …signals, security_storage: 'granted',
   wait_for_update })`. Each mapped signal's default state is derived from
   the engine's existing **default consent** — which already composes the
   **regime** (REQ-N4: opt-in → `denied`, opt-out → `granted`) and **GPC**
   (REQ-5: forces `denied`). No new policy logic; Consent Mode reads the
   same source of truth as the rest of the engine.
2. **Update (on every decision).** The hook subscribes to consent changes
   (`manager.watch`/`notify('consents')`). A signal is `granted` iff at
   least one **consented** service carries a purpose mapped to it, else
   `denied`. It emits `gtag('consent', 'update', { … })` and, if
   `dataLayerEvent` is set, a `dataLayer.push({ event, … })` so GTM
   triggers can react.
3. **Ordering.** The `default` command must run before the merchant's
   Google tag library loads — the engine already installs early (the same
   `<head>`-priority placement universal blocking and the host injectors
   rely on). The hook reuses that; it does not introduce new ordering
   constraints beyond "load the engine in `<head>`".

### Boundaries

- The engine **does not** load gtag, GTM, or any Google library; it only
  pushes consent commands to a dataLayer the merchant's own tag reads.
- Mapping is **purpose-based** (the existing `Service.purposes`), so it
  works with arbitrary merchant-defined services without a Google-specific
  field on every service.
- Other vendors (Meta) are out of scope; this hook is Google-specific by
  design (the signals are Google's).

## Consequences

### Positive

- Activates a planned capability as **shared engine code** — Shopify,
  TYPO3, and WordPress integrations all gain it from one place.
- **Composes** with the existing regime (REQ-N4) and GPC (REQ-5) paths
  instead of duplicating policy.
- Lets each host be a credible CMP for Google tags (the "implements
  Consent Mode v2 correctly" bar) without running an analytics pipe.

### Negative

- **Google-specific.** The hook doesn't generalise to non-Google vendors;
  those need their own mechanisms later.
- **Best-effort ordering.** If a host injects Google's tag *before* the
  engine, the `default` command can miss — same inherent limitation as
  front-end blocking; documented, not solved here.

### Neutral

- Off by default; existing integrations are unaffected until they opt in.
- Server-side analytics forwarding remains a separate, deferred option
  (Shopify ADR-0002/0003), not part of this hook.

## Amendment (2026-06-12, design review)

A same-day review ([review doc](../research/2026-06-req-n10-consent-mode-v2-review.md))
tightened the acceptance criteria in REQ-N10; the decision itself is unchanged.
Deltas relevant to this ADR:

- **Stored-consent replay:** on init with saved consent, the hook must emit a
  `consent update` right after `default` (within the `wait_for_update` window).
  Without it, returning visitors stay on `default: denied` forever — the classic
  CMP consent-mode bug. Explicit code path + test, not an assumed side effect
  of `notify('consents')`.
- **Universal blocking interaction — two deliberate compliance postures, not just
  a config conflict:** Advanced Consent Mode requires the Google tag to load
  pre-consent and send cookieless pings. That's not only technically incompatible
  with load-blocking — it's a **compliance trade-off**: those cookieless pings are
  a network call to Google *before* consent, which several DACH/EU regulators treat
  as a consent-requiring data transfer. So per signal-relevant service it's an
  explicit choice (no silent defaulting): **(1) Block** (strictest, our heritage —
  no call to Google until consent; Consent Mode off for that service) or
  **(2) Signal-gate** (Consent Mode v2 — tag loads, cookieless pings pre-consent,
  full measurement after; better measurement, weaker strictness). A service must
  not be *both* load-blocked and signal-gated (silent degrade to Basic). Host
  integrations must **surface the trade-off** — the Shopify "GA4 detected" card
  names both postures and the pre-consent-ping cost rather than silently steering
  to (2) — keeping us honest about the very thing we fault commercial CMPs for.
- **`redactAdsData` is dynamic**, per Google's pattern: `ads_data_redaction`
  tracks `ad_storage` (true while denied), emitted before `default` and on each
  update — not a static passthrough.
- **`dataLayerEvent` defaults to on** (`'simplecmp_consent_update'`); `false`
  disables it.
- **`default` covers only mapped signals** plus `security_storage: 'granted'`;
  unmapped signals stay unset (unset ≠ denied) and are opt-in via `purposeSignals`.
- The `gtag` shim must use the canonical `function gtag(){dataLayer.push(arguments)}`
  form — GTM's consent reading depends on `arguments` objects, not arrays.

## References

- REQ-N10 (acceptance criteria) — this repo
- [Shopify ADR-0003](https://github.com/SimpleCMP/simplecmp-shopify/blob/main/docs/adr/0003-phase2-consent-mode-v2-not-forwarding.md)
  — the decision that drives this; gate-not-forward rationale + research
- ADR-0015 / REQ-N4 (regimes) and REQ-5 (GPC) — the default-state sources
  this hook reads
- [Google — Consent Mode v2 signals](https://support.google.com/analytics/answer/14563069)
