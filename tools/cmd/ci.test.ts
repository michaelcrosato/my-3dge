/**
 * @file Unit tests for `x ci --local` (tools/cmd/ci.ts) in temporary roots, with a fake step runner, git, selections
 * and clock: the step list against PLAN.md §8.9; the order, the logs and the green commit; a failed step that leaves
 * the next ones running, and a failed `npm ci` that skips them; T2 in full or selected by its last full run; the
 * budgets (fresh JSON reports read, stale ones ignored, over warns, 1.5× fails); the cache kept across `npm ci`;
 * `--long`; the summary; and the exit codes and the 20-line output through the dispatcher. The real suite never runs
 * here: `node x ci --local` is WP 0.9's Verify.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LAST_GREEN, LONG_RUNS, TIERS, type Selection } from '../lib/tiers';
import { dispatch, MAX_LINES } from '../x';
import { CI_OUT, CI_STEPS, createCiCommand, renderSummary, runCi, type CiDeps, type StepOutcome } from './ci';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository root (a package.json is all the reports need). */
function sandbox(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'x-ci-'));
  temporary.push(root);
  for (const [path, text] of Object.entries({ 'package.json': '{ "version": "0.0.0" }\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const SHA = 'c0ffee'.padEnd(40, '0');
const FULL_T2 = TIERS.T2.command.join(' ');

/** What the fake runner does for one command: its outcome, and a side effect in the root. */
type Fake = Partial<StepOutcome> & { effect?: (root: string) => void };

/** Fake parts: every command passes in 1 s unless `fakes` (by argv joined) says otherwise; calls are recorded. */
function fakeDeps(fakes: Record<string, Fake> = {}, t2: Partial<Selection> = {}) {
  const calls: string[] = [];
  const plans: { lastFullT2Ms?: number }[] = [];
  const deps: CiDeps = {
    runStep: async (command, root) => {
      const key = command.join(' ');
      calls.push(key);
      const { effect, ...outcome } = fakes[key] ?? {};
      effect?.(root);
      return { code: 0, ms: 1000, output: `${key}\nall good\n`, ...outcome };
    },
    plan: (_root, options = {}) => {
      plans.push(options);
      return {
        base: { from: 'last-green', sha: SHA, reason: 'the last green x ci --local (c0ffee0)' },
        t1: { tier: 'T1', mode: 'all', command: ['npm', 'test'], reason: 'T1 runs in full' },
        t2: {
          tier: 'T2',
          mode: 'all',
          command: [...TIERS.T2.command],
          reason: 'T2 runs in full: within budget',
          ...t2,
        },
      };
    },
    head: () => ({ sha: SHA, branch: 'work', dirty: [] }),
    now: () => new Date('2026-10-10T12:00:00Z'),
  };
  return { deps, calls, plans };
}

/** The argv each step runs, as the runner receives it. */
const STEP_COMMANDS = CI_STEPS.map((step) => step.command.join(' '));
/** A root whose last full T2 run took `ms`. */
const measured = (ms: number) => sandbox({ [CI_OUT.t2Full]: JSON.stringify({ ms, commit: SHA }) });
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

describe('CI_STEPS', () => {
  it('are the steps of PLAN.md §8.9, in order, each named as typed', () => {
    expect(STEP_COMMANDS).toEqual([
      'npm ci',
      'node x src',
      'npm run check',
      'npm test',
      'node x port refs --check',
      'node x new --test-all',
      'npm run e2e',
    ]);
    for (const step of CI_STEPS) expect(step.command.join(' ').replace(/^node /, '')).toBe(step.name);
    expect(CI_STEPS.filter((step) => step.required).map((step) => step.name)).toEqual(['npm ci']);
    expect(CI_STEPS.filter((step) => step.tier).map((step) => [step.tier, step.command])).toEqual([
      ['T0', TIERS.T0.command],
      ['T1', TIERS.T1.command],
      ['T2', TIERS.T2.command],
    ]);
  });

  it('leave the Vercel build out (ADR-0021)', () => {
    expect(STEP_COMMANDS.some((command) => command.includes('build'))).toBe(false);
  });
});

describe('runCi', () => {
  it('runs every step in order, logs each, and records the green commit and the full T2 run', async () => {
    const root = measured(6000);
    const { deps, calls, plans } = fakeDeps();
    const run = await runCi(root, deps);
    expect(run.ok).toBe(true);
    expect(calls).toEqual(STEP_COMMANDS);
    expect(plans).toEqual([{ lastFullT2Ms: 6000 }]);
    expect(read(root, LAST_GREEN)).toBe(`${SHA}\n`);
    expect(JSON.parse(read(root, CI_OUT.t2Full))).toEqual({ ms: 1000, commit: SHA });
    expect(run.steps.map((step) => step.log)).toEqual(
      ['npm-ci', 'x-src', 'npm-run-check', 'npm-test', 'x-port-refs-check', 'x-new-test-all', 'npm-run-e2e'].map(
        (name, i) => `${CI_OUT.logs}/${i + 1}-${name}.log`,
      ),
    );
    expect(read(root, `${CI_OUT.logs}/4-npm-test.log`)).toBe('npm test\nall good\n');
    expect(read(root, CI_OUT.summary)).toContain('# x ci --local: ok');
  });

  it('runs T2 in full while no full run was measured, whatever the selection', async () => {
    const root = sandbox();
    const { deps, calls } = fakeDeps({}, { mode: 'some', command: ['npm', 'run', 'e2e', '--', '--only-changed=x'] });
    const run = await runCi(root, deps);
    expect(calls.at(-1)).toBe(FULL_T2);
    expect(run.steps.at(-1)?.note).toBe('T2 runs in full: no full run measured yet');
  });

  it('runs the selection once the last full T2 run went over budget, and skips T2 when it selects nothing', async () => {
    const selected = ['npm', 'run', 'e2e', '--', `--only-changed=${SHA}`, '--pass-with-no-tests'];
    const root = measured(400_000);
    const some = fakeDeps({}, { mode: 'some', command: selected, reason: 'T2 runs the specs that import a.spec.ts' });
    const run = await runCi(root, some.deps);
    expect(some.plans).toEqual([{ lastFullT2Ms: 400_000 }]);
    expect(some.calls.at(-1)).toBe(selected.join(' '));
    expect(run.ok).toBe(true);
    expect(JSON.parse(read(root, CI_OUT.t2Full)).ms).toBe(400_000);

    const none = fakeDeps({}, { mode: 'none', command: [], reason: 'T2 selects nothing: nothing changed' });
    const skipped = await runCi(root, none.deps);
    expect(none.calls).toEqual(STEP_COMMANDS.slice(0, -1));
    expect(skipped.steps.at(-1)).toMatchObject({ status: 'skipped', note: 'T2 selects nothing: nothing changed' });
    expect(skipped.ok).toBe(true);
  });

  it('keeps running after a failed step, fails the gate and keeps the last lines', async () => {
    const root = measured(6000);
    const output = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
    const { deps, calls } = fakeDeps({ 'npm test': { code: 1, output } });
    const run = await runCi(root, deps);
    expect(run.ok).toBe(false);
    expect(calls).toEqual(STEP_COMMANDS);
    expect(existsSync(join(root, LAST_GREEN))).toBe(false);
    const failed = run.steps.find((step) => step.status === 'fail');
    expect(failed).toMatchObject({ name: 'npm test', code: 1 });
    expect(failed?.tail).toHaveLength(30);
    expect(failed?.tail?.at(-1)).toBe('line 40');
  });

  it('skips every step after a failed npm ci', async () => {
    const root = measured(6000);
    const { deps, calls } = fakeDeps({ 'npm ci': { code: 1 } });
    const run = await runCi(root, deps);
    expect(calls).toEqual(['npm ci']);
    expect(run.ok).toBe(false);
    expect(
      run.steps.slice(1).every((step) => step.status === 'skipped' && step.note === 'skipped: npm ci failed'),
    ).toBe(true);
  });

  it('keeps node_modules/.cache/ across npm ci', async () => {
    const root = sandbox({ 'node_modules/.cache/eslint/state': 'warm', 'node_modules/old/index.js': '' });
    const reinstall = (at: string) => {
      expect(existsSync(join(at, 'node_modules', '.cache'))).toBe(false);
      rmSync(join(at, 'node_modules'), { recursive: true });
      mkdirSync(join(at, 'node_modules', 'new'), { recursive: true });
    };
    await runCi(root, fakeDeps({ 'npm ci': { effect: reinstall } }).deps);
    expect(read(root, 'node_modules/.cache/eslint/state')).toBe('warm');
    expect(existsSync(join(root, 'node_modules', 'old'))).toBe(false);
    expect(existsSync(join(root, CI_OUT.keptCache))).toBe(false);
  });

  it('runs the long runs after the steps with --long', async () => {
    const { deps, calls } = fakeDeps();
    const run = await runCi(measured(6000), deps, { long: true });
    expect(calls).toEqual([...STEP_COMMANDS, ...LONG_RUNS.map((entry) => entry.command.join(' '))]);
    expect(run.ok).toBe(true);
  });
});

describe('budgets', () => {
  it('warn over a budget and fail the gate at 1.5×', async () => {
    const warn = await runCi(measured(6000), fakeDeps({ 'npm run check': { ms: 12_000 } }).deps);
    expect(warn.ok).toBe(true);
    expect(warn.budgets.map((check) => [check.tier, check.status])).toEqual([
      ['T0', 'warn'],
      ['T1', 'ok'],
      ['T2', 'ok'],
    ]);
    const fail = await runCi(measured(6000), fakeDeps({ 'npm run check': { ms: 15_000 } }).deps);
    expect(fail.ok).toBe(false);
    expect(fail.budgets[0]).toMatchObject({ tier: 'T0', status: 'fail' });
  });

  it('take T1 and T2 from the JSON reports their steps rewrote', async () => {
    const root = measured(6000);
    const write = (path: string, report: object) => (at: string) => {
      mkdirSync(dirname(join(at, path)), { recursive: true });
      writeFileSync(join(at, path), JSON.stringify(report));
    };
    const vitest = write('out/test/report.json', { startTime: 0, testResults: [{ endTime: 70_000 }] });
    const playwright = write('out/e2e/report.json', { stats: { duration: 5000 } });
    const run = await runCi(root, fakeDeps({ 'npm test': { effect: vitest }, [FULL_T2]: { effect: playwright } }).deps);
    expect(run.budgets.map((check) => [check.tier, check.ms, check.status])).toEqual([
      ['T0', 1000, 'ok'],
      ['T1', 70_000, 'warn'],
      ['T2', 5000, 'ok'],
    ]);
    expect(JSON.parse(read(root, CI_OUT.t2Full)).ms).toBe(5000);
  });

  it('ignore a report the step did not rewrite', async () => {
    const root = measured(6000);
    mkdirSync(join(root, 'out', 'test'), { recursive: true });
    writeFileSync(
      join(root, 'out/test/report.json'),
      JSON.stringify({ startTime: 0, testResults: [{ endTime: 1e6 }] }),
    );
    utimesSync(join(root, 'out/test/report.json'), new Date(0), new Date(0));
    const run = await runCi(root, fakeDeps().deps);
    expect(run.budgets[1]).toMatchObject({ tier: 'T1', ms: 1000, status: 'ok' });
  });
});

describe('renderSummary', () => {
  it('shows the commit, the base, one row per step, the budgets and the failed steps’ last lines', async () => {
    const root = measured(6000);
    const run = await runCi(root, fakeDeps({ 'npm test': { code: 1, output: 'FAIL a.test.ts\n1 failed\n' } }).deps);
    const summary = renderSummary({ ...run, head: { ...run.head, dirty: [' M a.ts'] } });
    expect(summary).toContain('# x ci --local: FAIL');
    expect(summary).toContain('- Commit: c0ffee0 on work with 1 uncommitted changes\n');
    expect(summary).toContain('- Base: the last green x ci --local (c0ffee0)');
    expect(summary).toContain('| `npm ci` | ok | 1 s |  | out/ci/logs/1-npm-ci.log |  |');
    expect(summary).toContain('| `npm test` | FAIL (exit 1) | 1 s | 60 s | out/ci/logs/4-npm-test.log |  |');
    expect(summary).toContain('| `npm run e2e` | ok | 1 s | 6 min | out/ci/logs/7-npm-run-e2e.log | T2 runs in full');
    expect(summary).toContain('## Budgets\n\n- T0 took 1 s, within its 10 s budget\n');
    expect(summary).toContain('### `npm test` exited 1\n\nThe last lines of out/ci/logs/4-npm-test.log:\n\n```text\n');
    expect(summary).toContain('FAIL a.test.ts\n1 failed\n```\n');
    expect(read(root, CI_OUT.summary)).toBe(renderSummary(run));
  });

  it('names the green commit as recorded', async () => {
    const run = await runCi(measured(6000), fakeDeps().deps);
    expect(renderSummary(run)).toContain(`- Commit: c0ffee0 on work, recorded in ${LAST_GREEN}\n`);
    expect(renderSummary(run)).not.toContain('## Failures');
  });
});

describe('node x ci through the dispatcher', () => {
  /** Runs `x ci <argv>` in `root` with fakes; resolves to the exit code and the printed lines. */
  async function x(root: string, argv: string[], deps: CiDeps) {
    const lines: string[] = [];
    const code = await dispatch(['ci', ...argv], {
      root,
      commands: { ci: async () => createCiCommand(deps) },
      print: (line) => lines.push(line),
    });
    return { code, lines };
  }

  it('exits 0 when green, within 20 lines, with its report in out/ci/local/', async () => {
    const root = measured(6000);
    const { code, lines } = await x(root, ['--local'], fakeDeps().deps);
    expect(code).toBe(0);
    expect(lines[0]).toBe(`x ci: ok: 7 steps passed in 7 s; c0ffee0 recorded in ${LAST_GREEN}`);
    expect(lines).toContain('all passed in 7 s');
    expect(lines).toContain(`summary: ${CI_OUT.summary}`);
    expect(lines.at(-1)).toBe('report: out/ci/local/report.json');
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
    const report = JSON.parse(read(root, 'out/ci/local/report.json'));
    expect(report).toMatchObject({ tool: 'x ci', ok: true, metrics: { commit: SHA, 'npm test': 1000 } });
    expect(report.artifacts.map((artifact: { path: string }) => artifact.path)).toContain(LAST_GREEN);
  });

  it('exits 1 when a step fails or a tier reaches 1.5× its budget, naming each', async () => {
    const failed = await x(measured(6000), ['--local'], fakeDeps({ 'node x src': { code: 1, ms: 200 } }).deps);
    expect(failed.code).toBe(1);
    expect(failed.lines[0]).toBe('x ci: FAIL: 1 problem: x src');
    expect(failed.lines).toContain(
      `CI_STEP_FAILED: node x src exited 1 after 0.2 s: read ${CI_OUT.logs}/2-x-src.log (its last lines are in ${CI_OUT.summary})`,
    );
    const slow = await x(measured(6000), ['--local'], fakeDeps({ 'npm test': { ms: 90_000 } }).deps);
    expect(slow.code).toBe(1);
    expect(slow.lines[0]).toBe('x ci: FAIL: 1 problem: over budget');
    expect(slow.lines.some((line) => line.startsWith('CI_BUDGET: T1 took 1 min 30 s, at least 1.5×'))).toBe(true);
    expect(slow.lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('warns about uncommitted changes without failing', async () => {
    const { deps } = fakeDeps();
    const { code, lines } = await x(measured(6000), ['--local'], {
      ...deps,
      head: () => ({ ...deps.head(''), dirty: [' M a.ts'] }),
    });
    expect(code).toBe(0);
    expect(lines.some((line) => line.startsWith('CI_DIRTY: 1 uncommitted changes (M a.ts…)'))).toBe(true);
  });

  it('exits 2 without --local or with an unknown flag, running nothing', async () => {
    const { deps, calls } = fakeDeps();
    const bare = await x(sandbox(), [], deps);
    expect(bare.code).toBe(2);
    expect(bare.lines.join('\n')).toContain('x ci runs only with --local');
    const unknown = await x(sandbox(), ['--locl'], deps);
    expect(unknown.code).toBe(2);
    expect(unknown.lines.join('\n')).toContain('did you mean --local?');
    expect(calls).toEqual([]);
  });
});
