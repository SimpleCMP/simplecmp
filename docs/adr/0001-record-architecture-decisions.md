# 0001. Record architecture decisions

- **Status:** accepted
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler

## Context

We need to record architectural decisions made on this project so future contributors —
human or AI — can understand the reasoning behind the codebase as it stands today, rather
than rediscovering it through trial and error.

Without ADRs, the rationale behind decisions tends to live only in chat logs, commit
messages, or in someone's head. When that knowledge is lost, the project drifts: new
contributors override old decisions without knowing why they existed, and the codebase
becomes harder to maintain.

## Decision

We will use Architecture Decision Records as described by Michael Nygard. ADRs live in
`docs/adr/`, are numbered sequentially, and are reviewed via pull request.

The template is in `docs/adr/template.md`.

## Consequences

### Positive

- New contributors can understand the project's history and rationale by reading the
  ADRs in order.
- AI-assisted contributions (e.g. via Claude Code) can be grounded in documented
  decisions rather than inferred patterns.
- Disagreements about architectural direction become explicit and reviewable.

### Negative

- Writing an ADR adds friction to making decisions. We accept this as a feature, not a
  bug — important decisions deserve deliberation.

### Neutral

- ADRs are immutable once accepted. To revise, write a new ADR that supersedes the old
  one and update the index.

## References

- Michael Nygard, "Documenting architecture decisions": https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- ADR community templates: https://github.com/joelparkerhenderson/architecture-decision-record
