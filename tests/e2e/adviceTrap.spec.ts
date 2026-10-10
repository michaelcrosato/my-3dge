/**
 * @file The advice trap in the Playwright harness (WP 0.5), on Chromium: runs the fixture specs of
 * tests/setup/fixtures/ (`*.pw.ts`, with the e2e fixture) in a child Playwright Test and checks that every `passes:`
 * spec passed and every `fails:` spec failed through the trap, naming what it printed and the allow-list fix
 * (tests/setup/trapOutcomes.ts). It moved here from tests/setup/harnesses.test.ts, whose Vitest half stays in T1:
 * browser work is T2 (PLAN.md §8.2, ADR-0014 amendment 7).
 *
 * Invariants: the child gets no Vitest or Playwright worker variables, so neither harness's hooks leak into it; its
 * config starts no dev server, so it never contends for `$PORT`.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expectTrapOutcomes } from '../setup/trapOutcomes';
import { expect, test } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = 'tests/setup/fixtures';

/** Variables a test runner sets for its own workers; a child runner must start without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;

test('fails a Playwright test on an unlisted warning and passes it on a listed one (the e2e fixture)', () => {
  test.setTimeout(120_000);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const cli = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  const run = spawnSync(
    process.execPath,
    [cli, 'test', '--config', `${FIXTURES}/playwright.config.ts`, '--reporter=json'],
    { cwd: ROOT, encoding: 'utf8', env, timeout: 90_000 },
  );
  expect(run.status, run.stderr).toBe(1);
  type Spec = { title: string; ok: boolean; tests: { results: { error?: { message?: string } }[] }[] };
  const report = JSON.parse(run.stdout) as { suites: { specs: Spec[] }[]; errors: unknown[] };
  expect(report.errors).toEqual([]);
  const outcomes = report.suites
    .flatMap((suite) => suite.specs)
    .map((spec) => ({
      title: spec.title,
      ok: spec.ok,
      message: spec.tests.flatMap((entry) => entry.results.map((result) => result.error?.message ?? '')).join('\n'),
    }));
  expect(outcomes).toHaveLength(5);
  expectTrapOutcomes(expect, outcomes, 3);
});
