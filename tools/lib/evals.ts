/**
 * @file The agent-usability evals' tasks and runs (PLAN.md WP 12.2, ADR-0025 decision 5), which `node x evals`
 * (tools/cmd/evals.ts) drives: how a task is written, the copy of this repository an attempt works in, and how an
 * attempt is judged.
 *
 * A task is a directory `evals/<id>/` (lowercase words joined by `-`) holding `prompt.md`, what the agent is told after
 * `PREAMBLE`, and `task.json`: `title` (one line), `area` (`box`, `playground` or `engine`), `minutes` (a live attempt's
 * budget), `solution` (the reference solution: a patch from the starting state, kept beside the task), optionally
 * `start` (a patch from this tree to the starting state: a bug to find), and `accept`: `test` (a Vitest file the agent
 * never sees, run in the copy as `evals/<id>/accept.test.ts`; not `*.test.ts` here, so `npm test` leaves it alone) and
 * optionally `commands` (shell commands that must exit 0 in the copy), `unchanged` (paths the attempt must leave as
 * the start has them, besides `GUARDED`, the acceptance's own harness) and `checks` (`types`, x new's type check of
 * tools/cmd/new.ts, and `lint`, ESLint's errors, on the TypeScript the attempt changed and the test).
 *
 * An attempt runs in a copy (`makeCopy`): the files git tracks or would track here, evals/ aside, node_modules linked
 * from here, the start applied and committed in a fresh git repository, so `changedFiles` is the attempt's work
 * whether it commits or not. `judge` checks what must be unchanged, then runs the test, the commands and the checks,
 * stopping at the first that fails. `dryRunTask` judges a task twice with no model call: its acceptance must fail on
 * the start (else it proves nothing, `EVALS_NOT_REAL`) and pass once the reference solution is applied
 * (`EVALS_SOLUTION_FAILS`); `attemptTask` hands an agent's command the prompt on its standard input in the copy, stops
 * it after the task's minutes, its whole process group with it (`stopGroup`: a timed-out shell leaves its children
 * running), keeps its output and diff under out/evals/<id>/, and judges what it left.
 *
 * Invariants: nothing here writes inside the repository but out/; a copy lives under the system's temporary directory
 * and is removed after its task unless kept; children never inherit Vitest's or git's variables.
 *
 * @example
 * patchedFiles('diff --git a/labs/x.ts b/labs/x.ts\n'); // ['labs/x.ts']
 * @see tools/cmd/evals.test.ts
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { runCheck, type CheckName } from '../cmd/new';
import type { Finding } from './report';

/** Where the tasks live, from the repository root. */
export const EVALS_DIR = 'evals';
/** The baseline's file: the live pass rate, or why there is none yet. */
export const BASELINE_FILE = 'evals/baseline.json';
/** What a task works on. */
export const AREAS = ['box', 'playground', 'engine'] as const;
/** What every attempt leaves as the start has it: the acceptance's own harness. */
export const GUARDED: readonly string[] = ['vite.config.ts', 'tests/setup/', 'package.json', 'package-lock.json'];
/** The checks `accept.checks` may name. */
export const ACCEPT_CHECKS: readonly CheckName[] = ['types', 'lint'];
/** How long one acceptance step may run before it is stopped, in ms: it bounds a hang, never a slow machine. */
export const STEP_TIMEOUT_MS = 20 * 60_000;

/** What a live attempt's agent is told before the task's own prompt. */
export const PREAMBLE = `You are a fresh agent in a copy of my-3dge, a WebGPU game engine written and maintained only by AI agents. Do the task below with only this repository to go on: its docs (AGENTS.md, docs/, the skills in .claude/skills/, the file comments), its templates and its commands. Work in this directory alone: the network, \`node x deps --update\`, pushes, pull requests and escalations are out of this task's scope, and so are the ledger and docs/PROGRESS.md. You are done when the task is, with its checks green (npm run check and the unit tests your change touches); committing is up to you.

The task:`;

/** A task's acceptance, filled. */
export interface Acceptance {
  test: string;
  commands: string[];
  unchanged: string[];
  checks: CheckName[];
}

/** One task, read from `evals/<id>/`. */
export interface EvalTask {
  id: string;
  /** Its directory, from the root: `evals/<id>`. */
  dir: string;
  title: string;
  area: (typeof AREAS)[number];
  minutes: number;
  start?: string;
  solution: string;
  accept: Acceptance;
  prompt: string;
}

const TASK_KEYS = ['title', 'area', 'minutes', 'start', 'solution', 'accept'];
const ACCEPT_KEYS = ['test', 'commands', 'unchanged', 'checks'];
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');
/** Whether `file` is `path` or under it (a path ending in `/` is a directory). */
const under = (file: string, path: string) => file === path.replace(/\/$/, '') || file.startsWith(path.endsWith('/') ? path : `${path}/`); // prettier-ignore

/** The files a patch's text changes (both sides of each `diff --git` line). */
export function patchedFiles(text: string): string[] {
  const files = [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap((match) => [match[1], match[2]]);
  return [...new Set(files)].sort();
}

/** The problems with a task's `task.json` spec, beyond JSON itself; `file` resolves a name beside it. */
function specProblems(spec: Record<string, unknown>, file: (name: unknown) => string): string[] {
  const accept = (spec.accept ?? {}) as Record<string, unknown>;
  const problems = [
    ...Object.keys(spec).filter((key) => !TASK_KEYS.includes(key)).map((key) => `unknown key "${key}" (keys: ${TASK_KEYS.join(', ')})`), // prettier-ignore
    ...Object.keys(accept).filter((key) => !ACCEPT_KEYS.includes(key)).map((key) => `unknown accept key "${key}" (keys: ${ACCEPT_KEYS.join(', ')})`), // prettier-ignore
  ];
  if (typeof spec.title !== 'string' || !spec.title.trim() || spec.title.includes('\n')) problems.push('"title" is one line of text'); // prettier-ignore
  if (!(AREAS as readonly unknown[]).includes(spec.area)) problems.push(`"area" is one of ${AREAS.join(', ')}`);
  if (!Number.isInteger(spec.minutes) || (spec.minutes as number) < 1 || (spec.minutes as number) > 240) problems.push('"minutes" is a whole number of minutes, 1 to 240'); // prettier-ignore
  for (const key of ['solution', 'start'] as const) {
    if (key === 'start' && spec.start === undefined) continue;
    const path = file(spec[key]);
    if (!path || !existsSync(path)) problems.push(`"${key}" names a patch beside task.json: ${String(spec[key])} is missing`); // prettier-ignore
    else if (!readFileSync(path, 'utf8').startsWith('diff --git ')) problems.push(`its ${key}, ${String(spec[key])}, is not a git patch: write it with git diff`); // prettier-ignore
  }
  const test = file(accept.test);
  if (!test || !existsSync(test) || !test.endsWith('.ts') || test.endsWith('.test.ts')) problems.push('"accept.test" names a .ts file beside task.json, not *.test.ts (npm test would run it)'); // prettier-ignore
  for (const key of ['commands', 'unchanged'] as const) {
    if (accept[key] !== undefined && !strings(accept[key])) problems.push(`"accept.${key}" is a list of strings`);
  }
  if (accept.checks !== undefined && !(strings(accept.checks) && (accept.checks as string[]).every((check) => (ACCEPT_CHECKS as string[]).includes(check)))) problems.push(`"accept.checks" lists some of ${ACCEPT_CHECKS.join(', ')}`); // prettier-ignore
  const solution = file(spec.solution);
  if (solution && existsSync(solution) && strings(accept.unchanged ?? [])) {
    const forbidden = [EVALS_DIR, ...GUARDED, ...((accept.unchanged as string[] | undefined) ?? [])];
    const touched = patchedFiles(readFileSync(solution, 'utf8')).filter((path) => forbidden.some((guard) => under(path, guard))); // prettier-ignore
    if (touched.length)
      problems.push(`its solution changes what an attempt must leave as it is: ${touched.join(', ')}`);
  }
  return problems;
}

/** Reads one task directory: the task, or the problems with it, each naming its fix. */
function readTask(root: string, id: string): { task?: EvalTask; problems: string[] } {
  const dir = `${EVALS_DIR}/${id}`;
  if (!ID.test(id)) return { problems: [`${dir}: a task's directory is lowercase words joined by -`] };
  if (!existsSync(join(root, dir, 'task.json'))) return { problems: [`${dir} has no task.json: add one (tools/lib/evals.ts says what it holds) or remove the directory`] }; // prettier-ignore
  let spec: Record<string, unknown>;
  try {
    spec = JSON.parse(readFileSync(join(root, dir, 'task.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return { problems: [`${dir}/task.json is not JSON: ${(error as Error).message}`] };
  }
  const problems = specProblems(spec, (name) => (typeof name === 'string' && name ? join(root, dir, name) : ''));
  const prompt = existsSync(join(root, dir, 'prompt.md')) ? readFileSync(join(root, dir, 'prompt.md'), 'utf8').trim() : ''; // prettier-ignore
  if (!prompt) problems.push(`${dir}/prompt.md is missing or empty: it is what the agent is told`);
  if (problems.length) return { problems: problems.map((problem) => (problem.startsWith(dir) ? problem : `${dir}/task.json: ${problem}`)) }; // prettier-ignore
  const accept = spec.accept as Partial<Acceptance> & { test: string };
  const task: EvalTask = { id, dir, title: spec.title as string, area: spec.area as EvalTask['area'], minutes: spec.minutes as number, solution: spec.solution as string, prompt, accept: { test: accept.test, commands: accept.commands ?? [], unchanged: accept.unchanged ?? [], checks: accept.checks ?? [] } }; // prettier-ignore
  if (spec.start !== undefined) task.start = spec.start as string;
  return { task, problems };
}

/** Every task under evals/, by id, and the problems with any (`EVALS_BAD_TASK`, naming the file and the fix). */
export function readTasks(root: string): { tasks: EvalTask[]; problems: Finding[] } {
  const ids = existsSync(join(root, EVALS_DIR))
    ? readdirSync(join(root, EVALS_DIR), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() // prettier-ignore
    : [];
  const tasks: EvalTask[] = [];
  const problems: Finding[] = [];
  for (const id of ids) {
    const read = readTask(root, id);
    if (read.task) tasks.push(read.task);
    problems.push(...read.problems.map((message) => ({ id: 'EVALS_BAD_TASK', message, file: `${EVALS_DIR}/${id}/task.json` }))); // prettier-ignore
  }
  return { tasks, problems };
}

/** The environment children run in: no Vitest or git variables (they would steer the child), no colours. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && !key.startsWith('GIT_') && key !== 'FORCE_COLOR')); // prettier-ignore
  return { ...env, NO_COLOR: '1', ...extra };
}

/** Runs git in `cwd` with a fixed author, no hooks and no signing; returns its output and throws on a failure. */
export function git(cwd: string, args: string[]): string {
  const who = { GIT_AUTHOR_NAME: 'evals', GIT_AUTHOR_EMAIL: 'evals@localhost', GIT_COMMITTER_NAME: 'evals', GIT_COMMITTER_EMAIL: 'evals@localhost' }; // prettier-ignore
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: childEnv(who), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }); // prettier-ignore
}

/**
 * Copies `root`'s files (those git tracks or would track, evals/ and node_modules aside) to `dest`, links node_modules,
 * applies the patch `start` (an absolute path) and commits the result in a fresh repository; returns that commit.
 */
export function makeCopy(root: string, dest: string, start?: string): string {
  const files = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0');
  const copied = files.filter((path) => path && !under(path, EVALS_DIR) && !under(path, 'node_modules') && existsSync(join(root, path))); // prettier-ignore
  for (const file of copied) {
    mkdirSync(dirname(join(dest, file)), { recursive: true });
    cpSync(join(root, file), join(dest, file));
  }
  if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(dest, 'node_modules'), 'dir'); // prettier-ignore
  git(dest, ['init', '-q', '-b', 'main']);
  mkdirSync(join(dest, '.git', 'info'), { recursive: true });
  appendFileSync(join(dest, '.git', 'info', 'exclude'), '/node_modules\n');
  if (start) git(dest, ['apply', '--whitespace=nowarn', start]);
  git(dest, ['add', '-A']);
  git(dest, ['commit', '-q', '--no-verify', '--allow-empty', '-m', 'start']);
  return git(dest, ['rev-parse', 'HEAD']).trim();
}

/** The files an attempt changed in `copy` since the commit `since`: changed, added, removed or new. */
export function changedFiles(copy: string, since: string): string[] {
  const diff = git(copy, ['diff', '--name-only', since]).split('\n');
  const fresh = git(copy, ['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...diff, ...fresh].filter(Boolean))].sort();
}

/** The last lines of a child's output, on one line. */
const tail = (run: { stdout?: string | null; stderr?: string | null }, lines = 4) =>
  `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-lines).join(' ').replace(/\s+/g, ' ').slice(0, 600); // prettier-ignore

/** The first failed assertion in the Vitest report a run in `copy` wrote (vite.config.ts's json reporter), if any. */
function firstFailure(copy: string): string | undefined {
  const path = join(copy, 'out', 'test', 'report.json');
  if (!existsSync(path)) return undefined;
  type Result = { assertionResults?: { fullName: string; status: string; failureMessages?: string[] }[]; message?: string }; // prettier-ignore
  for (const file of (JSON.parse(readFileSync(path, 'utf8')) as { testResults?: Result[] }).testResults ?? []) {
    const failed = file.assertionResults?.find((test) => test.status === 'failed');
    if (failed) return `${failed.fullName}: ${(failed.failureMessages?.[0] ?? '').split('\n')[0]}`.slice(0, 600);
    if (file.message) return file.message.split('\n')[0].slice(0, 600);
  }
  return undefined;
}

/** A judgement of one attempt: whether it passes, why not (the first step that failed), and the steps it ran. */
export interface Verdict {
  pass: boolean;
  why: string;
  steps: string[];
}

/**
 * Judges the tree in `copy` against `task`'s acceptance, the start being the commit `since`: what it must leave as it
 * was, then the hidden test, the commands and the checks, stopping at the first that fails.
 */
export async function judge(root: string, copy: string, since: string, task: EvalTask): Promise<Verdict> {
  const steps: string[] = [];
  const fail = (why: string): Verdict => ({ pass: false, why, steps });
  const changed = changedFiles(copy, since);
  const touched = changed.filter((file) => [...GUARDED, ...task.accept.unchanged].some((path) => under(file, path)));
  if (touched.length) return fail(`it changed what it must leave as it was: ${touched.join(', ')}`);
  const test = `${task.dir}/accept.test.ts`;
  mkdirSync(join(copy, task.dir), { recursive: true });
  cpSync(join(root, task.dir, task.accept.test), join(copy, test));
  const run = (command: string, args: string[] = []) =>
    spawnSync(command, args, { cwd: copy, shell: args.length === 0, env: childEnv(), encoding: 'utf8', timeout: STEP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }); // prettier-ignore
  try {
    rmSync(join(copy, 'out', 'test', 'report.json'), { force: true });
    const vitest = run(process.execPath, [join(copy, 'node_modules', 'vitest', 'vitest.mjs'), 'run', test]);
    if (vitest.status !== 0) return fail(`its acceptance test failed: ${firstFailure(copy) ?? tail(vitest)}`);
    steps.push('test');
    for (const command of task.accept.commands) {
      const step = run(command);
      if (step.status !== 0) return fail(`${command} exited ${step.status ?? step.signal}: ${tail(step)}`);
      steps.push(command.split(' ').slice(0, 3).join(' '));
    }
    const code = [...changed.filter((file) => file.endsWith('.ts') && existsSync(join(copy, file))), test];
    for (const check of task.accept.checks) {
      const problems = check === 'lint' ? lintIn(copy, code) : await runCheck(copy, check, code);
      if (problems.length) return fail(`${check}: ${problems.length} problem(s): ${problems[0]}`);
      steps.push(check);
    }
    return { pass: true, why: '', steps };
  } finally {
    rmSync(join(copy, task.dir), { recursive: true, force: true });
  }
}

/**
 * ESLint's errors on `files` in `copy`, one sentence each, from its own command line in a child process: in this
 * process, typescript-eslint would keep each copy's config root and refuse the next copy's (measured).
 */
function lintIn(copy: string, files: string[]): string[] {
  const eslint = join(copy, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const run = spawnSync(process.execPath, [eslint, '--format', 'json', ...files], { cwd: copy, env: childEnv(), encoding: 'utf8', timeout: STEP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }); // prettier-ignore
  if (run.status === 0) return [];
  type Result = { filePath: string; messages: { severity: number; line?: number; ruleId: string | null; message: string }[] }; // prettier-ignore
  try {
    const results = JSON.parse(run.stdout) as Result[];
    const errors = results.flatMap((result) => result.messages.filter((m) => m.severity === 2).map((m) => `${relative(copy, result.filePath)}:${m.line ?? 0}: ${m.ruleId ?? 'eslint'}: ${m.message}`)); // prettier-ignore
    return errors.length ? errors : [`eslint exited ${run.status}: ${tail(run)}`];
  } catch {
    return [`eslint exited ${run.status ?? run.signal}: ${tail(run)}`];
  }
}

/** A scratch directory for one task's copy, removed by `done` unless kept. */
function scratch(id: string, keep: boolean) {
  const dir = mkdtempSync(join(tmpdir(), `my3dge-evals-${id}-`));
  return { dir, copy: join(dir, 'repo'), done: () => keep || rmSync(dir, { recursive: true, force: true }) };
}

/** The first line of an error's message. */
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0];

/**
 * Kills the process group `pid` leads (an attempt's shell, started `detached`, and all it started) and waits, up to
 * `ms`, until none of it is left: `spawnSync`'s timeout kills the shell alone, and its children would go on writing.
 */
export function stopGroup(pid: number | undefined, ms = 10_000): void {
  const alive = () => {
    try {
      process.kill(-pid!, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!pid || !alive()) return;
  process.kill(-pid, 'SIGKILL');
  for (const until = Date.now() + ms; alive() && Date.now() < until; ) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); // prettier-ignore
}

/** One task's dry run: its acceptance fails on the start and passes with the reference solution (see the file comment). */
export async function dryRunTask(
  root: string,
  task: EvalTask,
  keep = false,
): Promise<{ failure?: Finding; line: string }> {
  const started = performance.now();
  const { dir, copy, done } = scratch(task.id, keep);
  const file = `${task.dir}/task.json`;
  const took = () => `${Math.round((performance.now() - started) / 1000)} s${keep ? `, kept in ${dir}` : ''}`;
  const failed = (id: string, message: string, line: string) => ({ failure: { id, message: `${task.id}: ${message}`, file }, line: `${task.id}: ${line} (${took()})` }); // prettier-ignore
  try {
    let since: string;
    try {
      since = makeCopy(root, copy, task.start && join(root, task.dir, task.start));
    } catch (error) {
      return failed('EVALS_PATCH', `its start patch does not apply to this tree (${firstLine(error)}): make it again from the tree as it is`, 'its start does not apply'); // prettier-ignore
    }
    const untouched = await judge(root, copy, since, task);
    if (untouched.pass) return failed('EVALS_NOT_REAL', `its acceptance passes on the start, before any work, so it proves nothing: make ${task.dir}/${task.accept.test} fail until the task is done`, 'its acceptance is not real'); // prettier-ignore
    try {
      git(copy, ['apply', '--whitespace=nowarn', join(root, task.dir, task.solution)]);
    } catch (error) {
      return failed('EVALS_PATCH', `its solution does not apply to the start (${firstLine(error)}): make it again (apply it by hand, then git diff)`, 'its solution does not apply'); // prettier-ignore
    }
    const solved = await judge(root, copy, since, task);
    if (!solved.pass) return failed('EVALS_SOLUTION_FAILS', `its acceptance fails with the reference solution: ${solved.why}`, 'its solution fails'); // prettier-ignore
    return { line: `${task.id}: real: fails on the start (${untouched.why.slice(0, 70)}…), passes solved: ${solved.steps.join(', ')} (${took()})` }; // prettier-ignore
  } finally {
    done();
  }
}

/** One live attempt (see the file comment): the verdict and how long the attempt and its judgement took. */
export async function attemptTask(
  root: string,
  task: EvalTask,
  agent: string,
  keep = false,
): Promise<Verdict & { minutes: number }> {
  // prettier-ignore
  const started = performance.now();
  const { dir, copy, done } = scratch(task.id, keep);
  const out = join(root, 'out', 'evals', task.id);
  try {
    const since = makeCopy(root, copy, task.start && join(root, task.dir, task.start));
    const prompt = `${PREAMBLE}\n\n${task.prompt}\n`;
    writeFileSync(join(dir, 'prompt.md'), prompt);
    const env = childEnv({ EVAL_TASK: task.id, EVAL_PROMPT_FILE: join(dir, 'prompt.md') });
    // detached: the shell leads a process group of its own (spawnSync honours it as spawn does; its types omit it)
    const options = { cwd: copy, shell: true, detached: true, input: prompt, env, encoding: 'utf8' as const, timeout: task.minutes * 60_000, maxBuffer: 256 * 1024 * 1024 }; // prettier-ignore
    const run = spawnSync(agent, options);
    stopGroup(run.pid); // before its copy is read: nothing it started edits on past its minutes
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'agent.log'), `${run.stdout ?? ''}${run.stderr ?? ''}`);
    git(copy, ['add', '-A']);
    writeFileSync(join(out, 'attempt.patch'), git(copy, ['diff', '--cached', since]));
    git(copy, ['reset', '-q']);
    const verdict = await judge(root, copy, since, task);
    const why = run.error ? `the agent did not finish (${firstLine(run.error)}); ${verdict.why || 'what it left passes'}` : verdict.why; // prettier-ignore
    return { ...verdict, why, minutes: (performance.now() - started) / 60_000 };
  } finally {
    done();
  }
}

/** The baseline file's contents: deferred until the owner grants model access, or a recorded live run. */
export interface Baseline {
  $about?: string;
  status: 'deferred' | 'recorded';
  /** The escalation that asks the owner for model access. */
  escalation: string;
  recorded: string | null;
  agent: string | null;
  passed: number | null;
  total: number;
  tasks: Record<string, { pass: boolean; minutes: number; why?: string }>;
}

/** Reads evals/baseline.json, or undefined when there is none. */
export function readBaseline(root: string): Baseline | undefined {
  const path = join(root, BASELINE_FILE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Baseline) : undefined;
}
