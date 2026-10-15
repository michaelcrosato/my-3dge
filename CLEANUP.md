# CLEANUP: closing the open items after G9

A one-time work order, written 2026-10-14 from an audit of PLAN.md §14's notes, docs/PROGRESS.md, the docs and the
branches (main at f3900c5). Every scheduled WP is done; what follows are the loose ends their rows still carry, the
owner's answers to the open questions, and the finish. Tick each box in the commit that closes it, so a resumed or
compacted session sees where things stand. The last commit deletes this file: by then the ledger, PROGRESS.md and the
ADRs hold the record. (A root-level .md: `x docs --check` and Prettier skip it.)

## Owner decisions, 2026-10-14

1. **ESC-0001: yes.** Add the GitHub Actions workflow (§8). Actions is on (the owner's `game/*` branches ran three
   workflows on 2026-10-14) and the repository is public, so runner minutes are free. Both sources are public (shardfall is
   public as of 2026-10-14), so the runner clones them with no secret.
2. **ADR-0018's two "Owner:" calls are accepted as they are:** crowd walkers show knockdowns but not the flinch lean
   (their batches run no view layers); the cape is a sim component that only the view draws.
3. **T2's budget goes by machine size:** 9 min from 16 cores; the time measured on the 4-core cloud container becomes
   the budget there, with the reason in an ADR amendment. No test is weakened.
4. **Dated upgrades and on-demand WPs keep waiting.** U-1 to U-5 wait for the one-year rule (DOCTRINE.md 9: each date
   is 12 months after that major's release, so its idioms are in the models' training); U-6 to U-8 wait for a
   measurement or a platform change; the 22 on-demand WPs wait for a measured need (PLAN.md §9.1). If the owner names
   one to build now, add it here as its own item.

## How to work this list

- Branch `claude/wonderful-edison-n5xulc`. If its PR has merged, restart it from `origin/main`.
- Read DOCTRINE.md, AGENTS.md and docs/PROGRESS.md first; then, per item, its WP in PLAN.md §9 and the file comments of
  the modules you touch, not whole files. Skills: x-loop always; stress-box for labs/box; determinism-debugging when a
  hash parts; three-webgpu for engine/gfx; rapier for engine/physics.
- Work in the order written: §4 changes the box's fight and chase goldens, so 5.2 and 7.2 come after it and each golden
  is re-recorded once. Other items are independent.
- Per commit: `npm run check`, `npm test` (the full T1, about 30 s), and the T2 specs docs/TESTING.md selects for what
  you touched (`npm run e2e -- <spec>`). One suite at a time (ADR-0022). The full `node x ci --local` runs once, in §9,
  in the background (about an hour on 4 cores); read out/ci/summary.md, not the scrollback.
- Commit as `<area>: <what> (WP-x.y)`, naming the WP whose note it closes. In the same commit, edit that WP's §14 row:
  replace the open clause with what closed it.
- A new file joins its WP's **Owns** in PLAN.md §9, with an ADR amendment in the same commit (precedent: ADR-0020
  amendment 6). One amendment may cover several splits.
- Baselines (QA, goldens, thumbnails, budgets) change only with the reason written in the commit and the ledger row. A
  replay golden that changes where the item says it should not: stop and bisect (determinism-debugging).
- ADR-0022: cheap, objective checks. An item still unclear after a cheap test is recorded as an open issue starting
  "Owner:" in its ledger row and the final report; that closes it for this list.
- Escalate only an owner action (`node x esc open …`), and keep working on the rest meanwhile.
- Line numbers below are from main at f3900c5; edits shift them, so search for the quoted names.

## 1. Start

- [x] 1.1 `node x deps --update`, in a commit of its own (AGENTS.md, the loop, step 1).
- [x] 1.2 Record decisions 1–3: `node x esc answer ESC-0001 "Yes (2026-10-14): Actions is on and the repository is
      public; write .github/workflows/ci.yml running node x ci --local"`; an amendment to
      docs/decisions/ADR-0018-roadmap.md with the owner's acceptance of both calls (lines 58-61); WP 7.8's §14 row
      says "accepted by the owner, 2026-10-14" in place of its two "Owner:" clauses.

## 2. Split the files over 400 lines (DOCTRINE.md 1)

ESLint warns past 400 lines and errors past 600 (eslint.config.js:71-72; blank lines and comments count). Split each
file at its second concept, behaviour unchanged: every test and replay passes as before, in Node and Chromium. The
seams below are suggestions; follow the file comment where it says otherwise. engine/anim/ik.ts and
engine/anim/clip/retarget.ts are at exactly 400, and items 5.1 and 5.4 add lines to them: split them there.

| File                     | Lines | Move out                                                | Owns (WP) |
| ------------------------ | ----- | ------------------------------------------------------- | --------- |
| engine/anim/actions.ts   | 596   | the action data → actions-data.ts (WP 8.7's note)       | 8.7       |
| engine/anim/secondary.ts | 586   | `Chain` and `Cape` → chain.ts (WP 6.2's note)           | 6.2       |
| tools/qa/anim.ts         | 531   | the metrics → tools/qa/anim/metrics.ts                  | 6.6       |
| engine/anim/timeline.ts  | 504   | `Attack` and `Combo` → attack.ts                        | 6.1       |
| tests/e2e/parity.spec.ts | 489   | `STAGES` → a module of its own (4 docs cite it)         | 2.7       |
| engine/anim/check.ts     | 484   | the state matrix → stateMatrix.ts                       | 3.4, 6.6  |
| tests/e2e/post.spec.ts   | 458   | the box tests → post-box.spec.ts                        | 7.4       |
| engine/app/engine.ts     | 452   | the page's drawing → drawing.ts                         | 2.7       |
| engine/physics/world.ts  | 419   | `physicsOf` and its kin → binding.ts                    | 3.1       |
| tools/cmd/perf.ts        | 416   | budgets and trend → tools/lib/perfBudget.ts             | 1.5       |
| engine/sim/world.ts      | 410   | the entity table → entityTable.ts                       | 1.4       |
| engine/gfx/post/chain.ts | 410   | codes and settings → settings.ts                        | 7.4       |
| tools/lib/tiers.ts       | 409   | the budget checks → tierBudgets.ts                      | 0.5       |
| engine/sim/scene.ts      | 409   | `createSession` → session.ts                            | 1.5       |
| tools/cmd/port.ts        | 408   | the vector builders → tools/lib/portVectors.ts          | 0.11      |
| tools/cmd/ci.ts          | 403   | the summary → tools/lib/ciSummary.ts                    | 0.9       |
| tools/cmd/sim.ts         | 402   | scene lookup (7 tools use it) → tools/lib/scenes.ts     | 1.5       |

- [x] 2.1 The splits, in as few commits as review allows, with one ADR amendment for all of them. Done when
      `npm run lint` shows no max-lines warning and the full T1 and the selected T2 pass unchanged.

## 3. T2's budget by machine size (WP 0.5, ADR-0022; decision 3)

- [x] 3.1 Now: `TIERS.T2.budgetMs` is a flat 540,000 ms (tools/lib/tiers.ts:66-72). It drives the `CI_BUDGET` warning
      (tools/cmd/ci.ts:344) and `selectT2`'s rule that runs T2 in full when its last full run fit the budget
      (tiers.ts:304). Only `CORES_PER_WORKER` (playwright.config.ts:22) knows the core count.
  - Do: export one worker count by cores, used by playwright.config.ts and tiers.ts, and derive T2's budget from it:
    9 min at 4 workers (16 cores or more); about 60 min at 1 worker (4 cores: ADR-0014 amendment 15 measured
    57 min 40 s); any count in between stated as unmeasured. Inject the core count through the CI deps, so the tests do
    not depend on the host. Within its budget `selectT2` runs T2 in full, so in the cloud `x ci --local` will run the
    whole hour: confirm that is what §8.9 intends, and record the call.
  - Update every statement of the budget (search "9 min" and "540"): tools/lib/tiers.ts:6, tools/cmd/ci.test.ts:252,
    tools/lib/tiers.test.ts:259, AGENTS.md:71, .claude/skills/x-loop/SKILL.md:28, PLAN.md (lines 134, 1162, 1263,
    1386 and Appendix E's draft AGENTS.md), ADR-0014 amendments 14–15 (14's "fails at 13 min 30 s" predates
    ADR-0022). The record is an ADR-0022 amendment.
  - Prove: tiers.test.ts cases for 4 and 16 cores.

## 4. The hero and the crowd (WP 5.7; the controller of WPs 3.2 and 4.1)

- [x] 4.1 **At 1,000 walkers the hero cannot get through the crowd**, at the stairs or on open floor.
  - Now: in a headless run he moves 0.42 m in 3 s at the stairs' foot and 0.05 m on open floor (with 100 walkers he
    reaches the gallery). The stairs are a 1:5 ramp that the crowd climbs, so WP 5.7's "crowd climb 0.06 m" and gate
    G4's step-height note are settled. The cause: the character controller queries with the hero's own collision
    groups (engine/physics/move.ts:165, 172, 267), which include the crowd (engine/physics/groups.ts:44), so every
    walker is a wall, and his only way through is a 70 kg push per contact (engine/physics/character.ts:328-339)
    against a crowd pressing in along its flow field. The prototype left the crowd out of the hero's query
    (`HERO_QUERY`, my-3d2dge:src/stress-world/20-sim.js:33: "its capsule shoves monsters aside"); that was never
    ported.
  - Do: port it: a character option (for example `shoves: ['crowd']`) that drops those groups from the controller's
    query; the box's hero sets it (labs/box/cast/hero.ts). Tried in-process during the audit: he reaches the gallery
    at step 769 and moves 13.2 m on open floor. If it does not hold up, the fallback is a gameplay call (only
    attack-token holders close in, labs/box/cast/walker.ts:118-131): record it.
  - Prove: a box:crowd-1000 replay that walks to the stairs' foot, waits 5 s and climbs, with a test that the hero
    ends on the gallery (it fails today). Re-record box-4-chase's, box-4-hop's and box-5-fight's goldens and the
    fight's sound timeline (`FIGHT_TIMELINE`, tests/pages/boxAudioTimeline.ts) with the reason, in Node and Chromium.
    Amend ADR-0020 (its amendment 3 says how the controller moves).

## 5. Animation

- [x] 5.1 **The post-IK foot plant** (WP 6.2; open since WP 3.7, passed on at WP 3.10, never built; PROGRESS.md
      lists it).
  - Now: `footPlant` (engine/anim/ik.ts:303-329) takes a probe but no floor height and reads the floor from
    `pose.rootPos.y` (:337-338); only ik.test.ts calls it. The animator's `post` slot (engine/anim/weights.ts:41) holds
    only Actions' effector solve (engine/anim/actions.ts:303). ADR-0009 amendment 4 left the slot empty and `floor`
    unbuilt; amendments 3 and 6 leave the floor sinks and the foot slides to it.
  - Do: move `footPlant` to engine/anim/footPlant.ts with `floor?: number` in its options, and add a layer that runs it
    last in `post`, after Actions (a flat probe at the body's height; a foot is in stance when its sole is within
    5 mm). Attach it where animators are assembled: engine/gfx/puppets/actors.ts and tools/qa/anim.ts:93-96. Decide
    whether the sim's preciseHits posing (engine/sim/actors.ts) runs it too, since the trail is sim data, and record
    the call. Heel and toe probes (WP 3.5's follow-up) only if cheap.
  - Prove: an ik.test.ts case (a root below the floor, given `floor: 0`, leaves the soles within 5 mm of it); the
    KNOWN floor sinks of engine/anim/authoring.test.ts:92-97 (kneel, crouch, dash, guard) empty when posed through an
    Animator with the layer; `node x qa anim` reports the baseline entries it fixes as stale (tests/baselines/
    qa-anim.json: 38 footSlide entries cite the missing foot plant, 21 underFloor entries ADR-0009 amendment 3's
    sinks): remove them, with the reason. The box's replay goldens stay unchanged when the plant is view-side;
    thumbnails may move: re-record them with the reason.
- [x] 5.2 **preciseHits parity, Node against Chromium** (WP 6.1; deferred at WP 3.7 to Box 5's replays, which never
      set it). Record it after §4 and 5.1, so its goldens carry both.
  - Now: only Node unit tests set `preciseHits` (engine/anim/character.test.ts, engine/anim/moves.test.ts,
    fixtures/rigs/dummy/index.test.ts); the box's hero (labs/box/cast/hero.ts:90) does not.
  - Do: a sim setting `box.fight.precise` in labs/box/scenes/fight.ts, default off (defaults stay out of the hash, so
    box-5-fight's goldens hold), that spawns the hero with `anim.preciseHits`. Record
    tests/replays/box-5-precise.replay.json with box-5-fight's inputs and the setting on, following
    labs/box/README.md (adding a variant) and tests/replays/README.md: `node x replay <file> --browser sim --update`
    writes only when Node and Chromium agree, then `--browser page`. List the setting in labs/box/README.md and the
    replay in tests/e2e/parity.spec.ts; labs/box/scenes/fight.test.ts checks the trail is not empty mid-swing.
  - Prove: the replay's goldens agree in Node and Chromium, and parity.spec.ts passes with it.
- [x] 5.3 **The clip lift raises some clips' feet** (WP 8.4). engine/anim/clip/retarget.ts:358-365 lifts a pose by the
      lowest of its joints, feet, hand and head tips, so swims and jumps hover (worst Swim_Idle_Loop, 1,813 mm; the
      `mannequin` entry of tests/baselines/anim-clips.json, held by engine/gfx/puppets/bodies/mannequin.test.ts). Try
      lifting only by how far the pose sinks below the scaled source's own lowest point. Prove: retarget.test.ts's
      planted-feet case run with the lift on; the mannequin baseline re-recorded with the reason.
- [x] 5.4 **Contact IK swings a knee through at deep folds** (WP 8.6). plantFeet's two-bone solve passes no pole
      (engine/anim/clip/retarget.ts:307), so it takes the thigh frame's default. Pass the source knee's direction as
      the pole. Prove: `node x qa anim --only clip:CMU/Get_Up_From_Side,clip:MESH2MOTION/Slide_Exit,clip:MESH2MOTION/Zombie_Rise`
      reports their 4 entries in tests/baselines/qa-anim-library.json as stale; remove them with the reason.
- [x] 5.5 **`x describe action` lists no ids** (WP 8.7): tools/cmd/describe.ts:235 calls only `defineLibrary()`, and
      the engine cannot import data/. Add a tools-side `defineActions()` beside it (after 2.1's actions.ts split).
      Prove: tools/cmd/describe.test.ts lists the action ids.
- [x] 5.6 **The CMU set's credit line** (WP 8.1). The 25 `license` fields are corrected, but `credit` in
      data/anim/sets/cmu/_set.json:5 still says "free for all uses" (`CMU_CREDIT`, tools/anim/survey.ts:38-39). Reword
      it, map the old wording in tests/unit/data/anim/sets/sets.test.ts's legacy compare, and regenerate the set
      through the importer. Prove: `node x anim import --cmu --legacy --check` (network, about 23 MB).
- [x] 5.7 **The cold CMU import check** (WP 8.5's deferred proof): the run in 5.6 is it; record the result in WP 8.5's
      row. Add it to `LONG_RUNS` (tools/lib/tiers.ts) only if a 23 MB download at every gate is acceptable, and record
      the call.
- [x] 5.8 **Notes:** WP 8.10's "deferred without the checkouts" is done (the oracle decode and parity tests run with
      the checkouts in `npm test`, none skipped): update its row and WP 8.1's. WP 8.8's entry in PLAN.md gains a Need:
      a skinned-mesh GLB import test (tools/anim/glb-library.test.ts's fixture has no mesh).

## 6. Rendering, input, tools and docs

- [x] 6.1 **Camera codes** (WP 3.9). engine/gfx/cameras/codes.ts knows 9 of the 12 camera names (:86, :186; pinned
      by codes.test.ts:112), so a typo such as `cam3=chasee` gets an error naming none of chase, first and rail, and
      its fix texts (:44, :49) leave them out. Check all 12 (`FOLLOW_CAMERAS`, `didYouMean`; engine/gfx/cameras/
      place.ts:60-66 already reads them). Prove: a test of the typo's message; codes.test.ts moves to 12, with the
      reason.
- [x] 6.2 **The ID pass sees an InstancedMesh as one object** (gate G2): engine/gfx/idpass.ts gives each object one
      colour (:169, :210), so a crowd batch counts once. Give each instance its own id (colour by `instanceIndex` in
      TSL). idpass.ts is at 398 lines. Prove: engine/gfx/idpass.test.ts; re-record any ID-pass count baseline with
      the reason.
- [x] 6.3 **The steps scene has no replay goldens** (gate G2): fixtures/scenes/steps/index.test.ts:44-51 only checks
      that the scene replays itself. Record a steps replay with goldens and check it as
      fixtures/scenes/physics-40/index.test.ts does. Prove: `npm test -- fixtures/scenes/steps`.
- [x] 6.4 **Headless `step(n)` ignores the virtual device** (WP 3.3): the inspector's `step` passes `intents ?? {}`
      (engine/dev/inspector.ts:208-210), and an engine from `createHeadless` has no `input` member
      (engine/app/headless.ts:259-263). Load the input members in headless.ts and let `step(n)` sample the virtual
      device when no intents are given. Prove: a headless test where `hold('jump'); step(3)` records the input. Add to
      WP 10.6's entry in PLAN.md that system-layer actions never enter intents (its plan sends menu actions as input).
- [x] 6.5 **Tests that read the clock** (ADR-0022: time is noise, counts are checks): engine/sim/world.test.ts:376-393
      compares performance.now ratios; tools/cmd/describe.test.ts:232-237 waits a real 3 s; tools/anim/
      library.test.ts:27-29 asserts under 50 ms. Make each assert a count (calls, reads) or use an injected timer,
      guarding the same thing; the reason goes in the commit.
- [x] 6.6 **`outline.color` is not validated** (WP 7.4): `checkLook` checks only the levels
      (engine/gfx/post/looks.ts:235-241), and engine/gfx/post/filters.ts:324 passes any string to `new Color`. Add a
      colour problem beside `levelsProblem` (filters.ts:227), with its code (GFX_POST_BAD_COLOR, as WP 7.4's note
      proposed). Prove: a looks.test.ts case.
- [x] 6.7 **The look spec and the ready wait** (WP 7.8): tests/e2e/box-look.spec.ts is one 600 s test (:87); make it
      one test per look. `x shot` waits 30 s (tools/cmd/shot.ts:51) and pages 60 s (`READY_MS`, tools/lib/page.ts:26),
      short for styled looks under load: add a `--ready-ms` option. Prove: the spec passes; the option is in the help.
- [x] 6.8 **Browser `@example`s run nowhere** (WP 0.6's deferred proof; ADR-0015): 42 of 392 examples are flagged
      browser-only, 28 of them under labs/, and tests/unit/examples.test.ts:21-25 only checks that each gives a
      reason. Flag labs/ files by their imports rather than their folder (tools/lib/docs.ts:239-244), so most run in
      Node; run the rest in a new tests/e2e/examples.spec.ts (WP 0.6's Owns, with an ADR-0015 amendment). Prove: no
      example is left unrun, or each that is names why.
- [x] 6.9 **Stale text:** docs/ANIMATION-LIBRARY.md:50 ("Until WP 8.5", done); docs/ANIMATION-LIBRARY.md:277
      describes an importer that refuses non-redistributable sources, never built: build the refusal if it is small,
      else correct the line; tools/eslint/askTheEntry.test.ts:103 ("until WP 1.2").

## 7. Sim, audio and Chromium coverage

- [x] 7.1 **The state hash's slow path** (WPs 5.1, 5.7: 326 ms a hash at 5,000 walkers).
  - Now: only numbers take the fast path (engine/sim/state.ts:291-293). Every other value goes through `notData`
    (engine/sim/entities.ts:89-105) and `Fnv64.value` (engine/core/hash.ts:198-220), which allocates closures per call,
    UTF-8-encodes every key and string and sorts every object's keys. At crowd-1000 the slow path carries 34,100 keys
    a step, mostly `crowdBody.state` (66 keys a walker).
  - Do: the same bytes, cheaper: cache key and string bytes as `feedName` does (state.ts:263-278), hoist the visitor
    out of the per-call path, feed booleans and strings directly, and fold `notData` into the walk.
  - Prove: every replay golden holds (`node x replay tests/replays`); a spy test shows no `TextEncoder.encode` on a
    second hash of the same state. Keep it only if hashing is clearly faster (over 10%, ADR-0022); else drop it and
    record that.
- [x] 7.2 **`x audio --replay` finds 0 box sounds** (WPs 9.4, 9.5).
  - Now: `x audio` reads only `payload.sfx` (tools/cmd/audio.ts:141-166), while the box maps its sim events to sounds
    on the page side (labs/box/sounds/events.ts). `playReplay` has no `onStep` (engine/sim/replay.ts:232-237), so
    audio.ts:193-208 copies the stepping loop.
  - Do: an optional `sounds(record, world)` hook on the scene kind (engine/sim/scene.ts:112-136), defaulting to
    today's payload reader; `x audio` asks the replay's scene for it. labs/box/sounds/events.ts imports
    engine/sim-api.ts instead of engine/index.ts and exports `boxSounds(level)`; the box's scenes set
    `sounds: boxSounds(HALL_LEVEL)`; tools/eslint/simSide.ts lists events.ts as sim-side. Amend ADR-0013: this
    reverses WP 9.5's call that the map stays page-side. Replace the copied loop with an `onStep` in `playReplay`, or
    with engine/app/playback.ts's `createPlayback`.
  - Prove: `node x audio --replay tests/replays/box-5-fight.replay.json` finds the fight's sounds (79 before §4); a
    unit test compares its (step, sfx, vol) sequence with the page's timeline (tests/pages/boxAudioTimeline.ts).
  - Also: the fight's timeline golden is `94ad7308afa14921` (tests/pages/boxAudioTimeline.ts:28; §4 changes it), but
    docs/PROGRESS.md:14, docs/decisions/ADR-0013-audio.md:40 and the rows of WP 9.5 and G9 cite `8da39df56b106f5f`,
    the 81-sound golden from before G7: cite the current one. WP 9.5's "fight-1000 event rate vs the 256-record trace"
    was measured in the audit: at most 83 events in one step over fight-1000's 600 steps, none missed (both readers
    count misses); record it in the row.
- [x] 7.3 **Chromium coverage** (WPs 4.1, 4.2, 4.3, 5.3).
  - Now: tests/e2e/parity.spec.ts replays the box's twelve replays in Chromium; physics-40, physics-props, crowd-1000
    and kernel-crowd were checked in Chromium only when recorded (tools/cmd/replay.ts:22-24). WP 4.2's hulls
    (box-3-climb, box-3-dais) and WP 5.3's atan2 and hypot (tests/e2e/drift.spec.ts, box-4-chase, box-4-hop) are
    covered: update their rows. Two gaps: `findPath` runs only in fixtures/scenes/nav-1000, which has no replay
    (WP 4.3); no scene rides a vertical mover (fixtures/scenes/physics-props/index.ts:64-67), so the sink path is
    checked in Node only (WP 4.1).
  - Do: record a nav-1000 replay, and a lift replay (a physics-props setting, off by default, so physics-props'
    goldens hold), with `node x replay <file> --browser sim --update`. Add
    `node x replay tests/replays --browser sim --runs 1` to `LONG_RUNS` (tools/lib/tiers.ts), so every replay is
    re-checked in Chromium at each gate.
  - Prove: both replays' goldens agree in Node and Chromium.

## 8. CI on GitHub Actions (WP 0.9, ESC-0001; decision 1)

- [x] 8.1 **shardfall is public now** (GitHub reports it public on 2026-10-14; it was private when the plan was
      written), so the runner clones both sources anonymously and needs no secret. `x src` must resolve both
      (tools/cmd/src.ts:24; step 2 of `CI_STEPS`, tools/cmd/ci.ts:63-71). Correct the stale "shardfall is private"
      notes: CLAUDE.md:15, PLAN.md §9's WP 0.2 (`x src`) and §11.5's table, tools/cmd/src.ts:8. If a clone is
      refused after all, escalate once (`node x esc open`) and go on.
- [x] 8.2 **.github/workflows/ci.yml** (WP 0.9's Build): on pull requests and pushes to main, plus a manual dispatch; a
      120-minute timeout. Chromium 141 either from the Playwright image whose browser it is
      (`mcr.microsoft.com/playwright:v1.56.1-noble`, its chromium-1194 as `CHROMIUM_PATH`; check it reports
      141.0.7390.37, and install git if the image lacks it) or on ubuntu-24.04
      from scripts/setup.sh:154-176's Chrome for Testing download plus `npx playwright install-deps chromium` for the
      system libraries. Check out the repository, then my-3d2dge at e37e4ee into .cache/src-3d2dge and shardfall at
      fa2dab6 into .cache/src-shardfall (anonymously; LFS off); Node from .nvmrc; then `node x ci --local` (or its
      seven steps, one per workflow step, if 8.3's test keeps them equal to `CI_STEPS`). Always upload out/** and
      write out/ci/summary.md to `$GITHUB_STEP_SUMMARY`. The actions follow §6.10's version rule. A fresh runner runs
      T2 in full (no t2-full.json, tools/cmd/ci.ts:234-244), about an hour and a quarter in all. Box 4's chase replay
      ran at 165.5 s of its 240 s timeout on one worker here: a timeout on the runner is a finding to record, never a
      reason to loosen the test quietly.
- [x] 8.3 **Its unit test** (beside tools/cmd/ci.test.ts): reads ci.yml as text (no YAML dependency) and asserts that
      its commands equal `x ci --local`'s (`CI_STEPS`), its source commits equal the pinned ones (`sourceSpecs()`,
      tools/lib/source.ts), it takes Node from .nvmrc, and its Chromium matches tools/deps.json's pin.
- [x] 8.4 **Push ci.yml in a commit of its own, last.** GitHub refuses a push holding a workflow file without the
      `workflow` permission, and the refusal would hold back everything else. If refused: drop that commit, push the
      rest, and escalate with the file, for the owner to add it or grant the permission. When the workflow runs green:
      `node x esc close ESC-0001`, and update PLAN.md §8.9, ADR-0016 (`x ci --local` was the merge gate "until GitHub
      Actions is enabled") and WP 0.9's row with what the merge gate is now.

## 9. Finish

- [x] 9.1 **Branches:** delete `box-menu` (its menu is on main, newer, through PR #13); merge `origin/main` into
      `integration` and push it (docs/HANDOFF.md: it mirrors main with every lane's commit). Leave the owner's
      `game/cold-relay-20261014` and `game/silent-relay-20261014` alone.
- [x] 9.2 **PLAN.md §14:** a row for this cleanup, like the gate-fix rows; no row still carries an open clause this
      list closed. The rows of WPs 6.3 and 6.4 are stale too: hit-stop in a live page and `text` particles were closed
      by WPs 6.7 and 6.5.
- [x] 9.3 **docs/PROGRESS.md**, rewritten (at most 40 lines, `x docs --check`): where things stand after the cleanup,
      what waits (below), and any "Owner:" issue this list left. Today its line 32 runs two bullets together and says
      T2 runs in full while over its budget (while over, `selectT2` picks specs by what changed); its line 14 cites
      the old fight golden (7.2); and the G4 rewrite dropped three issues that were still open (6.2, 6.3, 6.4).
- [x] 9.4 **U-1's reminder:** a `send_later` for 2026-10-22 (about 16:00 UTC) to run `node x deps --qualify` and do U-1,
      Vitest 4, as its own change from main; it also clears the 4 Dependabot alerts (dev-only vitest and tinypool).
- [x] 9.5 **Review:** the `verifier` subagent over the whole diff, against DOCTRINE.md and this list (at most two
      rounds, ADR-0022).
- [x] 9.6 **`node x ci --local` green**, in the background; read out/ci/summary.md.
- [ ] 9.7 **Merge:** delete this file; push; open the PR to main ("After G9: the cleanup"); look once at its Vercel
      status and at the workflow's run (fix it if red, as for any check); squash-merge once
      `x ci --local` is green (ADR-0021).
- [ ] 9.8 **Report:** the commits, out/ci/summary.md, the escalations, any "Owner:" issues, and what was not verified.

## Waiting by design (not part of this list)

- **U-1** Vitest 4: qualifies 2026-10-22 (9.4).
- **U-2 to U-5**, the one-year rule (tools/deps.json holds each release date): globals 17, eslint-plugin-jsdoc 62 and
  ESLint 10 on 2027-01-01, 2027-01-09 and 2027-02-06; three r183 on 2027-02-18, or earlier if it measures better (the
  internals rule); Vite 8 and TypeScript 6 on 2027-03-12 and 2027-03-23; Node 26 on 2027-05-05.
- **U-6** Rapier after 0.21 and **U-7** three r184 and later: when a release measures better (r186 needs WebGPU
  features Chromium 141 lacks). **U-8** Chromium: when the environment's browser changes.
- **The 22 on-demand WPs** (PLAN.md §9.1): none has triggered. QA baseline entries wait on two of them:
  tests/baselines/qa-anim.json has 12 for WP 10.2 and 5 for WP 8.8; tests/baselines/qa-anim-library.json has 10 for
  WP 8.8.
- **Not verifiable in this container:** speakers and headphones, Firefox and Safari, touch on phones (ADR-0021),
  physical pads, real-GPU performance. Phase H, or the owner.
- **The owner's:** the first-game trial in docs/HANDOFF.md.
