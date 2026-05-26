# Library service deployment brief

This document is the delivery brief for promoting `reference-server/`
into a production-hosted services-library endpoint at
**`library.simplecmp.eu`** on Hetzner Cloud. It is written for a fresh
operator (human or AI agent) to act on without needing prior session
context.

## Goal

Deploy a hosted HTTP/JSON endpoint that lets SimpleCMP CMS plugins
(TYPO3, future WordPress / Contao) consult fresh `simplecmp/services-library`
data without waiting for composer-version-pinned releases. The endpoint
is **read-only**, serves the data published in the GitHub repo
[`SimpleCMP/services-library`](https://github.com/SimpleCMP/services-library),
and is consumed via plugin-side proxies — visitor IPs never reach this
server directly.

## Context

- Today: TYPO3 ext bundles `simplecmp/services-library` via composer.
  Curators add new services on GitHub → tag a library release → ext
  maintainer bumps composer → site admin runs `composer update`. The
  chain is slow for sites that follow trackers in the wild.
- The wire shape already exists: `docs/service-db-protocol.md` +
  `reference-server/` (PHP + SQLite reference implementation).
- This deployment is the canonical hosted instance of that protocol.

## Architecture (locked decisions — do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Hosting | WapplerSystems-hosted on **Hetzner Germany** | DACH-market data residency, full control, no vendor cloud terms |
| GDPR posture | **Zero log retention** (no IPs persisted anywhere) | Matches the compliance-first project posture |
| Layering | **Plugin proxies same-origin** | Visitor IPs only reach the plugin's server; only plugin servers query upstream |
| Source of truth | **GitHub is canonical**; server is a serve-only mirror | Prevents two-truths divergence if curator edits one and not the other |
| CDN | **None for v1**; revisit when traffic justifies | Hetzner direct is fast enough; CDN would weaken the "stays in Germany" story |

## Stack

- Hetzner Cloud VPS: **CAX11** (€3.79/mo, 2 vCPU ARM, 4GB RAM, 40GB SSD)
- Region: **Falkenstein** or **Nürnberg** (Germany)
- OS: latest Debian or Ubuntu LTS
- Web server: **nginx**
- PHP: **PHP-FPM 8.4**
- DB: **SQLite** (the file lives on local disk; rebuilt by cron)
- TLS: **Let's Encrypt** via certbot
- Firewall: **Hetzner Cloud Firewall** — only 22/80/443 open
- DNS: `library.simplecmp.eu` → VPS IP

## Step-by-step

### 1. Provision the box

```sh
# Via hcloud CLI (or web UI):
hcloud server create --type cax11 --image debian-12 --location fsn1 \
  --name simplecmp-library --ssh-key <key-id>
```

Hetzner Cloud is flexible: if CAX11 turns out underpowered, run
`hcloud server change-type simplecmp-library cax21` — takes 60-90s
with one reboot. Take a snapshot before any resize for instant
rollback.

### 2. DNS

Point `library.simplecmp.eu` A/AAAA records to the VPS IPv4/IPv6. TTL
~300 during setup, ~3600 once stable.

### 3. Base hardening

- SSH key-only auth (`PasswordAuthentication no` in sshd_config)
- Unattended security upgrades enabled
- Hetzner Cloud Firewall: only 22 (SSH), 80 (HTTP, redirects to HTTPS), 443 (HTTPS) inbound
- Two operators with sudo access (Sven + Ilja minimum)
- Standard hardening Sven runs on other Hetzner boxes

### 4. Install stack

```sh
apt update && apt install -y nginx php8.4-fpm php8.4-sqlite3 php8.4-cli \
  composer git certbot python3-certbot-nginx
```

### 5. Deploy reference-server

```sh
# Clone the upstream repo somewhere convenient (e.g. /opt/simplecmp)
mkdir -p /opt/simplecmp && cd /opt/simplecmp
git clone https://github.com/SimpleCMP/simplecmp.git
cd simplecmp/reference-server
composer install --no-dev --optimize-autoloader

# Point nginx at public/
# Seed the DB
php bin/seed.php   # if a seed entry exists; otherwise the cron below populates it
```

Refer to `reference-server/README.md` for the exact bootstrap commands
shipped with the code.

### 6. nginx config

The matching server block at `/etc/nginx/sites-available/library.simplecmp.eu`:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name library.simplecmp.eu;

    root /opt/simplecmp/simplecmp/reference-server/public;
    index index.php;

    # GDPR posture: zero log retention
    access_log off;
    error_log /var/log/nginx/library-error.log warn;  # errors only, no request bodies

    # CORS — read-only public JSON, safe to expose globally so future
    # JS-lib direct use works without infra changes.
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Max-Age 86400 always;

    # Rate limit — caps accidental hammering without persistent ban list.
    # 60 req/min/IP, no logging (in-memory zone only).
    # (Define zone in nginx.conf http{}: limit_req_zone $binary_remote_addr zone=library:10m rate=60r/m;)
    limit_req zone=library burst=20 nodelay;

    # Cache headers (handled by PHP for /v1/ endpoints, but ETag stripping
    # at proxies should preserve them)
    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root/index.php;
        include fastcgi_params;
    }

    location / {
        try_files $uri /index.php?$query_string;
    }

    # robots.txt — public data but not website content; avoid Google indexing
    location = /robots.txt {
        add_header Content-Type "text/plain";
        return 200 "User-agent: *\nDisallow: /\n";
    }

    ssl_certificate /etc/letsencrypt/live/library.simplecmp.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/library.simplecmp.eu/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    # Modern Mozilla cipher preset
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=31536000" always;
}

server {
    listen 80;
    listen [::]:80;
    server_name library.simplecmp.eu;
    return 301 https://$server_name$request_uri;
}
```

Also disable PHP-FPM's per-pool access log:

```ini
; /etc/php/8.4/fpm/pool.d/www.conf
access.log = /dev/null
```

### 7. Cron-based data sync

Hourly pull from the GitHub library repo + SQLite rebuild:

```sh
# /opt/simplecmp/sync-library.sh
#!/bin/bash
set -e
LIBDIR=/opt/simplecmp/services-library
if [ ! -d "$LIBDIR" ]; then
  git clone https://github.com/SimpleCMP/services-library.git "$LIBDIR"
fi
cd "$LIBDIR" && git pull --ff-only

# Rebuild the SQLite from the JSON files. The reference-server's data
# loader expects a known location; configure accordingly. Reference-server
# ships a rebuild script — call it here.
php /opt/simplecmp/simplecmp/reference-server/bin/rebuild-from-library.php \
  --source "$LIBDIR/data/services" \
  --target /opt/simplecmp/simplecmp/reference-server/var/library.sqlite
```

Crontab entry:

```
17 * * * * /opt/simplecmp/sync-library.sh >> /var/log/library-sync.log 2>&1 || true
```

Run at minute 17 (not 00) to spread load away from common cron times.
The `|| true` prevents cron-mail spam on failure; instead, we surface
"data is stale" via the `/v1/health` endpoint's `lastSyncAt` field.

**Cron failure handling.** If `git pull` or rebuild fails: the previous
SQLite stays in place, the server keeps serving last-known-good data,
the `lastSyncAt` timestamp doesn't advance, monitoring picks it up.
Never serve empty or broken data.

### 8. `/v1/health` endpoint

Reference-server should expose:

```
GET /v1/health
{
  "status": "ok",
  "lastSyncAt": "2026-05-26T12:17:03Z",
  "serviceCount": 369
}
```

External uptime checker hits this every minute; alerts when:
- HTTP non-2xx
- `lastSyncAt` is older than 2 hours (cron stopped)
- `serviceCount` drops by more than 10% (data corruption signal)

### 9. TLS

```sh
certbot --nginx -d library.simplecmp.eu --agree-tos --no-eff-email \
  -m <ops-email>
```

Renew via the certbot timer (Debian default).

### 10. Hetzner Cloud Backup

Enable daily backup add-on (~20% of base price) for 7-day rotation.
Belt-and-suspenders alongside the GitHub source-of-truth — if the
SQLite gets corrupted between snapshots, restore from GitHub via the
sync script.

### 11. Boot-time audit log

The reference-server (or a small startup hook) should write ONE log
entry at boot confirming the posture:

```
INFO [simplecmp-library] starting; access_log=off; rate_limit=60/min/ip; sync_source=github.com/SimpleCMP/services-library
```

This goes to syslog. It's the only operational log we keep — useful
for audit/compliance documentation.

## Configuration values reference

| Key | Value |
|---|---|
| Public URL | `https://library.simplecmp.eu/v1/` |
| Health endpoint | `https://library.simplecmp.eu/v1/health` |
| Cache header | `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` |
| ETag | computed from data hash on each rebuild |
| Rate limit | 60 req/min/IP, burst 20 |
| CORS | `Access-Control-Allow-Origin: *` |
| Error format | JSON `{"error": "...", "code": "..."}` |
| Sync schedule | hourly at minute 17 |
| Source repo | `https://github.com/SimpleCMP/services-library` |

## Acceptance criteria

A successful deployment passes all of these:

1. `curl https://library.simplecmp.eu/v1/health` returns 200 with the
   expected JSON shape including `lastSyncAt` no older than 1 hour.
2. `curl https://library.simplecmp.eu/v1/services` returns the full
   list with at least the same `serviceCount` as the GitHub repo
   contains.
3. `curl -I https://library.simplecmp.eu/v1/services` returns headers:
   - `Cache-Control: public, max-age=3600, ...`
   - `ETag: "<hash>"`
   - `Access-Control-Allow-Origin: *`
4. `curl https://library.simplecmp.eu/robots.txt` returns
   `User-agent: *\nDisallow: /\n` with `Content-Type: text/plain`.
5. nginx access log file is empty after 24h of operation.
6. SSH access works for at least two operators (Sven + Ilja).
7. Restarting the box keeps everything working (systemd units enabled
   for nginx + php-fpm + the certbot timer).
8. After 2 hours, `lastSyncAt` should have advanced (proving cron is
   running).
9. Hitting `/v1/lookup?cookie=_ga` returns the matching Google
   Analytics service entry (sanity check the wire shape against
   `docs/service-db-protocol.md`).

## Out of scope for v1

These are deliberately deferred — don't build them now:

- **Write endpoints / community submissions.** Curator workflow stays
  in the GitHub repo's PR flow.
- **CDN.** Direct-from-Hetzner is fast enough at expected scale.
- **Multiple regions / mirrors.** Single Hetzner box.
- **OpenAPI spec auto-generation.** `docs/service-db-protocol.md` is
  the wire contract.
- **Federation discovery.** Plugins point at `library.simplecmp.eu`
  by default; admins can override per site.
- **Webhook-based sync.** Cron-hourly is good enough.
- **SPF / DMARC / SMTP.** No server-side email.
- **Per-request analytics dashboards.** Zero log retention precludes
  these by design.

## Related files

- `reference-server/README.md` — code-side setup
- `docs/service-db-protocol.md` — wire contract (HTTP/JSON shape)
- `docs/adr/0005-service-db-protocol.md` — original protocol design
  rationale
- Plugin-side wiring (to be added in `t3-simplecmp`): config knob
  `simplecmp.libraryUpstreamUrl` defaulting to
  `https://library.simplecmp.eu/v1`, with the bundled
  `simplecmp/services-library` composer dep as fallback for network
  errors / timeouts.

## Open item (revisit before launch)

**Monitoring approach.** Three sketched:

1. External uptime checker (UptimeRobot / Hetzner monitoring) hitting
   `/v1/health` every minute. The `lastSyncAt` field surfaces stale-
   data conditions for free. Checker holds the access logs, server
   stays clean.
2. Aggregate-only counters (requests/min in memory, no per-request
   data) exposed via a privileged endpoint.
3. Both.

External checker alone fits the zero-log posture best. Decision can
land at launch time without changing any deployment steps above.
