# 0002. Fork Klaro! as the consent UI engine

- **Status:** superseded by [ADR-0006](0006-hard-fork-from-klaro.md)
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler

> **Note:** This ADR was the original "soft fork" decision — keep Klaro
> in `src/core/`, log every divergence, retain the option to merge
> upstream fixes. After ~12 months of practice, the cost of that
> discipline outweighed its (unrealised) benefits. ADR-0006 supersedes
> this by hard-forking — full UI rewrite with no upstream-tracking
> obligation. The original decision text is preserved below as a
> historical record.

## Context

SimpleCMP needs a consent UI that handles the well-understood mechanics of consent
collection: rendering a banner, showing a preference center, persisting choices,
respecting Do Not Track, and so on. This is solved territory — re-implementing it from
scratch would waste effort and introduce bugs that established projects have already
fixed.

The candidate engines we considered:

- **Klaro!** by KIProtect GmbH (Berlin) — BSD-3-Clause, vanilla JS, mature, with
  existing CMS integrations (Contao, TYPO3, Silverstripe community plugins). Active
  maintenance.
- **vanilla-cookieconsent** by Orest Bida — MIT, well-maintained, lightweight. Smaller
  surface than Klaro.
- **Cookie Consent by Osano** — MIT, but Osano's commercial product overshadows the
  open-source library; less active.

Klaro! emerged as the strongest base because it's actively maintained, has the most
complete UI feature set, comes from a German privacy-engineering company (matches
SimpleCMP's DACH focus), and is BSD-3-Clause (compatible with our intended licensing).

The remaining question was: depend on Klaro as an npm package, or fork the source into
SimpleCMP?

## Decision

We fork Klaro! into `src/core/` rather than depending on it as a package.

The reason: SimpleCMP's design adds a record mode, a service-DB integration, and a CMS
bridge — all of which require deep hooks into the consent UI's lifecycle. Modifications
to Klaro!'s rendering, storage, and event hooks are expected to be substantial.
Maintaining these as patches against an external dependency would be fragile.

We preserve the original BSD-3-Clause copyright header on every file derived from
Klaro!, and we preserve the upstream license text in `LICENSE-KLARO`. Modifications get
a `// SimpleCMP modification:` note. Substantial divergences are logged in
`docs/upstream-tracking.md` (to be created when needed).

## Consequences

### Positive

- Full control over the consent UI internals — we can refactor freely without breaking
  upstream's public API.
- Recorder, service DB, and CMS bridge can hook into any internal lifecycle event.
- No runtime dependency on Klaro!'s npm package, which simplifies the dependency tree.

### Negative

- Security fixes from upstream Klaro! must be evaluated and backported manually.
- We take on the maintenance burden for the consent UI itself, including browser
  compatibility and accessibility.
- Future major upstream changes can't simply be `pnpm update`d in.

### Neutral

- License compatibility is preserved (BSD-3 + BSD-3 = BSD-3).
- We will track upstream releases and document divergences explicitly so we can decide
  case-by-case whether to backport.

## References

- Klaro! upstream: https://github.com/KIProtect/klaro
- KIProtect GmbH: https://kiprotect.com
- BSD-3-Clause license: https://opensource.org/license/bsd-3-clause/
