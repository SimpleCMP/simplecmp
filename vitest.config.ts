import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Post-REQ-17 the test pipeline is genuinely minimal: no JSX-in-JS
 * transform (Klaro/Preact gone), no `.js`→`.ts` resolver gap (no JS
 * files in `src/` anymore), no CSS/YAML plugins. happy-dom carries the
 * DOM; everything else runs through Vite's defaults.
 */
export default defineConfig({
  define: {
    VERSION: JSON.stringify('0.0.1'),
  },
  test: {
    environment: 'happy-dom',
    // happy-dom auto-fetches script src / iframe src / etc by default. The
    // recorder DOM-watcher tests insert real-looking URLs to exercise the
    // observer, and we don't want happy-dom to actually go to the network
    // (which would fail with ECONNREFUSED / ENOTFOUND). Disable all
    // resource fetching — tests provide synthetic data.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          disableIframePageLoading: true,
          disableComputedStyleRendering: true,
        },
      },
    },
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules', 'dist', 'tests', '**/*.test.ts', '**/*.spec.ts', '**/*.config.ts'],
    },
  },
});
