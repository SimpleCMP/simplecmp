/**
 * Config helpers — service-purpose extraction and a (deeply) recursive
 * object-merge that's distinct from the Map-based `update` in `./maps.ts`.
 *
 * Re-exported by Klaro's `lib.js` as `updateConfig`. The signature is
 * `(target, source, overwrite?)` — note the parameter order differs from
 * `maps.update` (`(target, source, overwrite, clone)`); they're not
 * interchangeable.
 */

/** Loose service shape — only `purposes` matters here. */
export interface ServiceLike {
  purposes?: string[];
}

/** Loose config shape — `services` is the only field we read. */
export interface ConfigLike {
  services: ServiceLike[];
}

/** Collect the unique list of purposes referenced by any configured service. */
export function getPurposes(config: ConfigLike): string[] {
  const purposes = new Set<string>();
  for (const service of config.services) {
    const servicePurposes = service.purposes ?? [];
    for (const purpose of servicePurposes) {
      purposes.add(purpose);
    }
  }
  return Array.from(purposes);
}

/**
 * Recursively merge `source` into `target`. Mutates `target` and returns it.
 *
 * - String values: assigned (or skipped if `overwrite=false` and target
 *   already has the key).
 * - Object values: recurse if both sides are objects; otherwise assign.
 * - Other primitive types: ignored (matches the original JS semantics).
 */
export function update<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
  overwrite = true
): T {
  const targetRecord = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    // Defense-in-depth against prototype pollution: `JSON.parse` materialises
    // `__proto__` (and `constructor`/`prototype`) as own enumerable keys, so a
    // crafted config object could otherwise walk into Object.prototype here.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    const sourceValue = source[key];
    const targetValue = targetRecord[key];
    if (typeof sourceValue === 'string') {
      if (overwrite || targetValue === undefined) {
        targetRecord[key] = sourceValue;
      }
    } else if (typeof sourceValue === 'object' && sourceValue !== null) {
      if (typeof targetValue === 'object' && targetValue !== null) {
        update(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
          overwrite
        );
      } else if (overwrite || targetValue === undefined) {
        targetRecord[key] = sourceValue;
      }
    }
  }
  return target;
}
