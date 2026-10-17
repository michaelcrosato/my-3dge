# ADR-0025: The owner's direction of 2026-10-17: the Playground, a character-first vertical slice

Status: accepted · 2026-10-17 · Records PLAN.md Phase 13 (WPs 13.1 to 13.26, gates G10 to G13), §1, §2, §6.2, §9.1,
§9.2, §11.2, §11.3, §13.1 and §14, and the Trigger lines of the 21 on-demand WPs the playground fires; amends ADR-0018
(amendment 4)

## Decision
1. **The playground is the next integration target.** `labs/playground/`: a house (basement, ground and upper floors,
   attic, walkable roof) on a block with a yard, a street, a gym of calibrated features, a hill, a firing range and a
   sparring ring (docs/PLAYGROUND.md). It is to Phase 13 what the Stress Box was to Phases 2 to 7: every capability the
   phase builds is shown there, and its content stays sample content (PLAN.md §5.7).
2. **The character first.** The player moves as in Apex Legends: walk, run, sprint, crouch, slide, slide-jump, air
   strafing, mantle, vault, wall-climb, the superglide, ziplines, ladders, launchers and the door kick, with Apex's
   numbers where they are known (docs/PLAYGROUND.md §3.2 cites each) and every one checked headless by `node x feel`.
   Stage 1 (G10) builds the character, its animation and its cameras in the gym, before any of the house.
3. **Five cameras, two looks.** First person, a third-person shooter camera, a third-person platformer camera,
   isometric and top-down, switched live with a blend; a cel-shaded look and a pixel-art look done properly in each. We
   compete on gameplay, features and content, where agents excel, not on graphics; the simple asset system
   (procedural, then text) is an advantage.
4. **The long aim for gameplay.** The engine grows to play like Red Dead Redemption 2, GTA V, Apex Legends and
   Cyberpunk 2077: their gameplay, not their graphics. docs/PLAYGROUND.md §11 maps the road; each later slice is its
   own ADR and phase, chosen after the owner plays this one.
5. **The playground fires the on-demand WPs it needs.** All 21 (5.6, 7.5, 7.6, 7.7, 8.8, 10.1 to 10.6, 10.8, 10.9,
   11.1 to 11.5, 12.1 to 12.3) have a need in the playground, named in their Trigger lines, and Phase 13's stages
   schedule them. Two run on the owner's order rather than a measured need: 7.6 (an agent playtester through MCP) and
   12.2 (usability tasks over the playground, and mutation testing).
6. **What the owner's full permission covers** ("I am giving you full permission to take the plan further so that it
   is fully complete"): the devDependencies WPs 7.6 and 12.2 name (`@modelcontextprotocol/sdk`; `@stryker-mutator/core`
   and `@stryker-mutator/vitest-runner`), each pinned by PLAN.md §6.10's rule with its reason in tools/deps.json; and
   WP 8.8's downloads of public sources into `.cache/`, never committed. Still the owner's, escalated when reached: the
   Quaternius GLBs (WP 8.8 does everything else without them), model access for WP 12.2's live evals (its dry run
   stands until then), money, repository settings, and binary assets other than fonts.
7. **Nothing that passes today changes.** New movement, cameras, level formats and looks are opt-in:
   `movement:platformer` is today's controller, and a format-1 level compiles to the same data and hash, so every
   existing golden holds.

## Why
The owner's direction of 2026-10-17: the foundation is proven (G0 to G9), but there was nothing to touch and feel, and
that left them stuck. A vertical slice that shows the engine's flexibility, its animation and everything a player can
do, built around a character that moves, looks and feels right, gives the owner and agents a place to decide what to
build next. Movement, cameras and animation come first because if the core character does not feel and look good,
nothing built on it matters.

The doctrine's North Star still holds: every Phase 13 WP serves a need of the playground, and the on-demand WPs start
because the playground needs them (the trigger rule of PLAN.md §9.1), not in anticipation. Apex's movement is
Titanfall 2's, whose air strafing is Quake's: the community has measured and reconstructed it in detail, so its numbers
are known and emulating it is common ground rather than invention.

## Enforced by
PLAN.md Phase 13 and the ledger (§14); docs/PLAYGROUND.md, the design and its reference values; `node x feel` (WP 13.4)
and the playground's README test (WP 13.1); the verifier at each of G10 to G13.

## Amendment 1 (2026-10-17, WP 13.1): the lab as built

- **The gym's level is TypeScript data, not a `.txt` file.** labs/playground/levels/gym.ts holds the features (each a
  number, a sign and its rectangles of tiles) and writes the format-1 text from them; the scene compiles that text and
  the page registers it, as the starter game registers its arena. So a number moves the block, its sign and its test
  together, and nothing is restated. Later levels (the house's storeys, WP 13.13) may be text files read through `?raw`.
- **Slide ramps are drawn as their collider.** A ramp glyph's mesh was a flight of stairs over the slope; a slide down
  a staircase lies about the surface the body slides on. The recipe `ramp` (engine/gfx/level/ramp.ts) draws the smooth
  wedge its hull collider is; stairs keep `stairs`.
- **Two engine fixes the playground found.** A restart (a seed, a replay, a restore) disposed every puppet and made it
  again, and r182 names a skinned mesh's bone buffer in its shader, so the new mesh built its shadow pipelines in a
  drawn frame: puppets given up now wait as spares (engine/gfx/puppets/actors.ts). And `__engine.replay` dropped the
  page's view settings, so a replay snapped the look to `look:clean`: a replay's run now keeps them
  (engine/app/headless.ts).
- **The playground stays in this repository.** A game made from the engine (tools/game/files.mjs) gets the box as its
  worked example, not the playground, whose mechanisms reach games through the engine as each WP adds them.
- **Shared README checks.** The box's README test's checks moved to tests/unit/readmeClaims.ts, which the playground's
  README test runs too.

## Amendment 2 (2026-10-17, WP 13.2): the player's body

- **`build:adult`, and a gait that plants.** The adult build stands 1.80 m on Drillis and Contini's shares of height
  for the legs and the trunk (thigh 0.44 m, shin and ankle 0.51 m, the stance hip at 0.93 m with the knees a little
  bent), its arm's two segments nearly equal (0.30 and 0.29 m, where theirs are 0.33 and 0.26), so the moves and
  grips written for the source's builds, whose segments are equal, never fold an elbow flat. The source's gait raises
  the pelvis as the feet spread, so at full stride no natural leg reaches its planted sole (ADR-0009 amendment 4's
  hanging feet). The new build field `plantedStride` (false for the source's builds, so the port's reference vectors
  and every golden stand) lowers the pelvis just enough for each planted sole to be in reach
  (engine/anim/locomotion.ts `plantedHeight`).
- **The adult's own QA ids.** The anim QA keys an accepted exception by state and metric, the worst over its builds, so
  an exception for the adult would loosen the check for every build. The adult reports under `adult/…` ids with its own
  baseline (tests/baselines/qa-anim-adult.json, each entry's reason the source builds' cause; 13 are worse, from the
  planted soles and longer feet). WP 13.10's stance locks are to tighten them.
- **Apex's hull now.** The player's capsule is Apex's (1.83 m by 0.82 m) from this WP, so the gym's gaps read as they
  will; WP 13.3's profile takes the same numbers, and the gym replay's goldens were re-recorded for it.
- **Free hands follow their forearms.** `twoBoneRot` keeps a wrist's world rotation, and nothing set it for a hand
  holding nothing, so every build's free hand pointed out sideways as at rest, whatever its forearm did (the review's
  find: the player's gloves jutted from the hips). The humanoid now straightens each free wrist (engine/anim/authoring.ts
  `relaxHand`); only the free hand's grip socket moves (the inspector snapshots, re-recorded), no golden changes.
- **The sheet draws the build it is given.** `node x sheet --build` posed the build but drew chibi's bones; it draws the
  build's own skeleton now (tools/cmd/sheet.ts `sheetFor`).
- **The sky is the ID pass's background.** The daylight sky (the playground's first look with a dome and a backdrop)
  showed that the ID pass drew them at their real size, a 100 m box and a cylinder round the camera, over whatever lay
  beyond them, though the frame draws them at the far plane; from above, the whole gym was "covered". Objects marked
  `userData.background` (the dome and the backdrop) are now left out of the ID pass, as the scene's background is, and
  listed as `background`. They also write the cleared background's zero normal into the post chain's MRT
  (engine/gfx/post/mrt.ts), so the cel look's outline no longer inks the dome's box edges across the sky.
- **The accent at 11 px, and the cel look's ink, ahead of WP 13.24.** The isometric and top-down cameras draw the
  player 11 to 15 px tall, and the cel look's 2 px black line at every crease covered its whole accent there (1 and 0
  orange pixels on the player; the pixel look kept 27 and 21). `look:playground-cel` now inks 1 px, in a dark tint of
  the surface (0.35), at sharp creases only (0.2), and the yoke grew flattened orange shoulder caps; counted only in
  its lit and middle bands (the ink's tint of it reads as brown), the accent shows at least 8 pixels in every camera
  of both looks. tests/e2e/playground.spec.ts holds it at 6 or more; WP 13.24's ink scaled to the resolution replaces
  these numbers.

## Amendment 3 (2026-10-17, WP 13.3): movement profiles and the shooter model

- **A profile is data, and the model is Apex's code, ported.** The registry kind `movement`
  (engine/physics/movement/profile.ts) sets the controller's settings (`character`) and, for the shooter model, its
  numbers (`model`, whose defaults are Apex's: model.ts); `movement:apex` and `movement:platformer` ship. The model
  ports er-apex's reconstruction of Apex's movement code (`umiiii/er-apex`: GetAccel, Decelerate, Accelerate, the
  sticky sprint, the air move, CheckJumpButton's fatigue and skip, the landing slowdown), which gives R5Reloaded's
  measured acceleration tick for tick (engine/physics/movement/ground.test.ts).
- **Every golden stands.** A character without a model is today's controller, and the model's state is a component of
  its own (`motion`), held only by actors on a model: new fields in the actor's state would have changed every hash.
  The gym replay, whose player now moves by the model, was re-recorded (Node and Chromium ×3 agree).
- **Calls where the sources are silent or disagree:**
  - The jump launches at √(2gh), the table's 1.42 m, not er-apex's half a step lower (1.36 m in R5Reloaded).
  - The lurch, which er-apex's reconstruction has none of (the Apex Movement Wiki's numbers): a new key is the move in
    its keys' frame (the camera's heading, the intent `cam`) turning by 22.5° or more in one tick, so neither a stick
    turning smoothly nor the view turning alone lurches.
  - The sprint's dip to 4.80 m/s with a side key (measured) runs linearly over the move's first 45° off the view.
  - Walking, ours (a held key), blocks the sprint, as Apex's aiming does.
  - The coyote time and the jump buffer stay (docs/PLAYGROUND.md §3.4: no press is lost); the coyote time is Apex's
    0.2 s grace, never after a jump.
  - The fall stun counts the impact speed along the floor's normal (v²/2g), as the table says.
  - The hull is the exact conversion (16 u, 72 u: 0.4064 and 1.8288 m), and `maxFall` Source's 3,500 u/s, so a 20 m
    fall reaches the full stun.
  - With no view (the screen-relative cameras), the sprint's 45° is measured from the move, so it sprints in every
    direction; a `look` intent gives the view, an `aim` or a `look` what it faces, turning at 720°/s (ours).
  - The motion state starts holstered: the playground's player is empty-handed, so it runs 5.07 and sprints 7.59 m/s.
    `spawnActor({ holstered: false })` arms one, and `__engine.feel()` measures an actor as it is.
  - er-apex's side and back speed scales are model fields too (`gaits.side`, `gaits.back`), 1 as in Apex.
  - A character with a model stepped without its motion state is an error (`PHYSICS_BAD_ARGUMENT`), never the
    platformer's steering in its place.
  - The table's "about 0.87 s" from the run to the sprint is 0.83 s: Apex's run band overshoots the run by a tick
    (R5Reloaded's trial); docs/PLAYGROUND.md says so now.
- **The keys, ahead of WP 13.9.** createEngine takes an `actionMap`, and the playground binds `actionMap:playground`
  (labs/playground/controls.ts): Shift sprints, Left Alt walks, C crouches while held. Not Apex's Left Ctrl: Ctrl with
  W closes the browser's tab, and no page can stop it (WP 13.3's review). WP 13.9 adds the rest of §3.3's
  table, the crouch's toggle as a setting, and rebinding. The page sends no `look` yet, so the sprint has no view
  there and runs in every direction; WP 13.8's aiming cameras (first person, the shooter's) send it.
- **The port's license.** er-apex is MIT (© 2026 umi): its notice is engine/physics/movement/NOTICE, and lean/LICENSE
  carries it, as the bundle carries the model.
- **The feel course moved** to engine/sim/feelCourse.ts (engine/sim/actors.ts was at its 400 lines) and measures the
  model (`FeelReport.motion`), which `node x sim <scene> --feel` prints.

## Amendment 4 (2026-10-17, WP 13.4): the feel kit

- **A course is a replay with numbers.** The registry kind `course` (engine/dev/feel/course.ts) holds a scene, its
  settings, seed and change-point inputs, as a replay does, and the measures to read off the run, each against its
  reference and tolerance; `runCourse` (run.ts) plays it in a session of its own, so its hash is the replay's and
  measuring never changes it (the animation is posed as the page poses it, the cameras stepped as the page steps them,
  both presentation). `node x feel <lab>` (tools/cmd/feel.ts) runs a lab's courses into `out/feel/<lab>-<name>/`.
- **Courses start where they measure** through a scene's dev action, the gym's `place` over the engine's new
  `placeActor` (an actor at rest, its motion state started again), so a course stays a replay; each camera measure
  steps its own camera from its first frame, so the placing is never counted as the camera's jump.
- **Bounds not yet met are watched, never loosened.** A measure that `watch`es names the WP that will make it pass:
  its number is reported against the bound, as a warning, and never fails its course. The feet are watched until WP
  13.10: the procedural run holds a stance foot within 3 cm mid-stance but slides it at the touchdown and the lift-off,
  0.36 m a contact at a 5 m/s run and 0.53 to 0.73 m sprinting. Everything else passes from the first run: §3.2's
  numbers (the holstered run 5.07 m/s and sprint 7.59, 1.42 m jumps, the tired 0.43 m, the lurch's 4.6 m/s, the
  strafe's 0.20 m/s, the hop back to 7.59), no pop, and every camera's bounds (at most 7 cm a frame against §4's 30 cm,
  no turn, never inside, never losing the player).
- **The courses' references, holstered.** The playground's player is empty-handed, so each reference is §3.2's
  holstered value or follows from its rules: the run to 90% in 0.13 s as armed (speeds and accelerations both scale by
  1.15); a steady run to the sprint in 0.865 s (2.54 m/s² × 1.15; §3.2's 0.83 s is from rest); the stop in 0.24 s
  (31.75 m/s² does not scale); the walk 2.53 m/s and the crouch-walk 2.34 (×1.15).
- **One set of motion rules.** The anim QA's `Track`, `pops` and `footSlide` moved from tools/qa/anim/metrics.ts to
  engine/anim/motionMetrics.ts (re-exported there), with `worstPop` and `worstSlide`, their values of any size, so the
  feel kit and the QA read motion alike.
- **Live tuning is settings.** Every number of the shooter model has a setting, `movement.<group>.<field>`
  (engine/physics/movement/settings.ts), live: off its default it replaces that number for every character on the
  model from the next step, at its default it leaves each character's own. Settings are hashed and replayed, so a
  tuned run is a replay; the actor's character is never changed.
- **The panel is the page's.** engine/dev/feel/panel.ts draws a slider for each number under `movement.` and `cam.`
  (WP 13.8 declares the cameras'), reading `__engine.tune.settings()` and writing through `__engine.set`; Copy as
  profile is `__engine.tune.profile()` (a `defineMovement` call of the numbers off Apex's, and the camera settings
  that differ as a preset), Save the replay `__engine.input.record()`. The playground opens it on F or
  `?playground.feel=on` (labs/playground/feel.ts). The members are `tune.*`: `feel` is a member already, and a name is
  a member or a namespace, never both.
- **First person has no `lost` check yet:** its body is culled but the hands, and the chest sits below its view; the
  check waits for WP 13.12's arms.
- **The character's body** (addCharacter, feetOf and the new bodyAt) moved to engine/physics/characterBody.ts,
  re-exported by engine/physics/character.ts, which was at its 400 lines.

## Amendment 5 (2026-10-17, WP 13.5): crouch and slide

- **The duck and the slide are er-apex's.** engine/physics/movement/crouch.ts ports `update_duck`, `try_start_slide`,
  `end_slide` and `slope_gravity`, and ground.ts, steer.ts and air.ts their parts of WalkMove, Decelerate, the jump and
  the landing (`umiiii/er-apex`, MIT): the duck counted in whole milliseconds, 16 a tick, so a 0.4 s duck shrinks the
  hull 25 ticks after the press and crouch spam never finishes one; standing up waits for headroom; a toggled crouch
  (`crouchToggle`, pressed) stands up for a jump or a sprint press; a slide boosts at its start (+3.81 × the move
  scale, capped at 10.16 ×), only 2 s after the last slide's start, brakes at 2.54 m/s² (10.16 let go or pushed
  against) then decays × 0.7 a second, steers only sideways, gains g · n_y along the floor in two halves, loses 10 m/s
  a metre climbed, ends below 3.18 m/s into a crouch, and slides on with crouch let go above 8.89 m/s. Its jump goes
  1.27 m, gives back a boost jumped while the slide's crouch still goes down (a dead slide) and leaves a boosted slide
  slowing through 7.56 to 8.89 m/s at 8.89 (the long jump); a landing ducked at speed slides. Ours: a slide without a
  boost has none for a dead slide to take back (er-apex keeps the last boost's). The model's numbers are new
  `crouch` and `slide` groups of MODEL_FIELDS, each a live setting but the one switch, `crouch.jump`, a profile's.
- **The hull is the capsule's own.** A crouch resizes the body's capsule with Rapier's `setHalfHeight`
  (engine/physics/hull.ts), the feet kept on the ground and the centre in the air (the feet tucked 0.32 m), once
  `stepCharacter` has the model's stance, before the move and after it (a landing's slide); `feetOf`, the controller's
  legs and the ground probe read the half height the capsule has, and the standing one reads back exactly
  (`halfHeightOf`), so a character that never crouches moves, hashes and replays as before: every golden outside the
  playground holds. Headroom is a capsule a tenth of the skin wider overlapping nothing the controller collides with.
  Rapier's snapshot keeps the shape, so captures restore the hull.
- **Two controller options for the shooter model, opt-in.** A sprint or a slide at a step stopped dead: the climb's
  reach was measured from the tick's start, and a fast move met the step before getting its round bottom over the
  edge, so the wall clipped all its speed. A slide over a ramp's crest flew off it: a leg down that nothing stopped
  ended within Rapier's skin of the floor, which Rapier calls grounded, so no snap followed and the character counted
  as airborne. `stepFrom: 'contact'` measures the reach from where the step stopped the move, and `stayOnGround`
  snaps after such a leg (Source's StayOnGround); `movement:apex` sets both. Both are absent from every other
  character: made everyone's, the snap alone moved three goldens (box-5-fight, box-5-precise, steps).
- **The crawl fits the hull.** docs/PLAYGROUND.md's tunnel (1.0 m) and bar (1.2 m) were lower than Apex's crouched
  hull, 1.19 m: the tunnel is 1.4 m clear and the bar 1.3 m up, and the house's crawlspace 1.4 m. A format-1 level
  has no overhangs, so the tunnel's roof slab and the bar are fixed props on glyph walls and posts until WP 13.13.
- **References stepped as a tick.** §3.2's slide rules are Apex's per tick, so the courses' references step them at
  60 Hz in a tick's order (half the pull, the friction then the decay, half the pull) over the features' geometry,
  restating only §3.2's numbers; the continuous slide's ends come 1 to 2 ticks early over 2 to 3 s. The runs come
  within a tick or 1% of a speed. The feel kit gained what the courses needed: `place` takes a speed; a sample
  carries the stance and the slide, and `time` ends on `crouched`, `standing`, `sliding` or `stopsSliding`; bounds
  cover a labelled run and watch one camera by name; and a course's change-points out of step order are refused (they
  were skipped without a word).
- **Watched until WP 13.8:** in the crawl the shooter's camera (the chase camera for now) stands in the tunnel's roof
  (208 frames inside, 224 without the player, a 5.7 m jump) and snaps in by 5 m under the bar; the other four keep
  every bound.
- **Left to the view's WPs:** the crouched eye and pose (WP 13.8's effects, WP 13.10's poses): the first-person eye
  sits at the rig's eye socket, which crouches with WP 13.10's crouch pose; the motion state carries the duck, its
  milliseconds left and their total for the view's crouch share. The toggle's binding is WP 13.9's.
