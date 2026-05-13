# SimpleCMP Service-DB Reference Backend

Tiny PHP 8.3 + SQLite implementation of the
[Service-DB protocol](../docs/service-db-protocol.md) (REQ-8 / ADR-0005).
Designed for **local development and testing** — point your SimpleCMP
frontend at this endpoint to exercise the recorder + Service-DB flow
end-to-end without depending on an external service.

This is **not** a production service. It's a reference: ~6 routes, no
framework, ~500 LOC total. Fork it, replace it, ship your own. The protocol
contract is what matters.

## Quick start with ddev

Requires [ddev](https://ddev.com).

```bash
cd reference-server
ddev start
```

ddev installs Composer dependencies, the SQLite database is created on
first request, and seeds in `seeds/services/*.json` are loaded
automatically. The endpoint is available at:

```
https://simplecmp-service-db.ddev.site/v1/health
```

Verify with curl:

```bash
curl -sk https://simplecmp-service-db.ddev.site/v1/health | jq
# { "ok": true, "schemaVersion": 1, "count": 20 }
```

Point your SimpleCMP frontend config at this URL:

```ts
init({
  storageName: 'mysite',
  services: [],
  serviceDbUrl: 'https://simplecmp-service-db.ddev.site',
  record: true,
});
```

## Quick start without ddev

PHP 8.3 + the built-in dev server work fine:

```bash
cd reference-server
composer install
php -S 127.0.0.1:8080 -t public
```

Then `serviceDbUrl: 'http://127.0.0.1:8080'`.

## Routes

| Method | Path                    | Notes                                            |
| ------ | ----------------------- | ------------------------------------------------ |
| GET    | `/v1/health`            | `{ ok, schemaVersion, count }`                   |
| GET    | `/v1/services`          | List all (`limit`, `offset` query params)        |
| GET    | `/v1/services?cookie=…` | Filter by cookie name                            |
| GET    | `/v1/services?origin=…` | Filter by origin host                            |
| GET    | `/v1/services/:id`      | Single service or 404                            |
| POST   | `/v1/lookup`            | Batch — body `{ items: [{cookie?, origin?}] }`   |

CORS is wide open (`Access-Control-Allow-Origin: *`). Auth is intentionally
absent in the reference; CMS plugins that need auth implement it themselves.

## Adding services

Drop a JSON file in `seeds/services/`. Reset the database to re-seed:

```bash
rm var/service-db.sqlite && curl -sk https://simplecmp-service-db.ddev.site/v1/health
```

(The SQLite file is at `var/service-db.sqlite` by default; override with
the env var `SIMPLECMP_DB_PATH`.)

See `seeds/README.md` for the JSON format.

## Tests

```bash
composer install
composer test
```

PHPUnit smoke tests live in `tests/`. They cover the lookup logic — the
HTTP layer in `public/index.php` is exercised manually for now.

## Layout

```
reference-server/
├── public/
│   └── index.php          ← single-file router
├── src/
│   ├── Database.php       ← SQLite wrapper, idempotent schema init
│   ├── Lookup.php         ← matching logic
│   └── Seeder.php         ← JSON → DB
├── seeds/
│   ├── services/*.json    ← one file per service
│   └── README.md          ← seed schema + contribution guide
├── tests/                 ← PHPUnit
├── composer.json
├── phpunit.xml
└── .ddev/                 ← local-dev orchestration
```

## License

BSD-3-Clause, same as the rest of SimpleCMP. Service seed JSON files are
also BSD-3.
