/**
 * @file Playwright Test's settings for T2 (PLAN.md §6.10, §8.8): one project, `webgpu`, on the platform's Chromium
 * with shardfall's WebGPU flags, against a Vite dev server it starts itself.
 *
 * Invariants: the launch options come from `tools/lib/browser.ts`, so `x` commands open pages the same way. Vite
 * listens on `$PORT` (default 5173; each ultracode lane sets its own) and is never shared with another run. At most
 * 4 workers, so parallel lanes don't starve Chromium. The `line` reporter prints; the `json` reporter writes
 * `out/e2e/report.json`. Suites import `test` and `expect` from `tests/e2e/fixtures.ts`.
 *
 * @see tests/e2e/fixtures.ts
 */
import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';
import { launchOptions, VIEWPORT } from './tools/lib/browser';

/** The dev server's port: `$PORT`, else 5173 (vite.config.ts reads the same variable). */
const PORT = Number(process.env.PORT) || 5173;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  forbidOnly: true,
  retries: 0,
  workers: Math.min(4, availableParallelism()),
  reporter: [['line'], ['json', { outputFile: 'out/e2e/report.json' }]],
  use: { baseURL: `http://127.0.0.1:${PORT}/`, viewport: VIEWPORT },
  projects: [{ name: 'webgpu', use: { browserName: 'chromium', launchOptions: launchOptions() } }],
  webServer: {
    command: 'npx vite',
    url: `http://127.0.0.1:${PORT}/tests/pages/harness.html`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
