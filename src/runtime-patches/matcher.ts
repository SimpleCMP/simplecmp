/**
 * Build a host → serviceName matcher for the runtime patches from the
 * `config.services` array (ADR-0013, Phase 2 productionisation).
 *
 * Source of truth is the **configured services list**, not the bundled
 * `simplecmp/services-library`. Rationale: the engine can only ask the
 * visitor for consent for services that exist in the config — so the
 * runtime patches must scope to the same set, otherwise we'd silently
 * drop JS-injected calls to trackers the visitor has no way to consent
 * to. The server-side rewriter is the broader net (it carries the full
 * library); the FE patch is the narrower net (catches JS-injected
 * calls for configured services).
 *
 * Wildcard semantics match `recorder/classifier.ts::originMatches` —
 * imported directly, so all three layers (rewriter, recorder, runtime
 * patches) classify hosts identically.
 */

import { originMatches } from '../recorder/classifier.js';
import type { OriginMatcher } from '../recorder/types.js';

interface ServiceWithOrigins {
  name: string;
  origins?: readonly OriginMatcher[];
}

/**
 * Returns a function that resolves a host to the *first* service in
 * `services` whose `origins` matches, or `null` if no service matches.
 *
 * Services without an `origins` field are skipped — those services
 * don't represent third-party network endpoints (e.g. functional
 * cookies set by the host page itself).
 */
export function buildHostMatcher(
  services: readonly ServiceWithOrigins[]
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

  return (host: string): string | null => {
    if (host === '') return null;
    for (const service of indexed) {
      for (const matcher of service.origins) {
        if (originMatches(host, matcher)) return service.name;
      }
    }
    return null;
  };
}
