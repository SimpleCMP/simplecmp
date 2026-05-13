# 0005. Service DB protocol

- **Status:** accepted
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler

## Context

REQ-8 introduces the **Service DB** — a registry of well-known cookies and
external services with vendor metadata. The Phase-2 recorder (REQ-7,
ADR-0004) classifies detections via the `LocalClassifier`, which only knows
about services the integrator has manually configured. The Service DB
extends classification with a shared registry: looked up by cookie name or
origin, returns vendor name, purposes, retention, privacy policy URL, and
descriptions.

The original Phase-3 framing implied a single SimpleCMP-hosted service.
That framing is wrong for two reasons:

1. **Customer reality**: agencies and inhouse devs are happiest when the
   data layer lives where they already operate. A WordPress plugin admin
   wants to manage services in the WP backend, served from the WP
   instance — not from a third-party DNS lookup. A TYPO3 site admin wants
   the same in TYPO3 Backend.
2. **Phase 5 readiness**: the CMS plugins (REQ-10) need a way to expose
   their site-local service registry to the SimpleCMP client. If the
   client only knows one canonical endpoint, CMS plugins can't fit.

So the Service DB needs to be a **protocol** — an HTTP/JSON contract — that
multiple backends can implement. SimpleCMP ships the frontend client and
a reference backend; CMS plugins implement the same contract their own
way; the public-hosted community DB (if it ever ships) is just one more
implementation.

This ADR fixes the protocol shape, the frontend-client behaviour, the
reference-backend layout, and the seed-data strategy — before we write
code, in the same way ADR-0004 handled the recorder.

## Decision

### A. Service DB is a contract, not a service

The Service DB is defined as an HTTP/JSON API specification (Section C
below). SimpleCMP ships:

- The protocol document (`docs/service-db-protocol.md` — the
  user-readable form of this ADR's section C).
- A frontend client (`src/service-db/`) that speaks the protocol.
- A reference backend (`reference-server/` in this repo, not part of the
  npm package) implementing the protocol with PHP + SQLite, runnable via
  ddev.

The Service DB is **not** a hosted service we operate. SimpleCMP's
`SimpleCMPConfig.serviceDbUrl` points at whichever endpoint the consumer
prefers — the reference backend on localhost, a community-hosted DB if it
exists, the consumer's own backend, or (in Phase 5) the CMS-plugin's
embedded endpoint.

### B. Versioning: path-based, `/v1/...`

All endpoints are prefixed with a major version, `/v1/services`,
`/v1/lookup`, etc. Breaking changes ship as `/v2/`. Two version trees can
coexist on the same backend during migration windows.

The frontend client pins to a specific major in code; consumers can
override via `serviceDbApiVersion: 'v1' | 'v2'` if needed. SimpleCMP
minor releases follow a predictable cadence: when `/v2/` ships, one
SimpleCMP minor adds support; the following minor switches the default;
`/v1/` support is removed in the next major.

### C. Endpoints

Four endpoints in `/v1/`:

```
GET  /v1/services                          → 200 ServiceList
GET  /v1/services?cookie=<name>            → 200 ServiceList (filtered)
GET  /v1/services?origin=<host>            → 200 ServiceList (filtered)
GET  /v1/services/:id                      → 200 ServiceDetail | 404
POST /v1/lookup                            → 200 LookupResult
     Body: { items: [{cookie?, origin?}] }
GET  /v1/health                            → 200 { ok: true, schemaVersion: 1, count: N }
```

`/v1/lookup` is the recorder's primary path: one HTTP roundtrip per
batch of detections rather than one-per-detection. The response is
positionally aligned with the request items so the client can match
back without bookkeeping.

`/v1/services` (without filter) is intended for browsing and admin UIs;
the recorder uses `/v1/lookup` exclusively.

### D. ServiceMatch / ServiceDetail shape

```jsonc
// ServiceMatch — returned from /v1/lookup and /v1/services
{
  "id": "google-analytics",                    // stable, kebab-case
  "name": "Google Analytics",                  // canonical English
  "vendor": "Google LLC",                      // legal name of the controller
  "vendorCountry": "US",                       // ISO 3166-1 alpha-2
  "purposes": ["analytics"],                   // SimpleCMP purpose taxonomy
  "privacyPolicyUrl": "https://policies.google.com/privacy",
  "description": "Tracks user behaviour across sessions for traffic analytics.",
  "retention": {
    "display": {
      "en": "26 months",
      "de": "26 Monate"
    },
    "durationDays": 791                         // optional, machine-readable
  },
  "i18n": {
    "name": { "de": "Google Analytics" },       // overrides for `name`
    "description": {
      "de": "Erfasst Nutzungsstatistiken über Sitzungen hinweg …"
    }
  },
  "matches": {                                  // why this entry matched the query
    "cookies": ["_ga", "_ga_*"],
    "origins": ["www.google-analytics.com", "*.googletagmanager.com"]
  },
  "extensions": {                               // plugin-defined, see section E
    "wordpress": { "gtm-id": "GTM-ABC123" }
  }
}

// ServiceDetail — same shape plus optional fields the lookup omits
//   (e.g., admin-edit metadata, full cookie list with descriptions per cookie).
//   Phase 3 keeps Detail and Match equivalent; Phase 5+ may diverge.

// ServiceList
{ "items": [ServiceMatch, ...], "total": N, "limit": N, "offset": N }

// LookupResult — positionally aligned with request items
{
  "items": [
    { "query": { "cookie": "_ga" },
      "matches": [ServiceMatch, ...] },
    { "query": { "origin": "hotjar.com" },
      "matches": [] }
  ]
}
```

**Localization rules**: the canonical fields (`name`, `description`,
`purposes`, `retention.display.en`) are required. Translations under
`i18n.*` and `retention.display.<lang>` are optional. Frontend lookup is
`i18n.name[lang] ?? name`. Missing translations fall back to the
canonical English; CMPs are responsible for showing this gracefully.

**Purposes** are a small fixed taxonomy: `functional`, `analytics`,
`marketing`, `personalization`, `security`, `advertising`. Custom
purposes go via `extensions.<vendor>.customPurposes` (Section E).

### E. Plugin extensions: reserved `extensions` namespace

Backends MAY include a top-level `extensions` object on any
`ServiceMatch`. Keys inside `extensions` SHOULD be vendor-prefixed
(e.g., `wordpress`, `typo3`, `acme-corp`) to avoid collisions. The
frontend client ignores the contents of `extensions` by default;
plugin-specific tooling reads what it knows.

The protocol does NOT prescribe what plugins put in their extension
keys — that's plugin authors' decision. Plugins MUST document their
extensions in their own docs.

We considered:

- **`x-` prefix on top-level fields** (OpenAPI style) — works, but
  scatters extensions across the schema and makes it harder to ignore
  unknowns wholesale.
- **Strict schema, no extensions** — best interop guarantee but blocks
  CMS-plugin innovation; everything has to round-trip through the
  SimpleCMP spec.

The reserved-namespace approach is the JSON-Schema convention (RFC 7807
problem types), gives CMS plugins room to evolve, and lets the frontend
ignore the entire blob safely.

### F. Read-only in Phase 3

The `/v1/...` endpoints are read-only: GET and POST-for-batch-read only.
There are no `PUT`, `DELETE`, or `POST`-for-write endpoints in the spec.

CMS plugins (Phase 5) implement admin write paths in whatever way fits
their CMS — TYPO3 Backend module, WP Settings page, Contao DCA. Those
admin paths are out of the SimpleCMP protocol scope. The plugin's
read API exposes the result via `/v1/services` to the frontend client.

A future "Admin API v2" ADR may revisit this if cross-CMS migration
tooling becomes a requirement. For now the simplest path: each CMS
admin works natively, the plugin's read-API serves the SimpleCMP
contract.

### G. Frontend client behaviour

`src/service-db/` ships a `ServiceDbClient` class with this surface:

```ts
interface ServiceDbClient {
  /** Look up a single detection. Cached; falls back to LocalClassifier on error. */
  lookup(query: { cookie?: string; origin?: string }): Promise<ServiceMatch | null>;
  /** Batched lookup. Single HTTP request. */
  lookupBatch(queries: Array<{ cookie?: string; origin?: string }>): Promise<Array<ServiceMatch | null>>;
  /** Drop the in-memory cache (and optionally localStorage cache). */
  clearCache(): void;
}
```

**Caching**: lookups are cached in `localStorage` under
`simplecmp.servicedb.<host>.<query-key>` with a TTL (default 24 h).
The TTL is overridden by HTTP `Cache-Control: max-age=<n>` headers
when present. Stale cache entries are returned immediately while a
revalidation request runs in the background (stale-while-revalidate).

**Fallback**: any non-2xx response, network error, timeout (default
3 s), or schema mismatch causes the client to silently fall back to
the `LocalClassifier` from Phase 2. Fallback is logged via a
`console.warn` once per session per error type — not per lookup.

**Classifier integration**: a new `LayeredClassifier` composes
`ServiceDbClient` + `LocalClassifier` and implements the same
`Classifier` interface from ADR-0004 section E. The recorder doesn't
change; it just receives a different classifier when `serviceDbUrl`
is configured.

```
config.serviceDbUrl set?
├── yes → recorder uses LayeredClassifier(ServiceDbClient, LocalClassifier)
│         (DB lookup first, local config wins on conflict)
└── no  → recorder uses LocalClassifier (Phase 2 behaviour, unchanged)
```

**Conflict resolution**: when both the local config and the Service DB
match a detection, **local wins**. Site-specific configuration is more
authoritative than a community registry; the DB only fills in gaps.

### H. Reference backend layout

`reference-server/` in this repo:

```
reference-server/
├── public/
│   └── index.php          ← single-file router (~150 LOC)
├── src/
│   ├── Database.php       ← SQLite wrapper, idempotent schema init
│   ├── Lookup.php         ← matching logic, mirrors LocalClassifier
│   └── Schema.php         ← service JSON validation
├── seeds/
│   ├── services/          ← one .json per service
│   └── README.md          ← contribution guide
├── tests/                 ← PHPUnit smoke tests for the endpoints
├── composer.json
├── .ddev/                 ← ddev config that sets up PHP 8.3 + SQLite
└── README.md              ← "ddev start, then point serviceDbUrl at it"
```

The directory is excluded from `package.json.files`, so the npm
package stays TypeScript-only. ddev users run `ddev start` from the
project root; the backend is reachable at e.g.
`https://servicedb.simplecmp.ddev.site/v1/services`.

PHP 8.3 + SQLite + `composer` only — no Symfony, no Slim, no
heavyweight framework. The router is hand-rolled (~6 routes, manageable).

If the reference backend grows (more endpoints, real seed-management
UI, releases of its own), we move it to a separate repo
`simplecmp-service-db-reference`. That migration is mechanical and
can wait until the need is clear.

### I. Seed-data strategy

**Phase 3 initial bootstrap** (~20-30 services): hand-curated list
covering the most commonly-used third parties on European sites:

- Google Analytics, GTM, Ads, Maps, reCAPTCHA, YouTube
- Facebook Pixel, Connect
- Matomo
- Hotjar, Microsoft Clarity
- Stripe, PayPal
- Cloudflare, Cloudflare Turnstile
- Vimeo
- Mailchimp, SendGrid
- HubSpot
- Sentry
- Linkedin Insight Tag
- Pinterest Tag
- TikTok Pixel

Sourced primarily from Klaro's own example configs (BSD-3, license-
compatible) and supplemented by manual research for the entries Klaro
doesn't cover.

**Phase 3.5 follow-up**: evaluate the
[Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database)
(Apache 2.0, ~10k entries, CMP-focused) as a secondary import source.
Quality varies per entry; we'd selectively import. Decision is its own
work, separate ADR if it grows complex.

**Long-term contribution model**: seeds are JSON files in
`reference-server/seeds/services/<id>.json`, one per service. Community
contributes via PR. JSON Schema is validated in CI. When the seed list
grows past ~200 entries, we split into a separate `simplecmp-services`
repo with its own release cadence — but that's not Phase-3 work.

**Seed-data licence**: BSD-3 to match the rest of SimpleCMP. EasyList
(GPL/CC BY-SA) and Cookiepedia (commercial) are explicitly excluded
because of licence incompatibility / redistribution risk.

### J. Authentication

The `/v1/...` read endpoints in the reference backend require **no
authentication**. Service-DB data is public-by-design (vendor names,
public privacy URLs, well-known cookie names).

The protocol allows backends to OPTIONALLY require
`Authorization: Bearer <token>`. The frontend client supports a
`serviceDbAuth: { token?: string; header?: string }` config:

```ts
serviceDbUrl: 'https://my-cms.example.com/api/simplecmp/db',
serviceDbAuth: { token: 'abc123' }, // sends `Authorization: Bearer abc123`
```

CMS plugins can use this to gate their endpoints. We don't define
a token-issuance flow — that's plugin-specific (WP nonces, TYPO3
session tokens, JWT, whatever).

CORS: backends MUST send appropriate CORS headers. The reference
backend sets `Access-Control-Allow-Origin: *` for read endpoints
(it's public data). CMS plugins set their own based on site policy.

## Consequences

### Positive

- The Service DB grows with the ecosystem instead of being a single
  point of dependency. CMS plugins, agencies, and the eventual
  community-hosted DB all speak the same protocol.
- Phase 3 ships small: protocol spec + frontend client +
  reference backend + ~20 seeds. Mirrors the Phase-2 cadence.
- The frontend client integrates with Phase-2 classifier interface
  cleanly: `LayeredClassifier` composes DB + local, recorder doesn't
  change.
- The fallback model (DB lookup → LocalClassifier) means the recorder
  never breaks when the DB is unreachable. Network unreliability
  doesn't silently downgrade the consent UX.
- Path-based versioning + reserved-namespace extensions give us room
  to evolve without backwards-incompatible breaks.
- PHP + SQLite reference backend means ddev-based local dev works
  out of the box for any contributor with ddev installed. No Node
  backend, no microservice setup.

### Negative

- We commit to maintaining the protocol spec separately from the
  implementation. Frontend client changes that need protocol changes
  must touch both, which adds review surface.
- The frontend client now ships caching logic, error fallback, and
  retries — meaningful complexity. We'll need solid tests for all
  the failure modes (network, timeout, malformed response, partial
  success in batch).
- Seed-data quality starts thin (~20 services). Sites that need broader
  coverage will see "unknown" detections until we either grow the
  list or evaluate Open Cookie DB. Not a bug, but a customer-
  expectation question.
- The reference backend is PHP — not the same toolchain as the rest
  of the project (TypeScript). Adds a second language to the
  contributor surface area. Justified by the ddev story (PHP is the
  default ddev language and matches the eventual TYPO3/WP/Contao
  audience), but worth flagging.
- We do NOT define an admin-write API in v1. CMS plugins each
  implement admin nativeively. Cross-CMS migration tooling is harder
  to write later. Acceptable trade-off — admin UX is wildly
  different per CMS, and a generic API would fit none of them well.

### Neutral

- The protocol explicitly allows the frontend client to talk to ANY
  conformant backend. This means a malicious or buggy backend could
  return garbage. Mitigations: schema validation on the client, opaque
  error fallback, no auto-trust of `extensions` content.
- Open Cookie Database evaluation deferred to Phase 3.5. Decision
  flagged as an Open Item; doesn't block Phase 3 ship.
- A future Admin-API ADR may revisit Section F. The current decision
  is "Phase 3 read-only", explicitly leaving room.

## References

- REQ-7 (Phase 2 recorder, ADR-0004) — the consumer of this protocol
- REQ-8 — Service DB
- REQ-10 — CMS plugins, downstream consumers in Phase 5
- ADR-0004 — Recorder architecture, defines the `Classifier` interface
  this ADR composes with
- [Open Cookie Database](https://github.com/jkwakman/Open-Cookie-Database)
  (Apache 2.0)
- [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) — Problem
  Details for HTTP APIs (the `extensions`-namespace pattern this ADR
  borrows)
- [DDEV](https://ddev.com/) — local-dev orchestration the reference
  backend targets
