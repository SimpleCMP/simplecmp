# SimpleCMP Service-DB Protocol

> **Audience:** developers building a Service-DB backend (CMS plugin
> author, custom in-house implementation, community-hosted public DB).
> If you just want to *use* the Service DB from a SimpleCMP frontend,
> see the README quick-start instead.

This document is the consumer-facing form of the architectural decisions
in [ADR-0005](adr/0005-service-db-protocol.md). It defines the HTTP/JSON
contract that the SimpleCMP frontend client speaks.

**Version:** v1
**Authoritative reference implementation:** `reference-server/` in this repo.

## Why a contract, not a service

The Service DB isn't a single hosted endpoint. It's a protocol that
multiple backends implement:

- the PHP+SQLite reference in this repo,
- CMS plugins (TYPO3, WordPress, Contao — Phase 5) that expose their
  site-local registry to the SimpleCMP frontend,
- (optionally) a future community-hosted public DB.

The frontend client speaks one protocol. Where the data lives is the
operator's choice.

## Endpoints

All endpoints are prefixed `/v1/`.

**Client `serviceDbUrl` configuration:** the JS `ServiceDbClient` appends
`/<apiVersion>/<route>` to the configured base URL. Pass the URL *up to but
excluding* the version prefix — e.g. `https://example.com/api/simplecmp`, not
`https://example.com/api/simplecmp/v1`. The client then issues requests to
`https://example.com/api/simplecmp/v1/lookup` etc. Including `/v1` in the
base URL causes a doubled `/v1/v1/` path and 404s.

### `GET /v1/health`

Probe whether the backend is alive and which schema version it speaks.

**Response (200):**
```jsonc
{
  "ok": true,
  "schemaVersion": 1,
  "count": 23   // number of services in the registry (optional)
}
```

### `GET /v1/services`

List services. With no query parameters, returns all (paginated).

**Query parameters (all optional):**
- `cookie=<name>` — filter to services that claim this cookie
- `origin=<host>` — filter to services that claim this origin
- `limit=<n>` — page size (default 100, max 500)
- `offset=<n>` — page offset

**Response (200):**
```jsonc
{
  "items": [ ServiceMatch, ... ],
  "total": 23,
  "limit": 100,
  "offset": 0
}
```

### `GET /v1/services/:id`

Single service detail. Returns 404 if the id doesn't exist.

**Response (200):** a `ServiceMatch` (see schema below).

### `POST /v1/lookup`

Batch lookup — single HTTP request for many queries. Items in the
response are positionally aligned with items in the request.

**Request body:**
```jsonc
{
  "items": [
    { "cookie": "_ga" },
    { "origin": "hotjar.com" },
    { "cookie": "_unknown" }
  ]
}
```

**Response (200):**
```jsonc
{
  "items": [
    { "query": { "cookie": "_ga" },         "matches": [ ServiceMatch, ... ] },
    { "query": { "origin": "hotjar.com" },  "matches": [ ServiceMatch ] },
    { "query": { "cookie": "_unknown" },    "matches": [] }
  ]
}
```

The frontend uses `matches[0]` if present. Multi-matches are allowed in
the protocol but rare in practice.

## Schema: `ServiceMatch`

```jsonc
{
  "id": "google-analytics",                    // stable, kebab-case, required
  "name": "Google Analytics",                  // canonical English, required
  "vendor": "Google LLC",                      // controller's legal name
  "vendorCountry": "US",                       // ISO 3166-1 alpha-2
  "purposes": ["analytics"],                   // see "Purpose taxonomy" below
  "privacyPolicyUrl": "https://policies.google.com/privacy",
  "description": "...",                        // canonical English description
  "retention": {
    "display": {
      "en": "26 months",
      "de": "26 Monate"
    },
    "durationDays": 791                        // optional, machine-readable
  },
  "i18n": {
    "name":        { "de": "..." },            // overrides for `name`
    "description": { "de": "..." }
  },
  "matches": {                                 // why this entry matched
    "cookies": ["_ga", "/^_ga_/"],
    "origins": ["www.google-analytics.com", "*.googletagmanager.com"]
  },
  "extensions": {                              // see "Extensions" below
    "wordpress": { "gtm-id": "GTM-ABC123" }
  }
}
```

### Required vs. optional

Required: `id`, `name`, `purposes`.
All other fields are optional.

### Localization

`name` and `description` carry the canonical English string at the top
level. `i18n.name[lang]` and `i18n.description[lang]` provide
translations. The frontend resolves `i18n.name[currentLang] ?? name` —
missing translations fall back to English.

`retention.display.en` is required when `retention` is present;
`retention.display.<lang>` are optional translations. `durationDays` is
optional and machine-readable for Phase-5 audit reports.

### Purpose taxonomy

Fixed set of six values:

| Purpose | Use cases |
|---|---|
| `functional` | Cookies/scripts essential for site operation (session, CSRF, etc.) |
| `analytics` | Anonymous traffic measurement |
| `marketing` | Audience-building, conversion tracking |
| `personalization` | UI customisation based on user profile |
| `security` | Bot detection, fraud prevention |
| `advertising` | Targeted ad delivery |

Purposes are an **array** because some services span more than one
purpose (e.g., Meta Pixel is `["marketing", "advertising", "analytics"]`).

A service-DB-specific purpose taxonomy may be needed in v2; for v1 the
fixed set keeps frontend filtering predictable.

### `matches.cookies` patterns

- Plain string → exact name match.
- `/pattern/` (string starting and ending with `/`) → regex source,
  matched against the cookie name.

### `matches.origins` patterns

- Plain host (`www.example.com`) → exact match against the request host.
- `*.example.com` → suffix match. Matches `www.example.com`,
  `cdn.example.com`, AND bare `example.com`.
- `/pattern/` → regex against the host.

### Extensions

Backends MAY add a top-level `extensions` object with vendor-prefixed
keys:

```jsonc
"extensions": {
  "wordpress": { "gtm-id": "GTM-ABC123" },
  "typo3":     { "ext-key": "tx_googleanalytics" }
}
```

The frontend client ignores `extensions` by default; plugin-aware tools
read what they know.

Plugins MUST document their extension keys in their own docs.
Recommendation: use the plugin's package name (npm/composer/CMS-extension-key) as the namespace key.

## Authentication

The `/v1/...` read endpoints are public-by-default. Backends MAY require
`Authorization: Bearer <token>` (or a custom header — see frontend
client docs). The reference backend has no auth.

CORS: the reference backend sets `Access-Control-Allow-Origin: *`.
Backends gating endpoints by origin must set CORS headers accordingly.

## Caching

The frontend client caches lookups in `localStorage` for 24h by default.
Backends MAY override this with HTTP `Cache-Control: max-age=<seconds>`
headers — that takes precedence over the client default for the
specific response.

For aggressive freshness (e.g., admin previews), respond with
`Cache-Control: no-store`.

## Error responses

Any non-2xx response is treated as a failure. The frontend silently
falls back to its `LocalClassifier` (config-only matching) and emits a
single `console.warn` per error category per session.

There is no required error schema. A JSON body with `{ "error": "..." }`
is encouraged for debuggability.

## Versioning

Breaking changes ship as `/v2/`. Both versions can coexist on the same
backend during a migration window.

## Examples (curl)

```bash
# Health check
curl -s https://servicedb.example/v1/health

# Single cookie lookup
curl -s 'https://servicedb.example/v1/services?cookie=_ga'

# Batch lookup
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"items":[{"cookie":"_ga"},{"origin":"hotjar.com"}]}' \
  https://servicedb.example/v1/lookup

# Single service detail
curl -s https://servicedb.example/v1/services/google-analytics
```

## Frontend integration

```ts
import { init } from 'simplecmp';

init({
  storageName: 'mysite',
  services: [],   // optional local overrides
  serviceDbUrl: 'https://servicedb.example',
  // optional auth
  serviceDbAuth: { token: 'abc123' },
  // recorder uses the LayeredClassifier when serviceDbUrl is set
  record: true,
});
```

The `LayeredClassifier` consults the local `services` first; the
Service DB only fills in unknowns.

## See also

- [ADR-0005](adr/0005-service-db-protocol.md) — full architectural
  rationale for these decisions.
- `reference-server/README.md` — running the PHP reference locally
  with ddev.
- `reference-server/seeds/README.md` — JSON schema for seed entries
  and the contribution workflow.
