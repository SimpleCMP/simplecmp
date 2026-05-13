<?php

declare(strict_types=1);

namespace SimpleCmp\ServiceDb\Tests;

use PHPUnit\Framework\TestCase;
use SimpleCmp\ServiceDb\Database;
use SimpleCmp\ServiceDb\Lookup;
use SimpleCmp\ServiceDb\Seeder;

final class LookupTest extends TestCase
{
    private Database $db;
    private Lookup $lookup;

    protected function setUp(): void
    {
        $this->db = new Database('sqlite::memory:');
        $this->db->ensureSchema();

        $seeder = new Seeder($this->db);
        $seeder->upsert([
            'id' => 'google-analytics',
            'name' => 'Google Analytics',
            'vendor' => 'Google LLC',
            'purposes' => ['analytics'],
            'matches' => [
                'cookies' => ['_ga', '/_ga_/', '_gid'],
                'origins' => ['www.google-analytics.com', '*.googletagmanager.com'],
            ],
        ]);
        $seeder->upsert([
            'id' => 'unrelated',
            'name' => 'Unrelated',
            'purposes' => ['functional'],
            'matches' => [
                'cookies' => ['session'],
                'origins' => ['unrelated.test'],
            ],
        ]);

        $this->lookup = new Lookup($this->db);
    }

    public function testCookieExactMatch(): void
    {
        $matches = $this->lookup->byCookie('_ga');
        $this->assertCount(1, $matches);
        $this->assertSame('google-analytics', $matches[0]['id']);
    }

    public function testCookieRegexMatch(): void
    {
        $matches = $this->lookup->byCookie('_ga_ABC');
        $this->assertCount(1, $matches);
        $this->assertSame('google-analytics', $matches[0]['id']);
    }

    public function testCookieNoMatch(): void
    {
        $this->assertSame([], $this->lookup->byCookie('__hjid'));
    }

    public function testOriginExactMatch(): void
    {
        $matches = $this->lookup->byOrigin('www.google-analytics.com');
        $this->assertCount(1, $matches);
        $this->assertSame('google-analytics', $matches[0]['id']);
    }

    public function testOriginSuffixMatch(): void
    {
        $matches = $this->lookup->byOrigin('gtm-1.googletagmanager.com');
        $this->assertCount(1, $matches);
        $this->assertSame('google-analytics', $matches[0]['id']);
    }

    public function testOriginNoMatch(): void
    {
        $this->assertSame([], $this->lookup->byOrigin('random.example.com'));
    }

    public function testGetById(): void
    {
        $svc = $this->lookup->getById('google-analytics');
        $this->assertNotNull($svc);
        $this->assertSame('Google Analytics', $svc['name']);
        $this->assertNull($this->lookup->getById('does-not-exist'));
    }

    public function testCount(): void
    {
        $this->assertSame(2, $this->db->count());
    }

    public function testAll(): void
    {
        $all = $this->lookup->all(100, 0);
        $this->assertCount(2, $all);
    }
}
