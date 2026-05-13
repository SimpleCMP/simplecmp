# 0007. UI architecture — Lit-based Web Components, hybrid Shadow/Light DOM

- **Status:** accepted
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler

## Context

ADR-0006 commits us to rewriting the consent UI. This ADR fixes the
*how*: which technology, which DOM strategy, which API shape for
embedding the UI in a host page.

The constraints:

- **Framework-agnostic**: must work in vanilla HTML/JS (TYPO3 templates,
  WordPress themes), and not block React/Vue/Svelte consumers from
  using the SimpleCMP engine without our UI.
- **Modern**: uses platform features that have been stable for ≥ 2 years
  in evergreen browsers (no "let's wait for Baseline 2026").
- **Themable**: must support both Bootstrap-style (host CSS controls
  everything) and isolated-default-theme (host CSS doesn't bleed in)
  use cases.
- **Type-safe**: TypeScript, with reactive state and template typing.
- **Small runtime budget**: target < 30 KB for engine + UI gzipped.
- **Accessible**: must satisfy REQ-6 — `role="dialog"`, focus trap,
  Esc handling, prefers-reduced-motion.
- **Testable**: components should be unit-testable without spinning
  up a full browser.

## Decision

### Component framework: Lit

Web Components implemented with [Lit](https://lit.dev) (BSD-3-Clause).

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('simplecmp-banner')
export class SimpleCmpBanner extends LitElement {
  @property({ type: Object }) config!: SimpleCMPConfig;
  @state() private _confirmed = false;
  // ...
  render() { return html`...`; }
}
```

**Why Lit over alternatives:**

| | **Lit** | **Vanilla custom elements** | **Stencil** | **Solid Element** |
|---|---|---|---|---|
| Runtime | ~6 KB gzipped | 0 | ~30 KB | ~2 KB |
| TS support | First-class | DIY | First-class | First-class |
| Reactive state | Built-in (`@state`/`@property`) | Manual `attributeChangedCallback` | Built-in | Built-in |
| Templates | Tagged-template literals | innerHTML / DOM manipulation | JSX | JSX |
| Maturity | Google-backed, used at scale | Standard | Ionic | Smaller community |
| LOC for ~6 components | ~700 | ~1500–2000 | ~1000 | ~700 |
| License | BSD-3 | n/a | MIT | MIT |

Lit at 6 KB is a defensible cost for the LOC and DX savings. Vanilla
custom elements would add ~1300 LOC of boilerplate that we'd own and
maintain forever. Stencil's larger runtime defeats our bundle budget.
Solid is interesting but has a smaller community and no clear advantage
over Lit for our use case.

### DOM strategy: Shadow DOM by default, Light-DOM mode opt-in

Each component supports two rendering modes:

```html
<!-- Default: Shadow DOM, theme isolation, host CSS doesn't bleed in -->
<simplecmp-banner></simplecmp-banner>

<!-- Light DOM: host CSS applies directly, host classes can extend -->
<simplecmp-banner mode="light"></simplecmp-banner>
```

**Implementation**: each Lit component overrides `createRenderRoot()`:

```ts
protected createRenderRoot() {
  return this.getAttribute('mode') === 'light' ? this : super.createRenderRoot();
}
```

That's three lines per component, no other code changes.

**When Shadow DOM (default)**:

- Theme tokens via CSS Custom Properties: `--simplecmp-color-primary`,
  `--simplecmp-radius`, etc. Host overrides at any CSS scope.
- Default styling shipped in the component itself (`static styles = css\`...\``).
- Host's global CSS can't accidentally style our internals.

**When Light DOM (opt-in)**:

- Component renders into the regular DOM, host's CSS applies.
- For Bootstrap integration: host's `.btn`, `.btn-primary` etc. style
  our buttons directly — no CSS-Custom-Property bridge needed.
- Component still emits semantic classes (`simplecmp-banner-button`,
  `simplecmp-banner-decline`) so host CSS has predictable selectors.

The component lifecycle (state, events, slots) works identically in
both modes. The choice is purely presentational.

### Modal: native `<dialog>` element

We use the native HTML `<dialog>` element for the preferences modal.
[Browser support](https://caniuse.com/dialog) is at ~96% globally as
of 2026 (all evergreen browsers since 2022). Polyfill via
[dialog-polyfill](https://github.com/GoogleChrome/dialog-polyfill)
mounted lazily on detection of missing support, NOT shipped by
default — most consumers don't need it.

Native `<dialog>` gives us for free:

- `dialog.showModal()` traps focus and creates the backdrop.
- `Esc` key closes the modal.
- The `:modal` CSS pseudo-class applies the right styling state.
- Accessibility-tree behavior is correct out of the box (proper
  ARIA dialog semantics).

Klaro reimplemented all of this manually in `consent-modal.jsx`. We
don't need to.

### Theming: CSS Custom Properties only

No SCSS in `src/`. CSS is hand-written, parameterised entirely via
custom properties:

```css
/* Default theme — built into each component */
:host {
  --simplecmp-color-primary: #1a936f;
  --simplecmp-color-danger: #da2c43;
  --simplecmp-color-bg: #ffffff;
  --simplecmp-color-text: #1a232c;
  --simplecmp-radius: 6px;
  --simplecmp-spacing: 0.75rem;
  /* ... */
}

button.simplecmp-banner-accept {
  background: var(--simplecmp-color-primary);
  color: white;
  /* ... */
}
```

Bootstrap adapter is a separate CSS file that overrides custom
properties to pull from Bootstrap's tokens:

```css
/* dist/themes/bootstrap.css — opt-in */
:where(simplecmp-banner, simplecmp-modal) {
  --simplecmp-color-primary: var(--bs-primary);
  --simplecmp-color-danger: var(--bs-danger);
  --simplecmp-color-bg: var(--bs-body-bg);
  --simplecmp-color-text: var(--bs-body-color);
  --simplecmp-radius: var(--bs-border-radius);
}
```

That's the entire Bootstrap "adapter" — a stylesheet, not a code
fork. Tailwind, DaisyUI, custom themes work the same way: write
your own CSS file overriding the custom properties, ship it, done.

Build pipeline: drop `sass` dependency. CSS files are
authored in plain CSS, copied (or lightly minified by esbuild's
loader) into `dist/`.

### Component inventory

```
<simplecmp-banner>          ← REQ-1 / REQ-2 — initial consent notice
<simplecmp-modal>           ← REQ-6 — preference center, native <dialog>
<simplecmp-trigger>         ← REQ-4 — floating "cookie settings" button
<simplecmp-service-toggle>  ← service-level on/off control
<simplecmp-purpose-group>   ← group services by purpose
<simplecmp-policy-links>    ← REQ-1 — privacy + imprint links
```

Each is a custom element registered in the `simplecmp-` namespace.
The engine's `init()` instantiates them based on config; consumers
who want to render their own UI can subscribe to engine events
without touching these components at all.

### Engine ↔ UI communication

Components communicate with the engine via:

- **Properties**: `config` (read-only object passed in by `init()`)
- **CustomEvent dispatching**: components emit `simplecmp:accept`,
  `simplecmp:decline`, `simplecmp:save`, etc. The engine listens
  via the standard `addEventListener` API.
- **Engine subscription**: components subscribe to engine state
  changes (`engine.subscribe(callback)`) and re-render via Lit's
  reactivity when consent changes.

No prop-drilling, no virtual DOM diffing the engine's state — Lit's
reactive properties handle the "data in, render out" flow.

### Translations

Each component knows how to render translation keys via a small `t()`
helper, consistent across the codebase:

```ts
import { t } from '../engine/i18n.js';
render() {
  return html`<button>${t('acceptAll')}</button>`;
}
```

`t()` resolves against the active language's JSON file. German +
English are inlined; other languages are dynamic-imported on demand
when the active language switches. Falls back to English on missing
keys.

### Testability

Lit components are testable in three ways:

1. **Unit-test rendering**: instantiate `new SimpleCmpBanner()`,
   set properties, query the rendered shadow DOM.
2. **Integration-test interaction**: full component in a test fixture,
   click events, verify CustomEvent dispatch.
3. **Engine isolation**: test the engine without instantiating any
   UI components. We get this for free via the new `src/engine/`
   structure (ADR-0006).

happy-dom supports custom elements + shadow DOM out of the box, no
new test infrastructure needed.

## Consequences

### Positive

- **6 KB Lit runtime** is a small fixed cost; we save 1000+ LOC of
  custom-element boilerplate.
- **Native `<dialog>`** eliminates ~150 LOC of focus-trap/Esc/aria
  handling we'd otherwise re-implement (Klaro had this manually).
- **Hybrid DOM mode** gives Bootstrap users a no-code-changes
  integration path (Light DOM + Bootstrap stylesheet) and gives
  isolation-conscious users full theme encapsulation.
- **CSS Custom Properties** make theming trivial; Bootstrap adapter
  is one CSS file, not a fork.
- **Framework-agnostic**: any host page can `<simplecmp-banner>` in
  HTML, regardless of stack. Vue/React/Svelte don't need wrappers
  — Web Components are interoperable by spec.
- **Engine separation** is structural, not just discipline. Phase 4/5
  CMS plugins can `import { createEngine } from 'simplecmp/engine'`
  without dragging UI into their bundle.
- **Tests** become tractable — components testable in isolation,
  engine fully UI-free.

### Negative

- **Lit dependency** — one runtime dep we didn't have before. Mitigated
  by Lit's stability (Google-maintained, well-documented).
- **Web Components in IE11**: not supported. We don't care — Klaro
  also dropped IE11 in recent versions, and Phase 1 already
  required ES2020.
- **Shadow DOM debugging**: dev tools handle this well now, but it's
  a learning curve for contributors used to "open dev tools, find
  the element". The Light-DOM mode escape hatch helps.
- **CSS Custom Properties cascade through Shadow DOM**: this is the
  desired behavior, but consumers occasionally trip over the fact
  that *only* custom properties cross the boundary, not regular
  styles. The Light-DOM-mode flag is the answer for users who
  want full host-CSS access.
- **Dialog polyfill** is opt-in, not bundled. Consumers targeting
  pre-2022 browsers must opt in. Documented; not a real-world issue
  for SimpleCMP's target audience (modern German agency sites).

### Neutral

- **Bundle structure** changes: instead of one `simplecmp.global.js`
  for everything, we ship `simplecmp/engine` and `simplecmp/ui`
  as separate ESM entries (see ADR-0008).
- **i18n format** changes from YAML to JSON. Translation content
  is portable; the format swap is a one-time conversion.
- **Component API surface**: Web Components are "configured" via
  attributes/properties, not via a JS-only API. This affects how
  consumers script the UI. JSON-config-via-`init()` remains the
  primary path.

## References

- ADR-0006 — Hard-fork from Klaro (parent decision)
- ADR-0008 — ESM-only engine + ESM/IIFE for UI (follow-up build targets)
- [Lit documentation](https://lit.dev)
- [HTML `<dialog>` element on caniuse](https://caniuse.com/dialog)
- [WCAG 2.1 dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  — REQ-6 reference; native `<dialog>` satisfies all of it
- [dialog-polyfill](https://github.com/GoogleChrome/dialog-polyfill)
  — opt-in for pre-2022 browser support
