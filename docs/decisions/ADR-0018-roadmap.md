# ADR-0018: The roadmap: box first

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §9.1

## Decision
- The Stress Box comes first, in six stages (Phases 2–7, gates G2–G7), after the foundation (G0) and the kernel
  (G1).
- Then the animation library (Phase 8) and audio (Phase 9), which may start earlier but never delay a box stage.
- Everything else is on demand: each WP starts only when its trigger is measured, and its ledger note records the
  measurement (§9.1).
- Production hardening (Phase H) waits until a game goes to production.

## Why
Doctrines North Star (solve problems when they surface) and Discovery first (most of the work is finding something
worth shipping).

## Enforced by
The roadmap (§9) and the ledger (§14), whose notes record each trigger; the `verifier` flags production-hardening work
outside Phase H, except ADR-0021's.

## Amendment 1 (2026-10-11, gate G6's review): reactions and secondary motion are shown in Box 6

- **Found:** WP 6.2 built reactions (`Reactions`: the flinch spring, knockdown, death, the get-ups) and secondary
  motion (`Chain`, `Cape`, `Secondary`) and deferred showing them in the box to WP 6.7, whose Build and Done-when never
  named them. Box 5 shipped without them: the fight's foes flinch through the body state `hurt` and die through the
  humanoid's `die` pose, and no page draws a chain (nothing outside engine/anim and tools/qa/anim.ts uses them).
- **Call:** they are shown in Box 6 (WP 7.8), not wired into the fight as a review fix. Wiring them is a WP's work:
  `Reactions` is sim data, so its flinch and timelines enter the hash and the fight's goldens are re-recorded with
  that reason, and drawing a chain needs a view-side `Secondary` on the puppets' own animators and a mesh for it
  (engine/gfx/puppets/actors.ts), which no module has yet. Gate G6's own Done-when (kills and launches, goldens in
  Node and the page, effects never changing the hash, the animation QA) holds without them.
- **Plan edit:** the stage table moves "reactions and secondary motion" from Box 5's row to Box 6's; WP 7.8's Build
  and Done-when gain them and its Owns extends `engine/gfx/puppets/actors.ts` and the box-5 replays' goldens; the
  ledger rows of WPs 6.2 and 6.7 name WP 7.8; docs/PROGRESS.md lists it among the open issues.
