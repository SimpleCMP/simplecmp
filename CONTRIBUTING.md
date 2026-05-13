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
