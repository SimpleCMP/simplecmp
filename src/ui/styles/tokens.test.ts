import { describe, expect, it } from 'vitest';
import { SimpleCmpPurposeGroup } from '../components/purpose-group.js';
import { SimpleCmpServiceToggle } from '../components/service-toggle.js';
import { baseTokens, tokens } from './tokens.js';

/**
 * Guards the `config.theme` nested-component theming fix
 * (docs/issue-config-theme-nested-components.md).
 *
 * The bug: a component rendered inside another component's shadow root that
 * re-declares `--simplecmp-*` on its own `:host` pins itself to the defaults,
 * blocking an adapter/host override from inheriting across the shadow
 * boundary. The fix: nested components consume the tokens via `baseTokens`
 * (no defaults) and inherit them from their parent host.
 */

function cssTextOf(styles: unknown): string {
  const arr = Array.isArray(styles) ? styles : [styles];
  return arr
    .map((s) =>
      s && typeof s === 'object' && 'cssText' in s
        ? String((s as { cssText: unknown }).cssText)
        : ''
    )
    .join('\n');
}

describe('design tokens — token split for nested-component theming', () => {
  it('`tokens` (theming roots) declares the --simplecmp-* defaults', () => {
    expect(tokens.cssText).toContain('--simplecmp-color-primary:');
    expect(tokens.cssText).toContain('--simplecmp-color-text:');
  });

  it('`baseTokens` declares NO --simplecmp-* token (only consumes via var)', () => {
    // A "--simplecmp-x:" declaration here would re-introduce the bug. The
    // base block only *uses* tokens inside var(...), never declares one.
    expect(baseTokens.cssText).not.toMatch(/--simplecmp-[a-z-]+\s*:/);
  });

  it('nested components use baseTokens — they never re-declare token defaults', () => {
    for (const Component of [SimpleCmpServiceToggle, SimpleCmpPurposeGroup]) {
      const text = cssTextOf(Component.styles);
      // If any --simplecmp-* default is declared on these nested hosts, an
      // adapter/override on the modal host can't reach them — the bug.
      expect(text, `${Component.name} must not declare --simplecmp-* defaults`).not.toMatch(
        /--simplecmp-[a-z-]+\s*:/
      );
    }
  });
});
