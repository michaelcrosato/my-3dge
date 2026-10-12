# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-12, gate G7 done: the Stress Box, the foundation is set)

Phases 0–7 are done: the foundation, the kernel and Boxes 1–6 (PR #2–#9). The box does the stress test's job.
- Box 6's looks (labs/box/looks/): the torch-lit hall (`sky:hall`), toon, cel, pixel, bloom and FXAA on the hall's
  baked rune floor; every look builds no pipeline after a warm-up and keeps box-3-knock's goldens.
- The fight's blows go through the bodies' `reactions` (flinch, knockdown, get-up, death) and the hero wears a cape
  (`secondary`, view-only). Clip mode (8.9) and the box's sound (9.5) are in the box too.
- The benchmark (`x perf --ladder`, medians at 100 / 1,000 / 5,000): fight step 1.74 / 13.4 / 50.8 ms, crowd step
  0.94 / 9.95 / 50.5 ms, within tests/baselines/perf/box-{fight-1000,crowd-5000}.json.
- The gate's dry run (a fresh agent added a prop and a variant): 15 of 16 friction items fixed (`x replay --state`,
  `x describe kind:name`, `x qa` counts, README "Adding a prop", "Coordinates and inputs"); PLAN.md §14, row G7.
- Gate: `node x ci --local` green at 4af3816 in 10 min 54 s (check 5.9 s, test 30.1 s with 3,262 tests, e2e
  9 min 25 s with 164 tests); `x deps --qualify`: nothing qualifies beyond the pins.

## What is next

- Lane L's gate G8 (the animation library: its WPs and review fixes are in), then lane X's gate G9 (audio).
- Everything else is on demand: each WP waits for its measured trigger (PLAN.md §9.1).

## Open issues

- T2 took 9 min 25 s, over its 9 min, a warning only (ADR-0022): the gate selects T2 in full while it is over.
- Over the 400-line warning (cap 600): engine/anim/actions.ts, secondary.ts, engine/app/engine.ts,
  tests/e2e/parity.spec.ts, physics/world.ts, sim/world.ts, sim/scene.ts, ci.ts, tiers.ts, perf.ts, port.ts.
- The crowd's batches draw no flinch lean (no `reactions` layer); at 1,000 agents the crowd blocks the stairs' foot.
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- docs/INDEX.md is one 240 KB generated file: read its "Start here" and grep the rest.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22. Not verified: touch (ADR-0021), physical pads, real-GPU performance.
