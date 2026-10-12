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

## Amendment 2 (2026-10-12, gate G7's review): WP 6.2 in the box, as built

- **Found:** gate G7's review found WP 7.8's Done-when 2 unbuilt: no `Secondary` or `Reactions` outside engine/anim
  and tools/qa/anim.ts, yet the ledger marked WP 7.8 done.
- **Built** (lane gatefix-G7-r1):
  - engine/sim/reactions.ts declares two components. `reactions` holds `Reactions.save()`'s state, is in the hash,
    and comes with `reactTo(w, id, act)` and `stepReactions(state, dt)`. `secondary` (hair, cape, tail, colour) is
    carried by the sim like a build or a stand-in's material, and only the view draws it.
  - `actors.anim` steps an actor's reactions before its animator and lays what they tell the body over its states.
    spawnActor takes further components (`ActorSpec.components`).
  - engine/gfx/puppets/actors.ts puts two view-side layers on each puppet's animator: Reactions (the flinch lean, and
    a body down on its face drawn so) and Secondary.
  - engine/gfx/puppets/chains.ts draws the chains under the puppet in its own material: a cape as a two-sided ribbon,
    hair and tails as strands. The ID pass names `actor#<id>/cape` and counts it as the actor's.
  - The fight: every blow on the hero or a walker goes through its reactions (`HERO_FIGHT.react`). Big blows knock
    walkers down; they lie, get up the way they lie, and attack nothing meanwhile. Killing blows play the death.
  - The hero spawns with his reactions and cape, so the page's first warm-up builds the cape. Added at the first step
    instead, it re-warmed the page and held back its first drawn frames.
- **Calls:**
  - The new files (engine/sim/reactions.ts, engine/gfx/puppets/chains.ts) widen WP 7.8's Owns. Reactions and
    Secondary stay in engine/anim, under WP 6.2.
  - Slimes and wisps get no reactions, because Reactions bends a humanoid's spine.
  - Crowd batches pose without view layers, so a crowd walker shows its knockdown and get-up but not its flinch lean,
    and a walker knocked down from behind lies on its back. No WP takes this on until a game needs it (on demand,
    PLAN.md §9.1). Owner: say if the crowd should draw it.
  - Owner: the cape is a sim component that only the view draws, which spares the view a game-specific hook.
  - box-5-fight's goldens and the box sound timeline's golden (81 → 79 sounds) were re-recorded with this reason.
- **Plan edit:** WP 7.8's Owns adds engine/sim/reactions{,.test}.ts, engine/gfx/puppets/chains{,.test}.ts,
  engine/sim/actors.ts (the reactions step, ActorSpec.components), labs/box/cast/hero.ts and
  tests/pages/boxAudioTimeline.ts; the ledger rows of WP 7.8 and gate G7 record it.
