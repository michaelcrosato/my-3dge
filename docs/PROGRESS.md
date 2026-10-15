# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-15, after G9: the cleanup, then games from one URL)

- Games (WPs 10.7 and 12.4, the owner's ask of 2026-10-15, ADR-0024): the URL is the handoff. README's first section
  runs tools/game/new-game.mjs, which makes a game its own repository: the engine pinned by engine-lock.json, the
  starter labs/game/ (it plays, its bot wins, its tests pass), a game AGENTS.md; docs/GAME-GUIDE.md is the one-file
  handoff; `x engine --test`, in the full run, proves a new game passes its gate. docs/HANDOFF.md has the prompt.

The plan's phases 0–9 are done (PR #2–#11), and the cleanup after G9 closed every loose end (the ledger's row C1):
- Deps: @playwright/test 1.64.1 and Node 24.22.0 adopted; `x deps --qualify` names U-1 next, on 2026-10-22.
- Code: no file over the 400-line warning; the hero passes the crowd he shoves (box-4-stairs); the post-IK foot plant
  (engine/anim/footPlant.ts, without stance locks); the clip lift relative to its source and contact IK's knee pole;
  per-instance ID-pass colours; the state hash 67% faster with the same bytes; `x audio --replay` hears the box.
- Proofs: preciseHits parity (box-5-precise), the steps, nav-1000 and lift replays, every replay in Chromium at each
  gate (`LONG_RUNS`), browser examples run in T2 (tests/e2e/examples.spec.ts), the cold CMU import.
- CI (the owner's calls of 2026-10-15, ADR-0023, row C2): merges wait on the quick gate, `node x ci --local` (about
  5 minutes, no T2); the workflow runs the full run, `x ci --local --full`, on main after each merge, nobody waiting
  on it; `node x ci --status`, which the SessionStart hook prints, says how main's last one went: fix a red one first.

## What waits, by design

- U-1 Vitest 4 qualifies 2026-10-22 (it also clears the 4 Dependabot alerts on dev-only vitest and tinypool); U-2 to
  U-5 wait for the one-year rule (tools/deps.json holds each date); U-6 Rapier, U-7 three r184+, U-8 Chromium wait
  for a measurement or a platform change. The workflow's actions: upload-artifact v5 qualifies 2026-10-24,
  checkout v6 2026-11-20 (ADR-0016 amendment 1; `x deps` does not track them).
- The 21 on-demand WPs (the store, WP 10.9, among them) wait for a measured need (PLAN.md §9.1); QA baseline entries
  wait on two (WP 10.2, WP 8.8), and the anim QA's foot slides on a rule for stance locks (ADR-0009 amendment 8).
- Not verifiable in this container: speakers and headphones, Firefox and Safari, touch on phones (ADR-0021),
  physical pads, real-GPU performance (Phase H, or the owner).
- The owner's: the first games, and the engine work their ENGINE-FEEDBACK.md files ask for. Vercel is paused until
  the owner tests: ignore its statuses and errors (ADR-0023).

## Open issues

- None. C1's Owner: question (T0 and T1 over their budgets on 4 cores) was answered on 2026-10-15: one budget, the
  quick gate's five minutes (ADR-0023). The owner declined branch protection (PLAN.md §11.5).
