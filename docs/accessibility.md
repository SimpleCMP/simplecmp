# SimpleCMP — Accessibility (REQ-6)

This document captures SimpleCMP's accessibility posture: what we audited, what
we changed, and what's left for manual review or theming decisions. Tied to
[REQ-6](requirements.md#req-6--accessibility-wcag-21-aa).

Target: **WCAG 2.1 AA** for the default theme + the consent UI shipped from
`src/core/`. Custom themes are users' responsibility but should follow the
same checks.

## How this audit was done

- Code review of `src/core/components/*.jsx` for ARIA, focus management, and
  keyboard handlers.
- Code review of `src/core/scss/*.scss` for focus indicators, color contrast,
  and motion.
- Manual contrast calculation against the default Klaro theme tokens.
- Automated tests cover the parts that are testable in happy-dom (no
  visual/contrast assertions; see "Manual checks" below).

Automated axe-core scan via Playwright runs on every CI build (see
`tests/a11y/` + the `a11y` job in `.github/workflows/ci.yml`). It scans
demos 1 / 4 / 5 / 6 (the ones with no external resources, which would
otherwise make the suite flaky on CI network blips) under WCAG 2.1 AA
rules. The `color-contrast` rule is disabled with a documented brand
exception for the `green1` button color (see "Color contrast" below).
Blocking severity is `serious` or `critical`; `moderate` / `minor`
violations are logged but don't fail CI.

## What Klaro upstream provided

| Aspect | Status before SimpleCMP |
| --- | --- |
| `role="dialog"` on the modal | ❌ missing |
| `aria-modal="true"` | ❌ missing |
| `aria-labelledby` on modal | ❌ missing |
| Modal focus on mount | ⚠️ focused the close button (destructive target) |
| Focus restore on close | ❌ missing |
| Focus trap (Tab cycling) | ❌ missing |
| Escape to close | ❌ missing |
| Notice has `role="dialog"` + aria | ✅ present |
| Notice focus on mount | ✅ via `noticeRef.focus()` |
| Close button has `aria-label` | ✅ via translation `close` |
| `:focus-visible` ring | ❌ relies on browser default — invisible against dark theme |
| `prefers-reduced-motion` | ❌ ignored (Klaro has switch + control transitions) |
| Color contrast — text on `dark1` (#333) | ✅ ≈ 12.6:1 (AAA) |
| Color contrast — white on `green1` (#15775a) | ✅ ≈ 5.3:1 (passes 4.5:1) |
| Color contrast — white on `red1` (#da2c43) | ✅ ≈ 4.6:1 (just passes 4.5:1) |

## What SimpleCMP changed (REQ-6)

### Modal (consent-modal.jsx)

- Modal wrapper carries `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="simplecmp-modal-title"`, and `tabindex="-1"` so it can
  receive focus programmatically without being in the Tab order.
- The title `<h1>` carries `id="simplecmp-modal-title"`.
- `componentDidMount` records `document.activeElement` (so we can restore on
  close) and shifts focus to the modal wrapper instead of the close button.
- A `keydown` handler on `document` handles:
  - **Escape** — closes the modal, but only when `!config.mustConsent`
    (mirrors the close button's existing behaviour).
  - **Tab / Shift+Tab** — implements a focus trap by intercepting the keydown
    when focus is on the last/first focusable element and jumping to the
    other end. Standard modal-dialog pattern.
- `componentWillUnmount` removes the keydown handler and restores focus to
  the previously-focused element if it's still in the DOM.

The `consentModalRef` ref previously pointed at the close button; we don't
keep it on the close button anymore because focusing a destructive element
is a poor default — `Enter` or `Space` would close the dialog the user just
opened.

### Styles (klaro.scss)

- Added a `:focus-visible` rule (within the `.klaro` scope) on `button`, `a`,
  and `input` that draws a `2px` solid outline in `green1` with a 2px offset.
  Visible against both dark and light backgrounds.
- Added a `prefers-reduced-motion: reduce` block (within `.klaro`) that
  forces `transition-duration` and `animation-duration` to near-zero across
  all descendants. Klaro's switch toggles, modal transitions, and control
  animations all respect this without per-rule changes.
- The floating trigger from REQ-4 already had its own reduced-motion block
  and `:focus-visible` rule; nothing changed there.

### What we did **not** change

- **Color tokens** (`green1`, `red1`, `dark1`, ...). The borderline contrast
  on `green1` (success buttons) is documented but left for theming
  decisions. Changing the brand colors site-wide is its own discussion;
  themers who need strict AA can override `--green1` (CSS custom property)
  to e.g. `#0f7458` (≈ 5.4:1 against white).
- **Notice-banner accessibility**. Already in good shape from upstream
  (role, aria, focus). No changes needed for REQ-6.

## Acceptance Criteria coverage

| REQ-6 criterion | Where covered |
| --- | --- |
| Focus trap in modal | `consent-modal.jsx` `_handleTabKey` |
| First focusable on open | `consent-modal.jsx` `componentDidMount` (focuses modal wrapper, user Tabs from there) |
| Focus restore on close | `consent-modal.jsx` `componentWillUnmount` |
| Visible focus ring on all interactive elements | `klaro.scss` `:focus-visible` rule |
| Buttons have aria-label / text | Verified via audit; no icon-only buttons in default UI |
| Color contrast ≥ 4.5:1 text / 3:1 UI | Documented above; `green1` text contrast left to themer |
| `prefers-reduced-motion` respected | `klaro.scss` `@media` block |
| `Esc` closes modal | `consent-modal.jsx` keydown handler (when `!mustConsent`) |

## Manual checks (not automated)

Run these manually before each release. Tracked via `docs/accessibility.md`.

### Color contrast

The default Klaro theme:

| Foreground | Background | Ratio | WCAG AA result |
| --- | --- | --- | --- |
| `#fff` | `#333` (`dark1`) | 12.63:1 | ✅ AAA |
| `#fff` | `#404040` (`dark2`) | 10.37:1 | ✅ AAA |
| `#fff` | `#15775a` (`green1`) | 5.30:1 | ✅ passes 4.5:1 |
| `#fff` | `#da2c43` (`red1`) | 4.61:1 | ✅ passes 4.5:1 |

All foreground/background pairs in the default theme now pass WCAG AA
for normal text. The previous `green1` value (`#1a936f`, 3.51:1) was
darkened to `#15775a` to clear the 4.5:1 threshold; themers overriding
`--simplecmp-color-primary` need to verify their own contrast.

### Screen reader walkthrough

Before each release, walk the consent flow with NVDA (Windows) or VoiceOver
(macOS):

- [ ] Page loads; consent notice is announced as a dialog with title + body.
- [ ] Tab order in notice: title → description → learn-more → decline → accept.
- [ ] Activating "learn more" announces the modal's title.
- [ ] Tab in modal cycles through services, footer buttons, close button.
- [ ] Shift+Tab from first element wraps to last.
- [ ] Esc returns to whatever was focused before opening the modal.
- [ ] Floating trigger (REQ-4) is announced with its label, opens modal on
      Enter/Space.

### Browser focus-indicator visibility

In a real browser, Tab through the consent UI in:

- [ ] Light theme — focus ring visible against light backgrounds.
- [ ] Dark theme — focus ring visible against dark backgrounds.
- [ ] High-contrast mode (Windows) — focus ring respected, no invisible
      outlines.

## Open items

- [x] Add `axe-core` scan to CI via Playwright. Block PRs on regressions.
      Shipped 2026-05-13 — see `tests/a11y/` and the `a11y` job in
      `.github/workflows/ci.yml`.
- [ ] Color contrast: pick a darker green default (`green1` ≈ `#0f7458`) so
      the out-of-the-box theme passes AA without theming. Decide separately
      from REQ-6 — affects brand look.
- [x] Notice (`src/ui/components/banner.ts`, formerly the Klaro
      `consent-notice.jsx`) intentionally does not trap focus and has no
      Esc handler. Reason: it's a non-modal overlay — a hard focus trap
      would block legitimate site interaction, and Esc-to-decline would
      silently make a destructive consent decision. The class-level
      JSDoc on `SimpleCmpBanner` documents this. Decision closed
      2026-05-13.
- [x] Floating trigger (REQ-4): default label `"Cookie settings"` is
      English-only. README quick-start now points integrators of
      localized projects at `floatingTrigger.label` for explicit
      translation. The JSDoc on the config field already covered this;
      the README mention catches readers who don't drill into the type.
      Closed 2026-05-13.
