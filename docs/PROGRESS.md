# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-10)

Phase 0, the foundation (lane T), is in progress; no engine code exists yet.
- Done: WP 0.1 (constitution, platform, source checkouts), 0.2 (toolchain, e2e fixture, the `x` CLI), 0.4 (ESLint
  rules, `npm run check`), 0.5 (test tiers, the advice trap), 0.3 (pins, docs/THREE-DELTA.md) and 0.6 (the docs
  system: INDEX, API and ERRORS generated from comments, examples run, path checks, `x new`).
- Start at docs/INDEX.md for the modules, docs/TESTING.md for the tests, `node x help` for the commands.

## What is next

- WP 0.7: escalations and decisions (`x esc`, docs/escalations/).
- Then 0.11 (reference vectors), 0.8 (hello page on WebGPU), 0.12 (Vercel), 0.9 (CI), 0.10 (Claude Code
  integration), and gate G0's review of Phase 0.
- Phase 1, the kernel (lane C), starts from the merged G0.

## Open issues

- Vitest 4 qualifies on 2026-10-22 (U-1): from then `npm run check` warns DEPS_QUALIFIED; schedule its upgrade WP.
- Browser `@example` blocks are flagged by `x docs` (metric `examples.t2List`) but no T2 suite runs them yet.
- §8.12's `help()` drift check waits for the inspector (WP 1.6); ERRORS.md stays empty until WP 1.2's `defineCodes`.
