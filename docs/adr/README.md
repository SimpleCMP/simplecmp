# Architecture Decision Records

This directory contains [Architecture Decision Records](https://adr.github.io) (ADRs) for
SimpleCMP. Each ADR documents a significant architectural choice, the context in which it
was made, and its consequences.

## Format

We use [Michael Nygard's template](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md):

- **Title** — short noun phrase
- **Status** — proposed | accepted | deprecated | superseded
- **Context** — what's the issue we're seeing that motivates this decision?
- **Decision** — what is the change we're proposing or doing?
- **Consequences** — what becomes easier or harder as a result?

## Index

| #    | Title                                                          | Status   |
| ---- | -------------------------------------------------------------- | -------- |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md) | accepted |
| 0002 | [Fork Klaro! as the consent UI engine](0002-fork-klaro-as-engine.md)   | superseded by 0006 |
| 0003 | [Build targets — ESM, CJS, IIFE](0003-build-targets-esm-cjs-iife.md)   | superseded in part by 0008 |
| 0004 | [Recorder architecture](0004-recorder-architecture.md)               | accepted |
| 0005 | [Service DB protocol](0005-service-db-protocol.md)                   | accepted |
| 0006 | [Hard-fork from Klaro](0006-hard-fork-from-klaro.md)                 | accepted |
| 0007 | [UI architecture — Lit + Web Components](0007-ui-architecture-lit.md) | accepted |
| 0008 | [Build outputs — ESM-only engine](0008-build-targets-esm-only-engine.md) | accepted |
| 0009 | [Recorder `detectionSettled` event](0009-detection-settled-event.md) | accepted |
| 0010 | [Host-qualified cookie matchers](0010-host-qualified-cookie-matchers.md) | accepted |
| 0011 | [Browser-based consent signals — GPC primary, ConStand deferred](0011-browser-consent-signals.md) | accepted |
| 0012 | [Universal pre-consent blocking of third-party requests](0012-universal-pre-consent-blocking.md) | accepted (implementation gated post-1.0) |
| 0013 | [Implementation plan for universal pre-consent blocking](0013-universal-blocking-implementation-plan.md) | accepted (Phase 0 starts now, in parallel to 1.0) |
| 0014 | [Library service hosting](0014-library-service-hosting.md)           | accepted |
| 0015 | [Region-aware consent regimes (opt-in / opt-out)](0015-region-aware-consent-regimes.md) | accepted |

## Adding a new ADR

1. Copy `template.md` to `NNNN-short-title.md` where NNNN is the next number.
2. Fill in the sections.
3. Open a PR. ADRs are reviewed like code.
4. Once accepted, update the index above.
