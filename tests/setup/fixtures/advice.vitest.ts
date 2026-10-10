/**
 * @file The advice trap's fixture tests for Vitest (WP 0.5), run by tests/setup/harnesses.test.ts with
 * tests/setup/fixtures/vitest.config.ts. Each name says what the trap must do: a `fails:` test passes on its own and
 * fails only through the trap.
 */
import { expect, test, vi } from 'vitest';

test('passes: a listed advice code', () => {
  console.warn('[TRAP_LISTED] listed in tests/baselines/advice/trap.json');
});

test('passes: console output that is neither advice, a warning nor a deprecation', () => {
  console.log('a log line');
  console.error('an error line');
});

test('passes: a warning the test handles by spying on the console', () => {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  console.warn('[TRAP_UNLISTED] provoked on purpose');
  expect(spy).toHaveBeenCalledOnce();
  spy.mockRestore();
});

test('fails: an unlisted advice code', () => {
  console.info('[TRAP_UNLISTED] nobody listed this code');
});

test('fails: an unlisted console.warn', () => {
  console.warn('a plain warning nobody listed');
});

test('fails: a three.js deprecation', () => {
  console.log('THREE.Fixture: .old() is deprecated. Use .new() instead.');
});
