# Contributing to SimpleCMP

Thank you for considering a contribution. SimpleCMP is in early development, so
contributions are especially welcome — but please open an issue to discuss substantial
changes before opening a PR.

## Development setup

```bash
git clone https://github.com/simplecmp/simplecmp.git
cd simplecmp
pnpm install
pnpm dev    # starts tsup in watch mode
```

In a second terminal:

```bash
pnpm test   # Vitest in watch mode
```

## Before opening a pull request

1. **Open an issue first** for any non-trivial change. This prevents wasted work if the
   change conflicts with planned architecture.
2. **Run the full pipeline locally**: `pnpm ci`. This is what CI runs.
3. **Add tests** for new features or bug fixes.
4. **Update the CHANGELOG** under `## [Unreleased]`.
5. **Update documentation** if you change public APIs.

## Commit message format

We use [Conventional Commits](https://www.conventionalcommits.org). Format:

```
type(scope): subject

body (optional)

footer (optional)
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`.

Common scopes: `core`, `recorder`, `service-db`, `themes`, `build`, `deps`, `docs`.

Examples:

```
feat(recorder): add MutationObserver-based script detection
fix(core): respect Do Not Track header
docs(adr): record decision to fork Klaro!
```

## Code style

- TypeScript with strict mode, no `any` unless justified
- Single quotes, semicolons, trailing commas where ES5 allows
- Run `pnpm check:fix` before committing — Biome handles both linting and formatting

## Working on forked Klaro! code

Code in `src/core/` derives from [Klaro!](https://github.com/KIProtect/klaro). When
modifying it:

- Attribution lives in `LICENSE-KLARO` at the project root (BSD-3 satisfies the
  notice-retention requirement). Klaro upstream files have no per-file copyright
  headers; don't add one unless you're making a substantial modification, in
  which case prepend a SimpleCMP header that names the upstream baseline.
- Add a `// SimpleCMP modification:` note above non-trivial inline changes.
- Don't reformat unmodified upstream code (makes future merges painful).
- Log substantial divergences in `docs/upstream-tracking.md`.
- For substantial divergences, log them in `docs/upstream-tracking.md`

## Translations and informal-tone packs

Two translation surfaces live in `src/engine/translations/`:

- `<lang>.json` — the **formal** register pack for each supported language. Klaro's
  upstream wording, lightly maintained. Editor changes should be cautious — they
  affect every formal-tone consumer.
- `informal/<lang>.json` — sparse **T-form** overlays (du/tu/tú/…) that an
  integrator opts into via `simplecmp.init({ tones: { de: 'informal' } })`. Only
  keys that differ from the formal register appear in the overlay; everything
  else falls through to the formal pack.

**Currently shipped informal packs:**

| Language | Status |
|---|---|
| `de` | reviewed |
| `fr`, `it`, `es`, `nl` | **draft — native-speaker review pending** (see [issue #2](https://github.com/SimpleCMP/simplecmp/issues/2)) |

**Contributing a review.** If you read one of the draft languages natively, the
pinned issue lists every string with an AI-assisted first-pass verdict and
concrete suggestions. The lowest-effort contribution is a comment saying "fr
section X.Y is fine as-drafted" or "swap line `…` for `…`". A PR is also welcome.

**Contributing a new language.** Drop `informal/<lang>.json` containing only the
dotted keys that differ from the formal register, register it in
`informal/index.ts`, and open a PR. The engine picks the new code up
automatically the moment a consumer sets `tones: { <lang>: 'informal' }`.

**Pattern lists for the heuristic audit** (in `src/audit/heuristics.ts`) follow
the same per-language contribution model — adding patterns for a new locale is
a data-only change.

## Reporting bugs

Open a [bug report](https://github.com/simplecmp/simplecmp/issues/new?template=bug_report.yml)
with:

- SimpleCMP version
- Browser & OS
- Minimal reproduction (CodeSandbox, StackBlitz, or repository link)
- Expected vs. actual behavior

## Feature requests

Open a [feature request](https://github.com/simplecmp/simplecmp/issues/new?template=feature_request.yml)
explaining the problem you're solving, not just the solution you have in mind. We may have
a different solution that solves the same problem.

## License

By contributing, you agree that your contributions will be licensed under the
[BSD-3-Clause License](LICENSE).
