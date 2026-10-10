/**
 * @file Vite's settings (the dev server; WP 0.12 sets what the build takes) and Vitest's (T1), in one file as
 * Vitest expects (PLAN.md §6.10, WP 0.2).
 *
 * Invariants: every lab page (`labs/<name>/index.html`) and test page (`tests/pages/<name>.html`) is served as its
 * own page, and a missing page is a 404 (`appType: 'mpa'`). A bare `three` resolves to `three/webgpu`, as three.js's
 * WebGPU examples map it. The runtime dependencies are pre-bundled at startup, so a first page load never
 * re-optimizes and reloads (§4.7). The server listens on 127.0.0.1 and `$PORT` (default 5173). Nothing here needs
 * the network, a browser or the source checkouts (Vercel's build reads this file too).
 *
 * @see tools/lib/vite.test.ts
 */
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/** The dev server's port: `$PORT` (each ultracode lane sets its own), else 5173. */
const PORT = Number(process.env.PORT) || 5173;

export default defineConfig({
  appType: 'mpa',
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  optimizeDeps: {
    // The pages Vite scans for imports; the default (every *.html under the root) would crawl .cache/.
    entries: ['index.html', 'labs/*/index.html', 'tests/pages/*.html'],
    // Every runtime dependency of package.json, by the entry points pages import (tools/lib/vite.test.ts checks it).
    include: [
      'three/webgpu',
      'three/tsl',
      '@dimforge/rapier3d-simd-compat',
      '@stdlib/math-base-special-sin',
      '@stdlib/math-base-special-cos',
      '@stdlib/math-base-special-pow',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    watch: { ignored: ['**/.cache/**', '**/out/**', '**/dist/**', '**/test-results/**'] },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '.cache/**', 'out/**', 'dist/**', 'test-results/**', 'tests/e2e/**'],
    reporters: ['dot', 'json'],
    outputFile: { json: 'out/test/report.json' },
  },
});
