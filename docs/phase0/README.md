# ADR-0013 Phase 0 — measurement infrastructure

Captures the baseline TYPO3 render-time numbers on dev14 + the
synthetic worst-case page setup. Re-run `baseline.sh` after the
rewriter prototype lands to produce the comparison table.

## Pages benchmarked

| Path | Why |
|---|---|
| `/de/home` | Typical homepage with embedded content (3 SimpleCMP test embeds) |
| `/de/elemente` | Typical content page, zero third-party |
| `/de/extensions/blog/ein-testblogpost` | Long-form text page |
| `/de/extensions/blog` | Blog index (list view) |
| `/de/test-worst-case` | Synthetic — 30 third-party iframes across 6 library services |

## Baseline (cache hits, 2026-05-21, no rewriter)

| Page | min | p50 | p95 | max | bytes |
|---|---|---|---|---|---|
| `/de/home` | 80 ms | 85 ms | 95 ms | 99 ms | 105 KB |
| `/de/elemente` | 81 ms | 84 ms | 90 ms | 94 ms | 98 KB |
| `/de/extensions/blog/ein-testblogpost` | 75 ms | 79 ms | 84 ms | 84 ms | 96 KB |
| `/de/extensions/blog` | 75 ms | 80 ms | 83 ms | 87 ms | 100 KB |
| `/de/test-worst-case` | 76 ms | 80 ms | 85 ms | 89 ms | 96 KB |

Numbers are TTFB from `curl --time-starttransfer` over 20 runs per
page after a single warmup hit. dev14 is a ddev/Docker stack on
Linux; absolute numbers will differ on other hosts but the
delta-with-rewriter is the value we care about.

## Performance budget reminder (from ADR-0013)

| Tier | Typical page added | Worst-case page added |
|---|---|---|
| Target | <30 ms | <80 ms |
| Acceptable | <80 ms | <200 ms |
| Abort signal | >150 ms consistently | >400 ms consistently |

## Re-running

```sh
docs/phase0/baseline.sh
```

Hits dev14 at `https://dev14.ddev.site/de/...`. Adjust the `pages` array
in the script if URLs move.

## Worst-case page setup (idempotent re-plant)

The `/de/test-worst-case` page is hand-planted in the dev14 DB (not
in any git repo since dev14 itself isn't a repo). If the dev14 DB is
reset, recreate via:

```sql
INSERT INTO pages (
  pid, doktype, hidden, deleted, sys_language_uid, l10n_parent,
  title, slug, nav_hide, sorting, crdate, tstamp
) VALUES (
  1, 1, 0, 0, 0, 0,
  'Test worst case (rewriter benchmark)', '/test-worst-case', 1,
  9999999, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()
);
-- note the new page uid, then:
INSERT INTO tt_content (
  pid, sys_language_uid, CType, header, bodytext,
  sorting, hidden, deleted, crdate, tstamp, colPos
) VALUES (
  <page_uid>, 0, 'html', '',
  '<h1>Worst-case rewriter benchmark page</h1>...30 iframes...',
  256, 0, 0, UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), 0
);
```

The full body content lives in `worst-case-body.html` next to this
README — drop it straight into the tt_content `bodytext` field.

30 iframes spanning 6 library services: YouTube ×8, Vimeo ×5,
Spotify ×5, SoundCloud ×4, Twitch ×4, Facebook ×4. Each `<iframe>`
uses the `data-name + data-src + src=""` pattern so the existing
engine handles them; the rewriter prototype will then have to scan
+ match 30 third-party URLs against the library origin matchers.
