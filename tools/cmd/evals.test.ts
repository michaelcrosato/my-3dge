/**
 * @file Tests `x evals` (tools/cmd/evals.ts, tools/lib/evals.ts; PLAN.md WP 12.2): the committed tasks are at least
 * twelve, over the box, the playground and the engine, every one well-formed, and each one's patches still apply to
 * this tree (its start, then its solution on the start), so a change under a task names the task to make again; a
 * malformed task is named with its fix, by `x check` too; in a scratch repository, a dry run passes a real task and
 * fails one whose acceptance passes before any work and one whose solution does not pass it; a live run judges what
 * an agent's command left; and a live run without an agent is a usage error naming the owner's escalation.
 * The full dry run over every task (`node x evals --dry-run`) is the WP's verify command, not a unit test.
 * @see tools/cmd/evals.ts
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'; // prettier-ignore
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { attemptTask, AREAS, dryRunTask, git, patchedFiles, readBaseline, readTasks } from '../lib/evals';
import { CHILD_TIMEOUT_MS, ROOT, UsageError } from '../x';
import command, { check } from './evals';

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temporary directory, removed after the tests. */
function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

/** Writes `files` (path → text) under `root`. */
function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe('the committed tasks', () => {
  const { tasks, problems } = readTasks(ROOT);

  it('are at least twelve, over the box, the playground and the engine, each well-formed', () => {
    expect(problems).toEqual([]);
    expect(tasks.length).toBeGreaterThanOrEqual(12);
    expect(new Set(tasks.map((task) => task.area))).toEqual(new Set(AREAS));
    expect(check.run({ root: ROOT, lane: false })).toMatchObject({ failures: [], metrics: { tasks: tasks.length } });
  });

  it('still apply to this tree: each start, then each solution on its start', () => {
    for (const task of tasks) {
      const patch = (name: string) => join(ROOT, task.dir, name);
      if (!task.start) {
        expect(() => git(ROOT, ['apply', '--check', patch(task.solution)]), `${task.id}: make its solution again from this tree`).not.toThrow(); // prettier-ignore
        continue;
      }
      // the start's files as the start has them, outside any repository, where git apply works as patch does
      const dir = temp('evals-start-');
      const start = readFileSync(patch(task.start), 'utf8');
      const place = (file: string) => (mkdirSync(dirname(join(dir, file)), { recursive: true }), cpSync(join(ROOT, file), join(dir, file))); // prettier-ignore
      for (const file of patchedFiles(start)) place(file);
      expect(() => execFileSync('git', ['apply', patch(task.start!)], { cwd: dir, stdio: 'pipe' }), `${task.id}: make its start again`).not.toThrow(); // prettier-ignore
      const solved = patchedFiles(readFileSync(patch(task.solution), 'utf8'));
      for (const file of solved.filter((path) => existsSync(join(ROOT, path)) && !existsSync(join(dir, path)))) place(file); // prettier-ignore
      expect(() => execFileSync('git', ['apply', '--check', patch(task.solution)], { cwd: dir, stdio: 'pipe' }), `${task.id}: make its solution again on its start`).not.toThrow(); // prettier-ignore
    }
  });

  it('keep a deferred baseline that names the owner’s escalation until a live run records one', () => {
    const baseline = readBaseline(ROOT)!;
    expect(baseline.status === 'recorded' || /^ESC-\d{4}$/.test(baseline.escalation)).toBe(true);
    expect(baseline.total).toBe(tasks.length);
  });
});

describe('a malformed task', () => {
  it('is named with its fix, by x check too', () => {
    const root = temp('evals-bad-');
    write(root, {
      'evals/Bad Name/task.json': '{}',
      'evals/no-json/prompt.md': 'Do it.',
      'evals/thin/task.json': JSON.stringify({ title: 'Thin', area: 'moon', minutes: 0, solution: 'none.patch', accept: { test: 'accept.test.ts', extra: 1 } }), // prettier-ignore
      'evals/thin/accept.test.ts': '',
    });
    const messages = readTasks(root).problems.map((finding) => finding.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Bad Name: a task's directory is lowercase words/),
        expect.stringMatching(/no-json has no task.json: add one/),
        expect.stringMatching(/unknown accept key "extra"/),
        expect.stringMatching(/"area" is one of box, playground, engine/),
        expect.stringMatching(/"minutes" is a whole number/),
        expect.stringMatching(/"solution" names a patch beside task.json: none.patch is missing/),
        expect.stringMatching(/not \*\.test\.ts \(npm test would run it\)/),
        expect.stringMatching(/thin\/prompt.md is missing or empty/),
      ]),
    );
    expect(check.run({ root, lane: false })).toMatchObject({ summary: '0 tasks' });
  });
});

describe('in a scratch repository', () => {
  /** A repository with lib/add.ts, node_modules linked from here, and the task `mul`: add lib/mul.ts. */
  function repo(accept: string, solution: string) {
    const root = temp('evals-repo-');
    symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
    write(root, {
      '.gitignore': '/node_modules\nout/\n',
      'package.json': '{ "type": "module" }\n',
      'lib/add.ts': 'export const add = (a: number, b: number) => a + b;\n',
      'evals/mul/task.json': JSON.stringify({ title: 'Add mul', area: 'engine', minutes: 5, solution: 'solution.patch', accept: { test: 'accept.ts' } }), // prettier-ignore
      'evals/mul/prompt.md': 'Add lib/mul.ts: mul(a, b) is a times b.\n',
      'evals/mul/accept.ts': accept,
      'evals/mul/solution.patch': solution,
    });
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'scratch']);
    return { root, task: readTasks(root).tasks[0] };
  }
  const test = (body: string) => `import { expect, it } from 'vitest';\n${body}\n`;
  const ACCEPT = test("import { mul } from '../../lib/mul';\nit('multiplies', () => expect(mul(2, 3)).toBe(6));");
  const patchOf = (body: string) => `diff --git a/lib/mul.ts b/lib/mul.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/lib/mul.ts\n@@ -0,0 +1 @@\n+${body}\n`; // prettier-ignore
  const MUL = 'export const mul = (a: number, b: number) => a * b;';

  it(
    'passes a real task: its acceptance fails on the start and passes with its solution',
    async () => {
      const { root, task } = repo(ACCEPT, patchOf(MUL));
      const result = await dryRunTask(root, task);
      expect(result.failure).toBeUndefined();
      expect(result.line).toMatch(
        /^mul: real: fails on the start \(its acceptance test failed: .*\), passes solved: test/,
      );
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'fails a task whose acceptance passes before any work, and one whose solution does not pass it',
    async () => {
      const idle = repo(test("import { add } from '../../lib/add';\nit('adds', () => expect(add(2, 3)).toBe(5));"), patchOf(MUL)); // prettier-ignore
      expect((await dryRunTask(idle.root, idle.task)).failure).toMatchObject({ id: 'EVALS_NOT_REAL', message: expect.stringMatching(/passes on the start, before any work, so it proves nothing/) }); // prettier-ignore
      const wrong = repo(ACCEPT, patchOf('export const mul = (a: number, b: number) => a + b;'));
      expect((await dryRunTask(wrong.root, wrong.task)).failure).toMatchObject({ id: 'EVALS_SOLUTION_FAILS', message: expect.stringMatching(/fails with the reference solution: its acceptance test failed/) }); // prettier-ignore
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'judges a live attempt by what the agent’s command left in its copy, keeping its diff',
    async () => {
      const { root, task } = repo(ACCEPT, patchOf(MUL));
      const agent = `node -e "require('fs').writeFileSync('lib/mul.ts', process.argv[1] + '\\n')" "${MUL}"`;
      expect(await attemptTask(root, task, agent)).toMatchObject({ pass: true, why: '' });
      expect(readFileSync(join(root, 'out', 'evals', 'mul', 'attempt.patch'), 'utf8')).toContain('+export const mul');
      expect(await attemptTask(root, task, 'true')).toMatchObject({ pass: false, why: expect.stringMatching(/its acceptance test failed/) }); // prettier-ignore
    },
    CHILD_TIMEOUT_MS,
  );
});

describe('x evals', () => {
  const run = (positionals: string[], values: Record<string, string | boolean> = {}) => command.run({ root: ROOT, positionals, values }); // prettier-ignore

  it('lists the tasks and the baseline', async () => {
    const result = await run([]);
    expect(result.ok).toBe(true);
    expect(result.lines?.length).toBe(readTasks(ROOT).tasks.length);
    expect(result.summary).toMatch(/tasks; baseline: /);
  });

  it('refuses a live run without an agent, naming the owner’s escalation, and a task it lacks, naming the closest', async () => {
    const escalation = readBaseline(ROOT)!.escalation;
    await expect(run([], { run: true })).rejects.toThrow(UsageError);
    await expect(run([], { run: true })).rejects.toThrow(new RegExp(`model access, which is the owner's \\(PLAN.md §11.5, ${escalation}\\)`)); // prettier-ignore
    await expect(run(['box-props'], { 'dry-run': true })).rejects.toThrow(/there is no task box-props under evals\/: did you mean box-prop\?/); // prettier-ignore
    await expect(run([], { record: true })).rejects.toThrow(/--record writes a live run/);
    await expect(run([], { 'dry-run': true, run: true, agent: 'true' })).rejects.toThrow(/two runs: pick one/);
  });
});
