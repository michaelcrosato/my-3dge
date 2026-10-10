/**
 * @file An advice-trap fixture for Vitest (WP 0.5): a warning printed at the top level, outside any test, fails the
 * file even though its test passes. Run by tests/setup/harnesses.test.ts with tests/setup/fixtures/vitest.config.ts.
 */
import { test } from 'vitest';

console.warn('[TRAP_UNLISTED] printed at the top level of the file');

test('passes: a test that prints nothing', () => {});
