<?php

declare(strict_types=1);

/**
 * SimpleCMP Service-DB reference backend — REQ-8 / ADR-0005.
 *
 * Tiny hand-rolled router. Six routes total, no framework:
 *
 *   GET  /v1/health
 *   GET  /v1/services
 *   GET  /v1/services?cookie=<name>
 *   GET  /v1/services?origin=<host>
 *   GET  /v1/services/:id
 *   POST /v1/lookup
 *
 * Run via `ddev start` — see ../README.md.
 */

use SimpleCmp\ServiceDb\Database;
use SimpleCmp\ServiceDb\Lookup;
use SimpleCmp\ServiceDb\Seeder;

$root = dirname(__DIR__);
require_once $root . '/vendor/autoload.php';

// --- bootstrap ---------------------------------------------------------------

$dbPath = getenv('SIMPLECMP_DB_PATH') ?: ($root . '/var/service-db.sqlite');
$dbDir = dirname($dbPath);
if (!is_dir($dbDir)) {
    mkdir($dbDir, 0775, true);
}
$db = new Database('sqlite:' . $dbPath);
$db->ensureSchema();

// First-run seeding: if the table is empty, ingest the seeds dir.
if ($db->count() === 0) {
    $seedsDir = $root . '/seeds/services';
    if (is_dir($seedsDir)) {
        (new Seeder($db))->seedFromDirectory($seedsDir);
    }
}

$lookup = new Lookup($db);

// --- helpers ----------------------------------------------------------------

function send_json(mixed $body, int $status = 200, array $extraHeaders = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    foreach ($extraHeaders as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function send_error(string $message, int $status = 400): void
{
    send_json(['error' => $message], $status, ['Cache-Control' => 'no-store']);
}

/**
 * Send a JSON payload with ETag + Cache-Control. Honours If-None-Match
 * (returns 304 with no body). Used for the publicly cached /v1/services* routes.
 */
function send_cacheable_json(mixed $body): void
{
    $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $etag = '"' . substr(hash('sha256', (string)$json), 0, 32) . '"';
    $ifNoneMatch = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    $cacheControl = 'public, max-age=3600, stale-while-revalidate=86400';

    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Cache-Control: ' . $cacheControl);
    header('ETag: ' . $etag);

    if ($ifNoneMatch !== '' && trim($ifNoneMatch) === $etag) {
        http_response_code(304);
        return;
    }

    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo $json;
}

// --- routing ----------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($method === 'OPTIONS') {
    send_json([], 204);
    exit;
}

// /v1/health
if ($method === 'GET' && $path === '/v1/health') {
    $count = $db->count();
    $lastSync = $db->getMeta('lastSyncAt');
    $sourceSha = $db->getMeta('sourceSha');
    send_json([
        'status' => $count > 0 ? 'ok' : 'empty',
        'schemaVersion' => 1,
        'serviceCount' => $count,
        'lastSyncAt' => $lastSync,
        'sourceSha' => $sourceSha,
    ], 200, ['Cache-Control' => 'no-store']);
    exit;
}

// /v1/services + filters
if ($method === 'GET' && $path === '/v1/services') {
    $cookie = $_GET['cookie'] ?? null;
    $origin = $_GET['origin'] ?? null;
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    if (is_string($cookie)) {
        $items = $lookup->byCookie($cookie);
    } elseif (is_string($origin)) {
        $items = $lookup->byOrigin($origin);
    } else {
        $items = $lookup->all($limit, $offset);
    }

    send_cacheable_json([
        'items' => $items,
        'total' => $db->count(),
        'limit' => $limit,
        'offset' => $offset,
    ]);
    exit;
}

// /v1/services/:id
if ($method === 'GET' && preg_match('#^/v1/services/([\w-]+)$#', $path, $m)) {
    $service = $lookup->getById($m[1]);
    if ($service === null) {
        send_error('Service not found', 404);
        exit;
    }
    send_cacheable_json($service);
    exit;
}

// /v1/lookup (batch)
if ($method === 'POST' && $path === '/v1/lookup') {
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body) || !isset($body['items']) || !is_array($body['items'])) {
        send_error('Body must be { "items": [...] }', 400);
        exit;
    }
    $results = [];
    foreach ($body['items'] as $query) {
        if (!is_array($query)) {
            $results[] = ['query' => null, 'matches' => []];
            continue;
        }
        $matches = [];
        if (isset($query['cookie']) && is_string($query['cookie'])) {
            $matches = $lookup->byCookie($query['cookie']);
        } elseif (isset($query['origin']) && is_string($query['origin'])) {
            $matches = $lookup->byOrigin($query['origin']);
        }
        $results[] = ['query' => $query, 'matches' => $matches];
    }
    send_json(['items' => $results]);
    exit;
}

send_error('Not found', 404);
