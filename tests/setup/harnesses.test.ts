/**
 * @file The advice trap in both harnesses (WP 0.5): runs the fixture tests of tests/setup/fixtures/ in Vitest (with
 * vite.config.ts's own settings) and in Playwright Test (with the e2e fixture), and checks that every `passes:` test
 * passed and every `fails:` test failed through the trap, naming what it printed and the allow-list fix.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = 'tests/setup/fixtures';

/** What the trap must print for each `fails:` fixture, by test name. */
const PRINTED: Record<string, string> = {
  'fails: an unlisted advice code': 'console.info "[TRAP_UNLISTED] nobody listed this code"',
  'fails: an unlisted console.warn': 'console.warn "a plain warning nobody listed"',
  'fails: a three.js deprecation': 'console.log "THREE.Fixture: .old() is deprecated. Use .new() instead."',
};

/** Checks one harness's outcomes: `passes:` tests passed, `fails:` tests failed with the trap's message. */
function expectOutcomes(outcomes: { title: string; ok: boolean; message: string }[], fails: number): void {
  expect(outcomes.filter((outcome) => outcome.title.startsWith('fails:'))).toHaveLength(fails);
  for (const { title, ok, message } of outcomes) {
    if (title.startsWith('passes:')) expect(ok, `${title}: ${message}`).toBe(true);
    else {
      expect(ok, `${title} passed, but the trap should have failed it`).toBe(false);
      expect(message).toContain('unlisted warning');
      expect(message).toContain(PRINTED[title]);
      expect(message).toContain('tests/baselines/advice/<area>.json');
    }
  }
}

describe('the advice trap', () => {
  it('is the setup file of every Vitest run (vite.config.ts)', () => {
    expect(config.test?.setupFiles).toEqual(['tests/setup/adviceTrap.ts']);
  });

  it('fails a Vitest test on an unlisted warning and passes it on a listed one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'x-trap-vitest-'));
    try {
      const report = join(dir, 'report.json');
      const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
      const run = spawnSync(
        process.execPath,
        [vitest, 'run', '--config', `${FIXTURES}/vitest.config.ts`, `--outputFile.json=${report}`],
        { cwd: ROOT, encoding: 'utf8' },
      );
      expect(run.status, run.stdout + run.stderr).toBe(1);
      const files = (
        JSON.parse(readFileSync(report, 'utf8')) as {
          testResults: {
            name: string;
            message: string;
            assertionResults: { title: string; status: string; failureMessages: string[] }[];
          }[];
        }
      ).testResults;
      const advice = files.find((file) => file.name.endsWith('advice.vitest.ts'));
      const outcomes = (advice?.assertionResults ?? []).map((test) => ({
        title: test.title,
        ok: test.status === 'passed',
        message: test.failureMessages.join('\n'),
      }));
      expect(outcomes).toHaveLength(6);
      expectOutcomes(outcomes, 3);
      // A warning outside any test fails its file, though the file's one test passed.
      const stray = files.find((file) => file.name.endsWith('stray.vitest.ts'));
      expect(stray?.assertionResults.map((test) => test.status)).toEqual(['passed']);
      expect(stray?.message).toContain('1 unlisted warning outside any test of this file');
      expect(stray?.message).toContain('at tests/setup/fixtures/stray.vitest.ts:7:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a Playwright test on an unlisted warning and passes it on a listed one (the e2e fixture)', () => {
    // Without Vitest's variables, so the trap installs no Vitest hooks in Playwright's processes.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
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
        message: spec.tests.flatMap((test) => test.results.map((result) => result.error?.message ?? '')).join('\n'),
      }));
    expect(outcomes).toHaveLength(5);
    expectOutcomes(outcomes, 3);
  }, 120_000);
});
