#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Rebuild the live service-DB SQLite from the SimpleCMP/services-library
 * GitHub repo. Designed to run hourly via cron / Coolify scheduled task.
 *
 * Pipeline:
 *   1. Ensure $SIMPLECMP_LIBRARY_PATH contains a clone of the upstream
 *      repo; pull --ff-only if it does.
 *   2. Build a fresh SQLite at <db>.new from $libdir/data/services.
 *   3. Atomic-rename <db>.new → <db>. Old workers keep their handle to
 *      the previous inode; new requests see the rebuilt file.
 *
 * Failure modes (each: log, non-zero exit, leave existing DB untouched):
 *   - clone/pull failure (network, repo gone)
 *   - empty/missing data directory (refuse to deploy an empty DB)
 *   - any exception during build
 *
 * Env vars:
 *   SIMPLECMP_LIBRARY_PATH   default: ../var/services-library
 *   SIMPLECMP_LIBRARY_REPO   default: https://github.com/SimpleCMP/services-library.git
 *   SIMPLECMP_LIBRARY_BRANCH default: main
 *   SIMPLECMP_DB_PATH        default: ../var/service-db.sqlite
 */

use SimpleCmp\ServiceDb\Database;
use SimpleCmp\ServiceDb\Seeder;

$root = dirname(__DIR__);
require_once $root . '/vendor/autoload.php';

$libPath = getenv('SIMPLECMP_LIBRARY_PATH') ?: ($root . '/var/services-library');
$repoUrl = getenv('SIMPLECMP_LIBRARY_REPO') ?: 'https://github.com/SimpleCMP/services-library.git';
$branch = getenv('SIMPLECMP_LIBRARY_BRANCH') ?: 'main';
$dbPath = getenv('SIMPLECMP_DB_PATH') ?: ($root . '/var/service-db.sqlite');

$logPrefix = '[rebuild]';
$log = static function (string $msg) use ($logPrefix): void {
    fwrite(STDOUT, $logPrefix . ' ' . $msg . "\n");
};

function fail(string $msg, int $code = 1): never
{
    fwrite(STDERR, '[rebuild] ERROR: ' . $msg . "\n");
    exit($code);
}

function run(array $cmd, ?string $cwd = null): string
{
    $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = proc_open($cmd, $descriptors, $pipes, $cwd, null);
    if (!is_resource($proc)) {
        fail('Could not spawn: ' . implode(' ', $cmd));
    }
    $stdout = stream_get_contents($pipes[1]) ?: '';
    $stderr = stream_get_contents($pipes[2]) ?: '';
    fclose($pipes[1]);
    fclose($pipes[2]);
    $status = proc_close($proc);
    if ($status !== 0) {
        fail(sprintf("`%s` exited %d: %s", implode(' ', $cmd), $status, trim($stderr)));
    }
    return trim($stdout);
}

// --- 1. clone or pull ---------------------------------------------------------

if (!is_dir($libPath . '/.git')) {
    $parent = dirname($libPath);
    if (!is_dir($parent)) {
        mkdir($parent, 0775, true);
    }
    $log("cloning {$repoUrl} into {$libPath}");
    run(['git', 'clone', '--depth', '1', '--branch', $branch, $repoUrl, $libPath]);
} else {
    $log("pulling {$libPath}");
    run(['git', '-C', $libPath, 'fetch', '--depth', '1', 'origin', $branch]);
    run(['git', '-C', $libPath, 'reset', '--hard', 'origin/' . $branch]);
}

$sha = run(['git', '-C', $libPath, 'rev-parse', 'HEAD']);
$log("HEAD = {$sha}");

// The reference-server's composer.json doesn't require services-library
// as a dependency — we pull it from git on every rebuild and load the
// class directly from the freshly cloned source. This keeps the data
// pipeline and the schema source in lockstep without a re-deploy
// every time services-library cuts a release.
$servicesLibraryClass = $libPath . '/src/ServicesLibrary.php';
if (!is_file($servicesLibraryClass)) {
    fail('Cloned services-library is missing src/ServicesLibrary.php at ' . $servicesLibraryClass);
}
require_once $servicesLibraryClass;

// --- 2. build fresh SQLite ----------------------------------------------------

$dataDir = $libPath . '/data/services';
if (!is_dir($dataDir)) {
    fail('Library data directory missing: ' . $dataDir);
}
$fileCount = count(glob($dataDir . '/*.json') ?: []);
if ($fileCount === 0) {
    fail('Library data directory is empty: ' . $dataDir);
}

$dbDir = dirname($dbPath);
if (!is_dir($dbDir)) {
    mkdir($dbDir, 0775, true);
}

$tmpPath = $dbPath . '.new';
if (file_exists($tmpPath)) {
    @unlink($tmpPath);
    @unlink($tmpPath . '-wal');
    @unlink($tmpPath . '-shm');
}

$start = microtime(true);

$tmpDb = new Database('sqlite:' . $tmpPath);
$tmpDb->ensureSchema();
$count = (new Seeder($tmpDb))->seedFromDirectory($dataDir);

if ($count < 1) {
    @unlink($tmpPath);
    fail('Seeder produced zero rows from ' . $dataDir);
}

$nowIso = gmdate('Y-m-d\TH:i:s\Z');
$tmpDb->setMeta('lastSyncAt', $nowIso);
$tmpDb->setMeta('sourceSha', $sha);
$tmpDb->setMeta('serviceCount', (string)$count);
// Content hash over the seed data only — README/CI/scripts don't move it.
// Consumers compare this against ServicesLibrary::dataHash() on their
// bundled copy to detect drift without false positives from docs commits.
$tmpDb->setMeta('dataHash', \SimpleCMP\ServicesLibrary\ServicesLibrary::dataHash($dataDir));

// Force the WAL into the main file so the rename swaps everything at once.
// VACUUM rewrites the file in a single transaction and effectively
// checkpoints WAL.
$tmpDb->pdo()->exec('VACUUM;');
unset($tmpDb);

// --- 3. atomic rename ---------------------------------------------------------

if (!rename($tmpPath, $dbPath)) {
    @unlink($tmpPath);
    fail('Atomic rename failed: ' . $tmpPath . ' -> ' . $dbPath);
}

// Drop stale WAL/SHM from the previous instance — they belong to the
// old inode, not the new file. SQLite will recreate them on next open.
@unlink($dbPath . '-wal');
@unlink($dbPath . '-shm');

$elapsed = round((microtime(true) - $start) * 1000);
$log(sprintf(
    'rebuilt %s with %d services, sha=%s (%d ms)',
    $dbPath,
    $count,
    substr($sha, 0, 7),
    $elapsed
));
