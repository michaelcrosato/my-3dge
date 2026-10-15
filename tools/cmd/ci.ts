/**
 * @file The merge gate and the full run (PLAN.md §8.9, WP 0.9; ADR-0023). `x ci --local` is the quick gate an agent
 * runs before every merge: `CI_STEPS` but the `full` ones (x new --test-all, x engine --test and T2), in order on this
 * machine, held to one budget for them together
 * (tools/lib/tierBudgets.ts, five minutes). `x ci --local --full` is the full run: every step, T2 in full. Nobody waits
 * on it: the GitHub workflow (.github/workflows/ci.yml) runs it after each merge to main and by hand, and an agent at
 * the end of a goal or a stage. `x ci --status` says how main's last full run went (tools/lib/ciStatus.ts). Each run
 * writes `out/ci/summary.md` (tools/lib/ciSummary.ts) and, when everything passed, records HEAD in
 * `out/ci/last-green`, the base of the selections until main holds a gate.
 *
 * - **Steps:** `npm ci`, `x src`, `npm run check` (with `x deps --check` and `x docs --check`), `npm test`,
 *   `x port refs --check` and, in the full run, `x new --test-all`, `x engine --test` (a new game passes its own
 *   gate, tools/cmd/engine.ts) and `npm run e2e`, each from the root with its output
 *   kept in `out/ci/logs/<n>-<step>.log`, never printed. A failed `npm ci` skips the rest; after any other failure the
 *   next steps still run, so one run names every failure. The workflow's unit test keeps it running the full run
 *   (tools/cmd/ci-workflow.test.ts). The Vercel build is not a step (ADR-0021).
 * - **Budget:** the quick steps' times together against `GATE_BUDGET_MS`; over it warns and never fails (ADR-0022).
 *   T2 and the long runs have none: nobody waits on them (ADR-0023).
 * - **`npm ci` reinstalls node_modules under this running process.** That is safe, measured: everything this command
 *   runs is imported before it starts, and every later step is a new process. `KEPT_CACHES` survive it:
 *   `node_modules/.cache/` (the ESLint and Prettier caches, and tsc's declarations and build info), so T0 runs warm,
 *   and Vitest's file durations, so T1 starts its longest files first.
 * - `--long` also runs tiers.ts's `LONG_RUNS` after the steps (at each gate).
 *
 * Usage: node x ci --local [--full] [--long] | node x ci --status. Exit 0 when every step passed (or main's last full
 * run did); 1 otherwise; 2 on a usage error, `--local` and `--status` both missing included.
 *
 * @example
 * CI_STEPS.map((step) => step.name); // ['npm ci', 'x src', 'npm run check', 'npm test', …, 'npm run e2e']
 * CI_STEPS.filter((step) => step.full).map((step) => step.name); // ['x new --test-all', 'x engine --test', 'npm run e2e']
 * @see tools/cmd/ci.test.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { runtime } from '../lib/report';
import { LONG_RUNS, recordGreen, TIERS, t2Workers, type TierId } from '../lib/tiers';
import { checkGate, type BudgetCheck } from '../lib/tierBudgets';
import { CI_OUT, renderSummary, toResult } from '../lib/ciSummary';
import { mainStatus, readRuns, repoSlug, type RunsReader } from '../lib/ciStatus';
import { UsageError, type Command } from '../x';

/** One step of the gate. */
export interface CiStep {
  /** Its name in the summary: the command as an agent types it. */
  name: string;
  /** The argv run from the root; `node` means this process's Node. */
  command: readonly string[];
  /** The tier it runs. */
  tier?: TierId;
  /** Nothing else can run without it: when it fails, the remaining steps are skipped. */
  required?: boolean;
  /** Only in the full run (`--full`), which nobody waits on (ADR-0023). */
  full?: boolean;
}

/** The steps of `x ci --local`, in order (PLAN.md §8.9); the quick gate leaves out the `full` ones. */
export const CI_STEPS: readonly CiStep[] = [
  { name: 'npm ci', command: ['npm', 'ci'], required: true },
  { name: 'x src', command: ['node', 'x', 'src'] },
  { name: 'npm run check', command: TIERS.T0.command, tier: 'T0' },
  { name: 'npm test', command: TIERS.T1.command, tier: 'T1' },
  { name: 'x port refs --check', command: ['node', 'x', 'port', 'refs', '--check'] },
  { name: 'x new --test-all', command: ['node', 'x', 'new', '--test-all'], full: true },
  { name: 'x engine --test', command: ['node', 'x', 'engine', '--test'], full: true },
  { name: 'npm run e2e', command: TIERS.T2.command, tier: 'T2', full: true },
];

/** Why the quick gate leaves a step out. */
export const FULL_ONLY =
  "the full run's: node x ci --local --full, on GitHub after each merge, nobody waiting on it (ADR-0023)";

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
  head: (root: string) => Head;
  now: () => Date;
  /** The machine's cores, which set T2's workers (`availableParallelism()`). */
  cores: number;
  /** The GitHub workflow's runs on main, newest first (`x ci --status`; tools/lib/ciStatus.ts). */
  runs: RunsReader;
  /** The repository's `origin` URL, or undefined without one. */
  origin: (root: string) => string | undefined;
}

/** One step's result. */
export interface StepResult {
  name: string;
  /** The argv it ran; empty when skipped. */
  command: string[];
  status: 'ok' | 'fail' | 'skipped';
  ms: number;
  code?: number;
  tier?: TierId;
  /** Its log, relative to the root. */
  log?: string;
  /** Why it was skipped. */
  note?: string;
  /** The last lines of its output, when it failed. */
  tail?: string[];
}

/** A whole run of the gate. */
export interface CiRun {
  ok: boolean;
  /** The full run (`--full`), else the quick gate. */
  full: boolean;
  head: Head;
  /** When it started (ISO 8601). */
  started: string;
  runtime: string;
  /** The machine's cores: T2's workers go by them. */
  cores: number;
  steps: StepResult[];
  /** The quick steps' time together against the gate's budget. */
  budget: BudgetCheck;
}

/** The lines of a failed step's output kept in the summary. */
const TAIL_LINES = 30;

/**
 * What `npm ci` must not wipe, relative to the root: the tools' caches, and Vitest's record of each file's duration,
 * from which it starts the longest files first (without it, T1 took 39 s instead of 36 s).
 */
export const KEPT_CACHES = ['node_modules/.cache', 'node_modules/.vite/vitest'];

/** Moves `KEPT_CACHES` aside while `npm ci` replaces node_modules; the returned function puts them back. */
function keepCache(root: string): () => void {
  const kept = join(root, CI_OUT.keptCache);
  rmSync(kept, { recursive: true, force: true });
  const moved = KEPT_CACHES.map((dir, i) => [join(root, dir), join(kept, String(i))] as const).filter(([from]) =>
    existsSync(from),
  );
  mkdirSync(kept, { recursive: true });
  for (const [from, aside] of moved) renameSync(from, aside);
  return () => {
    if (existsSync(join(root, 'node_modules'))) {
      for (const [home, aside] of moved) {
        rmSync(home, { recursive: true, force: true });
        mkdirSync(dirname(home), { recursive: true });
        renameSync(aside, home);
      }
    }
    rmSync(kept, { recursive: true, force: true });
  };
}

/** `npm run e2e` → `npm-run-e2e`. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Runs the gate in `root`: the quick steps, or every step with `full`; then the long runs with `long`, the budget, the
 * summary and, when green, `out/ci/last-green`.
 */
export async function runCi(
  root: string,
  deps: CiDeps,
  options: { full?: boolean; long?: boolean } = {},
): Promise<CiRun> {
  const started = deps.now().toISOString();
  const head = deps.head(root);
  const full = options.full === true;
  rmSync(join(root, CI_OUT.logs), { recursive: true, force: true });
  mkdirSync(join(root, CI_OUT.logs), { recursive: true });

  const queue: CiStep[] = [...CI_STEPS, ...(options.long ? LONG_RUNS : [])];
  const steps: StepResult[] = [];
  let quickMs = 0;
  let stop: string | undefined;
  for (const [i, step] of queue.entries()) {
    const command = [...step.command];
    const left = stop ?? (step.full && !full ? FULL_ONLY : undefined);
    if (left) {
      steps.push({ name: step.name, command: [], status: 'skipped', ms: 0, tier: step.tier, note: left });
      continue;
    }
    const log = `${CI_OUT.logs}/${i + 1}-${slug(step.name)}.log`;
    const restore = step.command.join(' ') === 'npm ci' ? keepCache(root) : undefined;
    const outcome = await deps.runStep(command, root);
    restore?.();
    writeFileSync(join(root, log), outcome.output);
    const ok = outcome.code === 0;
    const lines = outcome.output.trimEnd().split('\n');
    const workers = t2Workers(deps.cores);
    const note =
      step.tier === 'T2' ? `in full, ${workers} worker${workers === 1 ? '' : 's'} on ${deps.cores} cores` : undefined;
    steps.push({
      name: step.name,
      command,
      status: ok ? 'ok' : 'fail',
      ms: outcome.ms,
      code: outcome.code,
      tier: step.tier,
      log,
      note,
      tail: ok ? undefined : lines.slice(-TAIL_LINES),
    });
    if (i < CI_STEPS.length && !step.full) quickMs += outcome.ms;
    if (!ok && step.required) stop = `skipped: ${step.name} failed`;
  }

  const ok = steps.every((step) => step.status !== 'fail');
  const run: CiRun = {
    ok,
    full,
    head,
    started,
    runtime: runtime(),
    cores: deps.cores,
    steps,
    budget: checkGate(quickMs),
  };
  if (ok) recordGreen(head.sha, root);
  writeFileSync(join(root, CI_OUT.summary), renderSummary(run));
  return run;
}

/** The repository's `origin` URL, or undefined (no git, no remote). */
export function readOrigin(root: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return url.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Builds the `x ci` command; the tests pass fakes for the step runner, git, the selections and the clock. */
export function createCiCommand(overrides: Partial<CiDeps> = {}): Command {
  const defaults = { runStep: spawnStep, head: readHead, now: () => new Date(), cores: availableParallelism(), runs: readRuns, origin: readOrigin }; // prettier-ignore
  const deps: CiDeps = { ...defaults, ...overrides };
  return {
    usage: 'ci --local [--full] [--long] | ci --status',
    options: {
      local: { type: 'boolean' },
      full: { type: 'boolean' },
      long: { type: 'boolean' },
      status: { type: 'boolean' },
    },
    maxPositionals: 0,
    async run({ values, root }) {
      if (values.status === true && values.local !== true) {
        return mainStatus(repoSlug(deps.origin(root)), deps.runs);
      }
      if (values.local !== true || values.status === true) {
        throw new UsageError(
          'x ci runs with --local (the quick gate; --full for every step, as the GitHub workflow does after each merge) or alone with --status (ADR-0023)',
        );
      }
      return toResult(await runCi(root, deps, { full: values.full === true, long: values.long === true }));
    },
  };
}

export default createCiCommand();
