# 0011. Browser-based consent signals — GPC primary, ConStand deferred

- **Status:** accepted
- **Date:** 2026-05-21
- **Deciders:** Ilja Melnicenko

## Context

Germany's revised TTDSG (now TDDDG, since 14 May 2024) introduced § 26: a
framework for *anerkannte Einwilligungsverwaltungsdienste* (recognised
consent management services, German equivalent of PIMS). The
Einwilligungsverwaltungsverordnung (EinwV) operationalising it has been
in force since 1 April 2025. The intent: users set their consent
preferences once in a recognised service (a browser plugin, OS setting,
or similar), websites read them automatically, the banner disappears.

The reality as of May 2026:

1. **Exactly one recognised service exists** — *Consenter* by Law &
   Innovation Technology GmbH, accredited by the BfDI on 17 October 2025.
2. **Recognition is bound to the vendor, not the spec.** Consenter ships
   ConStand as an open specification (built on GPC, ADPC, ISO/IEC TS
   27560, W3C DPV, TCF), but implementing ConStand in another CMP does
   not confer the legal privilege of being an *anerkannter Dienst* —
   that requires separate BfDI accreditation per provider.
3. **Embedding is voluntary** (§ 18 Abs. 1 EinwV) — websites are not
   required to honour a recognised service's signals unless they choose
   to. There is no sanction for non-integration.
4. **No standardised browser API yet** — W3C's `navigator.consent` is
   draft. ConStand uses proprietary message-passing between the
   Consenter Agent and a site-side banner.
5. **Federal evaluation is scheduled for April 2027.** The German
   federal government will assess whether to make participation
   mandatory; the system's binding effect is genuinely uncertain until
   then.

This creates a structural problem for any open-source CMP including
SimpleCMP. A visitor who has installed the Consenter Agent — who has
done the legally encouraged thing — will still see SimpleCMP's banner
on every site running our library, because we don't speak ConStand.
The same applies to Klaro, Borlabs Free, Real Cookie Banner Free, and
every other free/open CMP. The article's own analysis:

> Webseiten, die kostenlose CMPs nutzen — ihre Nutzer mit
> Consenter-Plugin bekommen weiterhin Banner, weil die Schnittstelle
> nicht implementiert ist. Theoretisch könnten sie ConStand selbst
> umsetzen, praktisch fehlen Ressourcen und Anreize.

We could implement ConStand. It's not infeasible. But:

- The spec is complex (server-side signing, Consent Store API,
  HSM-style flows) — easily 1–2 weeks of focused implementation work,
  more with testing.
- Adoption is single-vendor today. Implementing ConStand makes us
  interoperable with **one** browser plugin's user base. The article
  notes that "established CMPs … have **no economic incentive to
  implement** — their business model relies on high consent rates for
  AdTech." Open-source CMPs have the inverse problem: no resources
  to absorb the complexity.
- The spec's openness hasn't translated to multi-vendor adoption in
  18 months since the EinwV took effect. We have no evidence that
  building support today would unlock anything more than parity with
  a Consenter user base of unknown (likely negligible) size.

Meanwhile, **GPC (Global Privacy Control)** has none of these problems:

- Already shipped in SimpleCMP (`SimpleCMPConfig.respectGPC`, default
  `true`; reads `navigator.globalPrivacyControl` in
  `ConsentManager.getDefaultConsent`).
- Browser support: Brave (default on), Firefox (opt-in setting),
  DuckDuckGo Browser. Honoured by tens of millions of users.
- Legal recognition: California CCPA mandates respect. EU regulators
  (EDPB) have signalled that GPC can constitute a valid Art. 21(5)
  GDPR objection — the same legal lever the cited article identifies
  as the **better** path forward.

The article's own preferred direction:

> Eine bessere Lösung wäre gewesen: Verpflichtende Anerkennung von
> Open-Standards wie GPC im EU-Recht (Art. 21(5) DSGVO ist die
> rechtliche Hebelstelle), Browser-Standard `navigator.consent` über
> W3C, und Pflicht zur Berücksichtigung für Webseitenbetreiber.

We're already on that path.

## Decision

SimpleCMP supports **open, multi-vendor browser-based consent signals**
as its primary mechanism for automatic opt-out, and **defers
vendor-specific protocol implementations** including ConStand until
either material adoption justifies the effort or federal mandate
forces it.

In tiers:

**Tier 1 — supported today.**
- **GPC** via `respectGPC` (default `true`). When the browser sends
  `navigator.globalPrivacyControl === '1'`, non-required services
  default to opt-out and `consentVersionMismatch` event suppression
  is preserved. Required services bypass it.

**Tier 2 — supported if/when justified.**
- **ADPC** (Advanced Data Protection Control, noyb/EDPB-aligned).
  Same architectural shape as GPC: HTTP request header + DOM
  signal, opt-out per processing purpose. Add when (a) a flagship
  browser ships it, (b) a real user requests it, or (c) it appears
  in EDPB guidance as a recognised Art. 21(5) signal. Implementation
  estimate: half a day, additive, no architectural impact.
- **W3C `navigator.consent`** once it reaches Candidate Recommendation
  with at least one shipping browser implementation. Likely a
  superset of the GPC integration point.

**Tier 3 — deferred.**
- **ConStand / § 26 TDDDG integration.** Skip until one of:
  - The April 2027 federal evaluation makes participation mandatory.
  - A user with the Consenter Agent installed files an issue
    explicitly requesting support.
  - Material adoption emerges (a second recognised provider, or
    measurable user-side install base).
- We will not pursue BfDI accreditation as a recognised service
  ourselves. We are an open-source library author, not a regulated
  service operator; the legal-entity overhead is incompatible with
  the project's structure and mission.

## Consequences

### Positive

- **Low maintenance burden.** GPC is already in place; ADPC is
  additive at the same integration point if we add it later.
- **Aligned with the regulatory direction we believe is correct.**
  The EU's drift is toward open browser signals as the cleanest
  Art. 21(5) implementation. Vendors and CMPs supporting GPC end up
  with a cleaner story than vendors locked to a single PIMS.
- **No single-vendor coupling.** SimpleCMP doesn't acquire a
  dependency on Consenter's (or any one provider's) continued
  operation, accreditation, or pricing.
- **Honest with users.** We say what we support and why. Sites that
  need full § 26 compliance because of a specific legal advisor
  recommendation can document the gap and choose a paid commercial
  CMP that fits their threat model — that's not our market.

### Negative

- **Visitors using the Consenter Agent still see our banner**, on
  sites that run SimpleCMP, until either we implement ConStand or
  the visitor opts out via GPC instead. The user base affected is
  small today but may grow.
- **If the federal evaluation makes § 26 binding** without a
  grace period for non-implementing CMPs, sites running SimpleCMP
  could be pushed toward commercial alternatives. Mitigation:
  reopen this ADR by Q1 2027 with the evaluation outcome and
  decide implementation effort then, with a year of runway before
  any binding date.
- **No "anerkannter Dienst" status.** Sites or legal advisors that
  treat § 26 recognition as a hard requirement (rather than a
  voluntary enhancement) will exclude SimpleCMP. We accept this.

### Neutral

- The decision is reversible at low cost. Adding ConStand later is
  additive work; it doesn't require unwinding any current
  architecture.
- This ADR replaces nothing — it documents an existing position
  (GPC was always in scope per REQ-5) and an explicit deferral
  (ConStand was never in scope but the question now has an answer).

## Triggers to revisit

This ADR should be reopened on any of:

1. **April 2027 BfDI / federal government evaluation outcome.**
   Especially if the evaluation recommends mandatory participation
   or extends the recognition framework to spec-conformant
   non-accredited implementations.
2. **A second recognised provider** appears in the BfDI register.
   Multi-vendor adoption shifts the cost-benefit on implementing
   ConStand because the user reach grows.
3. **A flagship browser ships ADPC** (Firefox, Chrome, Safari, or
   Edge enabling the signal by default or via prominent setting).
   Triggers the Tier-2 ADPC work.
4. **W3C `navigator.consent` reaches Candidate Recommendation** with
   at least one shipping browser implementation.
5. **An explicit user request** to add ConStand support, filed with
   a real use case (a site using SimpleCMP whose visitor base
   includes Consenter Agent users).

## References

- TDDDG § 25, § 26 — https://www.gesetze-im-internet.de/tddsg/
- EinwV — https://www.gesetze-im-internet.de/einwv/
- BfDI register of recognised consent management services —
  https://www.bfdi.bund.de/DE/Fachthemen/Inhalte/Telefon-Internet/Einwilligungsverwaltung/Einwilligungsverwaltung.html
- Consenter / ConStand — https://www.consenter.eu/about/open-access
- W3C `navigator.consent` draft —
  https://www.w3.org/community/consent/
- GPC specification — https://globalprivacycontrol.org/
- ADPC specification — https://www.dataprotectioncontrol.org/spec/
- Internal background note (in-tree research summary, 2026-05-21)
- REQ-5 (GPC support requirement) — `docs/requirements.md`
