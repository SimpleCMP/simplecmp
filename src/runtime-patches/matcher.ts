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
 * Match grammar:
 *
 *     matcher     := host-pattern [ path-prefix ]
 *     host-pattern := exact-host | "*." apex
 *     path-prefix  := "/" …
 *
 * Path-scoped claims (`www.google.com/maps/`) are split off at build
 * time and checked before any host-only claim. Host-only claims use the
 * server-side HostMatcher's ordering: exact/regex host patterns first,
 * then `*.apex` wildcards — so an exact `maps.google.com` beats a
 * generic `*.google.com` even when the generic service is listed first.
 *
 * Asymmetry with `originMatches`: `originMatches` DEGRADES to the host
 * half when the caller knows no path, because a host-only caller asks
 * "which services can live here?". This matcher must return exactly one
 * service and therefore SKIPS path-scoped claims it cannot verify — an
 * unverifiable claim must not beat a verifiable host-only match.
 *
 * Same-origin / allowlisted hosts are NOT this matcher's concern —
 * `decideBlock` filters them out before calling here.
 */

import {
  hostPatternMatches,
  isPathScopedMatcher,
  originMatches,
  pathPrefixMatches,
  splitOriginMatcher,
} from '../recorder/classifier.js';
import type { OriginMatcher } from '../recorder/types.js';

interface ServiceWithOrigins {
  name: string;
  origins?: readonly OriginMatcher[];
}

interface PathScopedClaim {
  name: string;
  hostPattern: string;
  pathPrefix: string;
}

interface HostOnlyClaim {
  name: string;
  matcher: OriginMatcher;
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
): (host: string, path?: string | null) => string | null {
  // Partition once at build time; the returned matcher runs on every
  // URL setter and fetch call.
  const pathScoped: PathScopedClaim[] = [];
  const exactHostOnly: HostOnlyClaim[] = [];
  const wildcardHostOnly: HostOnlyClaim[] = [];

  for (const service of services) {
    if (!service.origins || service.origins.length === 0) continue;
    for (const matcher of service.origins) {
      if (matcher instanceof RegExp) {
        exactHostOnly.push({ name: service.name, matcher });
        continue;
      }
      if (typeof matcher !== 'string') continue;

      if (isPathScopedMatcher(matcher)) {
        const [hostPattern, pathPrefix] = splitOriginMatcher(matcher);
        // The guard above means pathPrefix is never null here; the
        // explicit check keeps the tuple type usable under strict mode.
        if (pathPrefix !== null) {
          pathScoped.push({ name: service.name, hostPattern, pathPrefix });
        }
        continue;
      }

      if (matcher.startsWith('*.')) {
        wildcardHostOnly.push({ name: service.name, matcher });
      } else {
        exactHostOnly.push({ name: service.name, matcher });
      }
    }
  }

  const blockAllUnknown = options.blockAllUnknown === true;

  return (host, path) => {
    if (host === '') return null;

    // Most specific first: claims that name a path beat host-only
    // claims. They are skipped when no path was supplied because they
    // cannot be verified against a real pathname.
    if (path !== null && path !== undefined) {
      for (const claim of pathScoped) {
        if (
          hostPatternMatches(host, claim.hostPattern) &&
          pathPrefixMatches(path, claim.pathPrefix)
        ) {
          return claim.name;
        }
      }
    }

    // Exact and regex host patterns are more specific than `*.apex`
    // wildcards. Each group is still walked in config order.
    for (const claim of exactHostOnly) {
      if (originMatches(host, claim.matcher)) return claim.name;
    }
    for (const claim of wildcardHostOnly) {
      if (originMatches(host, claim.matcher)) return claim.name;
    }

    return blockAllUnknown ? host : null;
  };
}
