/**
 * @file Unit tests for `x ci` (tools/cmd/ci.ts) in temporary roots, with a fake step runner, git, clock and GitHub: the
 * step list against PLAN.md §8.9; the quick gate (no T2) and the full run (`--full`, T2 in full: ADR-0023); the order,
 * the logs and the green commit; a failed step that leaves the next ones running, and a failed `npm ci` that skips
 * them; the quick gate's budget (its steps together, over warns, never fails: ADR-0022); the cache kept across
 * `npm ci`; `--long`; a shard of the full run (`--shard`, its spec files dealt by minutes: ADR-0023 amendments 1 and
 * 3); `--minutes`; the summary; `--status`; and the exit codes and the 20-line output through the dispatcher. The
 * real suite never runs here: `node x ci --local` is WP 0.9's Verify.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LAST_GREEN, LONG_RUNS, TIERS } from '../lib/tiers';
import { dispatch, MAX_LINES } from '../x';
import { CI_STEPS, createCiCommand, FULL_ONLY, parseShard, runCi, type CiDeps, type StepOutcome } from './ci';
import { CI_OUT, renderSummary } from '../lib/ciSummary';
import { T2_MINUTES } from '../lib/ciShards';
import type { WorkflowRun } from '../lib/ciStatus';

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

/** What the fake runner does for one command: its outcome, and a side effect in the root. */
type Fake = Partial<StepOutcome> & { effect?: (root: string) => void };

/** A workflow run on main, as GitHub's API gives it. */
const ghRun = (status: string, conclusion: string | null, sha = SHA): WorkflowRun => ({
  status,
  conclusion,
  head_sha: sha,
  html_url: `https://github.com/o/r/actions/runs/${sha.slice(0, 4)}`,
  created_at: '2026-10-15T06:41:15Z',
});

/** Fake parts: every command passes in 1 s unless `fakes` (by argv joined) says otherwise; calls are recorded. */
function fakeDeps(fakes: Record<string, Fake> = {}, runs: WorkflowRun[] = [ghRun('completed', 'success')]) {
  const calls: string[] = [];
  const deps: CiDeps = {
    runStep: async (command, root) => {
      const key = command.join(' ');
      calls.push(key);
      const { effect, ...outcome } = fakes[key] ?? {};
      effect?.(root);
      return { code: 0, ms: 1000, output: `${key}\nall good\n`, ...outcome };
    },
    cores: 16,
    head: () => ({ sha: SHA, branch: 'work', dirty: [] }),
    now: () => new Date('2026-10-10T12:00:00Z'),
    runs: async (slug) => {
      calls.push(`runs ${slug}`);
      return runs;
    },
    origin: () => 'https://github.com/o/r.git',
  };
  return { deps, calls };
}

/**
 * A root with five spec files and their minutes: over four machines, the first starting with the steps' 10, a goes to
 * the second, b to the third, c to the fourth, d (8) to the first, and e (unmeasured: 5) to the fourth.
 */
const SPECS = {
  ...Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((name) => [`tests/e2e/${name}.spec.ts`, ''])),
  [T2_MINUTES]: JSON.stringify({ measured: 'a test', steps: 10, minutes: { 'a.spec.ts': 30, 'b.spec.ts': 20, 'c.spec.ts': 12, 'd.spec.ts': 8 } }), // prettier-ignore
};

/** The argv each step runs, as the runner receives it. */
const STEP_COMMANDS = CI_STEPS.map((step) => step.command.join(' '));
/** The quick gate's: every step but x new --test-all, x engine --test and T2. */
const QUICK_COMMANDS = STEP_COMMANDS.slice(0, -3);
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
      'node x engine --test',
      'npm run e2e',
    ]);
    for (const step of CI_STEPS) expect(step.command.join(' ').replace(/^node /, '')).toBe(step.name);
    expect(CI_STEPS.filter((step) => step.required).map((step) => step.name)).toEqual(['npm ci']);
    expect(CI_STEPS.filter((step) => step.tier).map((step) => [step.tier, step.command])).toEqual([
      ['T0', TIERS.T0.command],
      ['T1', TIERS.T1.command],
      ['T2', TIERS.T2.command],
    ]);
    expect(CI_STEPS.filter((step) => step.full).map((step) => step.name)).toEqual([
      'x new --test-all',
      'x engine --test',
      'npm run e2e',
    ]);
  });

  it('leave the Vercel build out (ADR-0021)', () => {
    expect(STEP_COMMANDS.some((command) => command.includes('build'))).toBe(false);
  });
});

describe('runCi', () => {
  it('runs the quick gate in order without the full run’s steps, logs each step, and records the green commit', async () => {
    const root = sandbox();
    const { deps, calls } = fakeDeps();
    const run = await runCi(root, deps);
    expect(run.ok).toBe(true);
    expect(run.full).toBe(false);
    expect(calls).toEqual(QUICK_COMMANDS);
    expect(run.steps.slice(-3).map(({ name, status, note }) => [name, status, note])).toEqual([
      ['x new --test-all', 'skipped', FULL_ONLY],
      ['x engine --test', 'skipped', FULL_ONLY],
      ['npm run e2e', 'skipped', FULL_ONLY],
    ]);
    expect(read(root, LAST_GREEN)).toBe(`${SHA}\n`);
    const logs = ['npm-ci', 'x-src', 'npm-run-check', 'npm-test', 'x-port-refs-check'].map(
      (name, i) => `${CI_OUT.logs}/${i + 1}-${name}.log`,
    );
    expect(run.steps.map((step) => step.log)).toEqual([...logs, undefined, undefined, undefined]);
    expect(read(root, `${CI_OUT.logs}/4-npm-test.log`)).toBe('npm test\nall good\n');
    expect(read(root, CI_OUT.summary)).toContain('# x ci --local: ok');
  });

  it("runs every step with --full, T2 in full on the machine's workers", async () => {
    const root = sandbox();
    const { deps, calls } = fakeDeps();
    const run = await runCi(root, { ...deps, cores: 4 }, { full: true });
    expect(calls).toEqual(STEP_COMMANDS);
    expect(run.steps.at(-1)).toMatchObject({
      status: 'ok',
      command: [...TIERS.T2.command],
      log: `${CI_OUT.logs}/8-npm-run-e2e.log`,
      note: 'in full, 1 worker on 4 cores',
    });
    expect(read(root, CI_OUT.summary)).toContain('# x ci --local --full: ok');
  });

  it('runs a share of T2 with --shard, its spec files by minutes, and the other steps but npm ci on the first alone', async () => {
    const first = sandbox(SPECS);
    const one = fakeDeps();
    const run = await runCi(first, { ...one.deps, cores: 4 }, { full: true, shard: { index: 1, total: 4 } });
    expect(one.calls).toEqual([...STEP_COMMANDS.slice(0, -1), 'npm run e2e -- tests/e2e/d.spec.ts']);
    expect(run.steps.at(-1)).toMatchObject({ status: 'ok', note: 'shard 1 of 4: 1 spec file, ~8 min, 1 worker on 4 cores' }); // prettier-ignore
    expect(existsSync(join(first, LAST_GREEN)), 'a share is no whole run: no green commit').toBe(false);
    expect(read(first, CI_OUT.summary)).toContain('# x ci --local --full --shard 1/4: ok');
    expect(read(first, CI_OUT.summary)).not.toContain(`recorded in ${LAST_GREEN}`);

    const fourth = sandbox(SPECS);
    const four = fakeDeps();
    const later = await runCi(fourth, four.deps, { full: true, shard: { index: 4, total: 4 } });
    expect(four.calls).toEqual(['npm ci', 'npm run e2e -- tests/e2e/c.spec.ts tests/e2e/e.spec.ts']);
    expect(later.ok).toBe(true);
    const skipped = later.steps.filter((step) => step.status === 'skipped');
    expect(skipped.map((step) => step.name)).toEqual(CI_STEPS.slice(1, -1).map((step) => step.name));
    expect(skipped[0].note).toContain("shard 1's");

    const eighth = sandbox(SPECS); // more machines than spec files: none runs T2 with no file, which would run them all
    const eight = fakeDeps();
    const idle = await runCi(eighth, eight.deps, { full: true, shard: { index: 8, total: 8 } });
    expect(eight.calls).toEqual(['npm ci']);
    expect(idle.steps.at(-1)).toMatchObject({ status: 'skipped', note: 'no spec file falls to shard 8' });
  });

  it('keeps running after a failed step, fails the gate and keeps the last lines', async () => {
    const root = sandbox();
    const output = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
    const { deps, calls } = fakeDeps({ 'npm test': { code: 1, output } });
    const run = await runCi(root, deps, { full: true });
    expect(run.ok).toBe(false);
    expect(calls).toEqual(STEP_COMMANDS);
    expect(existsSync(join(root, LAST_GREEN))).toBe(false);
    const failed = run.steps.find((step) => step.status === 'fail');
    expect(failed).toMatchObject({ name: 'npm test', code: 1 });
    expect(failed?.tail).toHaveLength(30);
    expect(failed?.tail?.at(-1)).toBe('line 40');
  });

  it('skips every step after a failed npm ci', async () => {
    const root = sandbox();
    const { deps, calls } = fakeDeps({ 'npm ci': { code: 1 } });
    const run = await runCi(root, deps);
    expect(calls).toEqual(['npm ci']);
    expect(run.ok).toBe(false);
    expect(
      run.steps.slice(1).every((step) => step.status === 'skipped' && step.note === 'skipped: npm ci failed'),
    ).toBe(true);
  });

  it("keeps node_modules/.cache/ and Vitest's durations across npm ci", async () => {
    const root = sandbox({
      'node_modules/.cache/eslint/state': 'warm',
      'node_modules/.vite/vitest/x/results.json': '{}',
      'node_modules/old/index.js': '',
    });
    const reinstall = (at: string) => {
      expect(existsSync(join(at, 'node_modules', '.cache'))).toBe(false);
      expect(existsSync(join(at, 'node_modules', '.vite', 'vitest'))).toBe(false);
      rmSync(join(at, 'node_modules'), { recursive: true });
      mkdirSync(join(at, 'node_modules', 'new'), { recursive: true });
    };
    await runCi(root, fakeDeps({ 'npm ci': { effect: reinstall } }).deps);
    expect(read(root, 'node_modules/.cache/eslint/state')).toBe('warm');
    expect(read(root, 'node_modules/.vite/vitest/x/results.json')).toBe('{}');
    expect(existsSync(join(root, 'node_modules', 'old'))).toBe(false);
    expect(existsSync(join(root, CI_OUT.keptCache))).toBe(false);
  });

  it('runs the long runs after the steps with --long', async () => {
    const { deps, calls } = fakeDeps();
    const run = await runCi(sandbox(), deps, { full: true, long: true });
    expect(calls).toEqual([...STEP_COMMANDS, ...LONG_RUNS.map((entry) => entry.command.join(' '))]);
    expect(run.ok).toBe(true);
  });
});

describe("the quick gate's budget", () => {
  it('holds the quick steps together to five minutes: over warns and never fails the gate (ADR-0023)', async () => {
    const within = await runCi(sandbox(), fakeDeps({ 'npm test': { ms: 296_000 } }).deps);
    expect(within.budget).toMatchObject({ ms: 300_000, budgetMs: 300_000, status: 'ok' });
    const over = await runCi(sandbox(), fakeDeps({ 'npm test': { ms: 297_000 } }).deps);
    expect(over.ok).toBe(true);
    expect(over.budget).toMatchObject({ ms: 301_000, status: 'warn' });
  });

  it('leaves x new --test-all, x engine --test, T2 and the long runs out of it: nobody waits on them', async () => {
    const slow = { 'node x new --test-all': { ms: 150_000 }, 'node x engine --test': { ms: 120_000 }, 'npm run e2e': { ms: 3_900_000 }, ...Object.fromEntries(LONG_RUNS.map((entry) => [entry.command.join(' '), { ms: 600_000 }])) }; // prettier-ignore
    const run = await runCi(sandbox(), fakeDeps(slow).deps, { full: true, long: true });
    expect(run.budget).toMatchObject({ ms: 5000, status: 'ok' });
  });
});

describe('renderSummary', () => {
  it('shows the commit, the budget, one row per step and the failed steps’ last lines', async () => {
    const root = sandbox();
    const run = await runCi(root, fakeDeps({ 'npm test': { code: 1, output: 'FAIL a.test.ts\n1 failed\n' } }).deps);
    const summary = renderSummary({ ...run, head: { ...run.head, dirty: [' M a.ts'] } });
    expect(summary).toContain('# x ci --local: FAIL');
    expect(summary).toContain('- Commit: c0ffee0 on work with 1 uncommitted changes\n');
    expect(summary).toContain('- Budget: the quick gate took 5 s, within its 5 min budget\n');
    expect(summary).toContain('| `npm ci` | ok | 1 s | out/ci/logs/1-npm-ci.log |  |');
    expect(summary).toContain('| `npm test` | FAIL (exit 1) | 1 s | out/ci/logs/4-npm-test.log |  |');
    expect(summary).toContain(`| \`npm run e2e\` | skipped |  |  | ${FULL_ONLY} |`);
    expect(summary).toContain('### `npm test` exited 1\n\nThe last lines of out/ci/logs/4-npm-test.log:\n\n```text\n');
    expect(summary).toContain('FAIL a.test.ts\n1 failed\n```\n');
    expect(read(root, CI_OUT.summary)).toBe(renderSummary(run));
  });

  it("names the full run and T2's workers: one on 4 cores, four from 16", async () => {
    const { deps } = fakeDeps({ 'npm run e2e': { ms: 3_460_000 } });
    const cloud = renderSummary(await runCi(sandbox(), { ...deps, cores: 4 }, { full: true }));
    expect(cloud).toContain('# x ci --local --full: ok');
    expect(cloud).toContain(', 4 cores\n');
    expect(cloud).toContain('| `npm run e2e` | ok | 57 min 40 s | out/ci/logs/8-npm-run-e2e.log | in full, 1 worker on 4 cores |'); // prettier-ignore
    const big = renderSummary(await runCi(sandbox(), deps, { full: true }));
    expect(big).toContain('| in full, 4 workers on 16 cores |');
  });

  it('names the green commit as recorded', async () => {
    const run = await runCi(sandbox(), fakeDeps().deps);
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
    const root = sandbox();
    const { code, lines } = await x(root, ['--local'], fakeDeps().deps);
    expect(code).toBe(0);
    expect(lines[0]).toBe(`x ci: ok: 5 steps passed in 5 s; c0ffee0 recorded in ${LAST_GREEN}`);
    expect(lines).toContain('all passed in 5 s');
    expect(lines).toContain(`summary: ${CI_OUT.summary}`);
    expect(lines.at(-1)).toBe('report: out/ci/local/report.json');
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
    const report = JSON.parse(read(root, 'out/ci/local/report.json'));
    expect(report).toMatchObject({ tool: 'x ci', ok: true, metrics: { commit: SHA, 'npm test': 1000 } });
    expect(report.artifacts.map((artifact: { path: string }) => artifact.path)).toContain(LAST_GREEN);
  });

  it('exits 1 when a step fails, naming it, and only warns when the quick gate is over its budget', async () => {
    const failed = await x(sandbox(), ['--local'], fakeDeps({ 'node x src': { code: 1, ms: 200 } }).deps);
    expect(failed.code).toBe(1);
    expect(failed.lines[0]).toBe('x ci: FAIL: 1 problem: x src');
    expect(failed.lines).toContain(
      `CI_STEP_FAILED: node x src exited 1 after 0.2 s: read ${CI_OUT.logs}/2-x-src.log (its last lines are in ${CI_OUT.summary})`,
    );
    const slow = await x(sandbox(), ['--local'], fakeDeps({ 'npm test': { ms: 300_000 } }).deps);
    expect(slow.code).toBe(0);
    expect(slow.lines.some((line) => line.startsWith('CI_BUDGET: the quick gate took 5 min 4 s, over its'))).toBe(true); // prettier-ignore
    expect(slow.lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('warns about uncommitted changes without failing', async () => {
    const { deps } = fakeDeps();
    const { code, lines } = await x(sandbox(), ['--local'], {
      ...deps,
      head: () => ({ ...deps.head(''), dirty: [' M a.ts'] }),
    });
    expect(code).toBe(0);
    expect(lines.some((line) => line.startsWith('CI_DIRTY: 1 uncommitted changes (M a.ts…)'))).toBe(true);
  });

  it('reads --shard as <i>/<n>, 1 ≤ i ≤ n, and refuses it without --full', async () => {
    expect(parseShard('2/4')).toEqual({ index: 2, total: 4 });
    for (const bad of ['0/4', '5/4', '2', 'a/b', '2/4/1']) expect(() => parseShard(bad), bad).toThrow('--shard takes');
    const { deps, calls } = fakeDeps();
    const alone = await x(sandbox(), ['--local', '--shard', '1/4'], deps);
    expect(alone.code).toBe(2);
    expect(alone.lines.join('\n')).toContain('give it with --full');
    expect((await x(sandbox(), ['--local', '--full', '--shard', '9/4'], deps)).code).toBe(2);
    expect(calls).toEqual([]);
    const shard = await x(sandbox(SPECS), ['--local', '--full', '--shard', '2/4'], deps);
    expect(shard.code).toBe(0);
    expect(calls).toEqual(['npm ci', 'npm run e2e -- tests/e2e/a.spec.ts']);
  });

  it('reads --minutes with reports alone (tools/lib/ciShards.test.ts tests the table it writes)', async () => {
    const { deps, calls } = fakeDeps();
    for (const argv of [['--minutes'], ['--minutes', '--local', 'r.json'], ['--local', 'r.json']])
      expect((await x(sandbox(), argv, deps)).code, argv.join(' ')).toBe(2);
    expect(calls).toEqual([]);
  });

  it('runs the full run with --full', async () => {
    const { deps, calls } = fakeDeps();
    const { code, lines } = await x(sandbox(), ['--local', '--full'], deps);
    expect(code).toBe(0);
    expect(calls).toEqual(STEP_COMMANDS);
    expect(lines[0]).toBe(`x ci: ok: 8 steps passed in 8 s; c0ffee0 recorded in ${LAST_GREEN}`);
    expect(lines).toContain('npm run e2e: in full, 4 workers on 16 cores');
  });

  it("says with --status how main's last full run went, failing only when it did not pass", async () => {
    const green = await x(sandbox(), ['--status'], fakeDeps().deps);
    expect(green.code).toBe(0);
    expect(green.lines[0]).toBe("x ci: ok: main's last full run passed on c0ffee0 (2026-10-15 06:41 UTC)");
    expect(green.lines.at(-1)).toBe('report: out/ci/status/report.json');

    const red = fakeDeps({}, [ghRun('in_progress', null, 'beef'.padEnd(40, '0')), ghRun('completed', 'failure')]);
    const failed = await x(sandbox(), ['--status'], red.deps);
    expect(failed.code).toBe(1);
    expect(red.calls).toEqual(['runs o/r']);
    expect(failed.lines[0]).toBe(
      "x ci: FAIL: main's last full run failed on c0ffee0 (2026-10-15 06:41 UTC); 1 newer still running, the latest on beef000 (2026-10-15 06:41 UTC)",
    );
    expect(failed.lines.join('\n')).toContain('CI_MAIN_RED: ');
    expect(failed.lines.join('\n')).toContain('fix it before other work (AGENTS.md)');
  });

  it('exits 2 without --local or --status, with both, or with an unknown flag, running nothing', async () => {
    const { deps, calls } = fakeDeps();
    const bare = await x(sandbox(), [], deps);
    expect(bare.code).toBe(2);
    expect(bare.lines.join('\n')).toContain('x ci runs with --local');
    expect((await x(sandbox(), ['--local', '--status'], deps)).code).toBe(2);
    const unknown = await x(sandbox(), ['--locl'], deps);
    expect(unknown.code).toBe(2);
    expect(unknown.lines.join('\n')).toContain('did you mean --local?');
    expect(calls).toEqual([]);
  });
});
