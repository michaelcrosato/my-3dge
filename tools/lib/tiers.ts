/**
 * @file The test tiers (PLAN.md §8.2): their commands and budgets, what a change selects in T1 and T2 and why, and the
 * budget check over the JSON reports. `x ci --local` (WP 0.9) calls `plan`, `checkReports`, `timingTable` and
 * `recordGreen`; an agent iterating reads the same selections.
 *
 * - **Tiers.** T0 `npm run check` (10 s), T1 `npm test` (60 s), T2 `npm run e2e` (6 min), and `LONG_RUNS`, which have
 *   no budget and run at each gate.
 * - **The base** is the merge-base of HEAD with `origin/main` once main holds a gate (its PLAN.md ledger marks a
 *   `**G<n>**` row `done`), else the commit in `out/ci/last-green` (the last green `x ci --local`), else none, and
 *   every tier runs in full. Nothing here fetches: run `git fetch origin main` first for a current base.
 * - **Changes** are what differs from the base in the working tree: committed, staged, unstaged and untracked. A file
 *   whose only changed lines are `"version"` lines (package.json and package-lock.json: the version lives in
 *   package.json alone, I-32) counts as unchanged, so a version bump selects nothing.
 * - **T1** runs in full when a file every test depends on changed (`T1_FULL`: dependencies, settings, the setup file,
 *   baselines), else as `vitest related --run <changed files>`: every test that imports a changed file, directly or
 *   not, through Vite's module graph. That is `vitest run --changed <base>` minus the version-only files; Vitest's
 *   own `--changed` reruns everything on the same `T1_FULL` files (vite.config.ts's `forceRerunTriggers`).
 * - **T2** runs in full when engine, lab or page code changed (`T2_FULL`), because pages reach the browser through the
 *   dev server and not through the specs' imports; else as `playwright test --only-changed=<base>`.
 * - **Budgets.** A tier over its budget warns; at 1.5× its budget it fails.
 *
 * @example
 * const { base, t1, t2 } = plan(); // t2.reason: 'T2 runs in full: engine/core/a.ts changed (engine code, …)'
 * const checks = checkReports(process.cwd(), { T0: 4100 }); // T1 and T2 from out/test/ and out/e2e/report.json
 * console.log(timingTable([{ name: 'npm test', ms: 8140, ok: true, budgetMs: TIERS.T1.budgetMs }]).join('\n'));
 * @see tools/lib/tiers.test.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, two levels above this file. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A tier with a budget. */
export type TierId = 'T0' | 'T1' | 'T2';

/** One tier: its full command, its budget and the JSON report its duration is read from. */
export interface Tier {
  id: TierId;
  /** The full run, as argv. */
  command: readonly string[];
  budgetMs: number;
  /** The report it writes (PLAN.md §8.1), relative to the root; T0 writes none, so its caller measures it. */
  report?: string;
  /** Where to look when it is slow. */
  fix: string;
}

/** The tiers of PLAN.md §8.2. */
export const TIERS: Readonly<Record<TierId, Tier>> = {
  T0: {
    id: 'T0',
    command: ['npm', 'run', 'check'],
    budgetMs: 10_000,
    fix: 'time its parts (npm run typecheck, npm run lint, prettier --check, node x check) and speed up the slowest',
  },
  T1: {
    id: 'T1',
    command: ['npm', 'test'],
    budgetMs: 60_000,
    report: 'out/test/report.json',
    fix: 'find the slowest files in out/test/report.json and speed them up; a test that drives a browser belongs in T2 (tests/e2e/), one that is long in the long runs',
  },
  T2: {
    id: 'T2',
    command: ['npm', 'run', 'e2e'],
    budgetMs: 360_000,
    report: 'out/e2e/report.json',
    fix: 'find the slowest specs in out/e2e/report.json and speed them up; the gate selects T2 while it is over (§8.9)',
  },
};

/** The long runs: no budget, run at each gate. Long replays (WP 1.5) and the crowd ladder (WP 5.5) join them. */
export const LONG_RUNS: readonly { name: string; command: readonly string[] }[] = [
  { name: 'flake hunt', command: ['npm', 'run', 'e2e', '--', '--repeat-each', '3'] },
];

/** A path whose change runs a whole tier: a file, or a directory when it ends in `/`. */
export interface Trigger {
  path: string;
  /** Why, completing "it changed (…)". */
  why: string;
}

/** Changes that run every T1 test: what all of them run under, or read outside their imports. */
export const T1_FULL: readonly Trigger[] = [
  { path: 'package.json', why: 'the dependencies and scripts' },
  { path: 'package-lock.json', why: 'the installed dependencies' },
  { path: '.nvmrc', why: 'the Node version' },
  { path: 'tsconfig.json', why: 'how TypeScript compiles' },
  { path: 'tsconfig.base.json', why: 'how TypeScript compiles' },
  { path: 'vite.config.ts', why: "Vitest's settings" },
  { path: 'tests/setup/', why: 'the setup every test file runs' },
  { path: 'tests/baselines/', why: 'baselines, which tests read from disk, outside their imports' },
  { path: 'scripts/setup.sh', why: 'the platform constants tools read from it' },
];

/** Changes that run all of T2: code that reaches the browser through the dev server, and what every spec runs under. */
export const T2_FULL: readonly Trigger[] = [
  { path: 'engine/', why: "engine code, which pages load through the dev server, not through the specs' imports" },
  { path: 'labs/', why: "lab code, which pages load through the dev server, not through the specs' imports" },
  { path: 'tests/pages/', why: "page code, which pages load through the dev server, not through the specs' imports" },
  { path: 'index.html', why: 'page code' },
  { path: 'fixtures/', why: 'fixture content, which pages import' },
  { path: 'data/', why: 'data, which pages import' },
  { path: 'public/', why: 'files the dev server serves' },
  { path: 'tests/baselines/', why: 'baselines, which specs read from disk, outside their imports' },
  {
    path: 'tests/setup/fixtures/',
    why: "the advice trap's fixture specs, which tests/e2e/adviceTrap.spec.ts runs in a child Playwright, outside its imports",
  },
  { path: 'package.json', why: 'the dependencies' },
  { path: 'package-lock.json', why: 'the installed dependencies' },
  { path: '.nvmrc', why: 'the Node version' },
  { path: 'tsconfig.json', why: 'how Vite compiles TypeScript' },
  { path: 'tsconfig.base.json', why: 'how Vite compiles TypeScript' },
  { path: 'vite.config.ts', why: 'the dev server' },
  { path: 'playwright.config.ts', why: "Playwright's settings" },
];

/** `T1_FULL` as Vitest's `forceRerunTriggers` globs, so `vitest --changed` and `vitest related` agree with `selectT1`. */
export function vitestRerunTriggers(): string[] {
  return T1_FULL.map(({ path }) => (path.endsWith('/') ? `**/${path}**` : `**/${path}`));
}

/** Where the last green `x ci --local` records its commit, relative to the root. */
export const LAST_GREEN = 'out/ci/last-green';

/** The commit a selection compares against, and why it is that one. */
export interface Base {
  /** The full SHA; absent when there is no base and every tier runs in full. */
  sha?: string;
  from: 'origin/main' | 'last-green' | 'none';
  reason: string;
}

/** What changed since a base. */
export interface Changes {
  /** The base commit. */
  base: string;
  /** Changed, added, deleted and untracked files, relative to the root, sorted; version-only changes left out. */
  files: string[];
  /** Files left out because only their `"version"` lines changed. */
  versionOnly: string[];
}

/** What a tier runs for a change, and why. */
export interface Selection {
  tier: 'T1' | 'T2';
  /** `all`: the whole tier; `some`: what the changes reach; `none`: nothing to run. */
  mode: 'all' | 'some' | 'none';
  /** The command to run from the root, as argv; empty for `none`. */
  command: string[];
  /** One sentence saying why. */
  reason: string;
}

/** Runs git in `root` and returns its output; throws when git fails. */
function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 26,
  });
}

/** Runs git in `root`; undefined when it fails. */
function tryGit(root: string, args: string[]): string | undefined {
  try {
    return git(root, args).trim();
  } catch {
    return undefined;
  }
}

/** The latest gate a PLAN.md ledger marks done (`| **G0** | … | done |`), if any. */
function gateDone(plan: string): string | undefined {
  const rows = [...plan.matchAll(/^\|\s*\*\*(G\d+)\*\*\s*\|[^|\n]*\|[^|\n]*\|\s*done\s*\|/gm)];
  return rows.at(-1)?.[1];
}

/** The base for selections in `root` (see the file comment). */
export function findBase(root: string = ROOT): Base {
  const main = tryGit(root, ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']);
  const gate = main ? gateDone(tryGit(root, ['show', 'origin/main:PLAN.md']) ?? '') : undefined;
  const sha = gate ? tryGit(root, ['merge-base', 'HEAD', 'origin/main']) : undefined;
  if (gate && sha) {
    return {
      sha,
      from: 'origin/main',
      reason: `the merge-base with origin/main (${sha.slice(0, 7)}), which holds ${gate}`,
    };
  }
  const file = join(root, LAST_GREEN);
  const green = existsSync(file) ? readFileSync(file, 'utf8').trim().split(/\s+/)[0] : '';
  const known = green ? tryGit(root, ['rev-parse', '--verify', '--quiet', `${green}^{commit}`]) : undefined;
  const why = main ? 'origin/main holds no gate yet' : 'there is no origin/main';
  if (known)
    return { sha: known, from: 'last-green', reason: `the last green x ci --local (${known.slice(0, 7)}): ${why}` };
  const missing = green ? `names an unknown commit (${green})` : 'is missing';
  return { from: 'none', reason: `no base: ${why} and ${LAST_GREEN} ${missing}, so every tier runs in full` };
}

/** Records `sha` as the last green `x ci --local`, the base until main holds a gate. */
export function recordGreen(sha: string, root: string = ROOT): void {
  mkdirSync(dirname(join(root, LAST_GREEN)), { recursive: true });
  writeFileSync(join(root, LAST_GREEN), `${sha}\n`);
}

/** True when every changed line of a unified diff is a `"version": "…"` line, as many removed as added. */
export function isVersionOnly(diff: string): boolean {
  const changed: string[] = [];
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) inHunk = false;
    else if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && (line.startsWith('-') || line.startsWith('+'))) changed.push(line);
  }
  const removed = changed.filter((line) => line.startsWith('-')).length;
  const version = /^[-+]\s*"version":\s*"[^"]*",?\s*$/;
  return changed.length > 0 && removed * 2 === changed.length && changed.every((line) => version.test(line));
}

/** The files that carry the version, where a version-only change counts as no change. */
const VERSIONED = ['package.json', 'package-lock.json'];

/** What differs from `base` in `root`'s working tree (see the file comment). */
export function changedFiles(base: string, root: string = ROOT): Changes {
  const tracked = git(root, ['diff', '--name-only', '--no-renames', '-z', base]).split('\0');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
  const all = [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
  const versionOnly = all.filter(
    (file) => VERSIONED.includes(file) && isVersionOnly(git(root, ['diff', '-U0', base, '--', file])),
  );
  return { base, files: all.filter((file) => !versionOnly.includes(file)), versionOnly };
}

/** The first of `files` a trigger covers, with the trigger's reason. */
function firstHit(files: readonly string[], triggers: readonly Trigger[]): { file: string; why: string } | undefined {
  for (const file of files) {
    const hit = triggers.find(({ path }) => (path.endsWith('/') ? file.startsWith(path) : file === path));
    if (hit) return { file, why: hit.why };
  }
  return undefined;
}

/** Up to three files, then a count. */
function some(files: readonly string[]): string {
  return files.slice(0, 3).join(', ') + (files.length > 3 ? ` and ${files.length - 3} more` : '');
}

/** "nothing changed since abc1234 (but the version in package.json)". */
function nothing(changes: Changes): string {
  const version = changes.versionOnly.length ? ` but the version in ${changes.versionOnly.join(' and ')}` : '';
  return `nothing changed since ${changes.base.slice(0, 7)}${version}`;
}

/** What T1 runs for `changes`; undefined changes (no base) run it all. */
export function selectT1(changes: Changes | undefined): Selection {
  const all = (reason: string): Selection => ({ tier: 'T1', mode: 'all', command: [...TIERS.T1.command], reason });
  if (!changes) return all('T1 runs in full: there is no base to compare against');
  if (!changes.files.length)
    return { tier: 'T1', mode: 'none', command: [], reason: `T1 selects nothing: ${nothing(changes)}` };
  const hit = firstHit(changes.files, T1_FULL);
  if (hit) return all(`T1 runs in full: ${hit.file} changed (${hit.why})`);
  return {
    tier: 'T1',
    mode: 'some',
    command: ['npx', 'vitest', 'related', '--run', '--passWithNoTests', ...changes.files],
    reason: `T1 runs the tests that import ${some(changes.files)}, directly or not (Vite's module graph)`,
  };
}

/**
 * What T2 runs for `changes`; undefined changes (no base) run it all. `x ci --local` passes `lastFullMs`, the
 * duration of the last full T2 run: while that is within budget, the gate runs T2 in full (PLAN.md §8.9).
 */
export function selectT2(changes: Changes | undefined, options: { lastFullMs?: number } = {}): Selection {
  const all = (reason: string): Selection => ({ tier: 'T2', mode: 'all', command: [...TIERS.T2.command], reason });
  const { lastFullMs } = options;
  if (lastFullMs !== undefined && lastFullMs <= TIERS.T2.budgetMs) {
    return all(`T2 runs in full: its full set last took ${duration(lastFullMs)}, within its budget (§8.9)`);
  }
  if (!changes) return all('T2 runs in full: there is no base to compare against');
  if (!changes.files.length)
    return { tier: 'T2', mode: 'none', command: [], reason: `T2 selects nothing: ${nothing(changes)}` };
  const hit = firstHit(changes.files, T2_FULL);
  if (hit) return all(`T2 runs in full: ${hit.file} changed (${hit.why})`);
  return {
    tier: 'T2',
    mode: 'some',
    command: [...TIERS.T2.command, '--', `--only-changed=${changes.base}`, '--pass-with-no-tests'],
    reason: `T2 runs the specs that import ${some(changes.files)}, directly or not (Playwright's --only-changed)`,
  };
}

/** The base, the changes and both selections for `root`: what `x ci --local` and an iterating agent run. */
export function plan(
  root: string = ROOT,
  options: { lastFullT2Ms?: number } = {},
): { base: Base; changes?: Changes; t1: Selection; t2: Selection } {
  const base = findBase(root);
  const changes = base.sha ? changedFiles(base.sha, root) : undefined;
  return { base, changes, t1: selectT1(changes), t2: selectT2(changes, { lastFullMs: options.lastFullT2Ms }) };
}

/** `8.1 s`, `2 min 5 s`, `6 min`. */
export function duration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds <= 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  const rest = Math.round(seconds % 60);
  return `${Math.floor(seconds / 60)} min${rest ? ` ${rest} s` : ''}`;
}

/** A tier at this multiple of its budget, or more, fails; over the budget alone warns. */
export const FAIL_FACTOR = 1.5;

/** A tier's duration against its budget. */
export interface BudgetCheck {
  tier: TierId;
  ms: number;
  budgetMs: number;
  status: 'ok' | 'warn' | 'fail';
  /** One sentence: the duration, the budget and, when over, where to look. */
  message: string;
}

/** Checks one duration against its tier's budget: over it warns, at `FAIL_FACTOR` times it fails. */
export function checkBudget(tier: TierId, ms: number): BudgetCheck {
  const { budgetMs, fix } = TIERS[tier];
  const status = ms >= budgetMs * FAIL_FACTOR ? 'fail' : ms > budgetMs ? 'warn' : 'ok';
  const budget = duration(budgetMs);
  const took = `${tier} took ${duration(ms)}`;
  const message =
    status === 'ok'
      ? `${took}, within its ${budget} budget`
      : status === 'warn'
        ? `${took}, over its ${budget} budget (it fails at ${duration(budgetMs * FAIL_FACTOR)}): ${fix}`
        : `${took}, at least ${FAIL_FACTOR}× its ${budget} budget: ${fix}`;
  return { tier, ms, budgetMs, status, message };
}

/** The wall-clock duration a Vitest or Playwright JSON report records; throws on anything else. */
export function reportMs(file: string): number {
  const report = JSON.parse(readFileSync(file, 'utf8')) as {
    stats?: { duration?: unknown };
    startTime?: unknown;
    testResults?: { endTime?: number }[];
  };
  if (typeof report.stats?.duration === 'number') return report.stats.duration;
  if (typeof report.startTime === 'number' && Array.isArray(report.testResults)) {
    const ends = report.testResults.map((result) => result.endTime ?? report.startTime) as number[];
    return Math.max(report.startTime, ...ends) - report.startTime;
  }
  throw new Error(
    `${file} is neither a Vitest nor a Playwright JSON report: run npm test or npm run e2e to rewrite it`,
  );
}

/**
 * Checks each tier's duration: `measured` first (T0 writes no report, so `x ci --local` times it), else the tier's
 * JSON report under `root`. A tier with neither is left out.
 */
export function checkReports(root: string = ROOT, measured: Partial<Record<TierId, number>> = {}): BudgetCheck[] {
  const checks: BudgetCheck[] = [];
  for (const tier of Object.values(TIERS)) {
    const report = tier.report && join(root, tier.report);
    const ms = measured[tier.id] ?? (report && existsSync(report) ? reportMs(report) : undefined);
    if (ms !== undefined) checks.push(checkBudget(tier.id, ms));
  }
  return checks;
}

/** One row of the timing table. */
export interface Timing {
  name: string;
  ms: number;
  ok: boolean;
  budgetMs?: number;
}

/** The timing table: one line per step (verdict, name, duration, budget), then the total. */
export function timingTable(rows: readonly Timing[]): string[] {
  const width = Math.max(4, ...rows.map((row) => row.name.length));
  const lines = rows.map(({ name, ms, ok, budgetMs }) => {
    const budget = budgetMs === undefined ? '' : ` / ${duration(budgetMs)}${ms > budgetMs ? ' (over budget)' : ''}`;
    return `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${duration(ms)}${budget}`;
  });
  const failed = rows.filter((row) => !row.ok).map((row) => row.name);
  const total = duration(rows.reduce((sum, row) => sum + row.ms, 0));
  lines.push(failed.length ? `FAILED: ${failed.join(', ')} (${total} in all)` : `all passed in ${total}`);
  return lines;
}
