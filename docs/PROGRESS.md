# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-10, gate G2)

Phases 0–2 are done (PR #2, #3, #5): the foundation, the reproducible kernel and Box 1, a room that renders and steps.
- Renderer on WebGPU only (features with downgrade advice, resolution modes, a warm-up: 0 pipelines after it), the
  level compiler (v1, plus the v2 hall), procedural textures and materials, the geometry kit and level meshes (room in
  13 draw calls), cameras v1, shots with the ID pass and `x shot`, and the box app (`labs/box`, `createEngine`).
- Box-1 replays give one golden set headless and in the page while it renders, switches cameras and turns GPU
  features off; every inspector member and setting is reachable from `x` and `__engine`.
- Already in from Box 2: Rapier adapter (3.1), character controller (3.2), input (3.3), skeleton, IK and the humanoid
  port (3.4–3.6), cameras v2 (3.9), touch controls (3.12, not tested). Lane L: 8.1–8.3, 8.10. Lane X: 9.1, 9.2, 9.4.
- Gate: `node x ci --local` green in 3 min 42 s (check 6.8 s, test 28.3 s with 2,048 tests, e2e 2 min 25 s).

## What is next

- Box 2 (Phase 3, gate G3), remaining lanes: A 3.7 animator and body states; R 3.8 instancing and puppets; T 3.11
  film and visual comparison; then B 3.10, a hero in the box, which also proves 3.3–3.6 and 3.9 in the box.
- Background: lane L (8.4 baker and retargeting, then 8.5–8.7, 8.9) and lane X (9.3 runtime, then 9.5), never
  delaying a box stage. Phase 4 WP 4.2 is done early.

## Open issues

- Over the 400-line warning (cap 600): engine/sim-api.ts 425, engine/physics/world.ts 419, tools/cmd/port.ts 408,
  engine/sim/scene.ts 406, tools/cmd/ci.ts 404; ik.ts at 400 (character.ts and film.ts were split at G3's review).
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- The ID pass sees an InstancedMesh as one object (proposal: colour by instanceIndex). Chase/first/rail camera codes
  are not yet known to codes.ts and createCamera (core proposal, WP 3.9).
- Headless step(n) should take the virtual device's intents (proposal, WP 3.3). Steps replay goldens not committed.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22 (U-1). Browser `@example` blocks are flagged but not run.
- Not verified: physical pads, a real phone, hull determinism in Chromium beyond physics-40.
