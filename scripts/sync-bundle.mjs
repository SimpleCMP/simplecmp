/**
 * Post-build sync: copy `dist/simplecmp.global.js` to a developer-local
 * vendored location so a downstream project's checkout picks the new
 * bundle up without going through a publish round.
 *
 * Driven purely by the `SIMPLECMP_SYNC_TARGET` env var — set it to the
 * **absolute file path** where the bundle should land (the script
 * writes verbatim, no path-mangling). Leave it unset and the script is
 * a silent no-op so contributors without a downstream checkout don't
 * pay any cost.
 *
 * Example (TYPO3-CMS host):
 *
 *     export SIMPLECMP_SYNC_TARGET=/abs/path/to/t3-simplecmp/Resources/Public/JavaScript/simplecmp.global.js
 *     pnpm build
 *
 * Example (any other CMS / framework / static host): same shape — the
 * env var carries the destination file path; the script doesn't care
 * what's at the other end. Previous TYPO3-specific behaviour
 * (hardcoded candidate dirs, fixed `Resources/Public/JavaScript/...`
 * suffix) is gone — that was convenient for one maintainer and
 * confusing for everyone else.
 *
 * Runs as part of `pnpm build`. Standalone: `pnpm build:sync`.
 */
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cwd, env } from 'node:process';

const ROOT = cwd();
const SOURCE = resolve(ROOT, 'dist/simplecmp.global.js');

if (!existsSync(SOURCE)) {
  console.error(
    `[sync-bundle] source bundle missing at ${SOURCE} — did you run \`pnpm build\` first?`
  );
  process.exit(1);
}

const targetRaw = env.SIMPLECMP_SYNC_TARGET;
if (!targetRaw) {
  // No target configured. Silent exit — most contributors don't have
  // a downstream checkout and don't need to be told.
  process.exit(0);
}

const target = resolve(targetRaw);
const targetDir = dirname(target);
if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(
    `[sync-bundle] target directory does not exist: ${targetDir}\nEither create it first or update SIMPLECMP_SYNC_TARGET to point into an existing downstream checkout.`
  );
  process.exit(1);
}

copyFileSync(SOURCE, target);
console.log(`[sync-bundle] synced bundle → ${target}`);
