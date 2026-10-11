# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-11, gate G5)

Phases 0–5 are done: the foundation, the kernel, Box 1 (PR #2, #3, #5), Box 2 and Box 3 (PR #6), Box 4 (PR #7).
- Box 4: walkers, slimes and wisps fill the hall (box:crowd-100/1000/5000), 25 entering a step, and chase the hero
  by flow field and ring steering up the west stairs; box-4-chase and box-4-hop hold one golden set in Node and in
  the rendering page, through every camera and resolution mode and with the GPU features off.
- 0 pipelines built as the crowd grows to 5,000; every crowd batch is seen by the ID pass.
- Crowd ladder (Node, 300 steps): step 0.83/8.5/28.5 ms, hash 3.0/40.8/152 ms at 100/1,000/5,000 agents, within
  budgets 4/36/160 and 14/130/650 (tests/baselines/perf/box-crowd-1000.json).
- Already in from later phases: 6.5 overlay, 7.1 lights and sky, 7.2 toon styles; lane L 8.1–8.3, 8.10; lane X
  9.1–9.4 (audio runtime). 5.5's gpuMs is WP 11.2 (on demand); 5.6 bot and dev actions stays on demand.
- Gate: `node x ci --local --long` green in 27 min 58 s at load 19–46 (check 6.0 s, test 28.6 s with 2,554 tests,
  e2e 6 min 28 s with 122 tests, flake hunt 366/366, crowd ladder within budget).

## What is next

- Box 5 (Phase 6, gate G6): 6.1 moves, timelines and hits, 6.2 reactions and secondary motion, 6.3 combat helpers,
  6.4 effects, 6.6 animation checks and QA, then B 6.7, combat in the box.
- Background: lane L (8.4 baker and retargeting, then 8.5–8.7, 8.9), lane X (9.5 sound in the box), lane R 7.3, 7.4.

## Open issues

- T2 took 6 min 28 s, over its 6 min budget (fails at 9 min) under load 36–46: parity.spec.ts's render tests
  (133–146 s each) are the longest, so the gate keeps running T2 in full. T0 passed 10 s at G3 under heavy load.
- Over the 400-line warning (cap 600): engine/sim-api.ts 443, physics/world.ts 419, tools/cmd/perf.ts 414,
  sim/world.ts 410, sim/scene.ts 409, tools/cmd/port.ts 408, tools/cmd/ci.ts 404, tools/lib/tiers.ts 405.
- At 1,000 agents the crowd blocks the hero at the stairs' foot; the state hash dominates the step at 5,000.
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22. Not verified: touch (ADR-0021), physical pads, real-GPU crowd performance.
