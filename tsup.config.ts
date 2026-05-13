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
 * modern Node (≥ 18.18) handle ESM natively. The IIFE bundle covers the
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
  // ESM build with type definitions
  {
    entry: { simplecmp: 'src/index.ts' },
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
