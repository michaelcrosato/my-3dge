---
name: perf-budgets
description: Performance in my-3dge as counters against budgets, never frames per second — the budget files under tests/baselines/perf/ (Node steps, hash and capture; the crowd ladder at 100, 1,000 and 5,000 agents; a page's times, draw calls, triangles, textures, geometries and pipelines, 0 after the warm-up), the content budgets in the data (a geometry's vertices, the effects' pools, the light pool, a body's draw calls, a level's per storey), node x perf and __engine.stats(), and how to meet them (the warm-up, instancing, the light pool, features and quality tiers, what the hash reads). Use when you add or change something drawn or simulated at scale, when node x perf --budget or a QA budget fails, or before recording a budget.
---

# Performance budgets

PLAN.md §8.7 is the rule: counters against budgets, never headless frames per second. On this shared machine a time
is noise, not proof (ADR-0022): `--budget` fails a count over its budget and only warns for a time over its own, and
the quick gate's five minutes (tools/lib/tierBudgets.ts) warn, never fail.

## Where budgets live

- **A scene's**: tests/baselines/perf/<scene id>.json (`box:room` → box-room.json), read by tools/lib/perfBudget.ts:
  `{ scene, steps?, budgets?, page?, ladder?, tolerance?, reason }`, at least one section.
  - `budgets`, in Node: `stepMs`, `hashMs`, `captureMs`, medians of 5 runs over `steps` (600 by default).
  - `ladder`: the same at 100, 1,000 and 5,000 crowd agents, set by the integer setting it names.
  - `page`: `simMs`, `physicsMs`, `animMs`, `renderMs`, `gpuMs` and the counts `drawCalls`, `triangles`,
    `computeCalls`, `textures`, `geometries`, `pipelines`, `pipelinesAfterWarmUp` (always 0: a pipeline built in play
    stalls a frame).
  - `tolerance`: 0.15 lets a value run 15% over. `reason`: how and where it was measured (the command, the load
    average, the runs) and why each number is what it is. The work package that records a budget owns it; a new
    number needs its reason, never only a bump.
- **The content's**, in the data and checked by tests and QA: a geometry's vertex `budget` (`defineGeometry`; `node x
  qa geo` fails a part over it); the effects' pools, `FX_BUDGET` in engine/gfx/fx/effects.ts (4,096 particles, 1,024
  glows, 1,024 decals, 32 ribbons: a burst past them is dropped and counted); the GPU particles' 1 ms
  (`GPU_RING.budgetMs`, engine/gfx/enhanced/particles.ts); the light pool's 8 to 16 point lights, 12 by default, 64
  with tiled lighting (`POOL_SIZES`, engine/gfx/lights.ts); a body's 10 draw calls (the `body` template's test); a
  level file's 32 drawn vertices a tile and 20 draw calls a storey (`node x qa geo`).

## Measuring

- `node x perf <scene module or id> [--steps n] [--runs n] [--set k=v]`: Node, a warm-up run, then the medians;
  `node x perf labs/box --scene crowd-1000 --ladder` climbs the ladder.
- `node x perf labs/<name> --scene <id>`: the page in Chromium on WebGPU, its clock real, paused, stepped 120 times,
  60 frames drawn, then `__engine.stats()` read (engine/dev/stats.ts). In a page, `__engine.stats()` gives the same:
  the means of the last 60 steps and frames, the GPU's where timestamp queries exist, the last frame's counts.
- `--budget` holds the run to the file; a budget holds only for the run it was measured on (its scene, its steps, the
  scene's own settings), so `--budget` refuses other steps, `--set` or another scene, naming the fix.
- `--feature <id>` measures the page again with that feature off (`gfx.featuresOff`) and prints what it costs, for
  the work package's notes: compared, never budgeted.
- Every run appends to out/perf/trend.json and warns `PERF_TREND` for a number that grew over 15% since the run
  before. Compare counts, which repeat exactly; record times as medians with the load average beside them.

## Meeting them

- **No pipeline in play.** What a pool or a batch will show registers with the warm-up (engine/gfx/warmup.ts,
  `register(id, { objects })`), which compiles it before the first frame; fog, shadows, a filter or a light toggled
  later rebuild at the engine's moment, through the warm-up again. A material made mid-play builds a pipeline.
- **Fewer draw calls.** Many copies of one mesh go through the instancing service (`createInstancedBatch`,
  engine/gfx/instancing.ts: pages of 1,024 slots, so a page added in play builds nothing); one material draws a shape
  in one call; a crowd draws as instanced batches with a level of detail (engine/gfx/puppets/crowd.ts: thousands of
  bodies in a few dozen draw calls), never one actor each.
- **Lights.** A level's light spots feed the pool, which hands its fixed lights to the sources that matter near the
  focus: never add a `PointLight`, which rebuilds every lit pipeline.
- **Optional GPU work** sits behind a feature (engine/gfx/features.ts, with its advice code) and the quality tiers
  (engine/gfx/quality.ts: `quality` `low`, `medium`, `high` or `auto`); with `auto` the governor (engine/dev/governor.ts)
  moves between tiers as the frame rate asks, each move the advice `GFX_GOVERNOR`.
- **The sim.** `hashMs` and `captureMs` grow with what the state holds: the hash reads every component's declared
  fields, and strings, booleans and nested data take its general path (the crowd ladder's budgets name what costs
  most: tests/baselines/perf/box-crowd-1000.json). Keep per-agent state small and numeric; crowds of thousands are
  crowd agents (`addAgent`, engine/physics/crowd.ts), not actors.
- Measure before and after on the same command; a gain that does not show in the counts or the medians, run to run,
  is no proven gain (AGENTS.md: stop, and record it as an open issue).
