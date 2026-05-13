/**
 * Recursive Map helpers used by the translation merge in `src/index.ts` and
 * by Klaro's translation loader. We keep the shape and semantics of the
 * original JS — both functions are imported from JS and JSX call sites that
 * we don't want to retouch yet.
 */

/**
 * Recursively convert a plain object into a nested `Map`.
 * Strings (and `null`) are stored as-is; nested objects become nested Maps.
 */
export function convertToMap(d: Record<string, unknown>): Map<string, unknown> {
  const dm = new Map<string, unknown>();
  for (const key of Object.keys(d)) {
    const value = d[key];
    if (typeof value === 'string' || value === null) {
      dm.set(key, value);
    } else if (typeof value === 'object' && value !== null) {
      dm.set(key, convertToMap(value as Record<string, unknown>));
    }
  }
  return dm;
}

/**
 * Merge `ed` into `d`, recursively for nested Maps. By default `ed` overwrites
 * `d`; pass `overwrite=false` to keep existing keys. `clone=true` creates a
 * shallow copy of `d` before merging (keeping `d` itself untouched).
 *
 * Returns the merged Map (the original `d`, or its clone if `clone=true`).
 */
export function update(
  d: Map<unknown, unknown>,
  ed: Map<unknown, unknown>,
  overwrite = true,
  clone = false
): Map<unknown, unknown> {
  if (!(ed instanceof Map) || !(d instanceof Map)) {
    throw new Error('Parameters are not maps!');
  }
  const target = clone ? new Map(d) : d;

  const assign = (m: Map<unknown, unknown>, key: unknown, value: unknown): void => {
    if (value instanceof Map) {
      const cloned = new Map<unknown, unknown>();
      // deep-clone the nested map
      update(cloned, value, true, false);
      m.set(key, cloned);
    } else {
      m.set(key, value);
    }
  };

  for (const key of ed.keys()) {
    const value = ed.get(key);
    const dvalue = target.get(key);
    if (!target.has(key)) {
      assign(target, key, value);
    } else if (value instanceof Map && dvalue instanceof Map) {
      target.set(key, update(dvalue, value, overwrite, clone));
    } else if (overwrite) {
      assign(target, key, value);
    }
  }
  return target;
}
