import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/**
 * SimpleCMP build configuration.
 *
 * Two output targets (ADR-0008):
 * - **ESM** (.mjs) for modern bundlers and Node.js with `type: module`.
 *   This is the canonical artifact.
 * - **IIFE** (.global.js) for direct browser inclusion via `<script>`.
 *   Exposes the global `SimpleCMP` namespace.
 *
 * No CJS — pre-1.0 SimpleCMP only supports ESM consumers. Bundlers and
 * modern Node (≥ 20) handle ESM natively. The IIFE bundle covers the
 * "no build step" use case (CDN drop-in).
 *
 * The build is deliberately minimal: no JSX, no SCSS, no YAML plugin.
 * Translations are JSON (REQ-15); UI is Lit (REQ-14); themes are plain
 * CSS files copied via `build:themes`.
 */

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const sharedDefine = {
  VERSION: JSON.stringify(pkg.version),
  // Default/full builds bundle all locale packs (ADR-0018). The slim "core"
  // IIFE target overrides this to 'true' so only English is bundled.
  SLIM_BUILD: 'false',
} as const;

export default defineConfig([
  // ESM build with type definitions. Two entries:
  //  - `simplecmp` — full library (engine + UI + recorder + service-db).
  //  - `engine`    — UI-free headless surface (REQ-N2); reached via the
  //    `simplecmp/engine` subpath export in `package.json`.
  {
    entry: {
      simplecmp: 'src/index.ts',
      engine: 'src/engine/index.ts',
      // ADR-0013 Phase 0 — runtime patches for universal pre-consent
      // blocking, prototype on feature/universal-blocking. Drop this
      // entry when Phase 0 exits with a redesign (else keep through to
      // Phase 2 productionisation).
      'runtime-patches': 'src/runtime-patches/index.ts',
    },
    format: ['esm'],
    outDir: 'dist',
    outExtension: () => ({ js: '.mjs' }),
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    target: 'es2020',
    esbuildOptions(options) {
      options.define = { ...(options.define ?? {}), ...sharedDefine };
    },
  },
  // Browser global (IIFE) for direct <script> inclusion
  {
    entry: { simplecmp: 'src/index.ts' },
    format: ['iife'],
    outDir: 'dist',
    outExtension: () => ({ js: '.global.js' }),
    globalName: 'SimpleCMP',
    sourcemap: true,
    clean: false,
    minify: true,
    target: 'es2020',
    platform: 'browser',
    esbuildOptions(options) {
      options.define = { ...(options.define ?? {}), ...sharedDefine };
    },
  },
  // Browser global (IIFE), slim "core" build — English-only translations
  // (ADR-0018). Same global (`SimpleCMP`); hosts that know the active locale at
  // render time (Shopify Liquid, TYPO3) inject it via `config.translations` and
  // ship ~the other 25 packs lighter. `SLIM_BUILD` is defined `true` so the
  // non-English packs are tree-shaken out.
  {
    entry: { 'simplecmp.core': 'src/index.ts' },
    format: ['iife'],
    outDir: 'dist',
    outExtension: () => ({ js: '.global.js' }),
    globalName: 'SimpleCMP',
    sourcemap: true,
    clean: false,
    minify: true,
    target: 'es2020',
    platform: 'browser',
    esbuildOptions(options) {
      options.define = {
        ...(options.define ?? {}),
        ...sharedDefine,
        SLIM_BUILD: 'true',
      };
    },
  },
  // Critical-core ESM build with code-splitting (ADR-0019). `src/core.ts` arms
  // pre-consent blocking + Consent Mode synchronously and dynamic-imports
  // `src/deferred.ts` (the Lit UI + recorder) at idle; esbuild `splitting`
  // emits that deferred tier as a separate chunk fetched/parsed off the
  // critical path, so the synchronous on-load parse stays small (recovers the
  // mobile LCP the full bundle's parse was blocking). English-only
  // (`SLIM_BUILD`). Managed hosts load `dist/core.mjs` as an ES module; the
  // browser resolves the deferred chunk relatively — no host-supplied URL.
  {
    entry: { core: 'src/core.ts' },
    format: ['esm'],
    outDir: 'dist',
    // `.js` (not `.mjs`): the package is `type: module`, so `.js` is still ESM,
    // and Shopify theme-app-extension assets reject `.mjs`. Emitting `.js` keeps
    // core.js + its split chunks' internal import specifiers consistent and
    // vendorable straight into the extension's assets/.
    outExtension: () => ({ js: '.js' }),
    splitting: true,
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    minify: true,
    target: 'es2020',
    platform: 'browser',
    esbuildOptions(options) {
      options.define = {
        ...(options.define ?? {}),
        ...sharedDefine,
        SLIM_BUILD: 'true',
      };
    },
  },
]);
