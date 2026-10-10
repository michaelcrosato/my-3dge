# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-10, gate G1)

Phases 0 and 1 are done (PR #2, PR #3): the foundation and the reproducible kernel. No rendering engine yet.
- Kernel (engine/core, engine/sim, engine/input): fdlibm sin/cos/pow swapped into Math while the sim steps
  (`withSimMath`), so Node and Chromium agree bit for bit; seeded named RNG streams; registry, schema, settings,
  events, log with coded errors and warn-once advice; the frame clock and timers; the world (plain-data components,
  systems in fixed phases), its hash, capture and restore; intents, scenes, sessions and replays with bisection.
- Public API: engine/index.ts (pages) and engine/sim-api.ts (sim-side); game code imports only these (lint).
- `__engine` / `createHeadless`: one inspector API; `help()` checked against it. Mutations go through the session.
- Commands: `node x help`; `x sim`, `x replay --browser sim`, `x perf`, `x describe`. Gate: `node x ci --local`.
- Every L-size WP had a verifier review; all findings were fixed before merging (see the ledger notes).

## What is next

- Box 1 (Phase 2, gate G2), parallel lanes: WP 2.1 renderer and 2.2 level compiler first; then 2.3 materials and
  textures, 2.5 cameras, 2.6 shots and the ID pass; then 2.4 geometry and level meshes; then 2.7, the box app.
- Background lanes from G1: L (animation library, WP 8.1, 8.2) and X (audio, WP 9.1), never delaying a box stage.

## Open issues

- T0 (`npm run check`) runs about 9–10 s of its 10 s budget; `tsc` (7 s) is the bottleneck and incremental mode does
  not help with --noEmit. Plan: project references (or another measured fix) when T0 first warns.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22 (U-1). Vite HMR re-running a module that calls defineSettings throws
  CORE_DUPLICATE_ID (WP 2.7 must handle it). Browser `@example` blocks are flagged but not run.
- Deferred proof (WP 0.10): a fresh cloud session starts clean and both subagents load.
