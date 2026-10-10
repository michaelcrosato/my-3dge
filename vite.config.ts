/**
 * @file Vite's settings (the dev server and the build) and Vitest's (T1), in one file as Vitest expects (PLAN.md
 * §6.10, WPs 0.2 and 0.12).
 *
 * Invariants: every lab page (`labs/<name>/index.html`) and test page (`tests/pages/<name>.html`) is served as its
 * own page, and a missing page is a 404 (`appType: 'mpa'`). A bare `three` resolves to `three/webgpu`, as three.js's
 * WebGPU examples map it. The runtime dependencies are pre-bundled at startup, so a first page load never
 * re-optimizes and reloads (§4.7). The server listens on 127.0.0.1 and `$PORT` (default 5173). Every test file runs
 * the advice trap first (tests/setup/adviceTrap.ts), and `vitest --changed` reruns everything on the files that
 * tools/lib/tiers.ts's `T1_FULL` names.
 *
 * The build (`npm run build`, which Vercel runs through vercel.json) writes dist/ from the landing page (the root's
 * `index.html`) and every `labs/<name>/index.html`; test pages never ship (`harness.html` throws on purpose). A page
 * ships only what it imports, never a `fetch()` of a repository path (§6.3). Nothing here needs the network, a
 * browser, the source checkouts or an `x` command: Vercel's build and Vitest both read this file.
 *
 * @see tools/lib/vite.test.ts
 */
/// <reference types="vitest/config" />
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';
import { vitestRerunTriggers } from './tools/lib/tiers';

/** The dev server's port: `$PORT` (each ultracode lane sets its own), else 5173. */
const PORT = Number(process.env.PORT) || 5173;

/** The repository root: this file's directory. */
const ROOT = import.meta.dirname;

/** The pages a build ships, as absolute paths by entry name: `index` (the landing page), then `labs/<name>`. */
const PAGES = Object.fromEntries(
  ['index.html', ...globSync('labs/*/index.html', { cwd: ROOT }).sort()].map((page) => [
    dirname(page) === '.' ? 'index' : dirname(page),
    join(ROOT, page),
  ]),
);

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
  build: {
    rollupOptions: { input: PAGES },
    // In KB. Rapier passes its WASM to init() inline, as base64 (PLAN.md §4.8), so a page that imports it gets one
    // large chunk (about 5.4 MB, 1.86 MB gzipped) and no .wasm file: the default 500 KB would warn on every build.
    chunkSizeWarningLimit: 8000,
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
    setupFiles: ['tests/setup/adviceTrap.ts'],
    forceRerunTriggers: vitestRerunTriggers(),
  },
});
