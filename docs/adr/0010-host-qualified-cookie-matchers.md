# 0010. Host-qualified cookie matchers in the service-DB protocol

- **Status:** accepted (shipped 2026-05-18 — `LocalClassifier`
  observed-origins state + `enrichDetection`-on-late-host-arrival
  pathway, `LayeredClassifier` re-validation against Service-DB
  responses, `DetectionListPresenter::cookieMatches` BE-side parity,
  cross-classifier parity fixture covering literal / regex / object
  matcher forms)
- **Date:** 2026-05-17
- **Deciders:** Ilja Melnicenko
- **Related:** ADR-0004 (recorder architecture), ADR-0005 (service-DB
  protocol), ADR-0009 (`detectionSettled` event)

## Context

The service-DB protocol's `matches.cookies` is a name-only matcher
list: strings for exact match, slash-bounded strings for regex. The
recorder's cookie watcher reads `document.cookie` and emits a
`cookie:<name>` detection; the classifier matches that against each
service's `matches.cookies` array.

This works well for cookie names that are distinctively associated
with one vendor — `_ga`, `_fbp`, `__hs_*`, `intercom-session-*`.
Visit a site that doesn't use Google Analytics; you probably won't
encounter a cookie called `_ga`.

It works poorly for **short or generic cookie names**. A survey of
the Open Cookie Database (OCD) 2026-01-21 snapshot (the basis for
the v0.2 services-library expansion — see
`simplecmp/services-library/docs/ocd-import-plan.md`) found 164
literal cookies of 1-3 characters attributed to well-known services:

| Service | Generic cookies (sample) |
|---|---|
| Bing / Microsoft | `MR`, `MC0`, `MC1`, `MH`, `CC`, `BCP`, `BFB`, `ACL` |
| Facebook | `aks`, `csm`, `fr`, `ick`, `lu`, `oo`, `pl`, `rc` |
| Google | `A`, `AID`, `DV`, `NID`, `OTZ`, `SID` |
| Yahoo | `A1`, `A1S`, `A3`, `GUC`, `OTH`, `cmp`, `rxx` |
| Adform | `C`, `CM`, `GCM`, `TPC`, `cid`, `uid` |
| Stripe | `m` (set by `m.stripe.com` per OCD) |
| GTM | `td` (set by `www.googletagmanager.com` per OCD) |

A site that happens to use a cookie called `m` for its own purposes,
or `cid` for a CDN session, or `id` for absolutely anything, would
be misclassified as Stripe / Adform / dozens of other services with
the current name-only matching.

Importing OCD with name-only matching either:

- floods the consent UI with false positives (classify everything),
- drops these cookies from the library (lose 87% of the OCD long-tail
  unlock — 143 of those 164 rows have a clean Domain field that
  could disambiguate), or
- punts to per-site hand-curation (the situation today).

A protocol extension that lets services declare *"this cookie is
mine when the visitor's browser also observed this origin"* changes
the trade-off: short generic cookies stay classified, but only when
there is concrete evidence the relevant third party is actually
loaded on the page.

## Decision

Extend the service-DB protocol so each entry in `matches.cookies`
may be either:

- A **string** (current behaviour) — exact name match for plain
  strings, regex for slash-bounded strings. Unchanged.
- An **object** of the shape:

  ```jsonc
  { "name": "<cookie name or /regex/>", "requireOrigin": "<host>" }
  ```

  The matcher fires only if the cookie name (or regex) matches AND
  the recorder has observed `requireOrigin` in the current session
  via any watcher (DOM, network, …).

The `requireOrigin` value uses the same syntax as `matches.origins`
items: plain host, `*.suffix` wildcard, or `/regex/`. Most uses will
be a plain host because that's what OCD's Domain field provides;
the wildcard and regex forms are available for cases where a service
loads from multiple equivalent hosts.

### Recorder classifier changes

The recorder already tracks observed detections; the classifier
gains a small derived view — `observedOrigins: Set<string>` — that
is appended to as origin / request / script / iframe / image
detections arrive. The cookie classifier consults this set when
deciding whether a host-qualified rule fires.

Ordering edge case: a cookie observed *before* its qualifying origin
fires gets a `status: 'unknown'` initial announcement. When the
qualifying origin then arrives, the classifier re-classifies the
cookie and re-dispatches via the existing enrichment pathway
(`Recorder.enrichDetection`, ADR-0009) — same mechanism used today
for late-arriving Service-DB lookups. The `'detectionSettled'`
event then fires with the enriched state.

### Library data emission

The bundled services-library only emits the object form when:

1. The cookie is "generically named" by some heuristic — for the
   first batch, "literal cookie ≤ 3 chars". Services with their own
   already-distinctive names (`_ga`, `_fbp`, `intercom-session-`)
   keep using the string form. The threshold may change as the
   library curates more entries.
2. The data source provides a credible origin — for the OCD
   importer, this means the row's `Domain` field is a clean
   hostname.

When either condition is missing, the cookie is emitted as a plain
string (and the existing false-match-risk warning applies) or
omitted (when the curator deems the risk too high).

### Backwards compatibility

Services that don't use host-qualified matchers (every existing
hand-curated entry as of v0.1) keep working unchanged. Consumer
plugins that have not been updated treat object entries as
"unknown matcher shape, skip" — they degrade to "this cookie won't
be matched" rather than throwing. The library's TypeScript types
flag the union (`string | { name: string; requireOrigin: string }`)
so newer JS code reads both shapes safely.

This is a *minor* protocol bump: producers may emit the new shape,
older consumers safely ignore it. No protocol-version constant
needs to change.

## Consequences

### Positive

- Imports the OCD long-tail safely. ~143 generic cookies that would
  otherwise have been dropped (or shipped with false-match risk) are
  classifiable when their setting host is observed.
- Future re-imports keep benefiting — the translator emits
  host-qualified matchers from OCD's existing Domain column.
- The same mechanism unlocks hand-curated entries with short cookies
  the curator was previously uncomfortable shipping name-only
  (e.g. `_fbp` is safe today because it's distinctive, but
  Facebook's `fr` was not — host-qualifying on
  `connect.facebook.net` opens it up).
- Symmetric with `matches.origins` syntax. No new vocabulary.

### Negative

- The recorder now keeps stateful "observed origins" per session.
  Memory cost: a Set of host strings, bounded by the number of
  unique hosts on the page. In practice tens of strings, kilobytes
  at most.
- A cookie observed before any request to its setter host (e.g. a
  cookie persisted from a previous visit, with no fresh script load)
  stays `unknown` for the session. Workaround: site loads SOME
  resource from the host eventually → re-classify. Worst case is the
  same as today (cookie stays unknown).
- Object-form matchers are heavier to author by hand. Hand-curators
  weighing whether to use them have to look up the setter host
  rather than just typing a name. Mitigation: only the bulk-importer
  is meaningfully affected; hand-curators continue using string
  matchers for distinctive cookie names.
- Service-DB providers serving the protocol over the wire emit the
  object form when their data supports it. Older client libraries
  (pre-this-ADR JS releases) ignore the object entry rather than
  matching on it. Net effect: same as today on old clients — the
  cookie stays unknown. Acceptable in pre-1.0.

### Neutral

- The threshold for "generically named" is a heuristic, not part of
  the protocol — different curators may apply different rules. The
  protocol just provides the *mechanism*; the policy is per-library.
- Hand-curators can still emit plain string matchers for cookies
  that happen to be short but distinctive (`_ga` is short but unique
  to Google Analytics in practice). The object form is opt-in.

## References

- `simplecmp/services-library/docs/ocd-import-plan.md` — drove the
  motivating need to safely import OCD's generic-cookie rows.
- ADR-0005 — Service-DB protocol shape that this amends.
- ADR-0009 — `detectionSettled` and the enrichment dispatch the
  re-classify path piggybacks on.
- `docs/service-db-protocol.md` — wire-format reference; update
  `matches.cookies patterns` section when this ADR ships.
