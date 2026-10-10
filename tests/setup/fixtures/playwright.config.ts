/**
 * @file Playwright Test's settings for the advice trap's fixture specs (WP 0.5): `*.pw.ts` here, on the platform's
 * Chromium with the e2e launch options, with no dev server (the specs print from a blank page), writing to
 * out/advice-trap/ so a concurrent `npm run e2e`, which empties test-results/, never touches it. Only
 * tests/setup/harnesses.test.ts runs them; `npm run e2e` never does, since its suites live in tests/e2e/.
 */
import { defineConfig } from '@playwright/test';
import { launchOptions, VIEWPORT } from '../../../tools/lib/browser';

export default defineConfig({
  testDir: '.',
  testMatch: '*.pw.ts',
  outputDir: '../../../out/advice-trap',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: { viewport: VIEWPORT },
  projects: [{ name: 'webgpu', use: { browserName: 'chromium', launchOptions: launchOptions() } }],
});
