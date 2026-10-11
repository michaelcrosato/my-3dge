# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-11, gate G4)

Phases 0–4 are done: the foundation, the kernel, Box 1 (PR #2, #3, #5), and Box 2 and Box 3 together in PR #6.
- Box 2: a hero in the room (controller, input, skeleton and IK, animator, cameras v2, instancing and puppets, film
  and visual comparison); box-2 walk/jump/dash replays hold one golden set in Node and the rendering page.
- Box 3: the 64 × 44 hall (galleries, stairs, dais, braziers) compiles, validates and draws in 15 calls (32 budget
  with cutaway twins); bodies and props, navigation reaching every walkable tile; the hero climbs to a gallery, laps
  the dais and knocks crates (box-3-climb, box-3-dais, box-3-knock: Node and page give the same goldens).
- Already in from later phases: 5.1–5.4 (crowd bodies, steering, blob and floater rigs, crowd rendering at 5,000),
  5.5 (gpuMs: WP 11.2, on demand), 6.5 overlay, 7.1 lights and sky, 7.2 toon styles; lane L 8.1–8.3, 8.10; lane X
  9.1–9.4 (audio runtime).
- Gate: `node x ci --local` green in 6 min 57 s at load 32–42 (check 6.2 s, test 23.8 s with 2,530 tests,
  e2e 5 min 38 s of 6 min with 114 tests).

## What is next

- Box 4 (Phase 5, gate G5): B 5.7, a crowd in the box (walker, slime and wisp casts with their steering, box-4
  replays and the box-crowd-1000 perf baseline). 5.6 bot and dev actions stays on demand.
- Then Box 5 (Phase 6, G6): 6.1 moves and hits, 6.2 reactions, 6.3 combat helpers, 6.4 effects, 6.6 checks, 6.7.
- Background: lane L (8.4 baker and retargeting, then 8.5–8.7, 8.9) and lane X (9.5 sound in the box).

## Open issues

- T2 5 min 54 s of its 6 min at load 5–43 (WP-G5-fix-r1); T0 passed 10 s at G3 under
  load average 26–35 (recorded, not fixed).
- Over the 400-line warning (cap 600): engine/sim-api.ts 434, physics/world.ts 419, tools/cmd/perf.ts 414,
  sim/world.ts 410, sim/scene.ts 409, tools/cmd/port.ts 408, tools/cmd/ci.ts 404.
- Crowd bodies step only 7–8.5 cm against NAV_CLIMB 0.219 m: WP 5.7 needs a lower crowd climb or a step-up.
- The state hash's boolean/string path dominates at 1,000 agents (~75 ms at 5,000, WP 5.7).
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22. Not verified: touch (ADR-0021), physical pads, nav-1000 in Chromium.
