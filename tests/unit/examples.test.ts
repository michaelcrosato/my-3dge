/**
 * @file Runs every `@example` block of the repository's file and export comments in Node (T1; PLAN.md §8.12,
 * WP 0.6), one test per example, named by its module and line. Browser examples are flagged for T2 instead; the
 * last test checks that each one says why. tools/lib/docsExamples.ts says how an example runs.
 * @see tools/lib/docsExamples.ts
 */
import { describe, expect, it } from 'vitest';
import { collectExamples, EXAMPLE_TIMEOUT_MS, runExample } from '../../tools/lib/docsExamples';
import { ROOT } from '../../tools/x';

const examples = collectExamples(ROOT);

describe('@example blocks', () => {
  for (const example of examples.filter((candidate) => !candidate.browser)) {
    it(`${example.module}:${example.line} runs`, { timeout: EXAMPLE_TIMEOUT_MS + 5_000 }, async () => {
      const outcome = await runExample(ROOT, example);
      expect(outcome.error, `the @example at ${example.module}:${example.line}`).toBeUndefined();
    });
  }

  it('flags each browser example for T2 with its reason', () => {
    const flagged = examples.filter((candidate) => candidate.browser);
    for (const example of flagged) expect(example.browser).toMatch(/\S/);
    expect(examples.length - flagged.length).toBeGreaterThan(0);
  });
});
