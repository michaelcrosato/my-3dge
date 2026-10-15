/**
 * @file T2 for the `@example` blocks T1 cannot run (PLAN.md §8.12, WP 0.6; tools/lib/docs.ts `ExampleHost`), one test
 * each, named by its module and line:
 * - `page` (Web Audio, a page's DOM, a Vite-only import, or a first line `// browser`): in the box page
 *   (labs/box/?scene=room), its module imported through Vite with its exports as the example's names, and its own
 *   relative imports resolved to their URLs (tools/lib/docsExamples.ts `pageExample`);
 * - `node` (its module drives a browser itself, importing Playwright): beside this process, in a Node process of its
 *   own (`runExample` through tsx, as `node x` runs the tools): one worker runs every suite, so the modules an example
 *   imported here would stay registered for the suites after it (film.ts's view registers 16 materials, which
 *   materials.spec.ts then expected the page to have, after G9);
 * - `none` (a suite's own module, whose example is a test): left unrun, each naming why; the last test lists them.
 * So no example is left unrun but those that name why (tests/unit/examples.test.ts runs every other one in Node).
 *
 * Invariants: an example runs on this repository as it is, offline; a page example that throws or rejects fails, as a
 * Node one does.
 */
import { spawnSync } from 'node:child_process';
import type { Example } from '../../tools/lib/docs';
import { collectExamples, EXAMPLE_TIMEOUT_MS, pageExample, type ExampleOutcome } from '../../tools/lib/docsExamples';
import { ROOT } from '../../tools/x';
import { expect, test } from './fixtures';

const flagged = collectExamples(ROOT).filter((example) => example.browser);

test.describe.configure({ mode: 'parallel' });

for (const example of flagged.filter(({ host }) => host === 'page')) {
  test(`${example.module}:${example.line} runs in the box page`, async ({ page, harness }) => {
    const prepared = pageExample(ROOT, example);
    await page.goto('labs/box/?scene=room');
    await harness.ready({ timeout: 120_000 });
    const error = await page.evaluate(
      async ({ module, body, imports, ms }) => {
        const exports = (await import(/* @vite-ignore */ module)) as Record<string, unknown>;
        const names = Object.keys(exports).filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));
        const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...v: unknown[]) => unknown;
        const run = new AsyncFunction(...names, '__import', `{\n${body}\n}`);
        const load = (specifier: string) => import(/* @vite-ignore */ imports[specifier] ?? specifier);
        const limit = new Promise((_, reject) => setTimeout(() => reject(new Error(`it ran past ${ms} ms`)), ms));
        try {
          await Promise.race([run(...names.map((name) => exports[name]), load), limit]);
          return undefined;
        } catch (thrown) {
          return thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
        }
      },
      { ...prepared, ms: EXAMPLE_TIMEOUT_MS },
    );
    expect(error, `the @example at ${example.module}:${example.line}`).toBeUndefined();
  });
}

/** Variables a test runner sets for its own workers; the Node child starts without them (as box-audio.spec.ts's). */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;

/** The child's script: runs the example given as JSON and prints its outcome as the last line. */
const RUN_SCRIPT = `
import { runExample } from './tools/lib/docsExamples.ts';

const outcome = await runExample(process.cwd(), JSON.parse(process.argv[1]));
process.stdout.write('\\n' + JSON.stringify(outcome) + '\\n', () => process.exit(0));
`;

/** A `node` example's outcome, run in a Node process of its own (see the file comment). */
function runApart(example: Example): ExampleOutcome {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const args = ['--import', 'tsx', '--input-type=module', '--eval', RUN_SCRIPT, JSON.stringify(example)];
  const run = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env, timeout: 3 * EXAMPLE_TIMEOUT_MS });
  if (run.status !== 0) throw new Error(`the example's Node run failed (${run.status}):\n${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').at(-1)!) as ExampleOutcome;
}

for (const example of flagged.filter(({ host }) => host === 'node')) {
  test(`${example.module}:${example.line} runs in a Node process of its own`, () => {
    const outcome = runApart(example);
    expect(outcome.error, `the @example at ${example.module}:${example.line}`).toBeUndefined();
  });
}

test('the examples left unrun are the suites’ own, each naming why', () => {
  const unrun = flagged.filter(({ host }) => host !== 'page' && host !== 'node');
  for (const example of unrun) expect([example.host, example.browser]).toEqual(['none', expect.stringMatching(/\S/)]);
  expect(unrun.map((example) => example.module)).toEqual(['tests/e2e/fixtures.ts']);
});
