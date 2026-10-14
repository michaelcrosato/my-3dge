/**
 * @file The test tiers (PLAN.md §8.2): their commands and budgets, and what a change selects in T1 and T2 and why
 * (the budget checks over the JSON reports: tools/lib/tierBudgets.ts). `x ci --local` (WP 0.9) calls `plan` and
 * `recordGreen`; an agent iterating reads the same selections.
 *
 * - **Tiers.** T0 `npm run check` (10 s), T1 `npm test` (60 s), T2 `npm run e2e` (by machine size, `t2Budget`: 9 min
 *   on 4 workers from 16 cores, 60 min on 1 worker on 4 cores; ADR-0022 amendment 2), and `LONG_RUNS`, which have no
 *   budget and run at each gate. T2's workers are one per `CORES_PER_WORKER` cores (`t2Workers`, which
 *   playwright.config.ts reads), so its budget follows the cores; callers pass the core count, never read here.
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
 * - **Budgets.** A tier over its budget warns and never fails (tools/lib/tierBudgets.ts, ADR-0022).
 *
 * @example
 * const { base, t1, t2 } = plan(); // t2.reason: 'T2 runs in full: engine/core/a.ts changed (engine code, …)'
 * duration(125_000); // '2 min 5 s'
 * t2Budget(4).ms; // 3_600_000: 60 min on 1 worker
 * t2Budget(16).ms; // 540_000: 9 min on 4 workers
 * @see tools/lib/tiers.test.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, two levels above this file. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A tier with a budget. */
export type TierId = 'T0' | 'T1' | 'T2';

/** One tier: its full command, its budget and the JSON report its duration is read from. */
export interface Tier {
  id: TierId;
  /** The full run, as argv. */
  command: readonly string[];
  /** Its budget in ms on a machine of `cores` cores (only T2's depends on them). */
  budgetMs(cores: number): number;
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
    budgetMs: () => 10_000,
    fix: 'time its parts (npm run typecheck, npm run lint, prettier --check, node x check) and speed up the slowest',
  },
  T1: {
    id: 'T1',
    command: ['npm', 'test'],
    budgetMs: () => 60_000,
    report: 'out/test/report.json',
    fix: 'find the slowest files in out/test/report.json and speed them up; a test that drives a browser belongs in T2 (tests/e2e/), one that is long in the long runs',
  },
  T2: {
    id: 'T2',
    command: ['npm', 'run', 'e2e'],
    budgetMs: (cores) => t2Budget(cores).ms,
    report: 'out/e2e/report.json',
    fix: 'find the slowest specs in out/e2e/report.json and speed them up; the gate selects T2 while it is over (§8.9)',
  },
};

/** The cores each T2 worker's Chromium gets: SwiftShader draws on the CPU (ADR-0014 amendment 15). */
export const CORES_PER_WORKER = 4;

/** T2's Playwright workers on a machine of `cores` cores: one per `CORES_PER_WORKER`, from 1 to 4. */
export function t2Workers(cores: number): number {
  return Math.max(1, Math.min(4, Math.floor(cores / CORES_PER_WORKER)));
}

/**
 * T2's measured budgets in ms, by its worker count (ADR-0022 amendment 2): 9 min on 4 workers, from 16 cores (gate
 * G6, ADR-0014 amendment 14); 60 min on 1, on 4 cores (57 min 40 s at caff36a in the cloud container, ADR-0014
 * amendment 15). 2 and 3 workers are unmeasured.
 */
export const T2_BUDGETS: Readonly<Record<1 | 4, number>> = { 1: 3_600_000, 4: 540_000 };

/** T2's budget on `cores` cores: its worker count's measured budget; 2 and 3 workers, unmeasured, are held to 1's. */
export function t2Budget(cores: number): { workers: number; ms: number; measured: boolean; note: string } {
  const workers = t2Workers(cores);
  const own = workers === 1 || workers === 4 ? T2_BUDGETS[workers] : undefined;
  const on = `${workers} worker${workers === 1 ? '' : 's'} on ${cores} cores`;
  if (own !== undefined) return { workers, ms: own, measured: true, note: on };
  return { workers, ms: T2_BUDGETS[1], measured: false, note: `${on}, unmeasured: held to 1 worker's` };
}

/**
 * The long runs (PLAN.md §8.2): no budget, run at each gate. The flake hunt, the kernel's perf budget (WP 1.5; T1
 * never asserts timing), the crowd ladder's (WPs 5.5, 5.7: tests/baselines/perf/box-crowd-1000.json) and the clip
 * library's QA, every clip played on every build (WP 8.6: T1 plays a sample), and clip mode in the box page playing
 * every clip (WP 8.9: T2 plays one of each set). Long replays (WP 1.5) join them.
 */
export const LONG_RUNS: readonly { name: string; command: readonly string[] }[] = [
  { name: 'flake hunt', command: ['npm', 'run', 'e2e', '--', '--repeat-each', '3'] },
  { name: 'kernel budget', command: ['node', 'x', 'perf', 'fixtures/scenes/kernel', '--budget'] },
  {
    name: 'crowd ladder',
    command: ['node', 'x', 'perf', 'labs/box', '--scene', 'crowd-1000', '--ladder', '--budget'],
  },
  {
    name: 'fight ladder',
    command: ['node', 'x', 'perf', 'labs/box', '--scene', 'fight-1000', '--ladder', '--budget'],
  },
  { name: 'clip QA', command: ['node', 'x', 'qa', 'anim', '--only', 'clip:,set:'] },
  {
    name: 'box clips',
    command: ['env', 'BOX_CLIPS=all', 'npm', 'run', 'e2e', '--', 'tests/e2e/box-clips.spec.ts', '--workers=1'],
  },
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
 * What T2 runs for `changes`; undefined changes (no base) run it all. `x ci --local` passes `lastFull`: the duration
 * of the last full T2 run and this machine's cores. While that run is within T2's budget on these cores, the gate runs
 * T2 in full (PLAN.md §8.9): on 4 cores that is the whole hour, by design (ADR-0022 amendment 2).
 */
export function selectT2(
  changes: Changes | undefined,
  options: { lastFull?: { ms: number; cores: number } } = {},
): Selection {
  const all = (reason: string): Selection => ({ tier: 'T2', mode: 'all', command: [...TIERS.T2.command], reason });
  const { lastFull } = options;
  const budget = lastFull && t2Budget(lastFull.cores);
  if (lastFull && budget && lastFull.ms <= budget.ms) {
    const within = `within its ${duration(budget.ms)} budget (${budget.note})`;
    return all(`T2 runs in full: its full set last took ${duration(lastFull.ms)}, ${within} (§8.9)`);
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

/**
 * The base, the changes and both selections for `root`: what `x ci --local` and an iterating agent run. `cores` is the
 * machine's (`availableParallelism()` by default), for T2's budget.
 */
export function plan(
  root: string = ROOT,
  options: { lastFullT2Ms?: number; cores?: number } = {},
): { base: Base; changes?: Changes; t1: Selection; t2: Selection } {
  const base = findBase(root);
  const changes = base.sha ? changedFiles(base.sha, root) : undefined;
  const { lastFullT2Ms: ms, cores = availableParallelism() } = options;
  const lastFull = ms === undefined ? undefined : { ms, cores };
  return { base, changes, t1: selectT1(changes), t2: selectT2(changes, { lastFull }) };
}

/** `8.1 s`, `2 min 5 s`, `6 min`. */
export function duration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds <= 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  const rest = Math.round(seconds % 60);
  return `${Math.floor(seconds / 60)} min${rest ? ` ${rest} s` : ''}`;
}
