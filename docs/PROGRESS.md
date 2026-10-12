# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-12, gate G8 done: the animation library)

Phases 0–8 are done: the foundation, the kernel, Boxes 1–6 and the animation library (PR #2–#10).
- The library: 1,218 clips in 10 sets (CMU, Quaternius v2, mesh2motion and 100STYLE's 7 sets) as readable text,
  with provenance (data/anim/SOURCES.md, licenses, catalogs, the CMU ledger) and parity proofs (the codec
  bit-identical to the source; 79 of 87 Quaternius clips within v1's fit, the 8 others listed with reasons).
- The clip layer plays every clip on every build in Node, with the anim QA baselined with reasons
  (qa-anim-library.json, 32 entries); 28 actions (data/anim/actions/) play through the Actions player.
- Clip mode (`box:clips`) runs headless and in the page: every host registers the library (tools/anim/library.ts);
  the box-8-clips replay gives one golden set in Node, the sim page and the rendering page.
- `x anim import --cmu --legacy --check` reproduces the CMU set byte for byte (62 files).
- Gate: `node x ci --local` green at bb3862f (check 6.1 s, test 31.8 s with 3,262 tests); T2 in full at the review,
  159/159 in 14 min 24 s; `x deps --qualify`: nothing qualifies beyond the pins.

## What is next

- Lane X's gate G9 (audio: WPs 9.1–9.5 are in, sound in the box included).
- Everything else is on demand: each WP waits for its measured trigger (PLAN.md §9.1); WP 8.8 (re-import from the
  sources, format 2's key fields) among them.

## Open issues

- T2 runs over its 9 min, a warning only (ADR-0022): the gate selects T2 in full while it is over.
- Over the 400-line warning (cap 600): engine/anim/actions.ts, secondary.ts, engine/app/engine.ts,
  tests/e2e/parity.spec.ts, tools/cmd/sim.ts, physics/world.ts, sim/world.ts, sim/scene.ts, ci.ts, tiers.ts, perf.ts,
  port.ts.
- The crowd's batches draw no flinch lean (no `reactions` layer); at 1,000 agents the crowd blocks the stairs' foot.
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- docs/INDEX.md is one large generated file: read its "Start here" and grep the rest.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Vitest 4 qualifies 2026-10-22. Not verified: touch (ADR-0021), physical pads, real-GPU performance.
