/**
 * @file `npm run check` (T0, PLAN.md §8.1–§8.2): runs `tsc`, ESLint, Prettier and `node x check` at the same time and
 * fails if any fails. Run one after another they took about 9 s of T0's 10 s budget at G0, `tsc` alone about 4 s; in
 * parallel T0 takes as long as the slowest. Node runs this file directly (type stripping, as the hooks do; ADR-0014
 * amendment 4), so it needs nothing installed beyond the tools it starts.
 *
 * `tsc` is `npm run typecheck`'s command: `tsc -b` over the projects of tsconfig.check.json, which together hold
 * tsconfig.json's files. It reuses what the last run checked (node_modules/.cache/tsc/), so it costs what a change
 * reaches: measured 0.2 s unchanged, 1.5–3 s after a typical edit, about 6 s when an export of a module every file
 * reaches changes, against 6 s every time for `tsc --noEmit` (ADR-0014 amendment 7).
 *
 * Invariants: every tool runs to the end, so one run names every failure; each tool's output is printed whole, in
 * the fixed order below, after all have finished (never interleaved); the exit code is 0 only when all four pass,
 * else 1. Caches live under node_modules/.cache/, which `x ci --local` keeps across `npm ci`.
 *
 * Usage: `npm run check` (package.json: `"check": "node tools/checkAll.ts"`). Importing the module runs nothing.
 *
 * @see package.json, docs/TESTING.md
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/** One T0 tool: its name and its command line, run from the repository root. */
export interface CheckTool {
  name: string;
  command: string;
}

/** The T0 tools, in the order their output is printed; `tsc` runs package.json's `typecheck` command. */
export const CHECK_TOOLS: CheckTool[] = [
  { name: 'tsc', command: 'npx tsc -b tsconfig.check.json' },
  { name: 'eslint', command: 'npx eslint --cache --cache-location node_modules/.cache/eslint/ .' },
  { name: 'prettier', command: 'npx prettier --check --cache .' },
  { name: 'x check', command: 'node x check' },
];

/** The outcome of one tool: its exit code, combined output and time taken. */
interface ToolResult {
  tool: CheckTool;
  code: number;
  output: string;
  ms: number;
}

/** Runs one tool through the shell, collecting stdout and stderr together. */
function run(tool: CheckTool): Promise<ToolResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(tool.command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk));
    child.on('close', (code) => resolve({ tool, code: code ?? 1, output, ms: performance.now() - started }));
  });
}

/**
 * The cache directories ESLint and Prettier create on a cold run. They are made first, because `x check`'s docs
 * plugin, running at the same time, checks that the paths the docs cite exist.
 */
export const CACHE_DIRS = ['node_modules/.cache/eslint', 'node_modules/.cache/prettier'];

/** Runs every tool in parallel, prints their output in order, and returns the exit code (0 only if all pass). */
export async function checkAll(tools: CheckTool[] = CHECK_TOOLS): Promise<number> {
  for (const dir of CACHE_DIRS) mkdirSync(dir, { recursive: true });
  const started = performance.now();
  const results = await Promise.all(tools.map(run));
  for (const { tool, code, output, ms } of results) {
    const text = output.trimEnd();
    console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${tool.name} (${(ms / 1000).toFixed(1)} s)${text ? `\n${text}` : ''}`);
  }
  const failed = results.filter((result) => result.code !== 0).map((result) => result.tool.name);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(failed.length ? `check: FAIL (${failed.join(', ')})` : `check: ok in ${seconds} s`);
  return failed.length ? 1 : 0;
}

if (import.meta.main) process.exitCode = await checkAll();
