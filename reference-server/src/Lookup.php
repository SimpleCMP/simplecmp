<?php

declare(strict_types=1);

namespace SimpleCmp\ServiceDb;

use PDO;

/**
 * Match queries against the seeded services. Mirrors the matching rules
 * the SimpleCMP frontend's LocalClassifier uses: exact-match cookie names,
 * regex cookie patterns, exact / `*.suffix` / regex origin patterns.
 *
 * Phase 3 keeps this simple — for ~50 seeded services, scanning all
 * matchers is fine. If/when the catalog grows, swap in pre-computed
 * lookup tables or a reverse index.
 */
final class Lookup
{
    public function __construct(private readonly Database $db) {}

    /**
     * Look up by cookie name. Returns matching services.
     * @return list<array<string, mixed>>
     */
    public function byCookie(string $name): array
    {
        $pdo = $this->db->pdo();
        $stmt = $pdo->query(
            'SELECT s.id, s.payload, c.pattern, c.is_regex
             FROM services s
             INNER JOIN service_cookies c ON c.service_id = s.id'
        );
        $matched = [];
        $seen = [];
        if ($stmt) {
            foreach ($stmt as $row) {
                $isRegex = (int)$row['is_regex'] === 1;
                $hit = $isRegex
                    ? @preg_match('#' . $row['pattern'] . '#', $name) === 1
                    : $row['pattern'] === $name;
                if ($hit && !isset($seen[$row['id']])) {
                    $payload = json_decode((string)$row['payload'], true);
                    if (is_array($payload)) {
                        $matched[] = $payload;
                        $seen[$row['id']] = true;
                    }
                }
            }
        }
        return $matched;
    }

    /**
     * Look up by origin (host). Returns matching services.
     * @return list<array<string, mixed>>
     */
    public function byOrigin(string $host): array
    {
        $pdo = $this->db->pdo();
        $stmt = $pdo->query(
            'SELECT s.id, s.payload, o.pattern, o.kind
             FROM services s
             INNER JOIN service_origins o ON o.service_id = s.id'
        );
        $matched = [];
        $seen = [];
        if ($stmt) {
            foreach ($stmt as $row) {
                $hit = match ($row['kind']) {
                    'exact'  => $row['pattern'] === $host,
                    'suffix' => $host === $row['pattern']
                                 || str_ends_with($host, '.' . $row['pattern']),
                    // Anchored full-host match, mirroring the client's
                    // `originMatches` (`^(?:source)$`): an unanchored host regex
                    // lets a substring impersonate a service — `/tracker\.com/`
                    // would otherwise match `eviltracker.com.attacker.net`. The
                    // `(?:…)` group wraps any top-level alternation in the source.
                    // (Cookie regexes above stay partial — intentional prefix
                    // matchers, matching the client.)
                    'regex'  => @preg_match('#^(?:' . $row['pattern'] . ')$#', $host) === 1,
                    default  => false,
                };
                if ($hit && !isset($seen[$row['id']])) {
                    $payload = json_decode((string)$row['payload'], true);
                    if (is_array($payload)) {
                        $matched[] = $payload;
                        $seen[$row['id']] = true;
                    }
                }
            }
        }
        return $matched;
    }

    /**
     * Return all services, optionally paginated.
     * @return list<array<string, mixed>>
     */
    public function all(int $limit = 100, int $offset = 0): array
    {
        $pdo = $this->db->pdo();
        $stmt = $pdo->prepare('SELECT payload FROM services ORDER BY id LIMIT :limit OFFSET :offset');
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $out = [];
        while ($row = $stmt->fetch()) {
            $payload = json_decode((string)$row['payload'], true);
            if (is_array($payload)) $out[] = $payload;
        }
        return $out;
    }

    public function getById(string $id): ?array
    {
        $pdo = $this->db->pdo();
        $stmt = $pdo->prepare('SELECT payload FROM services WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!is_array($row)) return null;
        $payload = json_decode((string)$row['payload'], true);
        return is_array($payload) ? $payload : null;
    }
}
