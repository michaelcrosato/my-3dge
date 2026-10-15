/**
 * @file T2 for the `@example` blocks T1 cannot run (PLAN.md §8.12, WP 0.6; tools/lib/docs.ts `ExampleHost`), one test
 * each, named by its module and line:
 * - `page` (Web Audio, a page's DOM, a Vite-only import, or a first line `// browser`): in the box page
 *   (labs/box/?scene=room), its module imported through Vite with its exports as the example's names, and its own
 *   relative imports resolved to their URLs (tools/lib/docsExamples.ts `pageExample`);
 * - `node` (its module drives a browser itself, importing Playwright): in this Playwright process, as T1 runs the rest
 *   (`runExample`);
 * - `none` (a suite's own module, whose example is a test): left unrun, each naming why; the last test lists them.
 * So no example is left unrun but those that name why (tests/unit/examples.test.ts runs every other one in Node).
 *
 * Invariants: an example runs on this repository as it is, offline; a page example that throws or rejects fails, as a
 * Node one does.
 */
import { collectExamples, EXAMPLE_TIMEOUT_MS, pageExample, runExample } from '../../tools/lib/docsExamples';
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

for (const example of flagged.filter(({ host }) => host === 'node')) {
  test(`${example.module}:${example.line} runs in the Playwright process`, async () => {
    const outcome = await runExample(ROOT, example);
    expect(outcome.error, `the @example at ${example.module}:${example.line}`).toBeUndefined();
  });
}

test('the examples left unrun are the suites’ own, each naming why', () => {
  const unrun = flagged.filter(({ host }) => host !== 'page' && host !== 'node');
  for (const example of unrun) expect([example.host, example.browser]).toEqual(['none', expect.stringMatching(/\S/)]);
  expect(unrun.map((example) => example.module)).toEqual(['tests/e2e/fixtures.ts']);
});
