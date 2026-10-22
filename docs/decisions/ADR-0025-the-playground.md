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

## Amendment 6 (2026-10-17, WP 13.6): the mantle, the wall-climb and the superglide

- **Two mantle reaches.** Apex's 80 u (2.03 m) is the auto mantle's, holding jump on the ground. From the air it
  mantles ledges up to 2.49 m over the feet: no source states it, but Apex's highest ledge, 273 u, less the climb's
  147 u cutoff and 28 u end boost leaves 98 u, and the wiki's mantles of 97 u with the gun out and 106 u crouched need
  more than 80. So the 2.1 m mantle wall is refused from the ground (the press jumps) and taken from the jump a tick
  later, and the 6.9 m climb wall is reached only by the end boost of a climb that caught 1.19 m or more up.
- **Ledges by casts, the path through nothing.** engine/physics/ledge.ts finds the wall by a cast of the hull, the lip
  and the landing by rays, and casts the hull, standing else crouched, along the mantle's path: across to the wall, up
  until the feet clear the lip by two skins, across over the landing, down onto it. The mantle then moves the feet
  straight along that path (`Steering.path`, no controller), each phase from where the last left the feet, so a
  restored state goes on alike. A top narrower than the hull's landing (a radius and two skins in) is no ledge: the
  gym's fences are half a metre thick; a thin picket fence's vault is WP 13.15's, if its fence needs one.
- **Times, not speeds.** The grab takes 0.45 s and the pull 0.3 s whatever the height, as §3.2 gives them; a ledge up
  to 42 u (1.07 m) over the feet is only pulled. Each phase ends at the start of the tick after its last, so a course
  sees 27 ticks of grab and 18 of pull, and the tick that steps off onto the top is a ground tick. The hang holds the
  grab where it is (the lip 1.52 m or more over the ground below), forward going on, back or crouch letting go; a
  jump in any phase hops out at full height, arming no fatigue, forward over the ledge out of the pull.
- **The superglide is a hop then a glide.** A jump in the pull's last 9 ticks hops out; a crouch press the very next
  tick turns the hop into the glide, 1.8 × the speed it mantled at (13.67 m/s from a holstered sprint, Apex's 540 u/s
  within 0.3%), rising the slide-jump's 1.27 m (ours), starting the slide boost's cooldown, and within that cooldown
  less the slide's boost (ours). The mantle boost is a crouch press alone in the window, a full jump's rise, the
  lurch off until it lands. Its switch is a setting, `movement.mantle.boost`: the model's switches are settings now
  (amendment 5 left `crouch.jump` a profile's); the feel panel's sliders still take only the numbers.
- **The climb.** It catches a wall touched (four skins) in the air with the push and the view within 45.57°, climbs at
  up to 5.72 m/s reached at 30 m/s² (ours), with no gravity, stops at the catch + 2.54 m or the climb space's foot +
  3.73 m (the tick reaching it stops there, so the end boost's apex is exactly 4.44 m), then the end boost; across,
  2.92 m/s by the push along the wall, what it carried in kept up to 6.55 m/s. The climb space's foot is the last
  ground's height, dragged down by a fall below it, lowered 3.25 m by letting go and 6.5 m by a jump above the mini
  zone; a new catch must be below the last unless the wall turned 25.84°. The wall-bounce's green-zone lift is ours: a
  full jump at the zone's foot to none at its top (the wiki says only that it falls with the height); higher up a jump
  keeps the climb's rise (the wall push). §3.2's wall-bounce row said the zones stood "above where it caught": they
  stand above the climb space's foot, and the row says so.
- **The 0.5 m mantle wall is a step.** `movement:apex` steps 22 u (0.56 m), so it runs up the 0.5 m wall; the course
  checks that it stands on its top without a mantle. The mantle walls start at 1 m for Apex.
- **The feel kit gained** `duration` (how long a state lasts from its first sample), `topRise` and `standHeight`
  metrics, a sample's mode and mantle phase, and `until` states for the mantle's phases and the climb; the courses
  `mantle`, `fences`, `climb`, `hang`, `superglide` and `mantle-boost` (its setting on) pass, and
  tests/replays/playground-climb.replay.json (a superglide, the 6.9 m climb, a hang, a green-zone bounce) holds one
  golden in Node and Chromium.
- **Watched until WP 13.8:** topping out the 4, 5 and 6 m climb walls the shooter's camera jumps 1.1 to 1.2 m in a
  frame (its collision); the other cameras keep every bound. A placed player spends the tick it is placed airborne
  (`placeActor` resets its state), so a course places it clear of walls it means to catch.
- **The verifier's review** found two bugs, fixed with tests that fail without them: a mantle hop from the wall with
  forward held was caught again at once by the climb, which topped out into a new mantle (no climb now within the
  mantle's cooldown, and a catch that tops out at once mantles); and the ledge's casts left the path's last leg, down
  onto the landing, unswept, so the hull could pass through a cap over a thin wall (every leg is swept now). Its notes,
  done: the reattach rule's dot clamped (a chimney's far wall read as no turn), no catch on a push too weak to climb on
  (it let go on the same tick, lowering the space), the tick that steps off onto the top a ground move for the
  controller too (its step and its floor's carry). Its notes, left as they are: the casts meet the world and the
  props, so a one-way platform counts as solid and another character is not seen, and the path is checked once as
  the mantle starts (WP 13.7's lifts and G12's crowds are where these matter); the checked hull stands 5 mm above the
  moving one, within its two skins of clearance.
- **Left to the view's WPs:** the motion state holds the contacts as plain data (the lip, the wall's normal, the rise
  column, the landing, the phase and its ticks; `handsOf` puts the hands on the lip a shoulder apart): WP 13.11 plays
  the grab, the pull and the hang on them; WP 13.8 frames them.

## Amendment 7 (2026-10-19, WP 13.7): ziplines, ladders, launchers and the balloon

- **Rides are world data the sim hands the model.** The physics may import only the core and Rapier, so the model
  cannot read the world's entities: it defines what it asks (engine/physics/movement/ride.ts's `Rides`: cables,
  ladders and launchers as plain data), the sim answers from the scene's entities (engine/sim/rides.ts: the components
  `zipline`, `ladder` and `launcher`, hashed and captured; `addZipline`, `addLadder`, `addLauncher`,
  `addLevelLadders`, `ridesOf`), whose specs and checks are engine/world/traverse.ts's, and the stage draws the
  components (engine/gfx/stageRides.ts). The model gains the modes `zipline`, `ladder` and `skydive` and their state
  (`ride`, `rideAt`, `rideDir`, `rideSpeed`, `rideAccel`, `rideEnd`, `catches`, `rideCool`, `landing`), and the groups
  `zipline`, `skydive` and `ladder`; its input the look's pitch and the `interact` button's press (`usePressed`).
- **A ladder is a glyph or `addLadder`, not a prop entry.** A prop stands by a yaw alone; a ladder needs its face, its
  top and the wall's normal. The glyph field `ladder` (the engine's `|`) stands one on each run of its tiles along a
  face, against the neighbour standing highest; anywhere else `addLadder` places one, drawn by the stage. The field
  changed the compiled level's shape: the fixtures' and the hall's compiled hashes were re-recorded, and with `ladder`
  left out of their glyphs each gives its old hash.
- **Calls where §3.2 is silent (ours):** the hands 2.03 m over the feet on a cable; use's reach 1.52 m from the hands
  and the air's unasked catch 0.61 m; a ride ends 0.61 m short of each anchor, or where a cast of the hull along the
  line, made as it catches, meets something; the way along a cable is the view's (its pitch too), else the velocity's,
  else down a sloped line and up a vertical one (within 10° of straight up); catching stands the hull up; a catch from
  the air speeds up at the jump-on's 25.4 m/s² for the whole ride; the catches count resets on the ground; no catch or
  ladder within 0.25 s of letting go of either. The WP's "a jump keeps the speed" and §3.2's "off at up to 11.3 m/s"
  meet thus: a jump off goes up a full jump with 10.16 m/s added along the view across the ground, capped at 11.3 m/s
  or at the ride's own speed across, whichever is higher. At an end a ride lets go keeping half its speed; a vertical
  line's top hops it 1 m up and on along the view at the run's speed; a balloon's throws it up at 15.24 m/s into the
  skydive.
- **The skydive (ours, from §3.2's two numbers):** the view's pitch sets the fall from 20 m/s (level or up) to 35 m/s
  (straight down), reached under gravity and braked at 21 m/s² when faster; the push steers it across at up to 12 m/s
  (8 m/s²); the landing pose takes over from the tick whose move ends within 30 m of the ground below, slows the fall
  to 6.1 m/s (21 m/s² brings a 35 m/s dive there with a tick to spare: 20 did not) and lands with no stun.
- **Ladders (ours, tuned):** taken hold of standing, running into one within 45° and 0.3 m of its face or with use,
  or from its top with use, the feet 1 m down; climbed at 2.20 m/s, the hull 0.1 m off the face, moved straight; over
  the top by the mantle's pull alone, once the lip stands within the pull's 1.07 m (the climb stops there); at the
  foot it steps off; a jump goes 3.05 m/s away rising 0.5 m; crouch lets go.
- **Launchers set off any character,** on the model or not, without a field in the character's state (it would have
  changed every golden): its feet in the launcher's volume, not rising. The speed up is the one that leaves the
  launcher's top at its own (or `bounce` times the speed it falls onto the top at), whatever height in the volume
  caught it, so a pad's and a trampoline's heights hold to the millimetre. A `solid` one stands on a fixed box from the
  ground: the trampoline's frame. The event `launch` `{ id }` tells the view and the sound.
- **Pole feet are given, not found.** Rapier's queries see bodies only from the first step on, so a ray in `setup`
  missed the tower the scene had just stood: a zipline's spec names where its poles stand (`feet`, the ground by
  default).
- **The gym** (docs/PLAYGROUND.md §2.3): the tower's ladder up its north face, its 40 m zipline from a pole on its top
  to the south wall, the trampoline against its west face (so a jump off the top measures the bounce: a walk off the
  edge rolls the capsule 17 cm down the corner first), the jump pad in the open, and the redeploy balloon 90 m up
  (the hill's stands at 60 m: the gym's leaves room for a glide and a dive before the landing pose).
- **The feel kit gained** the states `riding`, `onLadder`, `skydiving` and `landingPose`, the metrics `top`,
  `heightAt`, `topFall`, `rideSpeed`, `rideGain` and `catches`, and a sample's ride speed, catches and landing pose;
  the courses `zipline`, `ladder`, `launcher` and `skydive` pass, and tests/replays/playground-rides.replay.json (the
  ladder and over the top, the zipline down, the pad, the balloon and its skydive) holds one golden in Node and
  Chromium. The playground's three other replays were re-recorded (the motion state grew; the gym's rides are
  entities); the other 22 goldens hold. A whole-number field of the model is a setting too (`movement.zipline.catches`).
- **Watched until WP 13.8:** in the zipline course the shooter's camera snaps in by the tower's pole (4.9 m) and, after
  the 20 m fall from the balloon's line, every camera catches up with the stop 0.33 to 0.36 m a frame; in the skydive
  every camera keeps its bounds.
- **For the owner's playtest:** a ride down to the far pulley lets go at half its speed and bumps the pole; whether a
  ride should end in a dismount, and the tuned numbers above, are the playtest's to say.
- **engine/physics/carry.ts:** the kinematic floor's carry moved out of engine/physics/character.ts, at its 400 lines.

## Amendment 8 (2026-10-19, WP 13.8): the camera modes

- **A rig between the view and its camera** (engine/gfx/cameras/rig.ts, beyond the WP's list: the view and the feel
  kit's camera metrics both step it, so the page and the numbers see one picture): the camera a code names, the one
  before it still stepped while a switch blends, the view effects with each camera's share, and the view settings
  `cam.fov` (Apex's horizontal degrees at 4:3, 90: first person's and the shooter's lens, so the box's first person is
  73.7° now, not 75°), `cam.blend` (0.35 s), `cam.effects` and `cam.wholeZoom` (the playground's page sets it: the
  classic views zoom 1, 2, 3, 4).
- **Live switches blend; others cut.** A blend's first frame is the old camera's picture, so an agent's set-then-shot
  would show the old camera: `camera.set(code)` cuts and `camera.set(code, { blend: true })` blends, as T, X and a
  view's turn do; a replay's view changes take `blend` too.
- **Blends** (blend.ts) go about the target: the target on a straight line, the heading the short way, pitch, roll,
  distance, lens, zoom, boost and planes in step, a smoothstep over the time. An orthographic pose blends as the
  perspective one with a 20° lens framing its picture at its target, so the projections swap where the pictures
  agree; two orthographic poses blend orthographic. The feel kit's camera metrics allow a blend's own move and turn,
  and the look's turn, read off the sim's look intents, for the cameras that look along it (`LOOK_CAMERAS`: first
  person and the shooter), so a cut between two views counts whatever the look (the review found the overhead view,
  heading north, taking the look's allowance); the look's swing is allowed at the camera's new distance, stricter
  when the arm pulls in.
- **The shooter** (shoulder.ts): §4's 0.5 m right, 0.3 m up and 3.8 m back from the eye, lagged 0.05 s and never
  0.5 m behind, looking along the aim. X swaps by the code (`cam3=shoulder,…,-1`, blended; on another camera it does
  nothing); a swap input eases in the camera over 0.12 s. The sights pull the arm in to 1.5 m by the effects' share (the aim button is WP 13.9's: the view
  reads `aim` from the step's held buttons). Under 1.2 m of room behind the eye draws the shoulder point in, across by
  the share and up by its square, so a camera backed against a wall still sees him.
- **The platformer** (follow.ts): §4's arm, pitch, recentring, look-ahead and dead zone, and ours: recentring eased
  over 0.6 s and at most 1.5 rad/s; the look-ahead full at 5 m/s, eased over 0.5 s; the dead zone's ground settling
  in 0.3 s; the lift (an arm cut 0.25 m short by a slope or a wall tilts the camera down at 1.5 rad/s, up to 50°, and
  back at 0.6 rad/s once clear); a 60° lens.
- **Collision at a pace** (collide.ts), reworked after the review. The chase keeps WP 3.9's spring arm; the shooter
  and the platformer move their camera on as a ball: carried with the arm (the base's move and the look's turns, not
  a camera's own recentring or lift, which go at its pace), then toward the arm's end where the ball fits there and a
  sweep from the arm's base meets no floor or ceiling on the way (else as far as that sweep clears), in at up to
  10 m/s and out eased over 0.3 s, no faster, each leg slid along the walls and stopped where the base would lose
  sight of it, with 0.2 m to spare when it had that (a floor or a ceiling grazing that room aside, so a look tipped up
  over open floor brings the camera down to the clear point); a camera already out of the base's sight (over a wall's
  top) goes down only to where it sees the base again, so it never ends behind the wall. A second stuck over a metre off, it homes to the clear point at that pace, level first, never through a
  wall. Two cuts are left: carried over 2 m in a frame (the player put elsewhere), it goes with him; found inside a
  wall (the level moved into it), it goes to the clear point. The arm's base follows by sliding, no further a frame
  than the player moved plus 10 m/s. §4's 0.3 m bound rules the spring arm out: on the courses it snapped 0.7 m
  dropping off the hang's wall, 3.3 m at the tunnel's mouth, 3.2 m at the ladder's top, 10 to 13 m stuck on the ramps.
  The first build's "never jumps" held only on the courses: the review's fuzz (80 random 3 s runs a seed anywhere in
  the gym, the look within ±0.8 rad, up to 3 rad/s) found 1.3 to 11.3 m jumps and a camera outside the perimeter
  wall, and the look held 1.2 rad up sent the arm's end under the floor. Over four seeds now: 0.26 m at worst for the
  shooter, 0.28 m for the platformer, 2.1°, never inside, and (after the second review) no frame behind a perimeter
  wall. The shooter still loses the player's chest in 4 to 5% of those frames, most with a wall within 1.5 m behind
  the eye (the arm pulled in to his head, the chest under the lens) or the camera held over a wall's top (a fall from
  beside a wall: about a second, until the stuck rule homes it), the platformer in 0.2 to 1.6%: every course keeps
  "never lost" (camera-walls' jump by the wall until the landing), and the rest is the playtest's (docs/PROGRESS.md).
- **The occluder fade hides** (cutaway.ts): with a camera that may stand behind a wall (the shooter's, the
  platformer's), the block pieces and the rides that a line from it to the player's head or chest crosses leave the
  picture until the line clears, a ride by its own meshes 0.25 m thick or more (`FADE_THIN`: a pad, a platform; a
  cable, a pole or a rung hides nothing and stays, so the line a player rides never goes); cut pieces stay cut; parts
  drawn as one mesh (ramps, floors) and props (instanced batches, with no hiding per instance yet) are not faded. The
  rides were never drawn in a run view before the review (WP 13.7's: the stage drew only the kinds a scene places);
  the stage now draws the ride kinds a game declares too (stage.ts). Hidden rather than see-through: a translucent twin of every
  look's materials would add materials and pipelines. A partial fade, and the props, are the playtest's to ask for.
- **Effects** (effects.ts): Apex's eye heights (1.524 and 0.8128 m, the duck's share between) are the cameras' until
  the sim needs the eye (WP 13.9's aim): in the model's profile now they would re-record every playground golden for
  numbers the sim never reads. Ours where §4 gives none: the punch's spring at 2.5 Hz and 0.6 damping, a landing 0.4°
  per m/s over 3 m/s up to 5°, a jump 1°, a grab 1.5°; the bob 1.2 cm down and 0.6 cm across at 5 m/s; the sights
  55° at a 70° lens in 0.25 s; screen shake 4 mm per m/s of a landing over 10 m/s. First person takes them all, the
  shooter its lens, the sights and half the roll and punch, the platformer 0.3 of the punch, the views none; the
  shake goes by the punch's share (the rig's `shake()`), and a weapon's kick is WP 13.20's, through the rig's `kick`.
- **The overhead view** is a classic view: straight down, north up (never turned), orthographic, in whole zoom steps,
  its target on its pixel grid (1/(24 × zoom) m). Views never trail the followed point more than 2 m once within it,
  nor first person's eye 0.2 m, so a 20 m fall's stop is never overshot.
- **A game's own camera:** the registry kind `camera` (`defineCamera(name, { create })`, its code `cam3=<name>[,…]`)
  and `followCamera(type, state, steps, { effects, fade })`; the factories are public (engine/gfx/cameras/api.ts,
  re-exported whole by engine/index.ts at its line cap). A `create` that returns no camera is refused at once
  (`GFX_BAD_GAME_CAMERA`). Q and E, the isometric view's turns, are WP 13.9's, with its action maps.
- **The courses:** the playground's modes are the rigs (`cam3=shoulder`, `cam3=first`, `cam3=follow`, `cam=iso`,
  `cam=overhead`); every course keeps every camera's bounds, the watches of amendments 5 to 7 lifted. The launcher's
  drop and the ladder's climb down look down: the shooter's view is the aim, and looking level off the tower no camera
  behind the player sees him below. The soak course `cameras` blends through the five modes twice round a square by
  the north wall: 0.08 m and 1.3° at worst, never inside, never lost outside first person, the lost spans measured
  by cameras started a second after each first person (one that goes the whole way loses him for 3 frames of each
  blend out of the eyes, which starts from a picture with no body in it). The course `camera-walls` holds the shooter
  and the platformer to the four bounds where they meet the level: the look tilted ±1.2 rad on open floor by the
  spawn, a sprint and a jump along the east perimeter wall, a run past the climb walls' edges, and a jump two metres
  from that wall with the camera over its top (never lost until the landing).

## Amendment 9 (2026-10-19, WP 13.9): controls for every camera

- **A map per camera mode** (labs/playground/controls.ts): `createEngine({ actionMap })` also takes a function from
  the camera's code to its map, and the engine swaps the input's map (`input.use`) at the frame after a switch. Each
  map keeps its own bindings (a rebind in one mode stays in that mode, saved under that map's id); the playtest may ask
  for one shared set.
- **View actions** (an action map's `view`): the camera's switch, the shoulder and isometric's turns are bound and
  rebound like any action but never sent to the sim: the page hears each press as it happens (`onView`), every press,
  so none is lost between two frames. P, F and M stay the page's own keys, reserved in every map.
- **Aiming** (engine/input/aim.ts): a map's `aimWith` names the rule. The page works the point out each frame from the
  camera it drew (the view's `aim`) and records it with the step's intents; the sim reads only the point, so live
  play replays without a camera. `centre`: the screen centre's ray through the sim's read-only queries, the player's
  own body skipped and nothing between the camera and his eye counted, out to 100 m; `pointer`: the free pointer's ray
  onto the plane of his feet, or a pushed right stick 5 m along the floor from him, the picture's up as up (twin
  sticks), the stick ahead of the pointer. The eye heights stay the cameras' (amendment 8): the sim needs no eye.
- **The look settings** (engine/input/look.ts), Apex's units: 0.022° a count times `input.sensitivity` (5: 0.11° a
  count), times `input.adsSensitivity` with the sights up (the map's `aim` held); the right stick turns each camera at
  its own rate times `input.stickSensitivity`; each inverts by a setting. They replace `createInput`'s `lookSpeed` and
  `invertY`, which no game passed. View settings, never hashed.
- **Sprint and crouch, hold or toggle**: the recorded settings `input.sprint` (`toggle` by default, Apex's sticky
  sprint; `hold`, only while held) and `input.crouch` (`hold` by default; `toggle`, a press crouches until pressed
  again), read by the actors for players only, so the AI keeps Apex's. Recorded, because the same presses move the
  player differently; the defaults change no golden.
- **Pointer lock**: a click takes it in the maps that look with the mouse (`lock`: first person, the shooter, the
  platformer); pause and a map without it give it back; isometric and top-down keep the cursor to aim.
- **Isometric's keys**: Q and E turn the view by 90°, blended, so its Use moves to G; the d-pad's right turns it on a
  pad, the d-pad's left swaps the shooter's shoulder, so the d-pad no longer moves.
- **Deferred**: the pad's reload and holster (Apex's X and Y held) wait for a held binding with WP 13.19 and 13.20.

## Amendment 10 (2026-10-19, WP 13.10): locomotion animation

- **The planted stride, not the library's blend sets yet** (engine/anim/locomotion/planted.ts): the player walks, runs,
  sprints and crouch-walks on the procedural humanoid's gait, planted: a foot stands its duty (0.62 of its cycle
  walking, 0.3 running, 0.24 sprinting, so a run has its flight), travelling back exactly as far as the body goes
  meanwhile, and swings on a half cosine; its touchdowns stay at the phase the sim hashes. Measured first: the library's
  loops were captured at 0.7 to 1.9 m/s (100STYLE's) against the playground's 2.3 to 7.6, past what a stride warp holds,
  and format 1 carries no contacts until WP 8.8 re-imports them. The blend sets wait for a measured need (the owner's
  playtest) and those contacts; the stride is matched to the speed by construction, the legs follow the movement and the
  chest the facing, with no hip turn yet (a strafe steps sideways, its crossing foot passing ahead).
- **The visual review's changes** (the movement states' sheets, three rounds): the steps were short and quick and the
  arms swung with the legs on their side, so the adult's stride grows from 0.42 to 0.5 m and a planted sprint's share
  past 1 to 1.25 (locomotion.ts `strideShare`), a planted build's arms swing against its legs (the source builds keep
  the source rig's swing, pinned by their reference vectors) and a sprint leans further forward. The crouch-walk lunged
  at each double support: a planted stride is 30% shorter crouched (`GAIT.crouchStride`), at a quicker cadence (0.58 m
  steps at 240 a minute), which the sim's phase needs to know, so the sim tells an actor's animator its movement model's
  duck as the pose `crouch` (engine/sim/actors.ts). Both move the hashed phase: the four playground replays were
  re-recorded, their runs unchanged (tests/replays/README.md). The walk back lunged as it started: the humanoid eases
  its movement components toward the velocity, so a reversal shrank the first step to half; a planted stride steps along
  their unit vector once they are half long (planted.ts `plantedMove`). The push-off bent the ankle 44° with the toes
  flipped up: a planted foot on its feet now rolls on its ball as the heel lifts and on its heel as the toes rise, in
  the leg's solve (authoring.ts `solveLeg`) and the plant alike, its toes flat, its ankle allowed 15° up and in a stride
  a quarter of the knee's bend more, 25° at most (`ankleLimit`: a bent knee frees the calf, so a standing foot stays as
  it stood), and the pelvis rides as high as a trailing foot reaches with its heel lifted (`plantedHeight`), a lifted
  foot holding it as far as the solve plants it: it dropped 12 cm in a tick at each touchdown, and now eases in and out.
  The third round: a swinging toe dragged on the floor in every gait and a run never flew (the swing lifted on a half
  sine, so a trailing foot stayed on its ball and its knee straightened after toe-off). A planted swing now lifts early
  (`PLANTED.kick`, its top at 0.38 of the swing) with its knee bent at least as far as the gait's heel kick (55°
  walking, 90° running, 110° sprinting, `plantedKnee`), its foot as level as the ankle allows and its toes aimed 1.5 cm
  over the floor (the ankle bending up to 30° further, authoring.ts `clearToes`), a crouched swing twice as high
  (`GAIT.crouchLift`): every gait's toes clear the floor (0.9 cm the least, walking back), a run flies 41% of its frames and a sprint 51%. A run's pelvis
  sank lowest at its toe-off, the source's bob: a planted run's rides 10 cm low through each stance and rises 7.5 cm
  into its flight (`plantedBob`). A strafe spread its legs 0.62 m and its pelvis sank 16 cm: a planted stride's steps
  are 35% shorter straight sideways (`GAIT.sideStride`), which moves the hashed phase, so the four playground replays
  were re-recorded again. The slide's left hand went through the floor: its wrist rides 19 cm up. The fall's feet
  hovered after the landing: a stance foot whose heel the dip lifts past 10° stands on its ball (`FOOT_PLANT.heelUp`).
  The fourth round: the crouch-walk's stop set a foot a few ticks into its swing back down 15 cm ahead, its stance
  lengthening as the body slowed; a crouched stride keeps the walk's stance share at any pace (`plantedDuty`'s
  `crouch`).
- **Stance locks, with the rule ADR-0009 amendment 8 asked for** (locomotion/locks.ts): only a `plantedStride` build
  locks (its `stance()`), and only on its feet (`onFeet`: not lying, climbing, striking, flying or early in a dash; a
  kneel keeps its feet). A foot locks where it lands, keeping its heading (a turn about the vertical), and lets go over
  0.05 s when its stance ends, lifting as its animation lifts it and taking its roll at once (the two rolls agree); at
  once when an action takes the feet or lifts a sole over 2 cm (on its feet, its ball: a heel lifting off it leaves the
  foot down), but for a toe-off in a stride on the level it locked on (a body speeding away had left the lock 17 cm
  ahead of its animation, and it snapped); a sole kept on the floor holds up to 0.1 s past its stance (the push-off, the
  touchdown), on the level it locked on. Standing or slowing below a step's pace, a foot astray steps back under the
  body, one at a time: at once past 12 cm (a stop, a turn in place), past 1.5 cm once its animation has held still
  0.05 s (the feet back to rest after an action). A held sole stays on the ground under it as that moves, on the physics
  ground never onto another level (a body stepping up leaves it on the floor below), rides the ground's velocity (the
  state matrix's run in place) and drops when the body is put over 1 m away or 0.6 m above it (past the plant's reach).
  With locks the knee bends as the animation bends it, the leg longer by as far as a lock holds its foot out from its
  animation (a body braking past a held foot sank to 15 cm, the knee under the floor), and a held foot lies flat and
  rolls as above (engine/anim/footRoll.ts). The pelvis drop is no longer smoothed: its 1 m/s rise cost slides and a pop,
  and a stair needs none (the floor and the drop change together).
- **The physics ground**: the view's puppets and the feel kit's track get the sim's query view, and the foot plant
  stands each sole on the physics ground within a band of the body's floor (a metre a metre out, ± 0.15 m: a ramp, a
  stair), else, and in the air, on the flat floor at the body's height (a ledge, a sole inside a wall); over ground
  below the floor, a lifting sole follows the body (a trailing foot clears the step it leaves), and a free foot out of
  the leg's reach rises over its place to where the leg reaches, never dragged along the leg's line through a riser. The
  feel kit reads a sole's height from that ground, so a foot on a ramp is on its floor.
- **What the view shows** (locomotion/motion.ts `MovementPose`, locomotion/shown.ts): the sim's animator is hashed, so
  the movement's crouch, slide, air, landing and lean are the view's, eased from the movement model's state and the
  actor's velocity and set on the humanoid before each pose (`Humanoid.shown`, never stepped or saved): the crouch; the
  slide, seated low and leaned back, the right leg out ahead, the left hand low by the hip, the spine tilted to the
  slope; the rise and the fall by the vertical speed; the landing's dip by the landing speed, soft from 4 m/s (a jump
  lands at 7.4), hard from 9 (deep, leaning forward, the right hand reaching for the floor, held 0.3 s), unwinding as
  the body leaves the ground again; the lean into the acceleration and the bank into a turn. Procedural: Quaternius's
  slide and Mesh2Motion's three-point landing are clips for WP 13.11's actions on actors.
- **The foot plant's weight from what the clips hold** (clipsets.ts `legsHeld`): a full-body clip as its fade shows, a
  masked one by its mask on the thighs, an added one none; an idle clip layer leaves the plant whole.
- **Movement states in the matrix** (locomotion/matrix.ts, `motion:<name>` for a `plantedStride` build): the walk, run,
  sprint, walk back, strafe, crouch-walk, slide, a running jump, the tower's 6 m fall, a stop and a whole turn in place,
  in the anim QA family and `x sheet`; a script may turn the body (`yaw`). They pass with no baseline entry.
- **The adult's baseline**: 11 entries go (the run's, the stances', the guard's, crouch's and kneel's, the dodge's, four
  clip actions'), 38 tighten (some twice, as the review's roll lowered them again), 10 stand as they were, none loosens
  and none is added. Of the 13 that WP 13.2 left above the source builds', eight go, two tighten under them, and three
  stay above, accepted against the Done-when's "to the source builds'": `action:roll`'s foot slide, 0.6009 against
  0.5843 (the dip and the rise crouch on the floor outside the locks, which hold only a body on its feet, `onFeet`; the
  playground never rolls, so it waits for a game that plays the roll on the adult), and `move:axekick`'s twist jump,
  2.5186 against 2.4568, and `reaction:fallFront`'s under-floor, 0.3503 against 0.2975 (the adult's longer shin in the
  kick's wind and its 0.27 m feet in the face-down turn: its proportions, not its locomotion; for WP 13.19, which plays
  the kicks and the falls on the adult, and WP 10.2's ragdoll for the fall).
- **Deferred**: the head and eyes toward the aim, to WP 13.11 with its aim offsets (the look's pitch reaching the view's
  body); starts and stops matched to distance, with the blend sets; the hip's turn toward the movement. A foot set
  down at a riser's base pokes its toes into it, and a swing from there passes through it (up to 17 cm past the riser
  in footPlant.test.ts's run onto a 0.4 m box, which holds it under 18 cm; the soles never go under a floor): the
  capsule steps up at once and the gait cannot see the riser ahead; easing that step in the view, and a stance foot
  set short of the riser, are the fix when a playtest shows it. A hard stop from a run, a sprint or a
  strafe can set a foot a tick or two into its swing back down as its stance lengthens with the falling speed (a
  re-plant a few centimetres on, then the stop's step): telling a swing from a stance across that needs each foot's
  memory of its swing, a new hashed field in every animator, so it waits with the starts and stops matched to distance.
  The crouch-walk's rear knee still comes within 23 cm of the floor at a double support: the crouch is as deep as the
  crouched hull (its eye at 0.81 m), and a 35 cm clearance would need the walking crouch 25 cm shallower.
- **Beyond Owns**: poses.ts (a planted stride's crouch stance fades as it walks; the shown layers), stateMatrix.ts (a
  script's yaw), builds.ts (the adult's stride), authoring.ts (the roll in `solveLeg`), locomotion.ts (the planted
  stride's share, the knee in a swing), api.ts (`queryGround`, `GroundQueries`, `FOOT_LOCK`), footRoll.ts (new: the roll
  on the ball and the heel), engine/sim/actors.ts (the duck
  as the crouch pose), engine/dev/feel/{anim,run,course}.ts, engine/gfx/stage.ts and engine/app/view.ts (the queries),
  tools/qa/anim.ts and tools/cmd/sheet.ts (the movement states), clipsets.ts, labs/playground/courses/bounds.ts and
  README.md, the playground replays' goldens and tests/replays/README.md (their reasons).

## Amendment 11 (2026-10-19, WP 13.11): traversal animation

- **Actions on actors** (engine/sim/actorActions.ts): the component `actions` holds an actor's `Actions` as the plain
  data `save()` writes, so the sim hashes, captures and restores what plays; `actOn(w, id, act)` plays on it (the
  component added at rest the first time a call changes it; in the sim API for game code), the call's own events
  going out as `action` from the call, at once between steps and at the step's end inside one; the system
  `actors.anim` steps it before the animator, lays the beat's body over the input and emits each event as `action`;
  clip beats play on the actor's clip layer (`SIM_ACTION_NO_CLIPS` without one). An `Actions` is made afresh for every
  call and step (the verifier found a cached one carrying a call's events into the next step: a capture taken between
  them restored without them). The puppets load the same data into a view `Actions` layer (its effectors, flip and
  squash). All 28 actions play on an actor to their ends, as their checks signal them.
- **Traversal on the procedural body, not the clips** (engine/anim/traversal/): the WP named Quaternius's climb warped
  to the height and Mesh2Motion's ledge hang and three-point landing; the player is the procedural humanoid
  (amendment 10) and the clips wait for WP 8.8's contacts. Built instead: the view's `TraversalPose` (eased once a
  step from the shooter model's state as plain data, its own copy, as the sim changes its state in place) and the
  `TraversalPlant` at the end of the `post` slot put the hands and feet on contacts: a mantle's lip (both hands; a low
  ledge taken faster than 3 m/s vaulted with the left hand, the body leaning in 0.9 rad; one under half the shoulders'
  height over where the feet began hurdled with none), the grab's legs hanging near straight (tucked back off a floor
  still under them), its right foot up the wall's face and the pull's left after it, each onto the top as the hip rises
  past the lip, lifted over its edge; the hang under the hands (the shoulders over the feet 0.3 m out from the lip, the
  arms at 0.95 of their reach to the grip); the wall-climb's holds hand over hand, locked where taken, the feet pushing
  below a toe's reach off the face, level (a climb not rising, one that caught a fall, slides its limbs down the wall); the ladder's rungs,
  two at a move, the right hand with the left foot, the stage's 0.3 m spacing, rung 0 the ground under the body; the
  zipline's cable over the feet, the legs swinging back as it speeds up; the skydive's glide on its front, its dive
  head down, its arms back along it, and its landing pose upright (the body turned about the pelvis: the root stands
  at the feet); the slide-jump's legs out ahead near straight, reaching down as it falls, its arms forward and up; the
  hard landing's right hand flat on the floor, the spine bending at its base just far enough to reach it.
  Presentation only: no golden changes.
- **Clear of the wall** (engine/anim/traversal/clear.ts): each solved leg, and one blended with the body's own, keeps
  its knee 6 cm and its toes' tip 1 cm off a mantle's face under its lip and off a climb's wall, the toes moved out
  with the foot, a knee that would touch swung out to its side (up over the lip once its hip is over it) no further
  than that takes; an elbow 3 cm, swung down, out and back; a hand on its way to a lip kept in front of the face and
  its fingers up it until it rises over the top, then hooked over it. A wall reaches 0.45 m past its face, so a
  fence's far side, open ground, is never in it (the gym's are 0.5 m thick: holding the feet off it had made a 0.7 m
  pop); a climb's wall stays the body's while it is within 0.35 m of it and takes no other way (kept on as it topped
  out, the climb's endless wall held a foot back till it jumped 0.57 m). The elbows point down and out under a hand
  over its shoulder and back and out behind one under it, never along the arm (the balloon catch's elbow flipped 0.54 m
  a step with one fixed pole).
- **Reaching and letting go**: a hand moves to its contact swung about its shoulder, never straight through it; a leg
  blends from its animation by weight (its knee as the animation has it, then square to the leg on its front), its
  target never nearer the hip than a third of the leg; a way easing out keeps its last contacts (a zipline's following
  the feet), and a body placed more than 1 m away lets go of all at once. The body is drawn toward a lip as far as its
  hands need (`TraversalPose.reach`: at once as they need more, back with its speed changing at most 150 m/s², so a hop
  out of the pull never snaps it up); the reach a rung, a hold or a cable needs is solved on the skeleton.
- **The foot plant**: off the ground the traversal takes the legs (the plant's weight `plantShare`, its locks
  forgotten while it is skipped, `FootPlant.reset`), on the ground the plant keeps them and the free leg poses stop.
- **Holding and aiming** (engine/anim/traversal/hold.ts, ahead of WP 13.20's weapons): the head and eyes toward the
  look the page's intents give the player (the feel kit's inputs), the neck and the head sharing it (the chest would
  carry held hands off their contacts); a gun (`carry`, as the view will say once weapons are drawn) at low ready,
  raised down the sights (its grip 0.17 m along and 0.13 m under the sight line through the right eye), lowered and
  turned 0.7 rad across the body to its left at a sprint, the hands low; the support hand on the handguard in line
  with its arm (two-hand IK), slid back along it to stay within 0.92 of its reach and the gun drawn in past that; the
  chest turning 70% toward an aim heading up to 0.9 rad off the body's, the muzzle within §5.1's 2° of the aim; the
  sights and the look eased over 0.2 s (`LookPose`); it yields to every hand the traversal holds. A run is not a
  sprint: the gait's speed share (of the adult's 4.41 m/s `speedRef`, capped at 1.25) turns to a sprint from 1.17 to
  1.24, the playground's run being 1.15 of it.
- **Measured**: `handContact` (engine/dev/feel/course.ts) in every course's body bounds (labs/playground/courses/
  bounds.ts, `hands held`, 3 cm), a span that traverses marked `holds`, so one in which no hand held fails it (a pose
  never wired up would otherwise pass at 0): the 19 courses' 1321 measures pass, the held hands on their contacts to
  the IK's precision, a limb held only when one way lays it alone (a way easing out under another holds nothing); a sole off the ground (traversing, flying) is measured against the physics ground under it, not the
  plant's flat floor at the body's feet. Ten states `traversal:*` and `hold:*` for a planted build
  (engine/anim/traversal/matrix.ts) in the anim QA (the adult's 99 checks: no new violation) and `x sheet` (the
  slide-jump's script slides until the step it jumps: a ground step between left its way unplayed). Leg joints more
  than 2 cm inside the gym's solids (a scratch probe of its heights; the first build, then with the clearance): the
  mantles' 170 to 8, the climb's 417 to 2, the hang's 106 to 0, the fences' 61 to 5, the superglide's 236 to 34, the
  ladder's 5 to 0: 49 in all against WP 13.10's 83, every one left WP 13.10's already. The ten sheets passed the
  visual review on its third round; left for the playtest: the stepping knees swung wide (a frog squat), the pull's
  hands off the top as the hips reach the lip, a ladder knee at the rung plane at a stop, the hang's elbows bent 34°
  under a 2 m lip (the hooked hand stands higher; the feet are already 0.1 m over the floor).
- **Deferred**: the clips (WP 8.8 and a measured need); the gun's mesh, recoil and the weapon state, WP 13.20's
  (`carry`); the eyes as their own joints; a climb moving sideways takes each new hold where the body is, its held
  hand stretching till then; the step-up, the vault's lean and the reach are tuned on the gym's walls; clipping as a
  course measure (the probe above reads heights, so an overhang needs a solid query). Left as WP 13.10 built them: the
  first ground step after a long fall shows the feet still tucked as the airborne tuck eases out (18/s), and a medium
  landing's hand goes partway down (its land layer); the plant puts the hand flat on the floor only past 0.55 of land
  × hard (from 0.3 it fell 8 to 10 cm short of the floor in the launcher and zipline courses).
- **Beyond Owns**: engine/sim/actorActions.ts (new) and engine/sim-api.ts (its names), engine/anim/footPlant.ts
  (`reset`), engine/dev/feel/{anim,course,run}.ts (the measure, `holds`, the floor off the ground), labs/playground/
  courses/ (the bounds, the traversal spans that hold), engine/app/view.ts (the player's look), tools/qa/anim.ts and
  tools/cmd/sheet.ts (the states), docs/PLAYGROUND.md §5.1 and docs/GAME-GUIDE.md (`actOn`).

## Amendment 12 (2026-10-19, WP 13.12): first person

- **The arms by a lens of their own, in the frame's own pass** (engine/gfx/viewmodel/lens.ts, material.ts): the WP
  drew the arms "in their own pass, with their own field of view and near plane". Built instead: each of their
  vertices is drawn by the arms' lens in the vertex shader, on its ray from the eye, its depth past their near plane
  (0.1 m) squeezed 0.15 m per metre into the centimetres in front of the picture's near plane (from 1.2 of it), and
  spread across the picture by the ratio of the picture's lens to theirs (Apex's 70 at 4:3; the view setting
  `cam.armsFov`). A wall stands at least the capsule's radius off the eye, so none covers them, and they keep their
  shape through the cam.fov slider, the slide's wider lens and the sights' zoom. A second pass would have cost a render
  target, its compositing and every look's pipelines again; this one costs neither, and the ID pass and the post
  chain see what the frame draws (Unreal 5.5's first-person rendering scales its first-person primitives toward the
  camera the same way).
- **Two meshes** (engine/gfx/viewmodel/body.ts, rig.ts): measured first, the camera's eye (the profile's 1.52 m over
  the feet) leaves the body's shoulders 0.08 to 1.39 m off it (a slide's 0.86, a mantle's 0.93, a skydive's 1.39), so
  hands posed from the body's own shoulders could not reach the picture. The arms are a second mesh of the body's arm
  and right-leg pieces (one draw call, casting no shadow) posed by a rig of its build stood upright under the camera,
  its eyes at the camera's eye and its heading the camera's: fists up at rest, pumping with the gait's phase in a
  sprint, spread in a slide, raised in the air, a breath, the view effects' weapon bob (Apex's 0.4 s) and a sway
  behind the look's turn; a hand the body holds on a contact (a ledge in a mantle, the wall in a climb, a rung, the
  cable) drawn on the contact's ray, a carried gun where the body holds it from its eyes; every hand kept within 0.95
  of the arms' half-frame (a zipline's cable overhead: at the frame's top) and within 0.95 of the arm's reach along
  its ray, the wrist's reach checked for the hand's final turn; a kick shows the body's kicking leg under the rig's
  hips. Measured on r182 in the page: a skinned mesh's `positionNode` is handed the vertex before skinning and what it
  returns is skinned (the lens on the arms' skinned mesh drew a 53-pixel speck), so the arms' mesh is posed on the CPU
  each frame, every vertex by the one bone it rides (about 1,400 vertices), and the lens sees it posed.
- **The body hidden from the camera, its shadow whole**: WP 3.9's culling gave the hidden parts no skin weight, which
  took their shadow with them. Now the body folds to a point, for the camera only, the vertices an attribute marks
  (`viewmodel`), through a node material copy of each of its materials whose `castShadowPositionNode` leaves the
  shadow pass every vertex where skinning puts it; the arms' copies take their shadows where a vertex really is
  (`receivedShadowPositionNode`; the drawn arms stand inside the body's own head). A copy is made once per source
  with every property carried (r182's `NodeMaterial.copy`, so `clone`, keeps only the node properties: a cloned
  standard material lost its roughness). The style set wraps what it gives such a mesh (`userData.restyle`), live
  and in the warm-up, so a look switch builds nothing; the toon material's `copy` keeps its look's uniforms. With the
  view setting `cam.fullBody` the body shows under the camera beside the arms, its head, its arms and what is near
  the eye folded.
- **Measured**: first person's `cameraLost` reads the arms (neither hand in the arms' frame) and `cameraClip`
  (engine/dev/feel/camera.ts) counts the frames a wall covers the drawn arms or the near plane cuts them, both in every
  course's camera bounds (21 a span): the 19 courses' 1,425 measures pass, both 0 everywhere. A scratch probe with the same rigs, the arms at their true depth: the
  climb's arms covered in 184 of its 1,531 first-person frames, the mantles' 13, the camera walls' 9, the ladder's 1;
  through the lens none, the drawn arms at least 0.306 m short of the nearest wall. In the page (tests/e2e/
  playground-cameras.spec.ts): the ID pass sees the arms and not the body, as many of their pixels standing against
  the spawn's south wall as in the open, the fists pump in a sprint and rise in a jump; 0 pipelines after the warm-up
  blending through every mode.
- **Deferred**: the gun's viewmodel and the punch's arm, WP 13.20's and WP 13.19's (the rig takes a carried gun's
  grips from the body until then, and draws a kick's leg); the arms' pose numbers are Apex-like, tuned by eye on the
  playtest (docs/PLAYGROUND.md §9.3).
- **Beyond Owns**: engine/gfx/puppets/actors.ts (`firstPerson` for `cull`; what it keeps of each actor split into
  actorLayers.ts), engine/gfx/materials/{styles,toon}.ts (the restyle hook; the toon copy),
  engine/dev/feel/{anim,camera,course,run}.ts (the arms' input, `cameraLost` and `cameraClip`), labs/playground/
  courses/bounds.ts (the two first-person measures).

## Amendment 13 (2026-10-19, WP 5.6): the bot and the dev actions

- **The dev actions live sim-side** (engine/sim/devActions.ts): the WP put the kind and `registerDevAction` in
  engine/dev/actions.ts. A replay records a dev action by name and plays it through the session, in every host
  (`x replay` in Node, the replay page, parity's Node playback), and the sim may not import `dev/`; so the kind
  `devAction` (`defineDevAction`, the registry's verb) and the engine's five live beside the session, which reads them
  after the scene's own actions (a scene's action of the same name wins), and their code falls under the sim-side
  bans like any change to the sim. engine/dev/actions.ts registers `__engine.actions.list()` and `.run(name, args)`.
- **What an action changes**: an entry has a `run(w, args)` (the sim, inside the session's capture, recorded as the
  change-point's `dev`), `settings(args)` (recorded as `set`, a view setting never), or both, its args a schema checked
  before anything changes, and a throw puts back the sim and the recorded settings with it. Time scale is the frame
  clock's view setting `time.scale`, so it never reaches the sim or a replay.
- **God mode** is the component `invulnerable`: `damage` takes no hit on its holder (the source's `dealDamage`
  returned 0 for the hero), on the player or any entity.
- **Freeze AI** is the recorded setting `ai.frozen` (engine/sim/systems.ts): while it is on, the step skips the systems
  of the phase `ai` (engine/sim/world.ts). The source stopped its foes' whole update; here the phase holds decisions
  alone, and Rapier keeps a crowd agent's velocity, so turning it on also stands the movers the AI drives: each actor
  that is not a player lets go of its AI's intents, and each living crowd agent (a component holding every field of
  `CROWD_AGENT_FIELDS`) stops across the ground.
- **Spawn N** makes props of an entry, fanned 0.4 rad apart (the source's) `distance` m before the player, each on the
  floor probed from 2 m over its feet: props are the engine's one generic spawnable (an actor needs a character, and
  the plan's `actor` template kind was never built); a scene spawns its own kinds with its own `spawn`. **Travel** is
  within the scene (`placeActor`): the engine has no level sequence to travel along.
- **The bot** (engine/dev/bot.ts): the autopilot's mechanisms (stuck measured along the way navigation wants, not the
  sidestep's: measured along the sidestep, the blocked maze's body slid 3 m down a wall counting itself held; the
  sidesteps of 1.3 and 2.2 rad at 0.45 and 0.9 s held, a jump and the other side at 1.5 s; held 5 s in all, stuck; a
  watchdog wanting 1 m of walking distance every 6 s; no route, stuck at once) and shardfall's run report (the stop
  condition `component.field`, a trace every n steps up to 120 samples, events by type, a sweep of seeds from fresh
  sessions as one row for the scene). Its sums run under the sim's math and its moves snap to 16 headings (two
  decimals, as the starter game's bot), so a run's intents are the same in Node and Chromium and its recording short
  (the maze run: 15 change-points in 251 steps). A tour draws its goals from its own stream, `derive(seed, 'bot')`,
  never the world's.
- **Reached from `x`** through `x eval` in an `x inspect` page: `__engine.actions` and the new `__engine.bot(plan)`
  (§8.3's table gains its row: doctrine 2 wants the bot reachable beyond code); tests/e2e/box.spec.ts calls the three
  in the page, engine/app/viewMembers.test.ts headless. No x command of its own: the member and the API cover a sweep.
- **Measured**: in the maze fixture (engine/dev/bot.test.ts) the bot reaches the far corner round four walls in 251
  steps, never over a solid tile; a box navigation does not know in the middle corridor gets three jumps and then
  `stuck` (`no progress`) at step 495; a goal in a closed pocket is `stuck` (`no route`) at step 0; two runs agree
  and the recording replays to the run's hash. Each of the five actions has its test (engine/dev/actions.test.ts),
  and the four the sim records replay to the same hash.
- **Beyond Owns**: engine/sim/devActions.ts (new), engine/sim/{session,world,systems,damage}.ts (the hooks: the
  session's fallback, the frozen phase, the setting, the invulnerable target), engine/app/headless.ts (loads the
  members), engine/app/viewMembers.test.ts and tests/e2e/box.spec.ts (every member's check).

## Amendment 14 (2026-10-19, WP 10.6): the UI widgets

- **Placed on the overlay** (engine/ui/widgets.ts): bars, hearts and boxes go in the HUD's places through a new
  `overlay.attach(element, at)` (engine/ui/overlay.ts, beyond the WP's files), stacking with the HUD's lines; the
  dialog and the menu stand over the root as panels that take the pointer. One stylesheet serves them all.
- **Input and sound injected**: the UI layer may not import the input devices or the audio, so a widget reads a
  `UiInput` (the page input's `held`, `pressed`, `strength` and `lastDevice`, over the system layer) and asks a
  `UiSound` for cues (`move`, `pick`, `cancel`, `type`). Held directions repeat after 0.35 s and every 0.1 s.
- **Gamepads**: the menu and the dialog take the pad's D-pad and left stick through the system layer's directions;
  any other panel through the pad's cursor (`createPadCursor`: shardfall's speeds, accept clicking what it is over),
  shown only with a gamepad used last and a panel open. **Picks as input**: a menu item with an `id` is handed to
  `send(id)`, which the page turns into a dev action or a custom intent, so the replay holds the pick
  (tests/e2e/ui.spec.ts: the menu's pick recorded as the scene's dev action).
- **Pages are strings**: the source wrapped a page to the box's width in its pixel font; here each string is a page and
  CSS wraps it. The box's and the playground's own menus stay theirs until a WP needs the widget's.

## Amendment 15 (2026-10-21, WP 13.13): storeys, the level format and its colliders

- **The text** (engine/world/level/parse.ts): a map per storey, bottom first, each after a fenced block of its own
  holding `storey` (its name), `base` (its floor, m) and `height` (its clear height, m); the level's front matter, when
  it has one, comes first. Every map is the size of the first, and each base stands above the ceiling of the storey
  below: the gap is that storey's floor slab (0.3 m under the lowest). A format-1 file, with no storey block, is one
  storey on 0 and compiles to the same data and hash as before: the glyph fields only storeys read (`void`, `full`,
  `opening`, `head`, `room`) are left out of a format-1 level's legend, and the wall's and the pillar's descriptions,
  which a compiled legend holds, kept their words (fixtures/levels/*.txt and the hall keep their goldens).
- **Heights** (storeys.ts): a storey's glyphs stand on its base; a `full` glyph (the v1 wall and pillar) rises to the
  floor of the storey above, so `#` is a storey's wall; a slab lies under every tile but void ones; a head (a door's
  2.1 m, a window's, the low ceiling's 1.4 m) is a solid from it up to the full top. A flight of stairs (`<`) rises
  from its floor to the floor of the storey above, toward the one side that floor meets it, with void over it there.
- **Roofs are the top storey's keys, not glyphs** (the plan said "roof areas" among the glyphs): a tile holds one
  glyph, so a roof drawn as glyphs could not also say what stands under it (an attic's floor, its gable walls, a
  chimney). `roof` (gable, hip, flat), `pitch`, `ridge` (a gable's; a hip's runs along the longer side) and `eaves`
  over the bounds of the storey's floored tiles; a pitched roof's eaves stand on the storey's ceiling, or its floor
  when it gives no height (an attic, as the house's); its slab is 0.2 m deep and walked on; the walls under it rise to
  its underside as convex hulls (roofs.ts). One roof a level, on its top storey; the porch roof and the garage's deck
  are floor of the upper storey. PLAN.md WP 13.13 and docs/PLAYGROUND.md §6.1 say so.
- **The v4 glyphs** (legend.ts): void `~`, door `+`, window `:`, railing `!`, flight `<`, low ceiling `_`, picked
  clear of the gym's letters; they draw with the existing recipes (floor, wall, low wall, stairs) until WP 13.14 draws
  openings, heads, railings and roofs. Rooms are a game's: the engine names no room marker; a glyph with `room` marks
  one, and its room is the floor its tile reaches inside walls and openings (rooms.ts). The storey fixtures' markers
  are fixtures/levels/storeys/glyphs.ts's, which `node x qa level` reads them with.
- **The compiled level** (`my3dge-level/2`): its per-tile and drawn fields are its ground storey's (the one on 0, else
  the lowest), so a reader of one storey reads the ground floor; `bounds`, `ground` (under the lowest slab),
  `colliders`, `spawns` and `lights` cover every storey, each holding its `storey`; `storeys`, `rooms`, `openings` and
  `roofs` beside them. `storeyView(level, k)` reads any storey as a format-1 level (its `base`, `fullTop` and roof
  for the height queries), so navigation, drawing and ladders read it unchanged; `levelLadders` stands each storey's.
- **In 3D** (heights.ts): `floorBelow(level, x, y, z)` is the highest surface at or under a point (a floor, a ramp, a
  flight, a dais, a solid's top, a head's top even with no floor over it, a roof, the ground slab), `surfaceBelow` its
  tag; `storeyAt(level, y)` reads a storey by height alone, `storeyBelow` by that surface (a flight's tiles are the
  storey they rise from up to their top, a roof none), and `roomAt` reads `storeyBelow`'s storey, so a hall's stairs
  are the hall's all the way up.
- **Validation** measures against the shooter model's hull, the largest the engine ships (`LEVEL_BODY`: 0.8128 m
  across, 1.19 m crouched), and flights against its walkable slope rounded down, 45°: `LEVEL_NARROW_DOOR`,
  `LEVEL_LOW_HEADROOM`, `LEVEL_STEEP_FLIGHT`, `LEVEL_UNREACHABLE_ROOM`, over the storeys walked as one graph (walk.ts's
  `walkStoreys`: a flight's top and a ladder link the floors). Structural: `LEVEL_BAD_STOREY`, `LEVEL_NEEDS_STOREY` (a
  storey's glyph in a format-1 map), `LEVEL_BAD_FLIGHT`, `LEVEL_BAD_OPENING`, `LEVEL_BAD_ROOM`, `LEVEL_BAD_ROOF`.
- **Beyond Owns**: engine/world/level/shapes.ts (exports `outside` and `SIDES` for the flights), meshes.ts (full
  glyphs grouped apart in a storey), engine/world/traverse.ts (ladders per storey), engine/sim/levelBodies.test.ts
  (the controller up the flights and on the roofs), tools/qa/level.ts (the storey fixtures, the content codes),
  engine/world/level/problems.ts (the new codes), engine/sim-api.ts and engine/sim/siteApi.ts (the queries,
  `storeyView`, the types: the review moved them to the site's part of the API), fixtures/levels/storeys/.
- **From the review**: the house's landings were reached through one 0.5 m tile between the north wall and the
  railing's end, narrower than the hull, so each flight is a tile shorter (seven tiles, 40.6°, walkable under 45.57°)
  and each landing two tiles deep; storeys/annex.txt holds a wall one storey high with a door and a window under
  void, whose heads' tops bodies stand on. Left for WP 13.18's house: a railing collides over its whole tile while it
  is drawn as a 6 cm rail down its middle, and a door's frames narrow its drawn opening by 7 cm a side; near the eaves
  `wallUnder` stands a wall up to 0.18 m over the roof's true underside, inside the roof's slab.

## Amendment 16 (2026-10-21, WP 13.14): storeys drawn

- **Each storey from its view** (engine/gfx/level/meshes.ts): a level written as storeys draws each storey's
  descriptors through `storeyView`, bottom first, named `level:<name>/<storey>/<recipe>` with `userData.storey`, then
  each storey's own parts (`ceiling`, `heads`, `frames`), the rooms' own floors and the roof, after every descriptor's
  mesh, so the stage's runs still index the descriptors' (engine/gfx/stage.ts splits each storey's).
- **The parts**: `ceiling` (slabs.ts) is a slab's underside, the ceiling of the storey below (none under the lowest),
  and its edges where floor meets void or the map's edge; `heads` (openings.ts) the wall over each door, window and low
  ceiling, from its head up, as the colliders; `frames` two jambs and a head of planks round each opening, a window's
  sill too, flush with the wall (a frame proud of a wall at the map's edge stood outside the level's bounds); railings
  are posts at most 1 m apart and two rails; flights climb by a 0.18 m riser (flights.ts: stairs.ts takes the count,
  `StepCount`, since two steps a metre made a storey's flight 0.375 m risers); a pitched roof's walls are the hulls of
  their merged runs clipped to its underside (walls.ts, three's `ConvexHull`), and the roof its planes' tops,
  undersides and edges (roofs.ts), UVs in metres in each face's own plane (`axesOf`).
- **The v4 railing and flight** draw with recipes of their own (`railing`, `flight`); their compiled glyph changed, so
  the storey fixtures' goldens were re-recorded (WP 13.13's, never in a replay). New recipes `ceiling`, `heads`,
  `frames` and `roof` name what no glyph does, overridable by a game as any recipe (`recipes`), their materials the
  engine's until WP 13.17's building materials.
- **Rooms' floors**: a level entry's `rooms` (`{ kitchen: 'material:tiles' }`, presentation only, as `materials`)
  draws each named room's floor tiles in a mesh of their own; the view passes it to the stage (`levelRooms`).
- **Bounds and budgets**: a format-2 level's bounds reach over its roof's eaves; `x qa geo`'s draw-call and vertex
  budgets count per storey (20 calls and 32 vertices a tile a storey: the house draws in 59 calls with one shadow map,
  four storeys) and it compiles each place's levels with its glyphs.
- **Both looks**: the playground's cel and pixel looks both draw materials in the toon style, their filters post passes
  over the frame; tests/e2e/level-meshes.spec.ts draws the house in the lambert and toon styles with every style warmed,
  building nothing after the warm-up, and tells its parts apart in the ID pass from outside, storey by storey with
  what stands above hidden, and from the cellar. The cutaway by storey is WP 13.15's.
- **Beyond Owns**: engine/gfx/level/stairs.ts (the step count), shapes.ts (exports `drawnWith`), engine/gfx/stage.ts
  (runs per storey, the ground under the lowest slab, `levelRooms`), engine/app/view.ts and engine/world/level/level.ts
  (the entry's `rooms`), engine/world/level/{legend,compile,types}.ts (the recipes, the bounds), tools/qa/geo.ts,
  tests/pages/level-meshes.ts.

## Amendment 17 (2026-10-21, WP 10.5): terrain

- **A heightfield, not terraced tiles** (engine/world/terrain.ts): shardfall's terrain is terraced tiles with side
  faces in triangle-mesh chunks; the playground's hill needs smooth slopes of 10° to 30° (docs/PLAYGROUND.md §2.2), so
  heights stand at a grid's corners and Rapier's heightfield is the collider (engine/physics/heightfield.ts, its
  internal edges fixed: a box sliding over a flat field's seams stays within 5 mm). Shardfall's fbm (5 octaves,
  lacunarity 2.03), ridge term, terraces and flattened footprints carry over as the spec's fields; smooth domes
  (`hills`) are new, to shape a designed rise; a footprint blends as `h·w + flat·(1 − w)`, exact at both ends. Its
  stateless placement is `scatterTerrain` (hashes of the seed, a salt and the cell).
- **The split, measured on 0.21**: the heightfield takes its heights column by column (`nrows` along z), centred on
  the collider, each cell split from its north-east corner to its south-west one. `terrainHeight` interpolates the same
  triangles and the finest drawn level is wound on them, so queries, collider and picture agree: probed from 1 km up
  (a float32 ray) within 2e-4 m, normals within 5e-7.
- **Navigation over a surface** (engine/world/terrainNav.ts): `NavGrid` takes a `NavSurface` (tiles from an `origin`,
  which are walkable, their floors, a step test) besides a compiled level; a level's origin is 0 and its arithmetic
  unchanged (x − 0 is x), so no golden moved. A terrain's cell is open up to a grade of 1 (45°); its heap moved to
  engine/world/tileHeap.ts (nav.ts at its line cap). On a heightfield a terrace's riser is a cell's slope, so the grade,
  not the climb, closes a high one.
- **The drawing** (engine/gfx/terrain.ts): chunks of 32 cells, each three's `LOD` of every corner, every second and
  every fourth from 0, 48 and 96 m, with 2 m skirts against cracks; normals of the full grid at every level, so the
  light holds as levels switch. An orthographic camera stands 60 m back (engine/gfx/cameras/presets.ts), so a chunk
  picks its level for one by what it frames (`levelDistance`: as far as a 50° lens stands to frame its height), and the
  ground under the player is the finest in every camera.
- **The splat** (engine/gfx/terrainSplat.ts): a node material copy of the ground layer's material in each style
  (through the style set's `userData.restyle`; the copier is shared with the viewmodel, engine/gfx/materials/
  nodeCopy.ts) whose colour mixes the steep layer in by the fragment's world normal (from the terrain's `steep` grade,
  0.7: 35°) and the high one by its height, the edges wavering by fractal noise. A game names the layers' materials:
  `material:default` alone by default (WP 13.17's building materials may give the engine turf and rock).
- **Scenes**: a scene's `terrain` names its terrain; the view draws it (engine/app/view.ts, engine/gfx/stage.ts: with no
  level, the stage's plane at its origin's height and the sun fitted to its area, reaching its far corner) and the
  scene's setup stands its body (`addTerrainBody`, engine/sim/levelBodies.ts), as with a level. The names game code
  takes are in engine/sim/siteApi.ts (sim-api.ts at its cap), WP 13.15's sites to follow there.
- **The playground's hill** (labs/playground/scenes/hill.ts): `terrain:block`, the whole block's ground (96 × 96 m,
  rolling 0.6 m) with the hill a 10 m dome of radius 30 m over the east edge's middle (slopes up to 28.9°, 10° to 30° on
  most of its flank), in the playground's turf and rock (labs/playground/ground.ts); `playground:hill` takes the gym's
  settings and `place`. A first strip of only the hill (x 72 to 96) let the replay's slide carry the player off its west
  edge into nothing: the block's ground holds him, and is what WP 13.18's site stands on. The course `hill` (25
  measures: the feet planted, no pops, every camera's bounds) passes; tests/replays/terrain-hill.replay.json (up the
  flank, across it, down it in a slide gaining from 6.1 to 10.2 m/s, back up) gives one golden set in Node ×3 and
  Chromium ×3.
- **Measured, the controller's own**: up a 20° hillside its feet stay 0 to 7 cm over the slope (its capsule's
  r (1 / cos θ − 1) and its skin); running down a 23° stretch at 6 m/s its across-then-down move hops it up to 13 cm off
  the slope and back (engine/sim/levelBodies.test.ts holds both bounds). The feet's plant reads the ground under each
  foot, so the course's planted feet pass.
- **Beyond Owns**: engine/world/{terrainNav,tileHeap,nav}.ts, engine/gfx/{terrainSplat,stage,stageSky}.ts,
  engine/gfx/materials/nodeCopy.ts and engine/gfx/viewmodel/material.ts (the copier), engine/gfx/level/runs.ts (split
  from the stage at its cap), engine/physics/world.ts (the shape), engine/sim/{levelBodies,scene,siteApi}.ts,
  engine/sim-api.ts, engine/index.ts, engine/app/view.ts, labs/playground/{ground,main}.ts, its scene and course,
  tests/e2e/terrain.spec.ts.

## Amendment 18 (2026-10-21, WP 13.15): sites

- **A site** (engine/world/site.ts): `defineSite(id, { terrain, structures })` stands levels on a terrain, each with its
  map's north-west corner at `at` (its storey on 0 at `at`'s height) and turned `turn` quarter turns about +Y. Points
  cross between a structure's frame and the world by swapping and negating (`toWorld`, `toLocal`), with no
  trigonometry, so Node and Chromium agree to the bit; `turnVector` never gives −0, since a ladder's normal is state and
  a capture as text would turn −0 into 0. The terrain is flattened round each footprint (`flatten`, 4 m) and cut, a flag
  per cell, under a storey below the ground floor and the rectangles a structure names (`cuts`: window wells).
- **The cut terrain is one triangle mesh, not chunks** (engine/physics/trimesh.ts; `addTerrainBody(physics, terrain,
  cut)`): docs/PLAYGROUND.md §6.3 planned triangle-mesh chunks where a cut is. One mesh of every uncut cell, split as
  the heightfield splits them, with Rapier's internal edges fixed (`FIX_INTERNAL_EDGES`: a box slides over its seams
  within 5 mm) has no seam between a heightfield and a chunk for a body to catch on, where neither collider knows the
  other's edges, and stays small (the lot's 32 × 32 cells: 2,048 triangles less the cut). Probed over the fixture site
  it stands where `siteFloorBelow` says within 1 mm, and a capture of a ball rolling down a mesh restores exactly. The
  drawn terrain leaves the cut cells out, the chunk holding them at its finest level only (engine/gfx/terrain.ts).
- **Queries over all of it** (engine/world/siteQueries.ts): `siteFloorBelow`, `siteSurfaceBelow`, `siteStructureAt`
  (the storey by the surface under the point, `storeyBelow`, else by height; the room), `siteSolidAt` (a head only
  where its solid stands), `siteClearSight` (sampled every 0.1 m) and `siteRescueGrid` (1 m tiles from an origin, the
  cellar's floor where the ground is cut; `rescueLost` reads a grid's `origin`).
- **Bodies in their places**: `addLevelBodies(physics, level, { at, turn })` stands a structure's one fixed body turned
  in its place; `addSiteBodies` stands the terrain, then each structure, in that order (insertion order is identity);
  `addSiteLadders` carries each structure's ladders' feet, tops and normals into the world.
- **Navigation over storeys and terrain** (engine/world/siteNav.ts, siteNavGrids.ts): a `NavSurface` for the terrain
  and each storey, linked through flights (each column), ladders (through the hatch) and doorways. A step needs the
  crouched hull and 5 cm under the ceiling over the higher floor of its two tiles, read at each tile's four inset
  corners, so a flight's edge counts; a tile under less than the standing hull (`LEVEL_BODY.standing`, 1.8288 m) and
  5 cm costs 2.5 times its length, crouched, and `crouch` says when, never across a link (crouching on a ladder lets
  go). A way walks each tile's clear point, moved off the sides it has no step through as far as the hull's radius and
  4 cm need, so the 0.81 m hull walks a stairwell of two 0.5 m tiles in its middle. `nodeAt` takes the highest floor at
  or under the feet within the climb, or, more than a step below them, an open tile beside it within a step of their
  height (a body on a hatch's rim, its centre over the hole). The neighbours (WP 13.21) take the same graph; ai.ts is
  unchanged.
- **The bot on a site** (engine/dev/botNav.ts, bot.ts): `siteBotNav(site, climb)` gives it ways with `crouch`, `rise`
  and `over`. A goal is reached only within 1 m of its height, so a room above is not reached from under its marker; a
  climb counts as getting on; on a ladder whose way goes down it crouches to let go, and while it falls it pushes
  nowhere, so it lands rather than catching the ladder again. `__engine.bot` reads a scene's site.
- **The cutaway by storey** (engine/gfx/storeyCut.ts; the stage's `frame`): in the classic views (the camera type
  `view`: isometric and top-down) every storey above the player's, and the roof while the player is indoors (in a
  room, or under the roof's footprint, as in a shed with no room marked: `cutPlace`, reading the floor up to 10 cm over
  the feet, since a resting body's feet sink a hair into it), are hidden by `visible`, the cutaway's twins with their
  parts, so no frame builds a pipeline. The site's structures are drawn in groups at their places and turns
  (engine/gfx/stageSite.ts, `site:<name>/<index>`), each with its cutaway and its cut by storey run in its own frame:
  the structure the player is in is cut, the others stay whole. The occluder fade for third person indoors is the
  existing cutaway's, per structure. Round a terrain the stage's ground is a frame, the terrain filling its own area
  (engine/gfx/stageGround.ts): its plane at the origin's height hid the cellar under the cut from above.
- **Rooms as data**: a light names its room (`room:<name>`, its light group: its tile's, else the first beside it,
  north, east, south, west, as a sconce in a wall); `roomReverb(room, height)` picks `small`, `room` or `hall` by volume
  (30 and 200 m³) for WP 13.22 to play; the playground's HUD names the room the player is in (`Room: kitchen`,
  `Indoors`, `Outdoors`).
- **The lot** (labs/playground/levels/lot.ts, scenes/lot.ts): the fixture house and shed in the playground's room
  glyphs on a 32 × 32 m terrain, the house at (10, 0, 12), the shed turned a quarter at (24, 0, 6); the fixture site
  (fixtures/levels/storeys/site.ts) stands the same for the engine's tests. The house's ladder moved from its outer wall
  under a one-tile hatch, which the hull could not climb through, to the study's west wall under a 1.5 m hatch (the
  house's golden re-recorded: f3b1585415bee4a1). The bot reaches each of the six rooms from the yard and back, and
  tours them all in 1,398 steps.
- **The soak**: a course of the tour's own intents is judged on no camera inside a wall (0 frames in all five cameras),
  the Done-when; the cameras' other bounds are watched for WP 13.18's house, whose rooms are roomier: the shooter loses
  sight of the player 931 of 1,398 frames and the platformer 255, and first person and the platformer jump 0.42 m and
  0.52 m in one frame.
- **From the review** (the verifier passed it, with notes, all taken): the rides fade once, in the world's frame (each
  structure's cutaway had read their world boxes against its local lines, so a ride off the camera's line could hide);
  a point on an edge two structures share is the east or south one's, as a tile's edge is (`siteStructureAt`, the
  stage's `where`); `turnVector` gives no −0 whatever comes in; `__engine.bot`'s help names a site goal's height, and
  a test plays it on the fixture site; a test holds the lot's copies to the storey fixtures, markers aside; WP 13.18's
  entry carries the watched camera bounds and amendment 15's leftovers.
- **Beyond Owns**: engine/world/{siteQueries,siteNav,siteNavGrids}.ts,
  engine/world/level/{heights,compile,types,validate}.ts, engine/physics/{trimesh,world,bodies}.ts,
  engine/sim/{rides,siteApi}.ts, engine/gfx/{stageSite,storeyCut,stageGround,stage,terrain}.ts, engine/app/view.ts,
  engine/dev/{bot,botNav,actions}.ts, engine/audio/runtime/reverb.ts, engine/index.ts,
  fixtures/levels/storeys/{site.ts,house.txt}, labs/playground/{levels/lot.ts,scenes/lot.ts,main.ts,README.md},
  tests/e2e/playground-cameras.spec.ts, tools/eslint/layers.ts (the bot's rule holds its navigation beside it, sim-side
  too). engine/world/nav.ts and engine/gfx/cutaway.ts, which the WP extends, needed no change: the site's graph is
  NavGrids over NavSurfaces, and the cut by storey a module of its own.

## Amendment 19 (2026-10-21, WP 13.16): doors, windows, switches and pickups

- **Use** (engine/sim/interact.ts, the system `interact`, phase `intents`): for each player, the thing in reach (2 m
  from the eye, plus half the thing's size) and in view: along the crosshair when the step has a `look` and an `aim`
  (first person and the shooter), the first body the eye's ray toward the aim strikes, or a bodiless thing (a switch)
  it passes within 0.15 m of before that; else the nearest within 60° of where it faces, a wall, a door or a pane
  between hiding it (a ray through the group `world`). What can be used is asked of the entries, never the ids: the
  kind `usable`, keyed by component (a door's, a switch's), then a prop's own `use` with a `prompt`, then carrying, for
  a dynamic prop of 25 kg or less; only what can be used now counts, so a sliding door hides no switch. The prompt
  sits in the player's `interactor` component, as it stands after the step's use, and the playground's HUD shows it
  with the key that uses it on the device used last (playground.spec.ts reads it: `E: Open`, then `E: Close`).
- **The phases**: the use reads the step's intents in `intents`, before the actors move; the doors, the panes and the
  switches run in `anim`, after it, so a throw is cast in its own step and the dev action `freeze`, which skips `ai`,
  stops none of them (a kinematic leaf left undriven would spin on at its last velocity).
- **A use takes its press**: `interactor.usedAt` is the step, and the actors' input leaves that press out of the
  rides' (engine/sim/actorInput.ts), so using a door beside a zipline does not ride it.
- **Carrying and throwing**: the carried prop's body is driven by velocity toward 0.8 m before the eye (at most
  12 m/s, its turn held), so it still collides; held back past the reach and 1.5 m, it drops; the next use throws it
  along the view at 8 m/s.
- **The strike before the kick**: `melee` strikes what is in reach and in view with the use's reach and cone, not
  §3.2's punch (1.52 m in a 30° cone), which WP 13.19 brings with the kick's move. Only what takes a strike counts: a
  component of the kind `strikable` (a door's rule, a breakable's point of damage), health, or a dynamic body to knock,
  so a lamp hanging before a door takes none.
- **Doors** (engine/sim/doors.ts): kinematic props (the prop kind gains `kinematic`, `spawnProp`'s `as` makes one),
  driven by velocity to the pose their hinge, turn and angle give (`driveBody`). A use opens one away from the user, a
  quarter turn and more (1.65 rad) at 2.6 rad/s, and closes it; a locked one says `Locked`. A kinematic body pushes
  whatever it meets, so the leaf's next pose is tested first against actors and props (`overlap`) and it waits there.
  Apex's rule: a strike while the striker faces it bursts it open three times as fast and unlocks it, the second
  breaks it off its hinges, a dynamic slab knocked away with `splinters`; a shot or a blast breaks it at once. A
  sliding door (the garage's) moves along an offset, opened by its switch, never struck. `addLevelDoors` hangs
  `prop:door` in each door opening of a level, centred (5 cm a side in a 1 m doorway); its 0.9 m leaf and the pane's
  0.5 × 1.2 m fit the default glyphs' openings, and another width, sill or head leaves gaps (the file comments say so).
- **Windows and breaking** (engine/sim/breakables.ts): `prop:pane`, 0.5 × 1.2 m and a 2 cm fixed slab with 1 hit
  point, stood every half metre across a window opening from its sill, in the wall's middle (`addLevelWindows`). A
  fixed pane would stop a thrown chair: the physics step resolves the contact before any rule sees it. So the system
  `breakables` breaks, before the physics step, every pane a prop flying faster than 4 m/s would strike in it: the
  prop's own shape cast along the step's move (gravity's pull in it), again past each pane it breaks (up to four), and
  the chair flies on through; a thrown prop with health of its own breaks one too. `breakProp` sends the event its look
  names (`breaks.shards`: `glass`, `splinters`; else `shatter`) with `{ id, prop, position, ground }`, stands its pieces
  (`breaks.into`) in a fixed fan with no random stream, their bodies knocked away as they are made (`spawnProp`'s
  `knock`: inside a step an entity joins only at its end, so a hit through it would find none), and removes it. The view's emitters answer those types: glass falls and glints and lands
  nowhere (a sill is no floor), splinters and debris land on `ground`.
- **Switches** (engine/sim/switches.ts): the component `switch` (on, its light group, or its door); flipping one turns
  its group's other switches with it (a stair's two). Lamps a scene's setup spawns join the world at the setup's end,
  after the switch, so the system `switches` holds each group at its switches' state every step, a lamp spawned later
  from the step after it joins; `switchGroup` (a rule: the streetlights at dusk) sets a group and its switches. The
  view reads `propLight.on` (engine/gfx/stageProps.ts, props.ts): a prop that is off draws its `lit` parts at a quarter
  of their tint and gives no light. The lamp's lit part is its shade, glowing: a bulb under a shade showed from below
  only, never in the isometric and top-down cameras.
- **The hash kept**: `sceneProp` is unchanged; a prop with health gains `propHealth`, a switchable one `propLight`,
  and nothing else does, so every earlier replay keeps its goldens.
- **`damage` stays the crowd's**: the plan's Owns has WP 13.16 extend engine/sim/damage.ts for props with health. A
  prop's hit points are its own component instead (`damageProp`), since `damage` writes a target's `hitAt` and `hitBy`
  and drives a crowd body; bolts and shots reach props through `strikeBody` (a body to its prop by `propOfBody`): the
  box's `fight.shots` calls it for each body its bolts strike, and with no prop in the fight its goldens hold.
- **A removed body's id names nothing** (engine/physics/capture.ts `liveBody`): Rapier finds a body by its slot alone,
  so once a removed body's slot was reused, `hasBody` said the old id lived and `readBody` read the newcomer (a broken
  pane's slot taken by a shard). Every lookup of a stored id (the world's, the bodies', the queries' `exclude`, a
  character's floor and platform, a crowd agent's) now checks the generation too; lookups of a query's own hits keep
  Rapier's. `removeProp` clears its component's body, since its entity stays to the step's end.
- **The body-to-entity lookup is a scan** (`propOfBody`), not the index the Build names: a use or a hit asks a few
  times a step, and an index would be state beside the components, to keep in step with spawns, breaks and restores.
- **The API**: the house's names are in engine/sim/houseApi.ts, re-exported whole by engine/sim-api.ts, and generic
  over the world's events (`World<C, E>`), as `damage` is, so a world with its own event map (the box's) calls them.
  `defineUsable` and `defineStrikable` write to the shared registry the system reads, and take no other.
  engine/gfx/props.ts, at its cap, gave its texture and materials to engine/gfx/propLooks.ts.
- **The playground**: the library gains the chair (6 kg), what the owner's playtest throws; the cottage
  (labs/playground/levels/cottage.ts, scenes/interact.ts) holds a door, two windows, the kitchen's lamp and switch and
  chairs to throw, and its replay (tests/replays/playground-interact.replay.json) opens the door, switches the light
  off and on, closes the door, bursts it open and breaks it, and throws a chair through a pane. The house's doors,
  windows, lamps by room (`room:<name>`, amendment 18's light groups), the garage and its door (whose storey must hold
  the door's 2.2 m slide up) and the bot through closed doors are WP 13.18's; doors, glass and switches have no
  sounds until WP 13.22.
- **From the review** (the verifier failed it on three counts, all fixed, and listed open issues, taken): the props
  page's lamp showed no bulb from above (now the glowing shade); the playground's menu spec still listed the gym alone,
  stale since WP 10.5's hill (now every scene and replay file); a prop breaking into pieces inside a step threw (now
  its pieces are knocked through their bodies). Taken from the open issues: what cannot be used now no longer hides what
  can; only what takes a strike is struck; a group's switches turn together; the phases above; a thrown prop with
  health breaks panes; the crosshair's ray picks what it strikes; `FRONT` written as 0.5, no Math at import; the stale
  test titles and file comments; the HUD's prompt read by the page spec. Left: the scan above, and the fixed pane and
  leaf sizes, documented.

## Amendment 20 (2026-10-22, WP 13.18): the site

- **The block** (labs/playground/levels/site.ts): one site, `site:block`, 96 × 113 m, on the hill scene's ground
  flattened under the range, the yards and the street. The gym as built (41 × 101 m, WP 13.1 to 13.7) could not stand
  in §2's 36 × 70 m strip, so the block runs 17 m further south than §2's 96 m, and docs/PLAYGROUND.md §2's sketch and
  ranges say so; the gym stands at (0, 12), its wall open by three gates (`GYM_GATES`, `GYM_SITE_TEXT`), while its own
  scene keeps the wall whole. The house (format 2, 0.25 m tiles), the shed, the tree house and the lookout, the range's
  shelter and backstop, the ring and the paving are levels painted from rectangles (labs/playground/levels/plan.ts);
  their looks (siding, wallpaper, shingles, a brick chimney, each room's floor) are their entries'. Each area has a
  spawn (`SITE_AREAS`) and a scene (`playground:site` the front yard's, `playground:site-<area>` the others'), each
  `defineScene` call written out with its id, since the tools find a scene by its module's text (tools/lib/scenes.ts).
- **The house as built** against §2.1: a patio on the backyard side, not a deck, the crawlspace under it; the garage's
  door an up-and-over door on its switches (a tilt, e981a49), 2.3 m high under the ground storey's 2.7 m; a level door hangs
  only in an opening its leaf fits. The study's bookshelf stands off its door: with the leaf open the two sealed it.
- **The lot and the cottage give way** (amendments 18 and 19): labs/playground/levels/{lot,cottage}.ts,
  scenes/{lot,interact}.ts and the interact replay are gone (their inspector glyphs also clashed with the house's). The
  site's replay (tests/replays/playground-site.replay.json, 640 steps, 12 goldens; Node ×3, Chromium ×3 and the page ×3
  agreeing) opens the front door, turns the hall's light off and on, bursts the living room's door open and breaks it,
  throws a chair through the dining room's north window and raises the garage's door; labs/playground/scenes/site.test.ts
  checks its story event by event and the HUD's prompts. WP 13.16's Verify plays it now.
- **The bot on the site** (engine/world/siteNav.ts, siteNavClear.ts, siteNavGrids.ts; engine/dev/bot.ts, botNav.ts):
  a tile's clear point is sampled every 5 cm within the hull's keep (its radius and 4 cm), the nearest point that far
  from what the body cannot walk into: a closed tile of its own grid, a side's floor more than a climb away, a ladder's
  foot, a prop's own box (not the margin the graph closes round it); the tiles links cross into count open. The way
  looks ahead up to three nodes past clear points already reached or, in the body's own grid, behind it. A drop off a
  step higher than a climb costs its height, and a flight's side is crossed only within a 10 cm curb, so a way never
  jumps off a flight's side; a block closes no tile through a closed one (a bookshelf's margin closed the attic's
  ladder through the landing's wall). The bot ducks 2.2 m ahead of a low ceiling, pushes gently at a drop and presses
  use there (a ladder's top takes hold by use), keeps its push through a mantle, pushes nowhere falling until 0.25 m
  over its floor, reads a ladder's rise over the next three nodes, and turns the view the way it walks when asked
  (`look`, as a player's mouse would). Left: a way along a ladder's face can take hold of it (the lot's attic run).
- **Measured**: the bot reaches every room of the four storeys and every area from the front yard's spawn and back
  (labs/playground/scenes/site-{downstairs,upstairs,areas}.test.ts), and tours the 17 rooms and back in about 5,100
  steps (site-soak.test.ts).
- **The cameras' watched bounds** (amendment 18): over the tour, run again as a course with the bot's view, no camera
  stands inside a wall (0 frames in all five), and first person, isometric and top-down keep all their bounds. The
  shooter loses the player in about 7% of the frames, its arm pulled in at the house's walls, and a door swinging into
  its ball cuts it once (3.45 m in a frame); the platformer loses the player in most, its short arm's view along it
  missing the chest indoors (the playground gives it no sim look). Judging them takes the follow cameras reworked for
  rooms, a WP of its own: WP 13.27 (stage G12), for which the soak watches them.
- **The warm-up asks for fewer styles** (engine/gfx/materials/styles.ts `attach(warmup, scene, styles)` and `add`,
  engine/app/look.ts): a page's style set warms its own style and each a look asks for, not all four: the playground's
  looks both draw toon. The site's page warmed 113 pipelines in 333 s before, 85 in 214 s after, on SwiftShader; the
  tools wait 300 s for a page (tools/lib/page.ts `READY_MS`), the site's specs 420 s. Open: the view's second camera's
  compile passes take about 45 s each, every pipeline already built (render objects rebuilt per camera).
- **A mesh with nothing to draw** (Dawn warned of a draw with an index count of 0 in the site's page): a storey's floor
  whose every piece its rooms' own floors took (the attic's) keeps its place in the level meshes' `parts`, hidden and
  out of the root and the warm-up (engine/gfx/level/meshes.ts).
- **The gym's courses from gate G10** (labs/playground/courses/{gaps,steps,crouch,landing,climbAgain}.ts): the gaps'
  (running across 3 m, sprinting across 5 m, slide-jumping across 7 m, and a superglide over the platform it mantled
  onto and the 5 m gap: the lane has no wall before a gap, so the 9 m gap's superglide is its flight's 10.0 m, not a
  run), on the contested 0.1 s hop window, since a place lands the player and a 3 m platform leaves no room for a 1 s
  run-up; the stairs climbed at the run's speed, the 45° slope walked to its deck and the 51° one refused; the duck's
  25 ticks of 16 ms after the press's own, getting up in the release's tick, crouch spam never down; the stun from 6,
  14 and 25 m and the run again a second on; a climb caught again only once the feet are 0.48 m up, 3.25 m under the
  cutoff. §2.3's stairs row says what the gym has, one stair of 0.25 m risers (the 0.10 to 0.20 m ones were never
  built, and §3.2's steps run to 0.56 m).
- **The page**: the gym's signs show where the gym stands on the site; the menu lists the site's scenes after the gym,
  by id. playground.spec.ts cycles the five cameras and both looks on the hill and, on one site page, from each area's
  spawn: the site's scenes are one block, each placing the player at an area's spawn, so one page placing it at each
  stands for them all.
- **Smaller calls**: `registry.kinds()` keeps its sorted list until a kind is declared (every prop and setting lookup
  asks); `findTarget` asks where a prop is before whether it can be used (a house holds hundreds); the terrain is cut
  where structures' floors cover a cell whole (its four quarters' middles), so a deck's posts and a ladder's foot leave
  the ground under them; `sweepBot` moved to engine/dev/botSweep.ts, bot.ts at its cap; the hydrant's cap a 2 cm limb
  (the view refuses a limb of no length; labs/playground/props/props.test.ts builds every part).
- **The review's fix** (the site's cutaway test failed in the crawlspace): the playground's `place` takes `crouch`,
  leaving the player ducked from the next step (no standing hull fits under the crawlspace's 1.4 m), and `roomPlace`
  (labs/playground/scenes/site.ts) puts him at a room's marker, ducked where a standing head would be in something
  solid; the crawlspace's marker stays against its walls (moving it changes the level's head colliders, merged by
  glyph, and so the replay's physics), a ducked body nudged 5 cm off them. In a classic view the cut by storey now
  also lifts the player's own storey's heads under a low ceiling (engine/gfx/storeyCut.ts: `cutPlace`'s `low`; the
  door heads go with it, one mesh), and hides the props standing on a storey it cuts off (`aboveStorey`, the site's
  `hides`, engine/gfx/stageProps.ts `hide`): an attic's chest no longer hangs over the hall. The house's walls cut
  `either` (a new rule beside `facing` and `blocking`, engine/gfx/level/recipes.ts: facing the camera, or between it and
  the player), since a wall with rooms or open storey on both sides faces no one way out, and its partitions
  `blocking`. Measured in Node by WP 12.3's eye (amendment 21): every camera sees the player in all 17 rooms, the shed
  and the front yard, first person the room past his body. The crawlspace has no lamp or switch: its light is WP
  13.23's.

## Amendment 21 (2026-10-22, WP 12.3): the agent eye

- **What it casts** (engine/dev/eye.ts): a ray from the view's camera through each cell's centre, the camera
  unprojected as the frame projects (its inverse projection, then its world matrix, so a classic view's height boost,
  engine/gfx/cameras/boost.ts, is in the ray; WebGPU's depth runs 0 to 1), cast at the read-only queries
  (engine/sim/queryView.ts) up to the far plane. The plan's "raster built from physics shapes" is these casts: the
  shapes are the queries'. A body an entity's component holds (`body`, the first holder in id order) is that entity's:
  the player, an actor, a prop by its id, else the component's name. Any other body is the level's.
- **What the frame draws** (engine/dev/eyeFaces.ts): the physics world keeps bodies where the frame draws nothing (a
  storey cut away, a wall the cutaway cut down, a roof, a prop on a cut storey, a collider's air round a chair's
  legs), so a hit counts only where a drawn face lies within 2 cm of it and shows to the ray (`drawnFaces`: every
  visible mesh's and drawn instance's triangles in world space, in a grid of 1 m cubes; a material's culled side does
  not show, as the ID pass draws it); elsewhere the ray goes on past it, up to 16 casts (`MARCHES`). A merged mesh's
  box would not do: a storey's door heads span the storey, their box round the floor above. An actor's body counts
  wherever it is, standing for his puppet, which the GPU skins.
- **First person** looks from inside the player's capsule, so the eye leaves the player's body out; its frame draws the
  arms, which have no body, and the agreement spec asks it only about the level there.
- **Headless frames** (`camera.follow(n)`, engine/app/viewMembers.ts and view.ts `follow`): headless runs no frames,
  so a view's camera stays where a dev action found the player and a follow camera's ball stays at its arm's base;
  `follow` moves it on by n frames of 1/60 s, drawing nothing and never stepping (view state only, never recorded), as
  a page's frames would. `x eye` moves the camera on by a second of them before it looks.
- **The picture**: `@` the player, `#` a wall, `.` a floor (a face within about 45° of up, `FLOOR_UP`), a letter per
  kind (upper case for actors), and its legend. `__engine.eye` looks at 96 × 54 cells by default (16:9, as the page);
  `x eye` prints 56 × 16 (a terminal's characters are about twice as tall as wide) and names six things at most.
- **Where it runs**: the member `__engine.eye` reads the view's camera, its scene and its queries (`RunView.queries()`,
  engine/app/view.ts: the QueryView the view already held for its cameras), so a page and a headless run with its view
  (`createHeadless({ view: true })`, which imports the member) both have it; `node x eye <scene>` is the second. The
  layer rule keeps three.js out of engine/dev: the eye's camera and objects are structural types, its math core/math's,
  and WebGPU's coordinate system its value (2001), which the unit test checks against three.js's.
- **Measured**: the trigger's question, in Node (labs/playground/scenes/site-eye.test.ts): with the player at each of
  the house's 17 rooms (ducked in the crawlspace), the shed and the front yard, every camera but first person sees him,
  first person the room past his body (finding WP 13.18's crawlspace, props and wall cuts, amendment 20's fix);
  tests/e2e/eye.spec.ts, the box's room-hero and hall-props, the hero at his spawn and walked two ways, 22 cameras
  (each classic view in both projections, the 3D cameras, the follow cameras and first person): the eye and the ID pass
  agree on 256 of 258 cases (99.2%; the Done-when's bound is 95%), both misses a follow camera still inside the hero's
  capsule two frames after a switch (from inside an actor's body the eye sees only him; his puppet, slimmer, may not
  fill the frame). The spec steps once before it looks: a scene's bodies join the queries at the first physics step.
- **Beyond its Owns**: engine/app/{view,headless,viewMembers}.ts and their tests (the members `eye` and
  `camera.follow`), tests/e2e/box-members.spec.ts (every member in the page), the tests beside each file, the house
  test, docs/GAME-GUIDE.md's command row and the stress-box skill's quick loop.
