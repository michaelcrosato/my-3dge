# ADR-0009: Animation architecture

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §4.2, §5.2, §6.4, WPs 3.4–3.7

## Decision
- Poses are authored in effector space, solved by IK, and applied to a rotation skeleton: a root plus 23 joints.
- An explicit layer stack.
- Two update paths (§6.4): `anim.step` runs in the sim for every character, every tick, and is part of the gameplay
  hash; `anim.pose` runs in the presentation for characters that are drawn, may be LOD'd, and is not hashed. A
  character marked `preciseHits` has its pose evaluated in the sim, never depending on visibility.
- No Card mode (sprite characters; §13.2 Q7).
- The camera never feeds animation.

## Why
The prototype's animation core is costly to rebuild and works (§4.2): porting its math onto one skeleton and an
explicit layer model keeps what works. Splitting the update paths removes the prototype's leak where the visibility
set drove animation (doctrine: Reproducible).

## Enforced by
Differential tests against the ported reference vectors (WP 0.11); the animation QA checks and sheets (WP 6.6).

## Amendment 1 (2026-10-10, WP-3.4)
- **The old rig's `footL`/`footR` is the sole, not the ankle.** Its drawing puts the ankle 62% of the way from the
  knee to the foot point. So build `legLower` is knee to sole, the `foot` joint (the ankle) sits `ankleHeight` above
  the sole, and the rest pose stands the soles at y = 0. WP 3.6 compares the old `footL` with the point on the sole
  under the ankle (contact height), not with the `foot` joint. Appendix C's joint table notes it.
- **Public names.** `anim.sheet()` and `anim.check()` are exported as `animSheet` and `animCheck`: sim-api takes flat
  names.
- **Build fields.** Builds hold `hipHeight` (was `hipZ`) and `headRadius` (was `headR`), since Z is no longer up, plus
  the stance and gait fields, so locomotion (WP 3.6) reads them from the entry. Four fields are new, with chosen
  defaults rather than source values (the old rig had no ankles, hands or back): `ankleHeight`, `footLength`,
  `handLength`, `chestDepth`; WP 3.8 should review them once bodies are drawn.
- **No `skeleton` registry kind** until a second skeleton exists; builds are registry kind `build`.
- Evidence: `engine/anim/fk.test.ts` (4 builds at sizes 1 and 0.5, soles at y = 0, three.js `Bone` hierarchy within
  1e-9 m).

## Amendment 2 (2026-10-10, WP-3.5)
- **`twoBone` is `ik3` verbatim, with one fix.** When the pole lies along the limb, `ik3`'s unnormalised fallback
  (n_y, -n_x, 0) shortened the bones; `twoBone` falls back to a unit horizontal instead, and to +Z for a vertical
  limb. Otherwise it matches `ik3` bit for bit (in metres, after the /16 axis swap).
- **`twoBoneRot`'s pole is a world direction**, so the old hints work as poles; it defaults to the current bend.
- **Hinges.** Knees bend about +X and elbows about -Y (left) or +Y (right) in the upper joint's frame.
- **Target.** The solve targets the end joint (the ankle), or `options.offset` in its frame. WP 3.6 can pass the
  contact socket's offset to target the sole.
- **No per-solver weight.** Solvers have no weight option; `blendPoses` fades them. A non-limb joint raises the
  existing `ANIM_UNKNOWN_JOINT`; one new code, `ANIM_BAD_TARGET`.
- Evidence: `engine/anim/ik.test.ts` (2000 random cases bit-exact against `ik3`; soles within 5 mm on a 10° slope and
  a 0.2 m step on 3 builds, worst gap 2.3e-8 m).

## Amendment 3 (2026-10-10, WP-3.6)
- **Scope of the state update.** WP 3.6 ports the gait, idle, lean, arm swing, poses, stances and knockdown (as a root
  turn) from `engine:1803` onward. The moves' arm and kick paths go to WP 6.1, and the squash, hair and cape to WP 6.2
  (secondary motion); the humanoid leaves them an `input.body` slot, matching WP 3.7's layer stack.
- **Known floor sinks.** The old leg had no ankle, so the back foot's ball sinks below the floor when kneeling (up to
  11.5 cm), crouching (5 cm), dashing (7 cm) and in guard (8 mm). They are listed with reasons in
  `engine/anim/authoring.test.ts` (KNOWN); WP 3.7's post-IK foot plant and the WP 6.6 motion QA close them.
- **No differential exceptions.** The reference vectors were recorded with no view hacks, so EXCEPTIONS is empty.
- **New code** `ANIM_UNKNOWN_POSE`, with the closest names as suggestions.
- **`LimbSide`.** The body side `'L' | 'R'` is exported as `LimbSide`, since WP 4.2 already exports a level `Side`
  (integration call).
- Evidence: `engine/anim/humanoid.test.ts` (3 builds, 14,688 points each; mean 0.70-0.78 mm, worst 1.56-2.04 cm, joints
  above the knees within 2e-6 m).

## Amendment 4 (2026-10-10, WP-3.7)
- **Public names.** The class is `Animator` and its input is `AnimatorInput`, because sim-api already exports
  `Character` (the controller's settings) and `BodyState` (a physics body). New codes: `ANIM_UNKNOWN_STATE`,
  `ANIM_BAD_STATE`, `ANIM_BAD_LAYER`.
- **Placement.** `weights.ts` holds the stack's `SLOTS`, `LAYER_SLOTS`, `AnimLayer` and `LOD` beside the weight table,
  which keeps `character.ts` under 400 lines. Actors keep the animator in a component of their own, `animator`
  (`spawnActor(w, { anim })`), so actors without one hash as before.
- **`preciseHits` posing in the sim runs the body's layers only.** Plug-in layers stay view-side until their WPs make
  their state sim data.
- **Footsteps.** A footstep is the gait setting a foot down (phase π/2 + kπ). At full stride the heroic soles hang about
  10 cm above their targets because the legs cannot reach (WP 3.6's solve).
- **The post-IK slot stays empty.** `ik.ts`'s `footPlant` measures lifts from `pose.rootPos.y`, which carries the
  pelvis offset (about 4.4 cm below `position.y` standing); a ground layer built on it held the soles 4.4 cm high.
  Proposed core change, not built: `floor?: number` in `FootPlantOptions` (default `rootPos.y`). Until then
  `authoring.test.ts`'s KNOWN floor sinks (amendment 3) stay open.
- The carried source path is `src/emberdeep/18-characters.js` at my-3d2dge@e37e4ee.
- Evidence: `engine/anim/{character,states,weights}.test.ts`.

## Amendment 5 (2026-10-11, WP-6.1)
- **The arm path lives in the humanoid (core change, accepted at review).** The humanoid's `input.body` slot
  (amendment 3) took only a move's body motion, so moves could not reach the animator, the sim's `preciseHits` posing
  or its trail. The arm path moves into `engine/anim/strike.ts`; the humanoid keeps it in `HumanoidState.arm`, steps it
  in `step` (a swing's start read from the effector stage of the state before the step, never from a pose), lays it in
  its effector stage (`poses.ts` `effectorStage`, the ready stance fading under a strike, as in my-3d2dge) and turns
  its root through a spin. A Humanoid or an Animator told `body: moveAt(...)` or `attack.body` plays the move; no
  separate move rig. WP 6.1's Owns is extended to `engine/anim/{strike,humanoid,poses,locomotion,states,weights,character}.ts`.
- **Recorded format.** `HumanoidState.arm` is part of the animator's saved, hashed state, so the eight hero replays'
  goldens were re-recorded (tests/replays/README.md); with `arm` left out the runs give their earlier goldens.
- **Bad move input.** A move told in `body` with a phase outside `MOVE_PHASES` or a non-finite share warns once
  (`ANIM_BAD_STATE`) and does not play. `Combo.load` treats a saved step outside its attacks as idle, as
  `Timeline.load` does an index out of range. New codes: `ANIM_BAD_HIT_KEY`, `ANIM_EMPTY_COMBO`, `ANIM_NOT_PRECISE`.
- Evidence: `engine/anim/{moves,strike,timeline,moves-data}.test.ts`, `fixtures/rigs/dummy/index.test.ts`.

## Amendment 6 (2026-10-11, WP-6.6)
- **Sheet cameras.** `x sheet` draws with `anim.sheet()`'s orthographic views; `SHEET_CAMERAS` (body, move,
  turntable) are presets of those views. `sheet.ts` fits every frame and view at one scale, so every camera frames
  every pose. Shardfall's back-off fixes perspective cameras, and sheets have none (PLAN.md WP 6.6 and §2 edited).
- **Rate check.** Step i at 1/60 s is compared with step 2i+1 at 1/120 s; only drift beyond the joint's own one-step
  motion counts, with a 2 cm limit.
- **Thresholds.** Pops use v1's numbers (9/16 m, ratio 2.5, floor 0.5/16, scaled by build size). A foot is in contact
  within 5 mm of the floor; slide limit 5 cm per contact. Loop closure 2 cm. Twist jump 120° while folded past 140°.
  Hinge tolerance 0.02 rad. Angle limit ±540°.
- **Coverage.** The fixture dummy is not driven: it has no skeleton. Clips go to WP 8.6, actions to WP 8.7.
- **Baselined, not fixed** (`tests/baselines/qa-anim.json`, 62 entries with reasons): the die pose's hurt and kneel
  ease twice per step toward opposite targets (faithful to v1), so they drift by step, up to 7.7 cm at half steps; the
  face-down turn (WP 6.2) sinks toe tips up to 0.30 m below the floor; v1's twist pops in axekick, overhead, throw,
  twohand and uppercut, and bulky's elbow pops in bash, overhead, throw and twohand; feet slide almost everywhere until
  a foot plant lands (amendment 4's `footPlant` proposal).
- Evidence: `engine/anim/check.test.ts`, `tools/qa/anim.test.ts`, `tools/cmd/sheet.test.ts`.

## Amendment 7 (2026-10-11, WP-8.7): actions as data, and the anim QA plays them
- **Actions are data that the reader loads.** The engine imports nothing outside engine/, so a page or tool reads
  data/anim/actions/*.json and defines them with `loadActions`, as with clip sets.
- **Channels.** Beats hand over 30 channels (motion, effector targets and weights, flip angle and axis, scale),
  snapshotted from data and eased by smoothstep over each beat.
- **Flips** pivot at 0.55 of hip height (heroRoll); only a ground flip is held on the floor, and in the air the game
  makes the arc.
- **Checks.** Each action's `check` field drives it through `actionCheck`; held or looping beats need signals. The
  unit test leaves the floor and rate checks to the anim QA's baseline. Deaths revive on finish.
- **Core change accepted:** WP 8.7's Owns extends tools/qa/anim.ts and tools/qa/anim.test.ts (WP 6.6) with the action
  subjects (`actionStates()`), with 38 entries in tests/baselines/qa-anim.json, each with its reason; it also owns
  tools/templates/action/ (PLAN.md WP 8.7 edited).
- Evidence: `engine/anim/actions.test.ts`, `tools/qa/anim.test.ts`, `node x qa anim --only action:`.

## Amendment 8 (2026-10-14, WP-6.2, after G9): the foot plant, built
- **What it is.** `footPlant` moves from engine/anim/ik.ts to engine/anim/footPlant.ts (ik.ts was at 400 lines) and
  takes `floor`: a sole's lift is measured from it, not from `pose.rootPos.y`, which a crouch or a kneel lowers. It
  keeps the heel and the toe tip, turned with the foot, on or above the ground. The `FootPlant` layer runs it last in
  the `post` slot (a layer marked `last` stays at the end of its slot, `Animator.use`), on a flat floor at the body's
  height, closing amendment 4's empty slot.
- **Where it runs.** The view's puppets (engine/gfx/puppets/actors.ts; faded out as an actor's clips show, since a
  clip plants its own feet by contact IK) and the anim QA's humanoids (tools/qa/anim.ts).
  The sim's precise-hit posing (engine/sim/actors.ts) does not: the trail it hashes stays the animation's own, the
  plant stays presentation (LOD 1 already drops the `post` slot), and no replay golden changes.
- **No stance locks.** Locks in stance (the function's `state`) fixed 30 of the QA's foot slides but broke 75 other
  entries: feet held where an action left them (35 loops no longer closed at rest), drift with the step (19), knees
  flipped and popping in deaths and flips (16). A lock needs a rule for stepping out of it; it waits for a measured
  need, and the 57 footSlide entries say so. Fading the plant as the pelvis tips over (rolls, falls) cost more floor
  fixes than it saved, so the layer is plain: it keeps no state and gives the same pose at any step.
- **What it settled.** Amendment 3's floor sinks (kneel, crouch, dash, guard, on every build) are 0 through an
  animator with the layer; 29 of the 30 underFloor entries of tests/baselines/qa-anim.json went stale and were
  removed, 11 entries tightened. Three moved, each with its reason: action:roll's footSlide (0.2418 → 0.5843: the soles
  now stand on the floor through the dip and the rise, inside the slide check), reaction:fallFront's underFloor
  (+0.1 mm) and a new rateDrift for action:techRoll (0.039 m at one frame as it rolls up from lying).
- Evidence: `engine/anim/footPlant.test.ts`, `engine/anim/authoring.test.ts`, `node x qa anim`.
