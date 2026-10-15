# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-15, after G9: the cleanup)

The plan's phases 0–9 are done (PR #2–#11), and the cleanup after G9 closed every loose end their rows carried (the
ledger's row C1):
- Deps: @playwright/test 1.64.1 and Node 24.22.0 adopted; `x deps --qualify` names U-1 next, on 2026-10-22.
- Code: no file over the 400-line warning; the hero passes the crowd he shoves (box-4-stairs); the post-IK foot plant
  (engine/anim/footPlant.ts, without stance locks); the clip lift relative to its source and contact IK's knee pole;
  per-instance ID-pass colours; the state hash 67% faster with the same bytes; `x audio --replay` hears the box.
- Proofs: preciseHits parity (box-5-precise), the steps, nav-1000 and lift replays, every replay in Chromium at each
  gate (`LONG_RUNS`), browser examples run in T2 (tests/e2e/examples.spec.ts), the cold CMU import.
- The fight's sound timeline: 77 sounds, 288bca340783f86f, in Node and Chromium.
- CI: T2's budget goes by machine size (60 min on 1 worker here, 9 min from 16 cores; ADR-0022 amendment 2).

## What waits, by design

- U-1 Vitest 4 qualifies 2026-10-22 (it also clears the 4 Dependabot alerts on dev-only vitest and tinypool); U-2 to
  U-5 wait for the one-year rule (tools/deps.json holds each date); U-6 Rapier, U-7 three r184+, U-8 Chromium wait
  for a measurement or a platform change.
- The 22 on-demand WPs wait for a measured need (PLAN.md §9.1); QA baseline entries wait on two of them (WP 10.2,
  WP 8.8), and the anim QA's foot slides on a stepping rule for stance locks (ADR-0009 amendment 8).
- Not verifiable in this container: speakers and headphones, Firefox and Safari, touch on phones (ADR-0021),
  physical pads, real-GPU performance (Phase H, or the owner).
- The owner's: the first-game trial (docs/HANDOFF.md).

## Open issues

- None. No "Owner:" issue was left by the cleanup.
