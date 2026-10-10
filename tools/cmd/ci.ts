/**
 * @file The merge gate (PLAN.md §8.9, WP 0.9): `x ci --local` runs `CI_STEPS` in order on this machine, holds the
 * tiers to their budgets (tools/lib/tiers.ts), writes `out/ci/summary.md` and, when everything passed, records HEAD
 * in `out/ci/last-green`, the base of the selections until main holds a gate.
 *
 * - **Steps:** `npm ci`, `x src`, `npm run check` (with `x deps --check` and `x docs --check`), `npm test`,
 *   `x port refs --check`, `x new --test-all` and `npm run e2e`, each from the root with its output kept in
 *   `out/ci/logs/<n>-<step>.log`, never printed. A failed `npm ci` skips the rest; after any other failure the next
 *   steps still run, so one run names every failure. The GitHub workflow, once the owner enables Actions, runs the
 *   same list: its unit test compares against `CI_STEPS`. The Vercel build is not a step (ADR-0021).
 * - **T2** runs in full while its last full run (`out/ci/t2-full.json`) stayed within its 6-minute budget, and when
 *   no full run was measured yet; otherwise it runs what tiers.ts's `plan()` selects, and nothing when that selects
 *   nothing.
 * - **Budgets:** T0 is timed; T1 and T2 take the duration their JSON report records when the step rewrote it, else
 *   the step's time. Over a budget warns; at 1.5× it fails the gate (tiers.ts's `checkBudget`).
 * - **`npm ci` reinstalls node_modules under this running process.** That is safe, measured: everything this command
 *   runs is imported before it starts, and every later step is a new process. `node_modules/.cache/` (the ESLint
 *   and Prettier caches) is kept across it, so T0 is timed warm, as its budget means.
 * - `--long` also runs tiers.ts's `LONG_RUNS` after the steps (at each gate).
 *
 * Usage: node x ci --local [--long]. Exit 0 when every step passed within 1.5× its budget; 1 otherwise; 2 on a usage
 * error, `--local` missing included (the GitHub workflow waits for the owner).
 *
 * @example
 * CI_STEPS.map((step) => step.name); // ['npm ci', 'x src', 'npm run check', 'npm test', …, 'npm run e2e']
 * @see tools/cmd/ci.test.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runtime, type Artifact, type Finding } from '../lib/report';
import {
  checkBudget,
  duration,
  LAST_GREEN,
  LONG_RUNS,
  plan as tiersPlan,
  recordGreen,
  reportMs,
  TIERS,
  timingTable,
  type BudgetCheck,
  type Selection,
  type TierId,
} from '../lib/tiers';
import { UsageError, type Command, type CommandResult } from '../x';

/** One step of the gate. */
export interface CiStep {
  /** Its name in the summary: the command as an agent types it. */
  name: string;
  /** The argv run from the root; `node` means this process's Node. */
  command: readonly string[];
  /** The tier whose budget it is held to. */
  tier?: TierId;
  /** Nothing else can run without it: when it fails, the remaining steps are skipped. */
  required?: boolean;
}

/** The steps of `x ci --local`, in order (PLAN.md §8.9). */
export const CI_STEPS: readonly CiStep[] = [
  { name: 'npm ci', command: ['npm', 'ci'], required: true },
  { name: 'x src', command: ['node', 'x', 'src'] },
  { name: 'npm run check', command: TIERS.T0.command, tier: 'T0' },
  { name: 'npm test', command: TIERS.T1.command, tier: 'T1' },
  { name: 'x port refs --check', command: ['node', 'x', 'port', 'refs', '--check'] },
  { name: 'x new --test-all', command: ['node', 'x', 'new', '--test-all'] },
  { name: 'npm run e2e', command: TIERS.T2.command, tier: 'T2' },
];

/** Where `x ci --local` writes, relative to the root. */
export const CI_OUT = {
  summary: 'out/ci/summary.md',
  logs: 'out/ci/logs',
  /** The duration of the last full T2 run that passed, `{ ms, commit }`. */
  t2Full: 'out/ci/t2-full.json',
  /** Where `node_modules/.cache/` waits while `npm ci` runs. */
  keptCache: 'out/ci/kept-cache',
} as const;

/** What running one command gave: its exit code (1 when it could not start), its wall time and its output. */
export interface StepOutcome {
  code: number;
  ms: number;
  output: string;
}

/** Runs one command from `cwd`; the tests inject a fake. */
export type StepRunner = (command: readonly string[], cwd: string) => Promise<StepOutcome>;

/** Runs `command` as a child process, stdout and stderr captured together, colours off. */
export const spawnStep: StepRunner = (command, cwd) =>
  new Promise((resolve) => {
    const started = performance.now();
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    for (const key of Object.keys(env)) if (key === 'FORCE_COLOR' || key.startsWith('VITEST')) delete env[key];
    const [bin, ...args] = command;
    const child = spawn(bin === 'node' ? process.execPath : bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = (code: number, note = '') =>
      resolve({ code, ms: performance.now() - started, output: Buffer.concat(chunks).toString('utf8') + note });
    child.on('error', (error) => done(1, `\n${error.message}\n`));
    child.on('close', (code, signal) => done(code ?? 1, signal ? `\nkilled by ${signal}\n` : ''));
  });

/** HEAD's commit and branch, and the uncommitted changes (`git status --porcelain` lines). */
export interface Head {
  sha: string;
  branch: string;
  dirty: string[];
}

/** Reads `Head` with git. */
export function readHead(root: string): Head {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return {
    sha: git('rev-parse', 'HEAD').trim(),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD').trim(),
    dirty: git('status', '--porcelain').split('\n').filter(Boolean),
  };
}

/** What `x ci` reaches outside itself; the tests replace each part. */
export interface CiDeps {
  runStep: StepRunner;
  /** The base and the selections (tiers.ts's `plan`). */
  plan: typeof tiersPlan;
  head: (root: string) => Head;
  now: () => Date;
}

/** One step's result. */
export interface StepResult {
  name: string;
  /** The argv it ran (T2's selection may narrow it); empty when skipped. */
  command: string[];
  status: 'ok' | 'fail' | 'skipped';
  ms: number;
  code?: number;
  tier?: TierId;
  /** Its log, relative to the root. */
  log?: string;
  /** Why it was narrowed or skipped. */
  note?: string;
  /** The last lines of its output, when it failed. */
  tail?: string[];
}

/** A whole run of the gate. */
export interface CiRun {
  ok: boolean;
  head: Head;
  /** When it started (ISO 8601). */
  started: string;
  runtime: string;
  /** Why the base is what it is (tiers.ts's `Base.reason`). */
  base: string;
  steps: StepResult[];
  budgets: BudgetCheck[];
}

/** The lines of a failed step's output kept in the summary. */
const TAIL_LINES = 30;

/** The duration of the last full T2 run that passed, if one was recorded. */
export function readT2Full(root: string): number | undefined {
  try {
    const { ms } = JSON.parse(readFileSync(join(root, CI_OUT.t2Full), 'utf8')) as { ms?: unknown };
    return typeof ms === 'number' && ms >= 0 ? ms : undefined;
  } catch {
    return undefined;
  }
}

/** Moves `node_modules/.cache/` aside while `npm ci` replaces node_modules; the returned function puts it back. */
function keepCache(root: string): () => void {
  const cache = join(root, 'node_modules', '.cache');
  const kept = join(root, CI_OUT.keptCache);
  if (existsSync(cache)) {
    rmSync(kept, { recursive: true, force: true });
    renameSync(cache, kept);
  }
  return () => {
    if (!existsSync(kept) || !existsSync(join(root, 'node_modules'))) return;
    rmSync(cache, { recursive: true, force: true });
    renameSync(kept, cache);
  };
}

/** When a tier's JSON report was last written (its mtime), if it exists. */
function reportStamp(root: string, tier: TierId | undefined): number | undefined {
  const report = tier && TIERS[tier].report;
  return report && existsSync(join(root, report)) ? statSync(join(root, report)).mtimeMs : undefined;
}

/** A tier step's duration: from its JSON report when the step rewrote it (its stamp moved), else the step's time. */
function tierMs(root: string, tier: TierId, outcome: StepOutcome, before: number | undefined): number {
  const stamp = reportStamp(root, tier);
  try {
    if (stamp !== undefined && stamp !== before) return reportMs(join(root, TIERS[tier].report ?? ''));
  } catch {
    // Not a report tiers.ts reads: the step's own time stands.
  }
  return outcome.ms;
}

/** `npm run e2e` → `npm-run-e2e`. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Runs the gate in `root`: every step, the budgets, the summary and, when green, `out/ci/last-green`. */
export async function runCi(root: string, deps: CiDeps, options: { long?: boolean } = {}): Promise<CiRun> {
  const started = deps.now().toISOString();
  const head = deps.head(root);
  const lastFull = readT2Full(root);
  const { base, t2: selected } = deps.plan(root, { lastFullT2Ms: lastFull });
  const t2: Selection =
    lastFull === undefined
      ? {
          ...selected,
          mode: 'all',
          command: [...TIERS.T2.command],
          reason: 'T2 runs in full: no full run measured yet',
        }
      : selected;
  rmSync(join(root, CI_OUT.logs), { recursive: true, force: true });
  mkdirSync(join(root, CI_OUT.logs), { recursive: true });

  const queue: CiStep[] = [...CI_STEPS, ...(options.long ? LONG_RUNS : [])];
  const steps: StepResult[] = [];
  const measured: [TierId, number][] = [];
  let stop: string | undefined;
  for (const [i, step] of queue.entries()) {
    const narrowed = step.tier === 'T2' ? { command: t2.command, note: t2.reason } : undefined;
    const command = [...(narrowed?.command ?? step.command)];
    if (stop || !command.length) {
      steps.push({
        name: step.name,
        command: [],
        status: 'skipped',
        ms: 0,
        tier: step.tier,
        note: stop ?? narrowed?.note,
      });
      continue;
    }
    const log = `${CI_OUT.logs}/${i + 1}-${slug(step.name)}.log`;
    const before = reportStamp(root, step.tier);
    const restore = step.command.join(' ') === 'npm ci' ? keepCache(root) : undefined;
    const outcome = await deps.runStep(command, root);
    restore?.();
    writeFileSync(join(root, log), outcome.output);
    const ok = outcome.code === 0;
    const lines = outcome.output.trimEnd().split('\n');
    steps.push({
      name: step.name,
      command,
      status: ok ? 'ok' : 'fail',
      ms: outcome.ms,
      code: outcome.code,
      tier: step.tier,
      log,
      note: narrowed?.note,
      tail: ok ? undefined : lines.slice(-TAIL_LINES),
    });
    if (step.tier) {
      const ms = tierMs(root, step.tier, outcome, before);
      measured.push([step.tier, ms]);
      if (step.tier === 'T2' && t2.mode === 'all' && ok) {
        writeFileSync(join(root, CI_OUT.t2Full), `${JSON.stringify({ ms: Math.round(ms), commit: head.sha })}\n`);
      }
    }
    if (!ok && step.required) stop = `skipped: ${step.name} failed`;
  }

  const budgets = measured.map(([tier, ms]) => checkBudget(tier, ms));
  const ok = steps.every((step) => step.status !== 'fail') && budgets.every((check) => check.status !== 'fail');
  const run: CiRun = { ok, head, started, runtime: runtime(), base: base.reason, steps, budgets };
  if (ok) recordGreen(head.sha, root);
  writeFileSync(join(root, CI_OUT.summary), renderSummary(run));
  return run;
}

/** The run as Markdown, for `out/ci/summary.md` (and the GitHub workflow's step summary). */
export function renderSummary(run: CiRun): string {
  const { head } = run;
  const dirty = head.dirty.length ? ` with ${head.dirty.length} uncommitted changes` : '';
  const out = [
    `# x ci --local: ${run.ok ? 'ok' : 'FAIL'}`,
    '',
    `- Commit: ${head.sha.slice(0, 7)} on ${head.branch}${dirty}${run.ok ? `, recorded in ${LAST_GREEN}` : ''}`,
    `- Started: ${run.started} on ${run.runtime}`,
    `- Base: ${run.base}`,
    '',
    '| Step | Result | Time | Budget | Log | Note |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const step of run.steps) {
    const budget = step.tier ? duration(TIERS[step.tier].budgetMs) : '';
    const result = step.status === 'fail' ? `FAIL (exit ${step.code})` : step.status;
    const time = step.status === 'skipped' ? '' : duration(step.ms);
    out.push(`| \`${step.name}\` | ${result} | ${time} | ${budget} | ${step.log ?? ''} | ${step.note ?? ''} |`);
  }
  if (run.budgets.length) out.push('', '## Budgets', '', ...run.budgets.map((check) => `- ${check.message}`));
  const failed = run.steps.filter((step) => step.status === 'fail');
  if (failed.length) out.push('', '## Failures');
  for (const step of failed) {
    out.push('', `### \`${step.command.join(' ')}\` exited ${step.code}`, '', `The last lines of ${step.log}:`);
    out.push('', '```text', ...(step.tail ?? []), '```');
  }
  return `${out.join('\n')}\n`;
}

/** The run as the dispatcher's result: the timing table, the T2 selection and one finding per problem. */
export function toResult(run: CiRun): CommandResult {
  const failed = run.steps.filter((step) => step.status === 'fail');
  const total = run.steps.reduce((sum, step) => sum + step.ms, 0);
  const t2 = run.steps.find((step) => step.tier === 'T2');
  const failures: Finding[] = failed.map((step) => ({
    id: 'CI_STEP_FAILED',
    message: `${step.command.join(' ')} exited ${step.code} after ${duration(step.ms)}: read ${step.log} (its last lines are in ${CI_OUT.summary})`,
  }));
  const warnings: Finding[] = [];
  for (const check of run.budgets) {
    if (check.status !== 'ok')
      (check.status === 'fail' ? failures : warnings).push({ id: 'CI_BUDGET', message: check.message });
  }
  if (run.head.dirty.length) {
    const message = `${run.head.dirty.length} uncommitted changes (${run.head.dirty[0].trim()}…): this run covers them, not ${run.head.sha.slice(0, 7)} alone; commit and run it again before merging`;
    warnings.push({ id: 'CI_DIRTY', message });
  }
  const artifacts: Artifact[] = [
    {
      path: CI_OUT.summary,
      kind: 'text',
      describes: 'the steps, their times and budgets, and the failed steps’ last lines',
    },
    ...run.steps.flatMap((step) =>
      step.log ? [{ path: step.log, kind: 'text', describes: `the output of ${step.name}` }] : [],
    ),
  ];
  if (run.ok) artifacts.push({ path: LAST_GREEN, kind: 'text', describes: 'the commit of this green run' });
  const rows = run.steps.map((step) => ({
    name: step.status === 'skipped' ? `${step.name} (skipped)` : step.name,
    ms: step.ms,
    ok: step.status !== 'fail',
    budgetMs: step.tier && TIERS[step.tier].budgetMs,
  }));
  return {
    ok: run.ok,
    summary: run.ok
      ? `${run.steps.length} steps passed in ${duration(total)}; ${run.head.sha.slice(0, 7)} recorded in ${LAST_GREEN}`
      : `${failures.length} problem${failures.length === 1 ? '' : 's'}: ${failed.map((step) => step.name).join(', ') || 'over budget'}`,
    lines: [...timingTable(rows), ...(t2?.note ? [t2.note] : []), `summary: ${CI_OUT.summary}`],
    target: 'local',
    failures,
    warnings,
    metrics: {
      commit: run.head.sha,
      dirty: run.head.dirty.length,
      ...Object.fromEntries(
        run.steps.map((step) => [step.name, step.status === 'skipped' ? 'skipped' : Math.round(step.ms)]),
      ),
    },
    artifacts,
  };
}

/** Builds the `x ci` command; the tests pass fakes for the step runner, git, the selections and the clock. */
export function createCiCommand(overrides: Partial<CiDeps> = {}): Command {
  const deps: CiDeps = { runStep: spawnStep, plan: tiersPlan, head: readHead, now: () => new Date(), ...overrides };
  return {
    usage: 'ci --local [--long]',
    options: { local: { type: 'boolean' }, long: { type: 'boolean' } },
    maxPositionals: 0,
    async run({ values, root }) {
      if (values.local !== true) {
        throw new UsageError('x ci runs only with --local: the GitHub workflow waits for the owner (PLAN.md §8.9)');
      }
      return toResult(await runCi(root, deps, { long: values.long === true }));
    },
  };
}

export default createCiCommand();
