/**
 * Demo CMS-bridge webhook receiver.
 *
 * Receives POSTs the SimpleCMP CMS bridge sends (`docs/cms-bridge-webhook.md`)
 * and keeps the last N payloads in memory so the demo HTML can render them
 * live. Standalone Node HTTP server, no external deps.
 *
 *   node demos/cms-bridge-receiver.mjs            # port 8787
 *   node demos/cms-bridge-receiver.mjs --port 9000
 *
 * Endpoints:
 *   POST /webhook           Accepts the bridge payload. Returns 200.
 *   GET  /received          Returns the in-memory ring buffer as JSON.
 *   GET  /health            Returns { ok: true, count: <number> }.
 *   POST /clear             Empties the ring buffer.
 *
 * CORS is wide open (Access-Control-Allow-Origin: *) so any demo origin
 * (typically http://127.0.0.1:5173) can POST without preflight failures.
 * This is a demo, not a production endpoint.
 */

import { createServer } from 'node:http';
import { argv } from 'node:process';

const portArgIndex = argv.indexOf('--port');
const PORT = portArgIndex >= 0 ? Number(argv[portArgIndex + 1]) : 8787;
const RING_BUFFER_SIZE = 50;

/** Newest-first ring buffer of received payloads. */
const received = [];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

const server = createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (req.method === 'GET' && urlPath === '/health') {
    jsonResponse(res, 200, { ok: true, count: received.length });
    return;
  }

  if (req.method === 'GET' && urlPath === '/received') {
    jsonResponse(res, 200, { items: received });
    return;
  }

  if (req.method === 'POST' && urlPath === '/clear') {
    received.length = 0;
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && urlPath === '/webhook') {
    let payload;
    try {
      const body = await readBody(req);
      payload = JSON.parse(body);
    } catch {
      jsonResponse(res, 400, { error: 'invalid JSON' });
      return;
    }
    const entry = { receivedAt: new Date().toISOString(), payload };
    received.unshift(entry);
    if (received.length > RING_BUFFER_SIZE) received.length = RING_BUFFER_SIZE;
    const id = payload?.detection?.identifier ?? '(no detection)';
    console.log(`← ${payload?.detection?.kind ?? '?'} ${id} (source=${payload?.source ?? '?'})`);
    jsonResponse(res, 200, { ok: true });
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CMS bridge receiver listening on http://127.0.0.1:${PORT}/`);
  console.log('  webhook  POST /webhook');
  console.log('  buffer   GET  /received   (last 50, newest first)');
  console.log('  health   GET  /health');
  console.log('  clear    POST /clear');
});
