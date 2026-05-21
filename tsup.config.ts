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
]);
