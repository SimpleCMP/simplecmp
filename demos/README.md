# SimpleCMP Demos

Drei statische HTML-Demos, die Phase 1–3 in Aktion zeigen.

| Demo | Zeigt |
|---|---|
| `01-basic.html` | Banner, Datenschutz/Impressum-Links, gleichberechtigte Decline/Accept-Buttons, Floating-Trigger, Modal-A11y |
| `02-recorder.html` | Wie #1 plus Recorder mit Live-Panel, Buttons zum Triggern von Detections, exportConfig() / assertNoUnknown() |
| `03-service-db.html` | Wie #2 plus Service-DB-Lookup gegen das PHP+SQLite-Reference-Backend |

## Schneller Start

```bash
# Aus dem Repo-Root
pnpm demo
```

`pnpm demo` macht drei Sachen, automatisch und in dieser Reihenfolge:

1. `pnpm build` — frisches Bundle in `dist/`
2. **Auto-Start des Service-DB-Backends** wenn ddev installiert ist und das
   Backend nicht schon läuft (Health-Check gegen
   `https://simplecmp-service-db.ddev.site/v1/health`)
3. Demo-Server auf `http://127.0.0.1:5173`

Browser auf die URL, fertig — alle drei Demos einsatzbereit.

### Wenn du nur den Server willst (Build ist aktuell)

```bash
pnpm demo:serve
```

### Wenn du das ddev-Auto-Start nicht willst

```bash
pnpm demo:serve -- --no-backend
# oder direkt:
node demos/serve.mjs --no-backend
```

Dann läuft der Demo-Server, aber Demo 3 zeigt "Backend nicht erreichbar"
bis du das Backend selbst startest.

## Demo 3 ohne ddev

Wenn du ddev nicht installierst, geht es mit dem PHP-Builtin-Server:

```bash
cd reference-server
composer install
php -S 127.0.0.1:8080 -t public
```

Dann auf der Demo-3-Seite die URL auf `http://127.0.0.1:8080` umstellen und
"Mit dieser URL neu starten" klicken.

`pnpm demo:serve` zeigt dir diesen Hinweis automatisch, wenn ddev nicht
auf dem PATH ist.

## Ports

- `5173` — Demo-Server (statische Files)
- `80/443` (via ddev) — Service-DB-Reference-Backend
- `8080` — PHP-Builtin-Server (alternativ zu ddev)

Falls 5173 belegt ist:

```bash
node demos/serve.mjs --port 8081
```

## Layout

```
demos/
├── serve.mjs           ← Pure-Node-Static-Server, ~80 LOC, kein externer Dep
├── index.html          ← Landing
├── 01-basic.html       ← Compliance-Basics
├── 02-recorder.html    ← Recorder mit Live-Panel
└── 03-service-db.html  ← Full-Stack
```

Demo-HTMLs laden die Bundles aus `../dist/`. Wenn du den Code änderst,
braucht's einen frischen `pnpm build`. `pnpm demo` macht das in einem
Schritt.

Die Demos sind **nicht** im npm-Paket — `package.json.files` schließt sie
aus. Im Repo bleiben sie aber, damit Contributors sie zum Anschauen haben.
