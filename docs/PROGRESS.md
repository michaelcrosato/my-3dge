# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-11, gate G6)

Phases 0–6 are done: the foundation, the kernel, Box 1 (PR #2, #3, #5), Boxes 2–3 (PR #6), Box 4 (PR #7), Box 5 (PR #8).
- Box 5: box:fight, the hero with a sword round the dais through 36 walkers, slimes and wisps, kills at least 3 and
  launches a body over 1 m; foes wind up telegraphed, at most 3 attack at once; bolts, trails, bursts and damage
  numbers in HTML/CSS. box-5-fight holds one golden set in Node and in the rendering page, effects on or off.
- Moves, timelines and hits (6.1), reactions and secondary motion (6.2, not in the box yet), combat helpers (6.3),
  effects (6.4), animation checks and QA (6.6: 62 baselined entries with reasons).
- Already in from later phases: 6.5 overlay, 7.1–7.4 (lights, toon, texture library v2, post chain); lane L 8.1–8.7,
  8.10; lane X 9.1–9.4. 5.5's gpuMs is WP 11.2 (on demand); 5.6 bot and dev actions stays on demand.
- Gate: `node x ci --local` green in 13 min 45 s at load 32–76 (check 9.6 s, test 43.1 s with 3,168 tests,
  e2e 11 min 10 s with 146 tests); the hall page warms 35 pipelines in about 4 s (ADR-0008 amendment 9).

## What is next

- Box 6, the Stress Box (Phase 7, gate G7): WP 7.8 makes the box look like the stress test and shows WP 6.2's
  reactions and secondary motion (ADR-0018 amendment 1).
- Background: lane L (8.9 clip mode in the box, then G8), lane X (9.5 sound in the box, then G9).

## Open issues

- T2 took 11 min 10 s against its 9 min budget (fails at 13 min 30 s, ADR-0014 amendment 14); parity.spec.ts is most
  of it (render-every-step replays 189 s), and Box 4's replay test nears its 240 s timeout at load 85+.
- Over the 400-line warning (cap 600): engine/anim/actions.ts 596, engine/anim/secondary.ts 586, engine/sim-api.ts,
  engine/app/engine.ts 411, physics/world.ts, tools/cmd/perf.ts, sim/world.ts, sim/scene.ts, port.ts, ci.ts, tiers.ts.
- At 1,000 agents the crowd blocks the hero at the stairs' foot; the state hash dominates the step at 5,000.
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22. Not verified: touch (ADR-0021), physical pads, real-GPU performance.
