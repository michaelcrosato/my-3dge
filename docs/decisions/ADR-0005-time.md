# ADR-0005: Time: a fixed 60 Hz step

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.4, WP 1.3, I-02

## Decision
- The sim steps at a fixed 60 Hz, at most 6 steps per frame, with an accumulator; the view interpolates between
  steps.
- The clock is injectable, so tests and replays drive time themselves.
- A timescale stack, a hit-stop budget and per-entity clocks shape time without breaking the fixed step.
- Gameplay time is counted in sim ticks.

## Why
Doctrine Reproducible: variable substeps made the prototype's play irreproducible and its rigs depend on the refresh
rate (I-02). A fixed step with recorded intents makes identical inputs give identical state.

## Enforced by
The time module's unit tests (WP 1.3); replay golden hashes (WP 1.5); ESLint's sim-side bans on
`requestAnimationFrame`, timers and `performance.now` (Appendix B).

## Amendment 1 (2026-10-10, WP-1.3)
Calls made where the plan is silent, and one deviation:
- **Deviation: two modules.** WP 1.3 owns `engine/core/{time,timers}.ts`, not `time.ts` alone: the frame clock
  (real time in, fixed steps and `alpha` out) and sim time (timers, per-entity clocks) are two concepts, and together
  they passed the 400-line limit (AGENTS.md, doctrine Agent-readable).
- **Slowdowns and hit-stop shape the step rate, never a step.** The stack, the hit-stop and pause live in the frame
  clock: they change how many fixed steps a frame runs, so the integration parameters stay pinned (§4.8). Rules still
  call them (§6.4), but nothing in a step reads them back, so the clock is no part of the hash, captures or replays,
  which record each step's intents. Their durations count real seconds, taken from the timestamps `advance(now)` is
  given, so a slowdown never stretches itself and no wall clock is read. `push(id, k, seconds?)` takes an optional
  duration (the source's); `k` is 0..1, and speed-ups go through `time.scale`.
- **The accumulator counts whole nanoseconds × hz** (one step is 1e9), measured from the first timestamp. At speed 1
  the steps after T ms are exactly floor(T × hz / 1000), however the frames fall, so random frame times reproduce
  fixed stepping exactly (the WP's test checks the step count and `alpha` at every frame). A slowdown or hit-stop
  that ends inside a frame ends at its exact time, so the step count does not depend on the frame rate either.
- **After a stall** the steps beyond `time.maxSteps` are dropped and the fraction kept (`alpha` stays continuous).
  Ten frames in a row that drop steps raise the advice `CORE_CLOCK_BEHIND` (AGENTS.md: never downgrade silently); a
  single stall, such as a tab coming back, does not.
- **Settings** (WP 1.2's schema): `time.hz` is sim-side (`when: 'scene'`, read when the clock is made or reset);
  `time.maxSteps`, `time.scale`, `time.paused` and the budget's `time.hitStop.soft`, `.refill` and `.floor` (the
  source's 0.07, 0.22 and 0.18) are `view` settings: they change when steps come, never what a step does.
- **Timers keep exact sim time in tick units** (0.025 s is 1.5 ticks), fire on the first step at or after their time
  and never in the step that made them, keep their phase, and repeat at most once a step (`every` is one tick at
  least). `capture()` holds their callbacks by reference, so `restore` continues exactly in the same process; a
  handle reaches its timer by id across a restore.
- **Per-entity clocks are plain numbers** (`{ rate, frozen, time }`) that a component holds, advanced by functions,
  so captures and the hash take them as data. A freeze counts world seconds, the longest wins, and a freeze ending
  inside a step gives the rest of the step back.
