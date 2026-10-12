# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-12, gate G7: the Stress Box, the foundation)

Phases 0–7 are done: the foundation, the kernel, Boxes 1–5 (PR #2–#8) and Box 6 (WP 7.8, gate G7's review fixes).
- Box 6's looks (labs/box/looks/): the torch-lit hall (`sky:hall`: 12 flickering torches, the nearest casting shadows,
  fog), toon, cel, pixel, bloom and FXAA, on the hall's baked rune floor; every box look and one engine look per
  material style build no pipeline after a warm-up on the hall with its props and keep box-3-knock's goldens.
- WP 6.2 in the box: the fight's blows go through the bodies' `reactions` (walkers flinch, big blows knock them down
  and they get up the way they lie, the slain fall; the hero flinches), and the hero wears a cape (`secondary`,
  view-only, `actor#1/cape` in the ID pass); box-5-fight re-recorded with that reason (5 kills, a body 1.72 m up).
- The benchmark (`x perf --ladder`, 300 steps, medians): fight-1000's sim step 1.74 / 13.4 / 50.8 ms at 100 / 1,000
  / 5,000, hash 7.6 / 79.5 / 410 ms; crowd-5000's step 0.94 / 9.95 / 50.5 ms, hash 3.4 / 54.6 / 294 ms; all within
  tests/baselines/perf/box-{fight-1000,crowd-5000}.json.
- Tools from the gate's dry run: `x replay --state`/`--until n` (a run's final state), `x describe kind:name`, `x qa`
  counting what it checked (an `--only` that keeps nothing is X_USAGE), x new checking cited paths, README "Adding a
  prop" and "Coordinates and inputs" (tests/replays/README.md).
- Also in the box: clip mode (8.9: the hero and the mannequin play any library clip) and its sound (9.5).
- Gate: `node x ci --local --long` green in 51 min 27 s at load 6–83 (check 13.9 s, test 46.2 s with 3,258 tests,
  e2e 9 min 32 s with 159 tests, the flake hunt 477 of 477, the ladders, clip QA and box clips).

## What is next

- Gate G7's PR (stage 7), then gates G8 (lane L) and G9 (lane X); everything else is on demand, each WP waiting for
  its measured trigger (PLAN.md §9.1).

## Open issues

- T2 took 9 min 32 s at load 18–52, over its 9 min (fails at 13 min 30 s, ADR-0014 amendment 14); 13 min 48 s at
  the review before parity.spec.ts played one replay a test and a look per material style. T0 took 13.9 s of 10 s.
- Over the 400-line warning (cap 600): engine/anim/actions.ts 596, secondary.ts 586, engine/app/engine.ts,
  tests/e2e/parity.spec.ts 459, physics/world.ts, sim/world.ts, sim/scene.ts, ci.ts, tiers.ts, perf.ts, port.ts.
- The crowd's flinch lean is drawn only on actors (the crowd's batches pose without the `reactions` layer); a walker
  knocked down from behind lies on its back there. At 1,000 agents the crowd blocks the hero at the stairs' foot.
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22. Not verified: touch (ADR-0021), physical pads, real-GPU performance.
