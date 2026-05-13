/**
 * Convert a kebab-case identifier into a Title Case label.
 *
 * `asTitle('first-party-analytics')` → `'First party-analytics'`. The
 * function only capitalises the first character of the first segment;
 * preserves the original idiom from the Klaro snapshot.
 */
export function asTitle(str: string): string {
  return str
    .split('-')
    .map((s) => s.slice(0, 1).toUpperCase() + s.slice(1))
    .join(' ');
}
