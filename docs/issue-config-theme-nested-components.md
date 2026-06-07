# Issue draft: `config.theme` adapters don't theme nested components (purpose-group / service-toggle)

> Draft for filing against `SimpleCMP/simplecmp`. Labels: `bug`, `theming`.

## Summary

The framework adapters in `src/ui/themes/` (`bootstrap5`, `tailwind4`,
`bulma`, `pico`) only re-theme **top-level** components. Components
nested inside another component's shadow root keep the default tokens,
so picking a framework theme produces a visually inconsistent consent
UI — the banner and modal frame adopt the host framework's palette
while the per-service toggles and purpose groups inside the modal stay
on the default SimpleCMP green.

## Root cause

`src/ui/styles/tokens.ts` still declares every token on `:host`, e.g.:

```css
:host { --simplecmp-color-primary: #15775a; /* … */ }
```

The adapters set the same variables via **document-level tag
selectors** (`src/ui/themes/bootstrap5.ts`):

```css
simplecmp-banner, simplecmp-modal, simplecmp-purpose-group,
simplecmp-service-toggle, … { --simplecmp-color-primary: var(--bs-primary, …); }
```

The comment in `src/ui/themes/index.ts` ("CSS custom-property
inheritance crosses the shadow boundary, so a `<style>` block in
`<head>` is enough") only holds for top-level elements:

- **Top-level** (e.g. `<simplecmp-banner>`, a `document.body` child):
  the document `tag { --x }` rule overrides the component's own
  `:host { --x }` (outer-tree normal declarations beat inner-tree
  `:host`). ✅
- **Nested** (rendered inside another component's shadow root): the
  document selector can't match across the shadow boundary, **and**
  the nested component's own `:host { --x }` re-declaration blocks
  inheritance of the parent host's overridden value. ❌ Listing the
  nested tag name in the document stylesheet has no effect.

`src/ui/components/modal.ts` renders `<simplecmp-purpose-group>` and
`<simplecmp-service-toggle>` inside its own shadow template, so with
any non-default `config.theme` those elements (the bulk of the modal
body) are left un-themed.

## Minimal reproduction (real Chromium)

```html
<style> outer-cmp, inner-cmp { --x: ADAPTER; } </style>
<outer-cmp></outer-cmp>
<script>
  const tmpl = `<style>:host{--x:DEFAULT;}</style>`;
  class Inner extends HTMLElement { constructor(){super();this.attachShadow({mode:'open'}).innerHTML=tmpl;} }
  class Outer extends HTMLElement { constructor(){super();this.attachShadow({mode:'open'}).innerHTML=tmpl+'<inner-cmp></inner-cmp>';} }
  customElements.define('inner-cmp', Inner);
  customElements.define('outer-cmp', Outer);
  const o = document.querySelector('outer-cmp');
  console.log(getComputedStyle(o).getPropertyValue('--x'));                                       // " ADAPTER"
  console.log(getComputedStyle(o.shadowRoot.querySelector('inner-cmp')).getPropertyValue('--x')); // " DEFAULT"
</script>
```

## Suggested fix

Stop declaring defaults on `:host`; consume tokens with inline
fallbacks at the point of use instead, e.g.
`color: var(--simplecmp-color-text, #1a232c)`. With nothing setting the
property explicitly per-component, a single document-level override (or
a top-level `:host`) inherits cleanly through every shadow boundary,
and the adapters work everywhere. This is a ~30+ site change across the
components and should land in a coordinated bundle release.

> Note: the TYPO3 extension's `RegisterAssets::injectTheme()` already
> works around this for per-site color tokens by walking shadow roots
> and injecting an adopted stylesheet into each — but the upstream
> `config.theme` adapter is a pure head-`<style>` and doesn't.
