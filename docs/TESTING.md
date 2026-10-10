# Testing

How to test a change, and where each rule is written down. This page points; the files it names hold the facts, so
it cannot drift from them (PLAN.md §8.2, §8.8).

## The tiers

- **T0, `npm run check`**: types, ESLint, Prettier and `node x check`, in parallel (`tools/checkAll.ts`) (the asset scan, the pins, docs drift). Run
  it after every edit.
- **T1, `npm test`**: Vitest in Node. Unit tests sit beside their modules (`name.test.ts`); the tools' tests, the
  advice trap's harness tests and the `@example` blocks (tests/unit/examples.test.ts) run here too. Run it before
  every commit, and `npm test -- <path>` while iterating.
- **T2, `npm run e2e`**: Playwright Test suites in tests/e2e/, on the platform's Chromium with WebGPU on SwiftShader.
  Run it before every push.
- **Long runs**: long replays, the crowd ladder, flake hunting; at each gate.

Each tier's command and budget, and the long runs, are `TIERS` and `LONG_RUNS` in tools/lib/tiers.ts. `x ci --local`
warns when a tier runs over its budget and fails it at 1.5×.

## What a change selects

tools/lib/tiers.ts's file comment is the rule: the base commit, T1 through Vite's module graph (`vitest related`),
and T2 in full when engine, lab or page code changed, else only the specs that import a change. Its `plan()` returns
each selection with its reason.

## The browser fixture

Every suite imports `test` and `expect` from tests/e2e/fixtures.ts; its file comment lists what a test gets (the
virtual clock and named streams, the `ready || error` wait, `readFrame`, `assertWebGPU`, the captured console, page
errors mapped to `.ts` lines). Pages open with tools/lib/browser.ts's launch options, the same ones `x` commands use;
tests/e2e/harness.spec.ts shows the fixture at work.

## Warnings fail tests

The advice trap (tests/setup/adviceTrap.ts) fails a test that prints an advice code, a `console.warn` or a three.js
deprecation that tests/baselines/advice/ does not list; that directory's README says how to list one, and when not
to.

## Adding a suite

- **A module and its unit test**: `node x new module <path>` writes both from tools/templates/module/ and checks
  them. A test that belongs to no module goes in tests/unit/.
- **A browser suite**: `tests/e2e/<suite>.spec.ts`, importing from `./fixtures`, with its page at
  `tests/pages/<suite>.html` (vite.config.ts serves it). Set `PORT` when another dev server is running.
- **A test that reads the sources** calls `requireSource()` (tools/lib/source.ts); offline it is skipped and reported
  as `deferred: no source`.
- **A test that spawns Vitest or Playwright** removes the `VITEST*` variables from the child's environment.
- Tests step a virtual clock and never wait on wall-clock time. Never skip, disable or loosen a test to get green.
