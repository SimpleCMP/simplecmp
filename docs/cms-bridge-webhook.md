# CMS Bridge Webhook — Protocol

Reference for backends that receive SimpleCMP CMS-bridge webhooks. The
bridge is implemented in `src/cms-bridge/` and wired through the
`cmsBridgeUrl` / `cmsBridgeAuth` config fields in `init()`. See REQ-9 in
[requirements.md](requirements.md) for the design rationale.

This document is the **public contract**. CMS plugins (Phase 5) and any
custom webhook receiver should be built against this contract — the
JS-side implementation may change, but the on-the-wire shape is the
stable surface.

## Trigger

The bridge fires when the Recorder produces a `Detection` with
`status: 'unknown'` — meaning:

- the item doesn't match any service in the local `services` config, and
- if a Service-DB is configured (`serviceDbUrl`), the DB also returned no
  match (or the DB lookup failed).

If a Service-DB lookup arrives **after** the initial detection and
resolves it to `known`, the bridge does **not** fire again. The webhook
is for items that remain unknown.

## Request

```
POST <cmsBridgeUrl>
Content-Type: application/json
Authorization: Bearer <token>   (if `cmsBridgeAuth` is configured)
```

If `cmsBridgeAuth.header` / `cmsBridgeAuth.scheme` are set, the header
name and value prefix change accordingly. Setting `scheme: ''` sends the
raw token without any prefix.

## Payload schema (v1)

```ts
interface CmsBridgePayload {
  schemaVersion: 1;
  source: string;            // identifies the SimpleCMP installation
  sentAt: string;            // ISO-8601 UTC
  page: {
    url: string;             // location.href, query and fragment stripped
    referrer?: string;       // document.referrer (omitted if empty)
    userAgent?: string;      // navigator.userAgent
  };
  library: {
    name: 'simplecmp';
    version: string;
  };
  detection: {
    kind: 'cookie' | 'script' | 'iframe' | 'image' | 'link' | 'request';
    identifier: string;      // cookie name, or URL for resource kinds
    origin?: string;         // host derived from URL (non-cookie kinds)
    firstSeen: number;       // epoch ms
    lastSeen: number;        // epoch ms
    count: number;           // observation count this session
    firstSeenOn?: string;    // page path at first sighting (query stripped)
    status: 'unknown';
  };
}
```

### Example

```json
{
  "schemaVersion": 1,
  "source": "production-de",
  "sentAt": "2026-05-13T14:22:11.412Z",
  "page": {
    "url": "https://www.example.de/produkte/foo",
    "referrer": "https://www.google.com/",
    "userAgent": "Mozilla/5.0 (...)"
  },
  "library": {
    "name": "simplecmp",
    "version": "0.0.1"
  },
  "detection": {
    "kind": "cookie",
    "identifier": "_new_unknown_tracker",
    "firstSeen": 1715591051000,
    "lastSeen": 1715591051000,
    "count": 1,
    "firstSeenOn": "/produkte/foo",
    "status": "unknown"
  }
}
```

## Privacy: URL scrubbing

`page.url` and `detection.firstSeenOn` are stripped of query strings and
URL fragments before being sent. Production URLs frequently carry session
tokens, magic-link auth parameters, or PII in query strings — this default
prevents the bridge from leaking those to the receiver.

The path portion is preserved so the CMS admin can still answer "which
page leaked this tracker?". If your application stores routing state in
the query string (legacy SPA pattern), expect to lose route-level
granularity. There's no opt-out in v1; raise an issue if you have a
concrete use case.

## Feedback-loop suppression

The Recorder's `PerformanceObserver` observes *every* outgoing network
request, including the bridge's own POSTs to `cmsBridgeUrl`. Without
care, each webhook would produce a fresh "unknown `request`" detection
for the bridge URL, which would re-fire the bridge in a 1-step loop
(saved from runaway only by the dedup TTL).

To prevent this, the bridge suppresses detections whose `origin` field
matches the host of `cmsBridgeUrl`. Side effect: any *other* unknown
tracker hosted on the same origin as your CMS bridge will also be
suppressed. In practice this is the right call — a CMS hosting its own
webhook endpoint is unlikely to also host third-party trackers under the
same hostname.

## Dedup behavior

Same `${kind}:${identifier}` only fires once per `dedupTtlMs` window per
browser session. Default TTL is **1 hour**. Override via
`cmsBridge.dedupTtlMs` in the SimpleCMP config:

```ts
init({
  // ...
  cmsBridgeUrl: 'https://cms.example.com/api/simplecmp/webhook',
  cmsBridge: { dedupTtlMs: 86_400_000 }, // 24h
});
```

The dedup map lives in memory only. It survives SPA route changes within
a tab; it resets on hard navigation (full page reload) or on `init()`
being called again.

**Receiver responsibility:** the TTL is per-browser-session. A page hit
by 1000 visitors with the same unknown tracker still produces up to 1000
webhooks. If you need cross-visitor rate limiting, do it on the receiving
side.

## Coordination with the Service DB

When both `serviceDbUrl` and `cmsBridgeUrl` are configured, the bridge
listens to the recorder's `'detectionSettled'` event rather than
`'detection'`. The settled event fires **after** any in-flight
Service-DB lookup resolves, so the bridge only POSTs for detections
that remain `status: 'unknown'` once classification is final. Items
the Service DB ultimately matches as known never generate a webhook.
(REQ-N7, shipped 2026-05-17.)

For receivers, this means the webhook stream is no longer a "raw event
stream with transient false positives" — it is a curated list of items
that even the shared Service DB could not classify.

## Response handling

The bridge does not consume the response body; only the status code
matters:

| Status | Bridge behavior |
|---|---|
| 2xx | Success. Dedup entry kept for the full TTL window. |
| 4xx | `console.warn` once; dedup entry kept (receiver said no, don't retry). |
| 5xx | `console.warn` once; dedup entry cleared so a future detection can retry. |
| Network error / timeout (default 5s) | `console.warn` once; dedup entry cleared so a future detection can retry. |

The `console.warn` is gated to fire at most once per error category per
session — failing receivers don't spam the console.

## CORS

The bridge issues a cross-origin `POST` with `Content-Type:
application/json`, which triggers a CORS preflight. Receivers must
respond to `OPTIONS` with at minimum:

```
Access-Control-Allow-Origin: https://your-site.example
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

For CMS plugins, this is typically handled by the plugin's REST endpoint
implementation. If you're standing up a custom webhook receiver, make
sure the CORS preflight succeeds — otherwise the bridge sees a generic
"network error" and you'll get warnings without any payload arriving.

## Schema versioning

`schemaVersion: 1` is the locked v1 contract. Future fields may be added
without bumping the version; receivers MUST tolerate unknown fields.
Breaking changes (renaming, removing, changing types) will bump
`schemaVersion` to 2 — receivers should accept both during the
transition.
