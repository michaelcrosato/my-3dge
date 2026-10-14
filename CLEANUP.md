# CLEANUP: closing the open items after G9

A one-time work order, written 2026-10-14 from an audit of PLAN.md §14's notes, docs/PROGRESS.md, the docs and the
branches (main at f3900c5). Every scheduled WP is done; what follows are the loose ends their rows still carry, the
owner's answers to the open questions, and the finish. Tick each box in the commit that closes it, so a resumed or
compacted session sees where things stand. The last commit deletes this file: by then the ledger, PROGRESS.md and the
ADRs hold the record. (A root-level .md: `x docs --check` and Prettier skip it.)

## Owner decisions, 2026-10-14

1. **ESC-0001: yes.** Add the GitHub Actions workflow (§7). Actions is on (the owner's `game/*` branches ran three
   workflows on 2026-10-14) and the repository is public, so runner minutes are free.
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
- Work top to bottom; items are independent unless one says otherwise.
- Per commit: `npm run check`, `npm test` (the full T1, about 30 s), and the T2 specs docs/TESTING.md selects for what
  you touched (`npm run e2e -- <spec>`). One suite at a time (ADR-0022). The full `node x ci --local` runs once, in §8,
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

## 1. Start

- [ ] 1.1 `node x deps --update`, in a commit of its own (AGENTS.md, the loop, step 1).
- [ ] 1.2 Record decisions 1–3: `node x esc answer ESC-0001 "Yes (2026-10-14): Actions is on and the repository is
      public; write .github/workflows/ci.yml running node x ci --local"`; an amendment to
      docs/decisions/ADR-0018-roadmap.md with the owner's acceptance of both calls (lines 58-61); WP 7.8's §14 row
      says "accepted by the owner, 2026-10-14" in place of its two "Owner:" clauses.

## 2. Split the files over 400 lines (DOCTRINE.md 1)

ESLint warns past 400 lines and errors past 600 (eslint.config.js:71-72; blank lines and comments count). Split each
file at its second concept, behaviour unchanged: every test and replay passes as before, in Node and Chromium. The
seams below are suggestions; follow the file comment where it says otherwise. engine/anim/ik.ts and
engine/anim/clip/retarget.ts are at exactly 400, and items 4.1 and 4.4 add lines to them: split them there.

| File                       | Lines | Move out                                           | Owns (WP) |
| -------------------------- | ----- | -------------------------------------------------- | --------- |
| engine/anim/actions.ts     | 596   | the action data → actions-data.ts (WP 8.7's note)  | 8.7       |
| engine/anim/secondary.ts   | 586   | `Chain` and `Cape` → chain.ts (WP 6.2's note)      | 6.2       |
| tools/qa/anim.ts           | 531   | the metrics → tools/qa/anim/metrics.ts             | 6.6       |
| engine/anim/timeline.ts    | 504   | `Attack` and `Combo` → attack.ts                   | 6.1       |
| tests/e2e/parity.spec.ts   | 489   | `STAGES` → a module of its own (4 docs cite it)    | 2.7       |
| engine/anim/check.ts       | 484   | the state matrix → stateMatrix.ts                  | 3.4, 6.6  |
| tests/e2e/post.spec.ts     | 458   | the box tests → post-box.spec.ts                   | 7.4       |
| engine/app/engine.ts       | 452   | the page's drawing → drawing.ts                    | 2.7       |
| engine/physics/world.ts    | 419   | `physicsOf` and its kin → binding.ts               | 3.1       |
| tools/cmd/perf.ts          | 416   | budgets and trend → tools/lib/perfBudget.ts        | 1.5       |
| engine/sim/world.ts        | 410   | the entity table → entityTable.ts                  | 1.4       |
| engine/gfx/post/chain.ts   | 410   | codes and settings → settings.ts                   | 7.4       |
| tools/lib/tiers.ts         | 409   | the budget checks → tierBudgets.ts                 | 0.5       |
| engine/sim/scene.ts        | 409   | `createSession` → session.ts                       | 1.5       |
| tools/cmd/port.ts          | 408   | the vector builders → tools/lib/portVectors.ts     | 0.11      |
| tools/cmd/ci.ts            | 403   | the summary → tools/lib/ciSummary.ts               | 0.9       |
| tools/cmd/sim.ts           | 402   | scene lookup (7 tools use it) → tools/lib/scenes.ts | 1.5     |

- [ ] 2.1 The splits, in as few commits as review allows, with one ADR amendment for all of them. Done when
      `npm run lint` shows no max-lines warning and the full T1 and the selected T2 pass unchanged.

## 3. T2's budget by machine size (WP 0.5, ADR-0022; decision 3)

- [ ] 3.1 _Filled in below from the sim, crowd, audio and CI audit._

## 4. Animation

- [ ] 4.1 **The post-IK foot plant** (WP 6.2; open since WP 3.7, passed on at WP 3.10, never built; PROGRESS.md
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
- [ ] 4.2 **preciseHits parity, Node against Chromium** (WP 6.1; deferred at WP 3.7 to Box 5's replays, which never
      set it). Do it after 4.1, so the golden carries the plant if the sim runs it.
  - Now: only Node unit tests set `preciseHits` (engine/anim/character.test.ts, engine/anim/moves.test.ts,
    fixtures/rigs/dummy/index.test.ts); the box's hero (labs/box/cast/hero.ts:90) does not.
  - Do: a sim setting `box.fight.precise` in labs/box/scenes/fight.ts, default off (defaults stay out of the hash, so
    box-5-fight's goldens hold), that spawns the hero with `anim.preciseHits`. Record
    tests/replays/box-5-precise.replay.json with box-5-fight's inputs and the setting on, following
    labs/box/README.md (adding a variant) and tests/replays/README.md: `node x replay <file> --browser sim --update`
    writes only when Node and Chromium agree, then `--browser page`. List the setting in labs/box/README.md and the
    replay in tests/e2e/parity.spec.ts; labs/box/scenes/fight.test.ts checks the trail is not empty mid-swing.
  - Prove: the replay's goldens agree in Node and Chromium, and parity.spec.ts passes with it.
- [ ] 4.3 **The clip lift raises some clips' feet** (WP 8.4). engine/anim/clip/retarget.ts:358-365 lifts a pose by the
      lowest of its joints, feet, hand and head tips, so swims and jumps hover (worst Swim_Idle_Loop, 1,813 mm; the
      `mannequin` entry of tests/baselines/anim-clips.json, held by engine/gfx/puppets/bodies/mannequin.test.ts). Try
      lifting only by how far the pose sinks below the scaled source's own lowest point. Prove: retarget.test.ts's
      planted-feet case run with the lift on; the mannequin baseline re-recorded with the reason.
- [ ] 4.4 **Contact IK swings a knee through at deep folds** (WP 8.6). plantFeet's two-bone solve passes no pole
      (engine/anim/clip/retarget.ts:307), so it takes the thigh frame's default. Pass the source knee's direction as
      the pole. Prove: `node x qa anim --only clip:CMU/Get_Up_From_Side,clip:MESH2MOTION/Slide_Exit,clip:MESH2MOTION/Zombie_Rise`
      reports their 4 entries in tests/baselines/qa-anim-library.json as stale; remove them with the reason.
- [ ] 4.5 **`x describe action` lists no ids** (WP 8.7): tools/cmd/describe.ts:235 calls only `defineLibrary()`, and
      the engine cannot import data/. Add a tools-side `defineActions()` beside it (after 2.1's actions.ts split).
      Prove: tools/cmd/describe.test.ts lists the action ids.
- [ ] 4.6 **The CMU set's credit line** (WP 8.1). The 25 `license` fields are corrected, but `credit` in
      data/anim/sets/cmu/_set.json:5 still says "free for all uses" (`CMU_CREDIT`, tools/anim/survey.ts:38-39). Reword
      it, map the old wording in tests/unit/data/anim/sets/sets.test.ts's legacy compare, and regenerate the set
      through the importer. Prove: `node x anim import --cmu --legacy --check` (network, about 23 MB).
- [ ] 4.7 **The cold CMU import check** (WP 8.5's deferred proof): the run in 4.6 is it; record the result in WP 8.5's
      row. Add it to `LONG_RUNS` (tools/lib/tiers.ts) only if a 23 MB download at every gate is acceptable, and record
      the call.
- [ ] 4.8 **Notes:** WP 8.10's "deferred without the checkouts" is done (the oracle decode and parity tests run with
      the checkouts in `npm test`, none skipped): update its row and WP 8.1's. WP 8.8's entry in PLAN.md gains a Need:
      a skinned-mesh GLB import test (tools/anim/glb-library.test.ts's fixture has no mesh).

## 5. Rendering, input, tools and docs

- [ ] 5.1 **Camera codes** (WP 3.9). engine/gfx/cameras/codes.ts knows 9 of the 12 camera names (:86, :186; pinned
      by codes.test.ts:112), so a typo such as `cam3=chasee` gets an error naming none of chase, first and rail, and
      its fix texts (:44, :49) leave them out. Check all 12 (`FOLLOW_CAMERAS`, `didYouMean`; engine/gfx/cameras/
      place.ts:60-66 already reads them). Prove: a test of the typo's message; codes.test.ts moves to 12, with the
      reason.
- [ ] 5.2 **The ID pass sees an InstancedMesh as one object** (gate G2): engine/gfx/idpass.ts gives each object one
      colour (:169, :210), so a crowd batch counts once. Give each instance its own id (colour by `instanceIndex` in
      TSL). idpass.ts is at 398 lines. Prove: engine/gfx/idpass.test.ts; re-record any ID-pass count baseline with
      the reason.
- [ ] 5.3 **The steps scene has no replay goldens** (gate G2): fixtures/scenes/steps/index.test.ts:44-51 only checks
      that the scene replays itself. Record a steps replay with goldens and check it as
      fixtures/scenes/physics-40/index.test.ts does. Prove: `npm test -- fixtures/scenes/steps`.
- [ ] 5.4 **Headless `step(n)` ignores the virtual device** (WP 3.3): the inspector's `step` passes `intents ?? {}`
      (engine/dev/inspector.ts:208-210), and an engine from `createHeadless` has no `input` member
      (engine/app/headless.ts:259-263). Load the input members in headless.ts and let `step(n)` sample the virtual
      device when no intents are given. Prove: a headless test where `hold('jump'); step(3)` records the input. Add to
      WP 10.6's entry in PLAN.md that system-layer actions never enter intents (its plan sends menu actions as input).
- [ ] 5.5 **Tests that read the clock** (ADR-0022: time is noise, counts are checks): engine/sim/world.test.ts:376-393
      compares performance.now ratios; tools/cmd/describe.test.ts:232-237 waits a real 3 s; tools/anim/
      library.test.ts:27-29 asserts under 50 ms. Make each assert a count (calls, reads) or use an injected timer,
      guarding the same thing; the reason goes in the commit.
- [ ] 5.6 **`outline.color` is not validated** (WP 7.4): `checkLook` checks only the levels
      (engine/gfx/post/looks.ts:235-241), and engine/gfx/post/filters.ts:324 passes any string to `new Color`. Add a
      colour problem beside `levelsProblem` (filters.ts:227), with its code (GFX_POST_BAD_COLOR, as WP 7.4's note
      proposed). Prove: a looks.test.ts case.
- [ ] 5.7 **The look spec and the ready wait** (WP 7.8): tests/e2e/box-look.spec.ts is one 600 s test (:87); make it
      one test per look. `x shot` waits 30 s (tools/cmd/shot.ts:51) and pages 60 s (`READY_MS`, tools/lib/page.ts:26),
      short for styled looks under load: add a `--ready-ms` option. Prove: the spec passes; the option is in the help.
- [ ] 5.8 **Browser `@example`s run nowhere** (WP 0.6's deferred proof; ADR-0015): 42 of 392 examples are flagged
      browser-only, 28 of them under labs/, and tests/unit/examples.test.ts:21-25 only checks that each gives a
      reason. Flag labs/ files by their imports rather than their folder (tools/lib/docs.ts:239-244), so most run in
      Node; run the rest in a new tests/e2e/examples.spec.ts (WP 0.6's Owns, with an ADR-0015 amendment). Prove: no
      example is left unrun, or each that is names why.
- [ ] 5.9 **Stale text:** docs/ANIMATION-LIBRARY.md:50 ("Until WP 8.5", done); docs/ANIMATION-LIBRARY.md:277
      describes an importer that refuses non-redistributable sources, never built: build the refusal if it is small,
      else correct the line; tools/eslint/askTheEntry.test.ts:103 ("until WP 1.2").

## 6. Sim, crowd, audio and Chromium coverage

- [ ] 6.1 _Filled in below from the sim, crowd, audio and CI audit._

## 7. CI on GitHub Actions (WP 0.9, ESC-0001; decision 1)

- [ ] 7.1 _Filled in below from the sim, crowd, audio and CI audit._

## 8. Finish

- [ ] 8.1 **Branches:** delete `box-menu` (its menu is on main, newer, through PR #13); merge `origin/main` into
      `integration` and push it (docs/HANDOFF.md: it mirrors main with every lane's commit). Leave the owner's
      `game/cold-relay-20261014` and `game/silent-relay-20261014` alone.
- [ ] 8.2 **PLAN.md §14:** a row for this cleanup, like the gate-fix rows; no row still carries an open clause this
      list closed. The rows of WPs 6.3 and 6.4 are stale too: hit-stop in a live page and `text` particles were closed
      by WPs 6.7 and 6.5.
- [ ] 8.3 **docs/PROGRESS.md**, rewritten (at most 40 lines, `x docs --check`): where things stand after the cleanup,
      what waits (below), and any "Owner:" issue this list left. Today its line 32 runs two bullets together, and the
      G4 rewrite dropped three issues still open then (5.2, 5.3, 5.4).
- [ ] 8.4 **U-1's reminder:** a `send_later` for 2026-10-22 (about 16:00 UTC) to run `node x deps --qualify` and do U-1,
      Vitest 4, as its own change from main; it also clears the 4 Dependabot alerts (dev-only vitest and tinypool).
- [ ] 8.5 **Review:** the `verifier` subagent over the whole diff, against DOCTRINE.md and this list (at most two
      rounds, ADR-0022).
- [ ] 8.6 **`node x ci --local` green**, in the background; read out/ci/summary.md.
- [ ] 8.7 **Merge:** delete this file; push; open the PR to main ("After G9: the cleanup"); look once at its Vercel
      status and at the new workflow's run; squash-merge once `x ci --local` is green (ADR-0021).
- [ ] 8.8 **Report:** the commits, out/ci/summary.md, the escalations, any "Owner:" issues, and what was not verified.

## Waiting by design (not part of this list)

- **U-1** Vitest 4: qualifies 2026-10-22 (8.4).
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
