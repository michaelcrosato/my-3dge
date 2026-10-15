# Testing

How to test a change, and where each rule is written down. This page points; the files it names hold the facts, so
it cannot drift from them (PLAN.md §8.2, §8.8).

## The tiers

- **T0, `npm run check`**: types, ESLint, Prettier and `node x check`, in parallel (`tools/checkAll.ts`) (the asset scan, the pins, docs drift). Run
  it after every edit. Its types are `npm run typecheck`: `tsc -b` over the projects tsconfig.check.json lists, which
  reuses node_modules/.cache/tsc/ and so re-checks only what a change reaches; that file's comment says which project
  a new file or directory joins. `npx tsc --noEmit` still checks the same files as one program, from scratch.
- **T1, `npm test`**: Vitest in Node, one worker per core. Unit tests sit beside their modules (`name.test.ts`); the
  tools' tests, the advice trap's Vitest harness test and the `@example` blocks (tests/unit/examples.test.ts) run
  here too. Run it before every commit, and `npm test -- <path>` while iterating. Nothing in T1 drives a browser.
- **T2, `npm run e2e`**: Playwright Test suites in tests/e2e/, on the platform's Chromium with WebGPU on SwiftShader,
  and every other test that needs Chromium (the advice trap's Playwright harness test, tests/e2e/adviceTrap.spec.ts).
  While working, run only the specs for what only T2 checks that you touched, or a failure you are finding and
  fixing (`npm run e2e -- <spec>`), never the whole set: that is the full run's (ADR-0023).
- **Long runs**: long replays, the kernel's perf budget, the crowd ladder, flake hunting; at each gate.

Each tier's command, and the long runs, are `TIERS` and `LONG_RUNS` in tools/lib/tiers.ts. Two runs use them
(tools/cmd/ci.ts):

- **The quick gate**, `node x ci --local`, before every merge: npm ci, x src, T0, T1 and x port refs --check, held
  to five minutes together (tools/lib/tierBudgets.ts); over them warns, and wall-clock time never
  fails a gate (ADR-0022).
- **The full run**, `node x ci --local --full`: the same steps, x new --test-all and T2 in full (`--long` adds the long runs). GitHub
  runs it after each merge to main and by hand, nobody waiting on it; `node x ci --status`, which the SessionStart
  hook runs, says how main's last one went, and a red one is fixed before other work. An agent waits on it only at
  the end of a goal or a stage (AGENTS.md).

## What a change selects

tools/lib/tiers.ts's file comment is the rule: the base commit, T1 through Vite's module graph (`vitest related`),
and T2 in full when engine, lab or page code changed, else only the specs that import a change. Its `plan()` returns
each selection with its reason. While working, T2's selection is a guide, not an order: run the specs for what only T2
checks that you touched (above); the full run runs the rest.

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
- **A replay**: tests/replays/README.md says how to make one, labs/box/README.md the six steps for a box scene. T2
  plays a replay in the rendering page only when tests/e2e/parity-stages.ts's `STAGES` names it; out/e2e/report.json
  lists the replays each of its tests played as the test's `replays` annotation.
- **A test that reads the sources** calls `requireSource()` (tools/lib/source.ts); offline it is skipped and reported
  as `deferred: no source`.
- **A test that spawns Vitest or Playwright** removes the `VITEST*` variables (and, in a spec, Playwright's worker
  variables) from the child's environment. One that drives Chromium is a spec in tests/e2e/, not a Vitest test.
- **A test that waits on a whole command in a child process** (`node x <cmd>`, Vitest, `npx`) gives it and itself
  `CHILD_TIMEOUT_MS` (tools/x.ts), so a loaded machine never fails it.
- Tests step a virtual clock, never wait on wall-clock time and never assert it: a timing budget is a long run
  (`x perf --budget`), and a T1 budget counts CPU time (tools/qa/audio.test.ts). Never skip, disable or loosen a test
  to get green.
