# 0014. Library service hosting

- **Status:** accepted
- **Date:** 2026-05-26
- **Deciders:** Sven Wappler, Ilja Melnicenko

## Context

ADR-0005 specified an HTTP/JSON protocol for a shared service registry,
and `reference-server/` implements that protocol in PHP + SQLite. To
date there is no canonical hosted instance — TYPO3 consumers bundle
`simplecmp/services-library` via composer and pick up library updates
only when the maintainer tags a new release + the site admin runs
`composer update`. The chain is slow for sites that follow trackers in
the wild (the recorder's whole job) and the bundled snapshot diverges
from the GitHub source-of-truth between releases.

Three real decisions had to be made before we could promote the
reference server to a production-hosted canonical:

1. **Where does it run?** Self-hosted on Sven's infra, vendor cloud
   (Cloudflare Workers + R2 or similar), or federated (anyone runs
   their own)?
2. **What's the GDPR/privacy posture?** How long do we retain access
   logs that contain visitor IPs?
3. **How do plugins talk to it?** Direct from the visitor's browser,
   server-side via plugin proxy, or hybrid?

Each decision has knock-on consequences for trust model, operational
cost, compliance story, and the future migration path to a federated
or community-curated future.

## Decision

### 1. Hosting — WapplerSystems-hosted on Hetzner Germany

The canonical hosted endpoint is `library.simplecmp.eu`, run on a
small Hetzner Cloud VPS (CAX11-class, ~€4/mo) in Germany.

- **Trust model:** users trust WapplerSystems while SimpleCMP has one
  steward. Federation can come later if a second steward emerges or
  scale demands.
- **EU data residency** is a meaningful positioning advantage for the
  DACH market the project targets.
- **No vendor cloud terms** to negotiate (Cloudflare, AWS, etc.) — the
  box is wholly under operator control.
- **Resize on the fly:** Hetzner Cloud supports `change-type` in
  ~60-90s with one reboot, so we can start small and scale up if
  metrics ever justify it.

### 2. GDPR posture — zero log retention

The hosting layer drops all access logs (`access_log off` in nginx,
PHP-FPM access log off too). No visitor IPs touch persistent storage
on the library server. A boot-time audit log entry confirms the
posture for compliance documentation.

- Library responses contain no PII.
- The only logs that exist are application-level error logs (no
  request bodies, no IPs) and the boot-time audit message.
- External uptime monitoring (e.g. UptimeRobot) holds whatever
  per-request data it produces; the library server itself stays
  clean.

### 3. Layering — plugin proxies same-origin

Visitor browsers never query the library directly. Plugins (TYPO3
ext, future WordPress / Contao) expose a same-origin classifier
endpoint and proxy unknown-lookup queries to `library.simplecmp.eu`
server-to-server.

- **Visitor IPs only reach the plugin's server**, not the central
  library.
- **Matches the TYPO3 ext's existing model** (`/api/simplecmp/v1/lookup`
  middleware) — promotion is changing the plugin's upstream URL from
  "bundled JSON file" to the new hosted endpoint.
- **The hosted endpoint also serves CORS-permissive responses
  (`Access-Control-Allow-Origin: *`)** for future "JS lib direct"
  consumers (static sites, custom integrations) — but that path is
  documented as having different privacy characteristics; the
  recommended posture for plugin authors is to proxy.

## Consequences

### Positive

- **Compliance story stays clean.** "Visitor IPs never reach
  library.simplecmp.eu" is a defensible statement that plugin admins
  can include in their site's privacy policy. The zero-log retention
  on the library server itself is a defense in depth.
- **EU data residency** as a positioning advantage in the DACH
  market.
- **Operationally simple.** One small VPS, nginx + PHP-FPM + SQLite,
  no vendor-cloud APIs to learn, no Terraform required. Sven's
  Hetzner conventions apply directly.
- **GitHub remains the source of truth.** The server is a serve-only
  mirror, rebuilt hourly from the canonical repo. No two-truths
  divergence pathology.
- **Direct path to a federated future.** If/when SimpleCMP grows past
  one steward, each org runs its own instance of the same software
  (already published as `reference-server/`); plugins gain a per-site
  upstream-URL override.

### Negative

- **Single point of failure** while we have one steward. If the
  Hetzner VPS goes down and the plugin's local cache TTL expires
  during the outage, new visitors get unknown-classification for
  library-covered trackers until the upstream returns. Mitigated by
  the bundled snapshot fallback in plugins.
- **WapplerSystems is the implicit trust anchor.** Anyone who can't
  trust WapplerSystems for whatever reason has no built-in
  alternative until federation lands.
- **No global CDN edge** on day one. Non-EU plugin servers get
  Europe-roundtrip latency (~50-100ms). Acceptable because the plugin
  layer caches 24h locally, so actual upstream traffic per visiting
  site is ~1 request/day. Revisit if traffic ever justifies a CDN.
- **Library server can't ban abusers persistently** with zero log
  retention — nginx rate limiting is in-memory only. Accepted as the
  cost of the privacy posture; the realistic threat model is
  accidental hammering, not targeted attack.

### Neutral

- **Monitoring approach is deferred.** External uptime checker
  (UptimeRobot hitting `/v1/health` every minute, with the
  `lastSyncAt` field surfacing "cron stopped") is the leaning choice;
  decision lands at launch time. No architectural impact either way.
- **Write/curator API is out of scope for v1.** Community
  submissions stay in the GitHub PR flow. A future curator-side write
  API would be additive, not a redesign.
- **`reference-server/` continues to be both the published reference
  implementation AND the codebase running the canonical instance.**
  Anyone can run their own. Federation is a packaging and
  documentation question, not an implementation rewrite.

## References

- [ADR-0005 — Service DB protocol](0005-service-db-protocol.md) — the
  wire contract this ADR builds on
- [`docs/library-service-deployment.md`](../library-service-deployment.md)
  — operator brief, for whoever (human or AI agent) actually performs
  the deployment
- [`reference-server/README.md`](../../reference-server/README.md) —
  code-side setup
- Plugin-side wiring (forthcoming in `SimpleCMP/t3-simplecmp`):
  `simplecmp.libraryUpstreamUrl` Site Set field defaulting to
  `https://library.simplecmp.eu/v1`, bundled
  `simplecmp/services-library` composer dep as fallback for network
  errors / timeouts
