<?php

declare(strict_types=1);

namespace SimpleCmp\ServiceDb;

use PDO;
use PDOException;

/**
 * SQLite-backed storage for service-DB seeds. Idempotent schema init —
 * call ensureSchema() on every request, it's a no-op once the tables
 * exist. Seeds are loaded from JSON files via Seeder.
 */
final class Database
{
    private PDO $pdo;

    public function __construct(string $dsn)
    {
        try {
            $this->pdo = new PDO($dsn, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
        } catch (PDOException $e) {
            throw new \RuntimeException('Could not open service-db: ' . $e->getMessage(), 0, $e);
        }
        // Foreign keys + WAL for sane SQLite defaults
        $this->pdo->exec('PRAGMA foreign_keys = ON;');
        $this->pdo->exec('PRAGMA journal_mode = WAL;');
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    public function ensureSchema(): void
    {
        $this->pdo->exec(
            <<<SQL
            CREATE TABLE IF NOT EXISTS services (
                id           TEXT PRIMARY KEY,
                payload      TEXT NOT NULL,        -- full JSON blob
                updated_at   INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS service_cookies (
                service_id   TEXT NOT NULL,
                pattern      TEXT NOT NULL,        -- exact name OR /regex/ string
                is_regex     INTEGER NOT NULL,     -- 0 = exact, 1 = regex
                FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_service_cookies_service ON service_cookies(service_id);
            CREATE TABLE IF NOT EXISTS service_origins (
                service_id   TEXT NOT NULL,
                pattern      TEXT NOT NULL,        -- exact host OR *.suffix OR /regex/
                kind         TEXT NOT NULL,        -- 'exact' | 'suffix' | 'regex'
                FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_service_origins_service ON service_origins(service_id);
            SQL
        );
    }

    public function count(): int
    {
        $stmt = $this->pdo->query('SELECT COUNT(*) AS n FROM services');
        $row = $stmt ? $stmt->fetch() : null;
        return is_array($row) ? (int)($row['n'] ?? 0) : 0;
    }
}
