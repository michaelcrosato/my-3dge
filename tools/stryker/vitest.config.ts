/**
 * @file Vitest's settings for StrykerJS's runs (stryker.config.json's `vitest.configFile`; PLAN.md WP 12.2): the
 * repository's own (vite.config.ts), with longer timeouts and no report file. A run's first pass must pass every test
 * under instrumentation (a check before each mutable expression, a count after) on a machine the other lanes share,
 * or no mutant is tested at all: one test of engine/anim/actions.test.ts passed `npm test`'s 30 s there under a load
 * of 13, and the humanoid suite's differential hook its 60 s with forward kinematics instrumented (now out of scope,
 * tools/stryker/sample.ts). The timeouts still bound a hang; StrykerJS times each mutant out by its own measure
 * (`timeoutMS`, `timeoutFactor`). A run starts the tests thousands of times, so the JSON report `npm test` writes would
 * only cost time.
 *
 * @example
 * // npx stryker run   (reads this file through stryker.config.json)
 * @see stryker.config.json
 */
import { defineConfig } from 'vite';
import base from '../../vite.config';

export default defineConfig({
  ...base,
  test: { ...base.test, testTimeout: 180_000, hookTimeout: 180_000, reporters: ['dot'], outputFile: undefined },
});
