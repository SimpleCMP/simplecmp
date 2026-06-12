# Design review: REQ-N10 — Google Consent Mode v2 (Signal-Hook)

- **Date:** 2026-06-12 (same day as the initial design)
- **Scope:** REQ-N10 acceptance criteria + [ADR-0016](../adr/0016-google-consent-mode-v2-hook.md)
- **Outcome:** design confirmed; AC amended in `requirements.md`, amendment note
  added to ADR-0016. This doc preserves the full reasoning.

## Verdict

The design is sound: purpose-based mapping, reuse of the existing
default-consent composition (regime REQ-N4 + GPC REQ-5) instead of new policy
logic, and "emit signals, never load gtag" are the right calls. The review
found **one real hole** in the acceptance criteria (returning-visitor replay),
**one undocumented feature interaction** (universal blocking), and a handful of
softer spots. All are addressed in the amended AC.

## Finding 1 (critical): returning visitors were unspecified

The original AC covered **bootstrap** (`consent default` derived from the
regime/GPC default) and **update on every decision**
(`manager.watch`/`notify('consents')`). It did not cover a **returning visitor
with stored consent**.

If `notify('consents')` only fires on *decisions*, a user who accepted last
week gets `default: denied` on every subsequent page load and never an
`update: granted` — the merchant's GA4 silently drops to zero for all repeat
traffic. This is the classic CMP consent-mode bug, and `waitForUpdate: 500`
only makes sense if exactly this replay happens promptly after `default`.

**Amendment:** explicit AC — on init, after stored consent is loaded, emit a
`consent update` reflecting it, within the `waitForUpdate` window. Explicit
code path + Vitest case (stored consent → `default: denied` followed by
`update: granted` in the same init). Do not rely on the watch mechanism
happening to fire during restore.

## Finding 2 (conceptual): interaction with universal blocking (ADR-0012)

Advanced Consent Mode only works if the Google tag **loads pre-consent** and
sends cookieless pings. The engine's flagship feature is universal
*pre-consent blocking*. If a merchant registers GA4 as a blocked service, the
tag never loads before consent — silently degrading to **Basic** consent mode,
the exact gap the feature exists to close. The original REQ didn't mention
this interaction.

This is more than a config conflict — it's a **compliance trade-off**. The
cookieless pings are a network call to Google *before* consent, which several
DACH/EU regulators treat as a consent-requiring data transfer. So per
signal-relevant service there are two deliberate postures, and the choice must
be explicit (no silent defaulting):

1. **Block** (strictest, the engine's heritage): no call to Google until
   consent; Consent Mode off for that service.
2. **Signal-gate** (Consent Mode v2): tag loads, cookieless pings pre-consent,
   full measurement after consent — better measurement, weaker strictness.

**Amendment:** a service must never be *both* load-blocked and signal-gated
(silent degrade to Basic). Host integrations must **surface the trade-off**
rather than steer: the Shopify "GA4 detected" card names both postures and the
pre-consent-ping cost — keeping us honest about the very thing we fault
commercial CMPs for.

## Smaller findings

### `redactAdsData` semantics were underspecified

The original AC treated it as a static boolean passthrough. Google's
recommended pattern is dynamic: `ads_data_redaction: true` *while `ad_storage`
is denied*. As specced, a merchant would either always redact or never.
Also unstated: emission point (`gtag('set', 'ads_data_redaction', …)` must
precede the tag, like `default`).

**Amendment:** dynamic — tracks `ad_storage`, emitted before `default` and
re-emitted on each update.

### `dataLayerEvent` default was ambiguous (REQ/ADR drift)

ADR typed it `boolean | string` with a default event name; the REQ test line
said "optional". Unclear whether the GTM event fires by default when
`consentMode: true`.

**Amendment:** default **on** (`'simplecmp_consent_update'`), `false` disables.
Rationale: GTM users are the primary audience — hardcoded gtag reacts to the
consent command itself, GTM triggers need the event.

### Which signals go into the `default` command

The default purpose map covers 4 of 7 signals plus hardcoded
`security_storage: 'granted'`. `functionality_storage` /
`personalization_storage` are in the type but unmapped. Google's guidance is
to set every signal you rely on; an omitted signal behaves as *unset*, which
is not the same as `denied`.

**Amendment:** `default` contains exactly the signals present in the purpose
map plus `security_storage: 'granted'`; unmapped signals are deliberately
omitted (unset ≠ denied) and opt-in via `purposeSignals`.

### gtag shim shape deserves a test

GTM's consent reading requires the canonical
`function gtag(){dataLayer.push(arguments)}` — pushing a plain array breaks
it. Easy to get wrong in a TS codebase where `arguments` feels unidiomatic.

**Amendment:** Vitest asserts dataLayer entries are `arguments` objects.

### Explicitly excluded (now stated rather than implied)

- **`url_passthrough`** — the usual companion to `ads_data_redaction`; it's
  tag-/merchant-side configuration, not a CMP concern. Out of scope.
- **`region` arrays on the `default` command** — unnecessary: the region is
  already resolved server-side per visitor (REQ-N4), so per-visitor defaults
  are correct without a blanket region mapping in the command.

## Confirmed as-is (do not change)

- Purpose-based mapping — no Google-specific field per service.
- `granted` iff at least one **consented** service carries the mapped purpose —
  deny-safe for unused signals.
- Best-effort ordering honestly documented (tag before engine = `default`
  missed), same inherent limitation as front-end blocking.
- Off by default; zero global writes when disabled.
- Test matrix for regime (opt-in→denied / opt-out→granted) and GPC-forces-denied.
- No gtag/GTM loading; Google-only scope (Meta etc. need their own mechanisms).

## References

- [REQ-N10](../requirements.md#req-n10--google-consent-mode-v2-signal-hook) — amended AC
- [ADR-0016](../adr/0016-google-consent-mode-v2-hook.md) — decision + amendment note
- [ADR-0012](../adr/0012-universal-pre-consent-blocking.md) — blocking interaction (Finding 2)
- [ADR-0015](../adr/0015-region-aware-consent-regimes.md) / REQ-N4, REQ-5 — default-state sources
- [Google — Consent Mode v2 signals](https://support.google.com/analytics/answer/14563069)
- [Google — ads_data_redaction / advanced implementation](https://developers.google.com/tag-platform/security/guides/consent)
