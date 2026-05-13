/**
 * Demo launcher for SimpleCMP.
 *
 * Pure Node, no external deps. Two responsibilities:
 *
 *   1. Auto-start the ddev-managed Service-DB reference backend if ddev is
 *      installed and the backend isn't already running. Demo 3 then works
 *      out of the box.
 *
 *   2. Serve the `demos/` directory (and the sibling `dist/` folder) on a
 *      local port, so demo HTML can reference `/dist/...` paths.
 *
 *   node demos/serve.mjs                  # auto-detect ddev, port 5173
 *   node demos/serve.mjs --port 8080      # custom port
 *   node demos/serve.mjs --no-backend     # skip ddev autostart
 */

import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';
import { argv, exit } from 'node:process';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DEMOS = resolve(ROOT, 'demos');
const REFERENCE_SERVER = resolve(ROOT, 'reference-server');

const portArgIndex = argv.indexOf('--port');
const PORT = portArgIndex >= 0 ? Number(argv[portArgIndex + 1]) : 5173;
const SKIP_BACKEND = argv.includes('--no-backend');
const BACKEND_HEALTH_URL = 'https://simplecmp-service-db.ddev.site/v1/health';

// --- ddev launcher ----------------------------------------------------------

/** Resolves to true if `ddev` is on the PATH. */
function ddevAvailable() {
  return new Promise((resolveCheck) => {
    const child = spawn('ddev', ['version'], { stdio: 'ignore' });
    child.on('error', () => resolveCheck(false));
    child.on('exit', (code) => resolveCheck(code === 0));
  });
}

/** Probe the Service-DB health endpoint. Short timeout, no retries. */
async function backendIsHealthy() {
  if (typeof fetch !== 'function') return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(BACKEND_HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.ok === true;
  } catch {
    return false;
  }
}

/** Run `ddev start` in `reference-server/`, blocking until it exits. */
function ddevStart() {
  return new Promise((resolveRun) => {
    console.log('  → Starting ddev backend in reference-server/ (this can take a moment)...');
    const child = spawn('ddev', ['start'], {
      cwd: REFERENCE_SERVER,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        console.log('  → ddev backend started');
        resolveRun(true);
      } else {
        console.log(`  ⚠ ddev start exited with code ${code} — Demo 3 may not work`);
        resolveRun(false);
      }
    });
    child.on('error', (err) => {
      console.log(`  ⚠ Could not run ddev: ${err.message}`);
      resolveRun(false);
    });
  });
}

async function maybeStartBackend() {
  if (SKIP_BACKEND) {
    console.log('  ⓘ --no-backend: skipping ddev autostart. Demo 3 needs a backend at');
    console.log(`     ${BACKEND_HEALTH_URL.replace(/\/v1\/health$/, '')}`);
    return;
  }
  if (await backendIsHealthy()) {
    console.log('  ✓ Service-DB backend already running — Demo 3 ready');
    return;
  }
  if (!(await ddevAvailable())) {
    console.log('  ⓘ ddev not installed — Demo 3 (Service-DB) needs a backend.');
    console.log('     Install ddev (https://ddev.com) or run reference-server/ manually:');
    console.log('     cd reference-server && composer install && php -S 127.0.0.1:8080 -t public');
    console.log('     Then point Demo 3 at http://127.0.0.1:8080.');
    return;
  }
  await ddevStart();
}

// --- static file server -----------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.map':  'application/json; charset=utf-8',
};

function safePathFor(urlPath) {
  // Anything under /dist/ resolves into the project's dist folder.
  // Everything else resolves into the demos folder.
  let target;
  if (urlPath === '/' || urlPath === '') {
    target = resolve(DEMOS, 'index.html');
  } else if (urlPath.startsWith('/dist/')) {
    target = resolve(ROOT, urlPath.slice(1));
    if (!target.startsWith(resolve(ROOT, 'dist'))) return null;
  } else {
    target = resolve(DEMOS, '.' + normalize(urlPath));
    if (!target.startsWith(DEMOS)) return null;
  }
  return target;
}

function startStaticServer() {
  const server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = safePathFor(urlPath);
    if (!file) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    let stat;
    try {
      stat = statSync(file);
    } catch {
      res.statusCode = 404;
      res.end('Not found: ' + urlPath);
      return;
    }

    if (stat.isDirectory()) {
      const indexFile = resolve(file, 'index.html');
      try {
        statSync(indexFile);
        res.writeHead(302, { Location: urlPath.replace(/\/?$/, '/') + 'index.html' });
        res.end();
      } catch {
        res.statusCode = 404;
        res.end('No index in ' + urlPath);
      }
      return;
    }

    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(file).pipe(res);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\nSimpleCMP demos running at http://127.0.0.1:${PORT}/`);
    console.log('  → press Ctrl+C to stop');
  });

  server.on('error', (err) => {
    console.error('Demo server error:', err.message);
    exit(1);
  });
}

// --- main -------------------------------------------------------------------

console.log('SimpleCMP demos — preflight');
await maybeStartBackend();
startStaticServer();
