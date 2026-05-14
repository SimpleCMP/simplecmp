/**
 * Post-build sync: copy `dist/simplecmp.global.js` to the simplecmp-typo3
 * extension if a local checkout is available.
 *
 * Auto-discovers known locations. Silent no-op if no target dir exists —
 * contributors without a TYPO3 dev environment don't pay any cost.
 * Override with the SIMPLECMP_TYPO3_PATH env var.
 *
 * Runs as part of `pnpm build`. Standalone: `pnpm build:sync-typo3`.
 */
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd, env } from 'node:process';

const ROOT = cwd();
const SOURCE = resolve(ROOT, 'dist/simplecmp.global.js');
const TARGET_RELATIVE = 'Resources/Public/JavaScript/simplecmp.global.js';

if (!existsSync(SOURCE)) {
  console.error(
    `[sync-typo3] source bundle missing at ${SOURCE} — did you run \`pnpm build\` first?`
  );
  process.exit(1);
}

const candidates = [];
if (env.SIMPLECMP_TYPO3_PATH) {
  candidates.push(resolve(env.SIMPLECMP_TYPO3_PATH));
}
candidates.push(
  resolve(ROOT, '..', 'simplecmp-typo3'),
  resolve(ROOT, '..', 'dev14', 'vendor', 'wapplersystems', 'simplecmp-typo3')
);

let synced = false;
for (const dir of candidates) {
  if (!existsSync(dir)) continue;
  if (!statSync(dir).isDirectory()) continue;
  const target = resolve(dir, TARGET_RELATIVE);
  copyFileSync(SOURCE, target);
  console.log(`[sync-typo3] synced bundle → ${target}`);
  synced = true;
}

if (!synced) {
  // Quiet exit — contributors without a local typo3 extension don't need to see this.
}
