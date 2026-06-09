<?php

declare(strict_types=1);

namespace SimpleCmp\ServiceDb;

use PDO;

/**
 * Loads service JSON files from disk into the SQLite database.
 *
 * Idempotent: each run replaces any prior seed of the same id. Designed for
 * dev-loop ergonomics — drop a JSON in `seeds/services/`, run a scan,
 * the row updates in place.
 */
final class Seeder
{
    public function __construct(private readonly Database $db) {}

    /**
     * Load every `*.json` under `$seedsDir` and upsert into the database.
     * Returns the number of services seeded.
     */
    public function seedFromDirectory(string $seedsDir): int
    {
        if (!is_dir($seedsDir)) {
            throw new \RuntimeException("Seeds directory not found: {$seedsDir}");
        }
        $files = glob($seedsDir . '/*.json') ?: [];
        $count = 0;
        $pdo = $this->db->pdo();
        $pdo->beginTransaction();
        try {
            foreach ($files as $file) {
                $raw = file_get_contents($file);
                if ($raw === false) {
                    continue;
                }
                $service = json_decode($raw, true);
                if (!is_array($service) || !isset($service['id']) || !is_string($service['id'])) {
                    throw new \RuntimeException("Invalid seed file: {$file}");
                }
                $this->upsert($service);
                $count++;
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return $count;
    }

    /** @param array<string, mixed> $service */
    public function upsert(array $service): void
    {
        $pdo = $this->db->pdo();
        $id = (string)($service['id'] ?? '');
        if ($id === '') {
            throw new \InvalidArgumentException('Service is missing an id');
        }

        // Merge matches.aliasOrigins into matches.origins (first-seen dedup)
        // and drop the alias key, mirroring
        // SimpleCMP\ServicesLibrary\ServicesLibrary::services() — the only
        // other path that flattens them. Both seeding entrypoints (seed.php,
        // rebuild-from-library.php) feed raw on-disk JSON straight to upsert()
        // without going through services(), so without this the hosted DB
        // silently drops alias origins (e.g. Meta's *.fbcdn.net) from both the
        // stored payload and the matcher tables — lookups against them miss.
        $service = self::flattenAliasOrigins($service);

        // Replace existing row + matchers
        $stmt = $pdo->prepare('DELETE FROM services WHERE id = :id');
        $stmt->execute(['id' => $id]);

        $insert = $pdo->prepare(
            'INSERT INTO services (id, payload, updated_at) VALUES (:id, :payload, :updated_at)'
        );
        $insert->execute([
            'id' => $id,
            'payload' => json_encode($service, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'updated_at' => time(),
        ]);

        $matchers = $service['matches'] ?? [];
        $cookies = is_array($matchers['cookies'] ?? null) ? $matchers['cookies'] : [];
        $origins = is_array($matchers['origins'] ?? null) ? $matchers['origins'] : [];

        $cookieIns = $pdo->prepare(
            'INSERT INTO service_cookies (service_id, pattern, is_regex) VALUES (:service_id, :pattern, :is_regex)'
        );
        foreach ($cookies as $entry) {
            if (!is_string($entry)) continue;
            $isRegex = str_starts_with($entry, '/') && str_ends_with($entry, '/');
            $pattern = $isRegex ? substr($entry, 1, -1) : $entry;
            $cookieIns->execute([
                'service_id' => $id,
                'pattern' => $pattern,
                'is_regex' => $isRegex ? 1 : 0,
            ]);
        }

        $originIns = $pdo->prepare(
            'INSERT INTO service_origins (service_id, pattern, kind) VALUES (:service_id, :pattern, :kind)'
        );
        foreach ($origins as $entry) {
            if (!is_string($entry)) continue;
            if (str_starts_with($entry, '*.')) {
                $originIns->execute([
                    'service_id' => $id,
                    'pattern' => substr($entry, 2),
                    'kind' => 'suffix',
                ]);
            } elseif (str_starts_with($entry, '/') && str_ends_with($entry, '/')) {
                $originIns->execute([
                    'service_id' => $id,
                    'pattern' => substr($entry, 1, -1),
                    'kind' => 'regex',
                ]);
            } else {
                $originIns->execute([
                    'service_id' => $id,
                    'pattern' => $entry,
                    'kind' => 'exact',
                ]);
            }
        }
    }

    /**
     * Merge `matches.aliasOrigins` into `matches.origins` (first-seen-wins
     * dedup, non-strings skipped) and drop the alias key, so a service seeded
     * from raw JSON ends up identical to what
     * SimpleCMP\ServicesLibrary\ServicesLibrary::services() yields to
     * bundled / vendored consumers. Kept in lockstep with that method's
     * private flattenAliasOrigins().
     *
     * @param array<string, mixed> $service
     * @return array<string, mixed>
     */
    private static function flattenAliasOrigins(array $service): array
    {
        $matches = $service['matches'] ?? null;
        if (!is_array($matches)) {
            return $service;
        }
        $aliases = $matches['aliasOrigins'] ?? null;
        if (!is_array($aliases) || $aliases === []) {
            // Strip an empty/absent-but-present alias array so consumers
            // never see the key.
            if (array_key_exists('aliasOrigins', $matches)) {
                unset($matches['aliasOrigins']);
                $service['matches'] = $matches;
            }
            return $service;
        }
        $origins = (array)($matches['origins'] ?? []);
        $seen = [];
        $merged = [];
        foreach ([...$origins, ...$aliases] as $entry) {
            if (!is_string($entry) || isset($seen[$entry])) {
                continue;
            }
            $seen[$entry] = true;
            $merged[] = $entry;
        }
        $matches['origins'] = $merged;
        unset($matches['aliasOrigins']);
        $service['matches'] = $matches;
        return $service;
    }
}
