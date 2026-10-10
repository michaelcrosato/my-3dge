/**
 * @file The advice trap in the Vitest harness (WP 0.5): runs the fixture tests of tests/setup/fixtures/ in Vitest (with
 * vite.config.ts's own settings) and checks that every `passes:` test passed and every `fails:` test failed through
 * the trap, naming what it printed and the allow-list fix (tests/setup/trapOutcomes.ts). The Playwright half drives
 * Chromium, so it runs in T2: tests/e2e/adviceTrap.spec.ts (ADR-0014 amendment 7).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';
import { expectTrapOutcomes } from './trapOutcomes';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = 'tests/setup/fixtures';

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
      expectTrapOutcomes(expect, outcomes, 3);
      // A warning outside any test fails its file, though the file's one test passed.
      const stray = files.find((file) => file.name.endsWith('stray.vitest.ts'));
      expect(stray?.assertionResults.map((test) => test.status)).toEqual(['passed']);
      expect(stray?.message).toContain('1 unlisted warning outside any test of this file');
      expect(stray?.message).toContain('at tests/setup/fixtures/stray.vitest.ts:7:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
