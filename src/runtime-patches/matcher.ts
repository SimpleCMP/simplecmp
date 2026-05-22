/**
 * Build a host → serviceName matcher for the runtime patches from the
 * `config.services` array (ADR-0013, Phase 2 productionisation).
 *
 * Two modes:
 *
 * - **Narrow** (default) — resolves only hosts that match
 *   `config.services[].origins`. Hosts outside the configured set
 *   return `null` (pass-through). Used when integrators opt into
 *   `interceptRuntime: true` without `universalBlock`. The engine
 *   stays able to surface consent UI for every blocked host because
 *   each one corresponds to a real service in the config.
 *
 * - **Universal** (`{ blockAllUnknown: true }`) — same configured-
 *   service matching first, but falls back to **the host itself** as
 *   the synthetic service id for any non-matching host. Used when
 *   `simplecmp.universalBlocking.enabled` is on: admin opts into the
 *   strict "block everything third-party" posture, and the cost of
 *   broken-until-curated embeds is acceptable. The host shows up in
 *   the detection log; admin promotes via Kuratieren as usual.
 *
 * Wildcard semantics match `recorder/classifier.ts::originMatches` —
 * imported directly, so all three layers (rewriter, recorder, runtime
 * patches) classify hosts identically.
 *
 * Same-origin / allowlisted hosts are NOT this matcher's concern —
 * `decideBlock` filters them out before calling here.
 */

import { originMatches } from '../recorder/classifier.js';
import type { OriginMatcher } from '../recorder/types.js';

interface ServiceWithOrigins {
  name: string;
  origins?: readonly OriginMatcher[];
}

export interface BuildHostMatcherOptions {
  /**
   * Treat every host that doesn't match a configured service as
   * universally-blocked, returning the host itself as a synthetic
   * service id. Defaults to `false` (narrow mode — unknown hosts
   * pass through).
   */
  blockAllUnknown?: boolean;
}

/**
 * Returns a function that resolves a host to the *first* service in
 * `services` whose `origins` matches, the host itself if
 * `blockAllUnknown` is true, or `null` to pass through.
 *
 * Services without an `origins` field are skipped — those services
 * don't represent third-party network endpoints (e.g. functional
 * cookies set by the host page itself).
 */
export function buildHostMatcher(
  services: readonly ServiceWithOrigins[],
  options: BuildHostMatcherOptions = {}
): (host: string) => string | null {
  // Snapshot the (name, origins) pairs at build time — the patches call
  // this function on every URL setter / fetch call, and re-resolving
  // the array each time is wasteful.
  const indexed = services
    .filter(
      (s): s is ServiceWithOrigins & { origins: readonly OriginMatcher[] } =>
        Array.isArray(s.origins) && s.origins.length > 0
    )
    .map((s) => ({ name: s.name, origins: s.origins }));
  const blockAllUnknown = options.blockAllUnknown === true;

  return (host: string): string | null => {
    if (host === '') return null;
    for (const service of indexed) {
      for (const matcher of service.origins) {
        if (originMatches(host, matcher)) return service.name;
      }
    }
    return blockAllUnknown ? host : null;
  };
}
