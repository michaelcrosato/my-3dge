/**
 * @file The advice trap's fixture specs for the e2e fixture (WP 0.5), run by tests/e2e/adviceTrap.spec.ts with
 * tests/setup/fixtures/playwright.config.ts. Each name says what the trap must do: a `fails:` spec passes on its own
 * and fails only through the fixture's trap.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../../e2e/fixtures';

/** Prints `text` through the page's `console[level]` and waits until the fixture has recorded it. */
async function print(page: Page, level: 'warn' | 'info' | 'log', text: string): Promise<void> {
  await Promise.all([
    page.waitForEvent('console'),
    page.evaluate(([method, line]) => console[method](line), [level, text] as const),
  ]);
}

test('passes: a listed advice code', async ({ page }) => {
  await print(page, 'warn', '[TRAP_LISTED] listed in tests/baselines/advice/trap.json');
});

test('passes: advice the test reads through harness.advice()', async ({ page, harness }) => {
  await print(page, 'warn', '[TRAP_UNLISTED] provoked on purpose');
  expect(harness.advice().map((warning) => warning.code)).toEqual(['TRAP_UNLISTED']);
});

test('fails: an unlisted advice code', async ({ page }) => {
  await print(page, 'info', '[TRAP_UNLISTED] nobody listed this code');
});

test('fails: an unlisted console.warn', async ({ page }) => {
  await print(page, 'warn', 'a plain warning nobody listed');
});

test('fails: a three.js deprecation', async ({ page }) => {
  await print(page, 'log', 'THREE.Fixture: .old() is deprecated. Use .new() instead.');
});
