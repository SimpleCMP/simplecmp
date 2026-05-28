#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Seed the service-DB SQLite from a directory of *.json files.
 *
 * Usage:
 *   php bin/seed.php [--source=<dir>] [--db=<path>]
 *
 * Defaults:
 *   --source = $SIMPLECMP_SEED_SOURCE or ../seeds/services
 *   --db     = $SIMPLECMP_DB_PATH     or ../var/service-db.sqlite
 *
 * Idempotent: upserts each service by id. Existing rows that are no
 * longer in the source directory are NOT removed — for a clean rebuild
 * use bin/rebuild-from-library.php instead.
 */

use SimpleCmp\ServiceDb\Database;
use SimpleCmp\ServiceDb\Seeder;

$root = dirname(__DIR__);
require_once $root . '/vendor/autoload.php';

$opts = getopt('', ['source::', 'db::']);
$source = $opts['source'] ?? getenv('SIMPLECMP_SEED_SOURCE') ?: ($root . '/seeds/services');
$dbPath = $opts['db'] ?? getenv('SIMPLECMP_DB_PATH') ?: ($root . '/var/service-db.sqlite');

$dbDir = dirname($dbPath);
if (!is_dir($dbDir)) {
    mkdir($dbDir, 0775, true);
}

$db = new Database('sqlite:' . $dbPath);
$db->ensureSchema();

$start = microtime(true);
$count = (new Seeder($db))->seedFromDirectory($source);
$elapsed = round((microtime(true) - $start) * 1000);

$db->setMeta('lastSyncAt', gmdate('Y-m-d\TH:i:s\Z'));
// dataHash is intentionally NOT set here. seed.php is the bootstrap path
// (just JSON files, no services-library checkout guaranteed), so we can't
// compute the canonical hash. The first rebuild-from-library tick — which
// always pulls the upstream repo and has the class available — populates
// the field. /v1/health omits the field until then; consumers handle that
// gracefully (BE freshness panel shows "Updates verfügbar" until first
// rebuild).

fwrite(STDOUT, sprintf(
    "[seed] %d services from %s into %s (%d ms)\n",
    $count,
    $source,
    $dbPath,
    $elapsed
));
