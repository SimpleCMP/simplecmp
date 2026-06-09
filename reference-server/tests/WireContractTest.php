<?php

declare(strict_types=1);

namespace SimpleCmp\ServiceDb\Tests;

use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * Source-level wire-contract test. Asserts that `public/index.php`
 * constructs its response bodies with the exact keys the protocol
 * promises (and the JS client expects).
 *
 * The canonical shapes live in
 * `../src/service-db/wire-contract-fixture.json` in the upstream
 * simplecmp repo — the JS-side test there pins the consumer view.
 * This test pins the producer view: someone changing
 * `'items' => $items` to `'services' => $items` (a plausibly-clearer
 * rename) silently breaks every existing client, and the only place
 * that catches it today would be a sharp-eyed reviewer.
 *
 * Closes audit P2 from 2026-05-22.
 */
final class WireContractTest extends TestCase
{
    private string $source;

    protected function setUp(): void
    {
        $this->source = (string) file_get_contents(dirname(__DIR__) . '/public/index.php');
        self::assertNotEmpty($this->source);
    }

    #[Test]
    public function listingResponseUsesItemsTotalLimitOffset(): void
    {
        // GET /v1/services returns the listing wrapper. The four keys
        // below are the contract — the JS client and any third-party
        // consumer key on them.
        self::assertStringContainsString("'items' => \$items", $this->source);
        self::assertStringContainsString("'total' => \$db->count()", $this->source);
        self::assertStringContainsString("'limit' => \$limit", $this->source);
        self::assertStringContainsString("'offset' => \$offset", $this->source);

        // Negative: someone renaming the container key to 'services'
        // breaks the contract. Catch the most likely rename.
        self::assertStringNotContainsString("'services' => \$items", $this->source);
    }

    #[Test]
    public function lookupBatchResponseUsesItemsArrayWithQueryAndMatches(): void
    {
        // POST /v1/lookup returns { items: [{ query, matches }] }.
        // The construction is `$results[] = ['query' => ..., 'matches' => ...]`
        // followed by `send_json(['items' => $results])`.
        self::assertStringContainsString("'query' =>", $this->source);
        self::assertStringContainsString("'matches' =>", $this->source);
        self::assertStringContainsString("send_json(['items' => \$results])", $this->source);
    }

    #[Test]
    public function healthResponseEmitsOkAndCountContractKeys(): void
    {
        // GET /v1/health must emit the `ok` (boolean) + `count` keys the JS
        // HealthResponse type, the protocol doc, and wire-contract-fixture.json
        // all promise. The server also emits operational extras
        // (status/serviceCount/sourceSha) — those stay, but the contract keys
        // must not regress (they were missing before, so a JS client reading
        // `.ok` / `.count` got undefined against the real server).
        self::assertStringContainsString("'ok' => \$count > 0", $this->source);
        self::assertStringContainsString("'count' => \$count", $this->source);
        self::assertStringContainsString("'schemaVersion' => 1", $this->source);
        // Operational extras kept (the TYPO3 ext + monitoring read these).
        self::assertStringContainsString("'serviceCount' => \$count", $this->source);
    }

    #[Test]
    public function lookupBatchRequestExpectsItemsArray(): void
    {
        // Request body must be { items: [...] } — symmetric with the
        // response. The validator must reject anything else with 400.
        self::assertStringContainsString("isset(\$body['items'])", $this->source);
        self::assertStringContainsString("Body must be { \"items\": [...] }", $this->source);
    }
}
