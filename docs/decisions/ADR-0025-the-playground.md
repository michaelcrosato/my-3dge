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
  chairs to throw, and its replay (playground-interact, retired with the cottage at WP 13.18) opens the door, switches the light
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
- **The gate's review** (G11): `placeActor` takes `{ crouch }` (engine/sim/actors.ts; the playground's `place` passes
  it on instead of setting the motion itself) and refuses a place where the level stands over the feet lower than the
  hull's top, up its axis, with `SIM_BAD_ARGUMENT` and its fix (a place with headroom, or `crouch`): a standing hull
  put under a 1.4 m slab sank 0.45 m through the floor and stuck there, with no word. Only a ceiling counts, not a wall
  the hull touches (the camera-walls course puts the player against one), and a one-way platform lets it up through.
  The stage draws the props again in a frame only when the cut moved (engine/gfx/stageProps.ts `hide(test, key)` says
  so; the site's `cutKey`), not in every frame as the review's fix had it.

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
- **Headless frames** (`camera.advance(n)`, engine/app/viewMembers.ts and view.ts `advance`; not `follow`, which names a
  camera): headless runs no frames, so a view's camera stays where a dev action found the player and a follow camera's
  ball stays at its arm's base; `advance` moves it on by n frames of 1/60 s, drawing nothing and never stepping (view
  state only, never recorded), as a page's frames would. `x eye` moves the camera on by a second of them first.
- **The picture**: `@` the player, `#` a wall, `.` a floor (a face within about 45° of up, `FLOOR_UP`), a letter per
  kind (upper case for actors), and its legend. `__engine.eye` and `x eye` look at 96 × 54 cells by default (16:9, as
  the page); `x eye` answers at that size (its summary, `eye.txt` and `eye.json`) and prints the picture shrunk to 56 ×
  16 (`printOf`: a terminal's characters are about twice as tall as wide; a printed character shows the player's `@` if
  any cell under it does, else the thing most of them show, else a wall over a floor), naming six things at most.
- **Where it runs**: the member `__engine.eye` reads the view's camera, its scene and its queries (`RunView.queries()`,
  engine/app/view.ts: the QueryView the view already held for its cameras), so a page and a headless run with its view
  (`createHeadless({ view: true })`, which imports the member) both have it; `node x eye <scene>` is the second. The
  layer rule keeps three.js out of engine/dev: the eye's camera and objects are structural types, its math core/math's,
  and WebGPU's coordinate system its value (2001), which the unit test checks against three.js's.
- **Measured**: the trigger's question, in Node (labs/playground/scenes/site-eye.test.ts): with the player at each of
  the house's 17 rooms (ducked in the crawlspace), the shed and the front yard, every camera but first person sees him,
  first person the room past his body (finding WP 13.18's crawlspace, props and wall cuts, amendment 20's fix);
  tests/e2e/eye.spec.ts, the box's room-hero and hall-props, the hero at his spawn and walked two ways, 22 cameras
  (each classic view in both projections, the 3D cameras, the follow cameras and first person) and two each round that
  must not see him (`AWAY`: a fixed camera behind him looking away, the top-down view zoomed in 6 m east of him): the
  eye and the ID pass agree on 280 of 282 cases (99.3%; the Done-when's bound is 95%), the 12 that must not see him
  unseen in both answers; both misses a follow camera still inside the hero's capsule two frames after a switch (from
  inside an actor's body the eye sees only him; his puppet, slimmer, may not fill the frame). The spec steps once
  before it looks: a scene's bodies join the queries at the first physics step. In the box a wall or the pillar
  between a camera and the hero is no negative case: the cutaway cuts it, in the frame and so for the eye.
- **Beyond its Owns**: engine/app/{view,headless,viewMembers}.ts and their tests (the members `eye` and
  `camera.advance`), tests/e2e/box-members.spec.ts (every member in the page), the tests beside each file, the house
  test, docs/GAME-GUIDE.md's command row and the stress-box skill's quick loop.

## Amendment 22 (2026-10-22, WP 13.27): the follow cameras indoors

- **Never cut by what moves** (engine/physics/queries.ts `fixed`, Rapier's `ONLY_FIXED`): the cameras' casts, sweeps and
  overlaps meet the level's fixed bodies only (engine/gfx/cameras/collide.ts `Walls.fixed`, true by default), so a door
  that swings, a lift or a prop that moves passes through the camera, faded where it stands between it and the player,
  as a game's camera channel ignores its doors; the feel check's `inside` counts the same bodies
  (engine/dev/feel/camera.ts). The 3.45 m cut by the living room's swinging door (amendment 20) is gone.
- **The shooter** (shoulder.ts): its arm reads the room it will need before it needs it: toward each side, as far as a
  turn of the view at a body's 720°/s could take it before the arm, coming in, got there (`SHOULDER_ROOM.sides`), and
  back from where the shoulder point is going, by his velocity, its bend and the pitch turning on, over the next half
  second (`SHOULDER_ROOM.ahead`, the arm preparing at half its pace: a drop off a ledge, the climb down the attic's
  hatch, a jamb as he steps past it). A short arm draws the shoulder point in toward his chest at once and lets it out
  at 3 a second. The camera heads for the arm's end as `moveCamera` moves it (`SHOULDER_KEEP`: in sight of its own
  ball, along his trail however near once out of his sight), carried with the pivot and the view, not with a turn
  that would carry it into a wall; where his chest stands past 60% of the picture's half-height it shifts across the
  view toward him, its own moves held to 1.5 × `COLLIDE_PULL` (0.25 m a frame, under §4's 0.3). Tried and dropped: a
  camera standing on its arm, never past the first wall, which lost the player in 19 of the soak's frames but popped
  0.7 to 2.9 m on ten of the gym's courses, wherever the arm sank onto a ledge behind a drop.
- **The platformer** (follow.ts): `moveCamera` keeps a trail of its base (`CameraBall.trail`) and, out of its sight,
  goes along it to the newest point it sees (a door, a corner); held off its arm it looks toward its pivot
  (`FollowState.aim`, at most 120°/s; right over it, straight down at 180°/s); its look-ahead scales by the share of
  its arm the camera stands out, so a camera held in close looks at him, not a metre past him.
- **The bot's look** (engine/dev/bot.ts): it turns toward its heading at a body's 720°/s, as a mouse would, its keys in
  the heading's frame (`cam`), so it walks as it did; the soak's view no longer turns 90° in a frame.
- **Measured** over the house's soak (labs/playground/scenes/site-soak.test.ts, 5,127 frames, every camera's bounds
  judged, none watched): the shooter's jump 0.19 m, turn 0.008 rad, inside 0, lost 0 (about 7% before); the
  platformer's jump 0.19 m, turn 0.054 rad, inside 0, lost 0 (most before); first person, isometric and top-down as
  before. The gym's 25 courses keep their 1,767 measures (`node x feel labs/playground`).
- **ESC-0002** (the shooter's bound where less than 0.6 m lies behind his chest): decided in the owner's absence, §4's
  bound kept as written; no frame needed the unframable count the call allowed.
- **Found**: Rapier 0.21's heightfield misses ball casts: of the hits a ray finds against a heightfield of 16 to 96
  cells a side, its ball casts miss 11 to 24% (and a ray up a slope missed at 96); a triangle mesh of the same cells
  misses none (a probe; the hill's shooter stood in its terrain for 21 frames while its arm trusted those casts). Not
  needed now (`moveCamera`'s overlap test keeps every camera out of the hill), so proposed, not done: stand every
  terrain as `addTerrainBody`'s triangle mesh (engine/sim/levelBodies.ts), the hill's replay re-recorded.
- **Beyond its Owns**: engine/physics/queries.ts (`fixed`), engine/dev/feel/camera.ts (`inside` against fixed bodies),
  engine/dev/bot.ts and its test (`LOOK_TURN`, `cam`).

## Amendment 23 (2026-10-22, WP 10.4): the gameplay kits

- **Things** (engine/world/things.ts, engine/sim/things.ts) are props that count their hits, go down and stand back up
  after their kind's `rise`, or break (`rise` below 0), and slide along a track: the kind `thing` holds the prop, the
  numbers and the hooks `hit`, `down` and `up` (asked of the entry); a scene's thing is its prop, kinematic, holding the
  component `thing`, struck through WP 13.16's `defineStrikable` (a melee hit or a shot a point, a blast all it has),
  its body driven along its track by the system `things` (`driveBody`). The range's pop-up and moving targets (WP 13.20)
  and the ring's dummies (WP 13.19) are things; a door or a pane stays WP 13.16's.
- **Projectile patterns** (engine/world/patterns.ts): a shot emitter's volleys (aimed, forward, ring, spiral, random
  from a named stream) and timing (delay, interval, bursts and their pause, range) over WP 6.3's swept shots, so no
  pattern tunnels. Its names say *shot* emitter (`ShotEmitter`, `SHOT_EMITTER`, `stepVolleys`): `Emitter` is already
  the particle effects' kind (engine/gfx/fx/emitters.ts). Volleys fall at the delay and whole intervals after it, each
  on the step that reaches it, the overshoot kept, so a coarse step keeps the rhythm.
- **Awareness** (engine/world/awareness.ts): beyond WP 5.2's sight, which the caller still tests (a grid's `canSee`,
  a ray on a site), the noises an agent hears (each within its loudness times the agent's hearing, half as far through
  a wall the caller names) and its memory of where it last saw or heard (`memory` seconds), with `alerted` the step it
  first knows: the neighbours' startle (WP 13.21).
- **The public API**: their names are listed in engine/sim/kitsApi.ts, and the crowds' and combat's (WPs 5.1 to 6.4)
  moved to engine/sim/combatApi.ts, both re-exported whole by engine/sim-api.ts (400 lines, at its cap, now 302): the
  split PROGRESS.md asked for on its next change, the names and their paths unchanged for game code.
- **Measured**: engine/world/{things,patterns,awareness}.test.ts and engine/sim/things.test.ts, 19 tests; the
  Done-when's bound in patterns.test.ts: every shot of every pattern, 60 m/s (1 m a step), stopped on the 4 cm post
  across its way, never past it.
- **Beyond its Owns**: engine/sim/{things,kitsApi,combatApi}.ts and their tests, engine/sim-api.ts.

## Amendment 24 (2026-10-22, WP 13.19): melee and the door kick

- **The door kick on the procedural body, not the clip**: the WP and docs/PLAYGROUND.md §5.1 name Mesh2Motion's
  `Kick_Breach`, its hit at the strike, but the player is the procedural humanoid and the library's clips wait for WP
  8.8's contacts (amendments 10 and 11); a clip layer on him would also load the library into the page. Built instead:
  the engine's door kick, `move:breach` (engine/anim/moves-data.ts `ADDED_MOVES`: a front kick, the sole at the lock's
  height), timed on the clip: its hit 0.83 s in, where `Kick_Breach` lands its strike (engine/anim/clip/library.ts
  `strikeTime`; its 1.83 s hold a step back the body does not need: the move is 1.41 s). Its own lunge is 0: at the
  port's kicks' 0.025 m the planted foot still slid 6.5 cm (the anim QA's 5 cm), and the sim's lunge moves the body.
  The punch is the engine's cross, the air's kick `move:kick` and the slide's uppercut `move:uppercut`, each drawn out
  so its hit lands at Apex's 0.35 s (the cross's own clip, Mesh2Motion's `Punch_Cross`, strikes at 0.33 s).
- **Melee** (engine/sim/melee.ts, the system `melee`): Apex's numbers (§3.2) as `MELEE`: 30 damage to a person (an
  actor with `health`, engine/sim/damage.ts), a reach of 1.52 m in a 30° cone, the lunge until the hit (0.35 s), the
  hands back 0.75 s after a swing began, a 0.25 s hit-stop. Ours: the lunge closes to 0.9 of the move's measured reach
  (engine/anim/moves.ts `measureMove`), its speed toward the target's point set each step (so the model's friction
  cannot leave it short), 8 m/s at most; one target a swing; the cone is a fan of five rays at three heights (scaled
  down crouched) through the physics world (engine/sim/hits.ts `fanHits`), so a wall hides what stands behind it; the
  facing is the step's (its aim, else its look), as the movement model turns him.
- **Faced** (Apex's door rule; amendment 19's hand-off): the target as the swing began; at the hit the first in reach,
  faced only when it is that one. A strikable entry may name the move a melee plays on it (`defineStrikable(component,
  strike, move)`: a door's is the kick); else a slide gives the uppercut, the air the kick, the rest the punch.
- **No mantle while a swing plays** (engine/physics/movement/mantle.ts): the model's air mantle starts at any ledge
  the body moves at, and an air kick's lunge climbed the dummy it kicked; `CharacterInput.swinging`, from the actor's
  `melee`, holds it off.
- **Seen**: third person through the animator's `states.body` (the arm path, WP 6.1); first person, the kick's leg
  (amendment 12's) and the punch's fist where the body's goes from its eyes (engine/gfx/viewmodel/rig.ts `punch`); a
  hit kicks the view back 1.5° and shakes it 2 cm, by each camera's share of the punch (engine/gfx/cameras/effects.ts,
  `melee.hitAt`).
- **Sound**: the events `melee` and `strike` (and the dummies' `thingHit`, WP 10.4's), which WP 13.22 voices: the
  playground has no sound before it, and its coverage test asks a sound of every event the playground emits.
- **The ring's dummies** (labs/playground/cast/dummies.ts): things (amendment 23) standing as `prop:playground-dummy`,
  three on the canvas, sprung into their bases (1.4 Hz, damping 0.22, 2.6 rad/s a hit, 0.5 rad at most; the component
  `sparring`, the system `dummies` driving the body about its base); a hit's points come back at once, so a punch never
  puts one down, a blast for its 3 s rise. The two that ragdoll and get up are WP 10.2's.
- **The site's replay** (tests/replays/playground-site.replay.json): its two instant strikes are door kicks now, so its
  second press moved 180 steps after the first, a look toward the burst leaf before it (the 30° cone), and everything
  after it 140 steps later; its goldens re-recorded (tests/replays/README.md). The site gains melee and the dummies.
- **Found by the page**: WP 13.27's shooter camera divided its look-ahead's rates by a frame's dt, and a page's
  warm-up frame of no time made NaN casts (the playground did not start): fixed in 3bcb765, with a test.

## Amendment 25 (2026-10-22, WP 13.20): firearms

- **The kind `weapon` in engine/world/weapons.ts**, not engine/sim/weapons.ts (the WP's Owns): the view draws a gun
  from its kind (its prop, its muzzle, its sights' lens), and the layer rule keeps engine/gfx from the sim's values.
  The sim's half (the component `weapons`, the system `weapons`) is engine/sim/weapons.ts.
- **Hitscan from the eye or the chest**: with a look (first person, the shooter) a shot leaves the eye (Apex's 1.52 m,
  0.81 m crouched: engine/sim/interact.ts `EYE`) toward the step's aim, the crosshair's point; without one, level from
  the chest (1.3 m, 0.75 m crouched: engine/sim/weapons.ts `CHEST`) toward the pointer's point (isometric, top-down)
  or where he faces (the platformer). The view meets the pointer's ray at the chest's height, not on his floor
  (engine/input/aim.ts `height`), so the pointer over a target aims at it: met on the floor, isometric's 30° view aimed
  2.25 m beyond what the pointer was over (the verifier's finding). It is the physics world's raycast through the
  level, props, people and crowds, his own body aside. The cone is drawn from his stream `weapon`, uniform over its
  disc, and turned in the aim's own frame, so it stays round at any pitch; the hip's and the move's half-angles ease to
  the sights' as they come up (`spreadOf`). Aiming down the sights walks (Apex walks only then), on foot or in the air.
- **Recoil once**: the burst's kick (each shot's step of the weapon's `recoil`, [up, right] degrees, the last
  repeating) turns the shots in the sim, so spread and recoil follow the weapon's data in Node; `settle` seconds after
  the last shot the burst ends and the kick falls away with the time constant `recover` (0.15 s, ours), so a shot
  fired meanwhile goes where the still-raised picture's centre is. The view takes the kick as it is (the effects' frame
  `recoil`) by the camera's aim share, whole in first person and the shooter, the two cameras that aim with their
  centre, so it is where the next shot goes (the verifier found the shooter climbing by its punch share, half), and the
  rig's `aimPose` leaves it out of the aim's ray, so the page's recorded aim does not carry it into the sim a second
  time. The rig's spring `kick` stays for a game's own kicks.
- **Drawing, holstering, reloading**: 1 and 2 draw the pistol and the rifle, `swap` the other, 3 holsters (and draws
  again), the trigger draws a holstered one; each takes the weapon's `draw`. Holstered he runs Apex's ×1.15 (the
  shooter model's `motion.holstered`, which only the spawn set before). A reload is `reload.tactical`, from empty
  `reload.empty`; the magazine's last round brings it on, and an empty trigger clicks (`dry`). A melee swing holds the
  trigger until the hands are back (`MELEE.back`, 0.75 s).
- **The pad's held bindings** (engine/input/codes.ts `Hold:<code>`, `HOLD_TIME` 0.3 s, ours): Apex's X held reloads
  and Y held holsters, a tap of X uses and of Y swaps; the input holds a code back while a held binding waits on it,
  so a tap presses its plain action on release and a hold never does (engine/input/input.ts). Amendment 9's hand-off.
- **The gun drawn**: in third person its prop, drawn by the stage's props (`carry`) at the right hand's grip with +Z
  along the hold's barrel (amendment 11's) and +Y as near up as that leaves. In first person a mesh per weapon of its
  prop's parts as one geometry, coloured by their tints (`gunGeometry`), in the arms' vertex-coloured material by their
  lens, so first person adds no material; made for the weapons defined when the arms are, so the warm-up builds them,
  and for one defined later the first time the body holds it; its barrel the body's turned from the body's look onto the camera's, the
  arms' grips taken from the right eye as the sights come up, so they line up on the picture's centre, and a shot
  kicks it 3 cm back and 0.05 rad up (`GUN_KICK`). Shots leave the muzzle as it is drawn: a tracer (50 ms), a flash
  of sparks, and where a shot struck the impact's star and sparks and a hole facing the surface (the latest 64 kept).
- **Sound**: the events `gunshot`, `draw`, `holster`, `reload` and `dry`, which WP 13.22 voices, as amendment 24's.
- **The guns** (labs/playground/weapons/guns.ts): props of parts (no body) and Apex's season 3 rate, damage, magazine
  and reloads of the P2020 and the R-301; their cones, recoil patterns, sights' times and draws are ours. The gallery's
  review closed the pistol's trigger guard, hung a trigger in it and seated the rifle's magazine in its receiver; the
  rifle reads near black (its iron parts dark under the gallery's light), kept: the brief asks for none lighter.
- **The range's targets** (labs/playground/weapons/range.ts): things (amendment 23) instead of WP 13.18's fixed props:
  pop-ups at 10 and 25 m, movers sliding 2 m across their lane at 1 m/s at 50 m; one hit puts one down, falling back
  about its base (the component `popup`, the system `poppers`), up again 2.5 s later. The HUD shows the weapon out, its
  rounds and the range's count, hits of shots, and the crosshair while the screen's centre aims one.
- **The site's player is armed**: every site scene's player carries the pistol and the rifle, holstered, and the site
  adds the system `weapons` and the range's targets, so the site's and the ring's replays (playground-site,
  playground-melee) took new goldens, their stories unchanged; the gym's scenes stay unarmed.
- **The draw eases** (engine/anim/traversal/hold.ts `drawn`, `HOLD.draw` 0.25 s, ours): found by the range's course,
  whose draw popped the hands 0.59 m in a step (the anim QA's 9/16 m). The view makes an actor's animator again when
  its weapon changes (the weapon is part of the humanoid's make, engine/anim/character.ts `AnimatorPool`), so a new
  hold snapped onto the gun; now the hands come onto a gun drawn and leave one holstered over 0.25 s by the body's
  clock, and a hold made again follows the old one's draw (`follow`), in the page and in the feel kit alike. A body
  that starts with a gun holds it at once, so the states' sheets and the anim QA pose as they did.
- **§5.1's muzzle as a course measure** (amendment 11's hand-off): the feel kit's metric `muzzle`, the farthest the gun
  hand's barrel line (the right hand's +Z, which the hold lays on the barrel) points from the aim while the sights are
  fully up, past any bound for a span that never aims; the range's course (labs/playground/courses/range.ts: both
  guns down their sights, the looks glided to as a mouse turns them, rounds and bursts fired) judges it against 2°.
- **The range's replay** (tests/replays/playground-range.replay.json, written from a scripted run that aims each shot
  at its target's plate as the sim has it): each kind of target down, the hip's third round and a burst's last into
  the backstop, a reload and the holster; its story is labs/playground/weapons/range.test.ts. Writing it found the
  first recoil numbers too steep (a rifle burst climbing 4° in seven rounds, over the 3 m backstop): the guns' kicks
  were halved (the pistol 0.9° a shot, the rifle 0.5° falling to 0.2°).

## Amendment 26 (2026-10-22, WP 10.2): ragdolls

- **Joints as data** (engine/physics/joints.ts, beyond the WP's Owns: §5.8's port of shardfall's joints): fixed, ball,
  hinge, slider, rope and spring, to another body or to the world (a fixed anchor body of its own), in SI. Ours: a
  joint's frames are set so it rests at `rest`, `b`'s rotation relative to `a`'s (theirs at the hand-off by default),
  so a hinge's limits and every spring measure from there, whatever the pose a joint is made in. Two traps of Rapier
  0.21's JS, measured: it hands a ball joint back typed as a generic one (its motors missing), so a ball's springs go
  through its own class over the same handle; and it has no limits for a ball, which its joint set's raw per-axis call
  (what a hinge's `setLimits` calls) gives: exact for a turn about one axis, the quaternion's share about each for a
  turn about several. Not ported: shardfall's chain and bridge builders (nothing here needs them yet).
- **The ragdoll** (engine/physics/ragdoll.ts, engine/anim/ragdoll.ts): eleven parts at their bones' frames (the pelvis
  with the hips, the chest with the shoulders, the head, the arms' and legs' two segments, the hands and feet on the
  forearms and shins), capsules at `bodyCapsules`' radii, in the group `corpse`; balls at the spine, the neck, the
  shoulders and the hips within a body's limits (the spine and neck sprung toward straight), hinges at the elbows and
  knees about the IK's own hinges, each joint at rest in the T-pose. A first build without limits folded a neck 174°
  and a knee to its stop; with them, over eight measured falls, a knee goes 10° past its limit for a moment (21°
  without the parts' four extra solver passes: engine/physics/world.ts `solverIterations`) and an elbow still swings
  24° past as a hand strikes the floor. A fall lies still (its fastest part under 0.3 m/s, a turn counted at 0.1 m)
  1.7 to 4 s after the blow; it gets up after 0.5 s still, or 5 s after the blow however it lies.
- **The hand-off** (engine/sim/ragdolls.ts, beyond Owns: the sim's half): the body posed from its animator's data
  where it stands, every part moving as it did plus the blow's push and a tip over it; its reactions down for as long
  as it takes (or dead); its capsule kept under the pelvis, so the cameras follow, and the actor moving nothing
  meanwhile (engine/sim/actors.ts skips it, and `removeActor` takes its parts). It gets up where the humanoid lying as
  it lies would stand (its pelvis the ragdoll's, measured over 4 s of the lying body's breath and sway, ±2 cm), facing
  as it would, and its reactions get up the way its chest lies. A scene adds the system `ragdolls` in its setup
  (`addRagdolls`): one added at the first hand-off made a capture taken after it unrestorable into a fresh world.
- **The view** (engine/gfx/puppets/actors.ts): a ragdoll layer last in the physics slot of every puppet, the parts
  between their last two steps, faded in over 0.1 s and out over 0.3 s as the get-up shows (`RAGDOLL_FADE`).
- **The box's setting** (labs/box/scenes/ragdoll.ts, `box:ragdoll`): four partners in the room fall on an 8 s cycle
  to a blow from the front, one from behind, a launch and a death; `box.ragdoll.handOff` off, they fall through their
  timelines instead. Its replays are tests/replays/ragdoll-falls.replay.json and ragdoll-strike.replay.json (the
  hero's attack). The box's crowd (the fight's walkers) does not ragdoll: they are crowd bodies, not actors.
- **The ring's partners** (labs/playground/cast/partners.ts): the two of §7.3 that ragdoll are people (actors on
  `build:adult`) in the canvas's south corners, not two more of amendment 24's dummies (props on springs): a punch or
  a shot flinches one, a kick or the uppercut hands it off, and its hit points come back at every blow. The site's
  three replays (playground-site, -melee, -range) took new goldens for them (hashed), their stories unchanged.
- **The film's review** (2026-10-23): the box's film showed partners lying motionless 2 s and more before rising. A limb
  went on swinging after the body lay still: an arm standing on its hand, toppling and springing back up off the floor,
  or a leg trapped under a launched body, its hip 1.4 rad past its twist limit and coming back. It lay still by every
  part up to 3.4 s after its trunk did (1.1 s on average). A ragdoll now gets up once its trunk (the pelvis and the
  chest) has lain still 0.5 s, the limbs' last poses laid into the get-up as the ragdoll fades. Over 24 measured falls
  (the three living partners' blows at eight pushes from 2.5 to 8 m/s) it gets up 1.5 to 3.6 s after the blow (2.2 s on
  average, 3.1 before), but for one launch at 7 m/s whose trunk rolled again (5 s). More solver passes (8, 12 and 16 a
  step) and more damping (the parts' or the joints') changed the limbs' swing and the hip's overshoot only within the
  falls' scatter, so they stay as they were. The first partner slid into the south wall's foot, where the cutaway hides
  it, and the second fell onto the pillar: they stand where each falls on open floor in view, the dead one too. Filmed
  again, the third, launched up and a little east, came to rest along the low wall's foot: it is launched to the
  south-east, away from it, and lies 2 m clear.

## Amendment 27 (2026-10-23, WP 10.1): procedural building blocks

- **The blocks** (engine/anim/proc/, one concept a file, the techniques of PLAN.md §5.6 as mechanisms): springs with a
  kick (`Spring1`, `Spring3` and `SpringQuat`, the last new: no source has a turn's spring) stepped by the damped
  oscillator's exact solution, so 60 and 120 steps a second settle alike and no frequency is too stiff; eased state
  weights and the pose stack (`StateWeights`, `layerPose`: its angles not wrapped, as the source's); the digitigrade
  leg; sway chains (`SwayChain`, keeping its links' lengths, which the source's tail did not) and the lagging part
  (`LagPart`, a sprung tip on its sphere about its pivot: the source's abdomen, driven by the turn rate alone, moved a
  hundredth of a radian); the planted gait (`LegGait`); path chains; looking (`LookAt`, bounded, the angle left
  shrinking by e^(−rate dt), a target behind turning it: the source's nlerp had no bounds and stuck there) and
  blinking (`Blink`, from a named stream, not `Math.random`); hovering; orbiters (their angle integrated: the source's
  time × rate jumped when the rate changed) and detached parts; pose history (between records, not the one before);
  extras on sockets; tip trails (by time, with a base for a ribbon); and the measured reach (its last moment exactly 1).
- **The gait, beyond the sources**, each found by a fixture rig's check: a foot aims its landing past the spot it
  measures from, the rest spot `lead` ahead and 0.35 of its step further, as the source's (`BST_Crawler`; the first
  port left the lead out, and at speed its foot landed behind where it measured, so it stepped again at once, and the
  biped's force rule lifted both its feet); a body standing still squares its feet up
  (`threshold.still`, shardfall's two-level threshold, so a rig comes back to its rest); and the gait steps in inner
  steps of 1/120 s (`GAIT_SUBSTEP`), the body moving linearly between its steps, so 60 and 120 steps a second take the
  same decisions (the hexapod's rate check found its feet 5–7 cm apart). A wall is found by a ray from the hip toward
  the spot (the source marched tiles); the ground by a ray down from above it.
- **The path chain lays the body out as its path** at `reset`, so a head rising from rest lifts its neck and leaves
  the rest lying (the serpent's check found the body hanging below the floor along the newest stretch's direction).
- **Two blocks the engine had**: the verlet strand is engine/anim/chain.ts's `Chain` (WP 6.2: gravity, drag, wind,
  iterations, colliders, the floor, a rest shape and a fixed inner step), so WP 10.1 maps its block to it rather than
  writing a second; and the block the plan calls `Floater` is `Hover` (engine/anim/proc/hover.ts: hover, bank, lean and
  fold), since engine/anim/floater.ts's `Floater` is the stress world's wisp, kept as it is.
- **The rig contract** (engine/anim/proc/rig.ts, beyond Owns): `anim.check` is bound to the humanoid's 23 joints
  (engine/anim/check.ts), so a procedural rig names its own points, bones, feet and states (`ProcRig`) and `rigCheck`
  holds it to the same contract (finite, bones their length, over the floor, the same every run, the same at half the
  step). The `anim` QA family drives the six fixture rigs through their states as `rig:<name>/<state>` with its motion
  metrics too (tools/qa/anim/points.ts, split from tools/qa/anim.ts at its cap, the blob's and the wisp's runs as they
  were): 25 states, none over its bounds.
- **Public names**: engine/anim/proc/api.ts, re-exported whole by engine/sim-api.ts as engine/sim/kitsApi.ts is; three
  names chosen against clashes with the API's own (`LookAtOptions`, `HoveringOptions`, `TipSample`).
- **The review** (2026-10-23, the verifier at 9b5ebf7): the force rule measured its bypass against the standing
  threshold (1 cm), so feet 2.3 cm off stepped whatever the others did: the hexapod lifted both tripods in 50 of its
  turn's 138 frames and the biped both feet as it stopped. It is measured against the moving threshold now (`base` and
  its speed's share), as the source's; and the feet waiting start the farthest first, for in a turn in place the first
  tripod, landing, stepped again before the other could and starved it. `fly` now leaves the gait where the body is, and
  feet in the air land under the body as the step ends (they landed 0.5 m up after a 1 m drop at 60 Hz). The serpent's
  rise wrote its head's height into its path, so its neck stood on in a column after it lowered (`closed: 3` hid it):
  its neck now curls up by a lift fading down six segments, as the source's, and its rig closes every point but in its
  slither. A rig naming a point or a state it lacks threw a bare TypeError: `ANIM_BAD_RIG` now, its fix and the closest
  names. A bone may give its length (the multi-arm's do); `closed` may be given by state (`rigClosed`); the QA reads its
  runs through `driveRig`, cloned; and T1's QA test holds the fixture rigs' ids too. The multi-arm's blades go on by
  `placeExtras` and the serpent wears a crest by `along`, so the blocks the README credits are the ones the rigs use
  (`blendAngles`, round the circle, in its unit tests only). Its second reading (at 8ad16fd) passed, with notes, three
  taken at once: a flight eased once a step parted 60 Hz from 120 Hz by 0.36 m after a hop, and a body easing its speed
  by up to 0.15 m in 30 of 54 runs (the inner steps held the step's end velocity), so the gait eases a flight in inner
  steps too and moves the body's velocity on linearly between steps as its place (3 of 54 runs left over the bound, by a
  threshold met an inner step apart); a rig's numbers are checked (a bone's length, a closure, a state's seconds); and
  the serpent's spines lean back, toward its tail. Left as they are: feet in a fast turn in place, 4 rad/s, can still
  lift both tripods for a few frames (the corners of one land and start again before its middle leg is down); a standing
  body squares its feet up to 1 cm, so a turn in place shuffles (a feel question for WP 13.21's dog, whose gait sets its
  own); the serpent's curl stretches its neck's first link 18%, as the source's. Kept: the fixtures' one-statement lines
  over 120 columns, the codebase's own `prettier-ignore` idiom, so their 86 to 118 lines are counted as written (114 to
  190 as Prettier would lay them out).
- **The rig template** (tools/templates/rig/, `node x new rig labs/<lab>/rigs/<name>`): a small four-legged walker on
  two diagonals, written once six rigs were written by hand; a start for WP 13.21's dog.

## Amendment 28 (2026-10-23, WP 13.21): the neighbours and the dog

- **The neighbours** (labs/playground/cast/neighbours.ts): four people about the block, each on a round of two stops
  kept on a schedule (`followRoute`, engine/world/aiRoutes.ts: the stop it walks to and since when it stays, a
  component), strolling at 1.3 m/s over the site's navigation round its props, a flow field a stop. Each knows the
  player by WP 10.4's awareness (in sight within 14 m, nothing of the world between their eyes; a shot carrying 40 m,
  a kick 12) and reacts as §7.4 lists, each reaction an event `neighbour` `{ id, what }`: it looks at him within 6 m
  (its head along its intents' `look`: engine/app/view.ts turns any AI actor's head so, not the player's alone), steps
  aside to its right where he stands in its way (`stepAside`, 1.6 m ahead and 0.7 m of its line), flinches when he
  runs into it (within 0.85 m, closing faster than 1 m/s), startles at a shot or a kick it hears (a light hit away from
  it and a look), falls to a hard blow (the kick and the jump kick, `PARTNER_BLOWS`, the ring's own: WP 10.2's
  hand-off) and gets up the way it lies, and flinches at a punch or a shot (a shot puts none down: it was heard first,
  and the ring's partners fall only to the same blows). Two sit on the benches' stops (`action:sit`, a data action of
  the playground's: its pelvis back and down onto a seat behind it, its feet planted ahead, until told to rise) and
  rise when their stay is over. Their hit points come back at every blow (cast/health.ts, shared with the partners).
- **Their bodies** (labs/playground/bodies/neighbours.ts): the player's body, its parts as they are, its slots drawn
  from palettes by a seed each (`Rng(2113 + k)`), never in his orange accent, so he stays the one marked from every
  camera (§3.1); bare-handed, the gloves their skin and the cuffs their jacket's (the player's body names its cuffs
  `cuff`, in his accent's colour, so a neighbour's hands do not read as gloves in its accent: the frame review). The
  page registers them with its bodies; tests that draw the site import them as they do the player's.
- **The dog** (labs/playground/cast/dog.ts) is Biscuit, shardfall's town dog (`arpg/scene.rs:974-981`: the quadruped
  preset at 0.72, its colours): a new rig in the engine, `Quadruped` (engine/anim/quadruped.ts: its state plain data,
  for a crowd body), not a fixture or a template's rig, because the stage cannot draw a lab's own mesh (a frame has no
  scene) and the crowd draws rig bodies on any joints (the blob's and the wisp's way): the crowd body rig `quadruped`
  (engine/sim/crowdBodies.ts, its feet on the physics ground through `crowdGround`, a raycast through `world`) and its
  body `QUADRUPED_BODY` (engine/gfx/puppets/bodies/quadruped.ts). Its legs are WP 10.1's planted gait (`LegGait`, two
  diagonals: `save` and `load` new, a gait as plain data), the front two bones with the elbows back (shardfall's
  mammal legs), the hind three by `digitigrade` (the stifle forward, the hock back: new, shardfall's are two). Its body
  rides over its front and hind feet's ground, bobs 2.5 cm with its feet in the air (Σ sin πt, as `lifting`: a spring
  kicked at each footfall, the biped fixture's way, sagged it 3 cm while it walked instead) and lowers 7 cm as it runs;
  sitting drops its hips 0.14 m and draws them back 0.08 m, its stifles forward, its long feet flat and its paws
  planted, and lays its rump on the ground behind them (a joint of its own, `rump`, as a pelvis tilts: on the torso,
  the frame review found it 9 cm off the ground and the stifles folded back, a crouch), its tail along the ground;
  its head looks where it is told within 1.1 rad and 0.6 up or down, and looks about while it stands (shardfall's);
  its tail wags as told. Its heading and head follow their targets as
  an exact first-order lag (the target moving linearly between steps): an ease of 1 − e^(−rate·dt) toward a moving
  target parted 60 from 120 steps a second by 4.6 cm in a turn in place.
- **The dog's gait, tuned to its legs**: WP 10.1's defaults let a planted paw stray past its leg's reach from 2 m/s
  (shardfall's legs reach 0.17 m across from under their roots), so the dog's strides are shorter (a threshold of
  0.09 m and 0.015 m more a m/s, a lead of 0.03 s, steps of 0.045 to 0.14 s) and its body lowers as it runs: speeding
  up at 15 m/s², a planted paw stays on its foot at any steady pace to 6 m/s and within 6 mm in the first half second.
  The `anim` QA drives it as `rig:quadruped/<state>` (rest, walk, trot, run, a turn in place, sit, look): 7 states,
  none over a bound. Its drive eases a speed in and out over 0.3 s, as an actor's body speeds up and brakes: a step
  change of speed parted the two rates by 13 cm at the stop, a discrete choice of which diagonal squares up first.
- **What the dog does**: it stands beside the player's spawn in every area, facing him from the first, its ball
  (`prop:playground-ball`, a tennis ball, 58 g, bouncing) 0.45 m before its middle, just before its paws, toward him and
  off his way (laid before him, the bot's tour kicked it ahead to the front door, where a use took it up instead of the
  door and the tour went another way; laid ahead of the dog facing his way, it lay by its hips once the dog had turned
  to him: the frame review), at the first of six spots beside him where the dog's paws and its ball lie flat, clear of a
  kerb or a step (the street's sidewalk, 2 m wide, leaves none: there the dog stands on the driveway, its ball 0.34 m from
  the sidewalk's edge, whose foot hid a ball laid against it: the second frame review). Its first step stands its feet
  even told it is aloft: an actor is not grounded on its first tick, the world's queries seeing no ground before the
  first physics step, and its gait, flown from a fresh state, swung its feet from the world's origin (`LegGait.fly` now
  tucks a gait's feet at once while it has never stood). It trots after him beyond 2.2 m and runs beyond 7 m
  (shardfall's 2.4 and 7), sits once he has stood still a second, gets out of his way when he walks at it (actors pass
  through each other, so it is courtesy), chases a ball he throws, slowing as it comes, picks it up lying under its
  mouth, carries it back pulled to its mouth as a player's carry is, and lets it fall 1.4 m from him. Its capsule is an
  actor's (it collides with the world and climbs a kerb); its rig steps in `readback`, from where the capsule moved,
  since the platformer controller snaps an actor's yaw to its move (the rig eases toward it).
- **The ways** (labs/playground/cast/ways.ts): one navigation of the block a world, round its props, shared by the
  neighbours and the dog. A scene's setup sees none of its own props (entities spawned there reach queries after it),
  so the ways are made at the first step that asks, and the boxes they went round are kept in the world (the component
  `siteWays`, with a count of remakes), so a world restored from a capture makes the same ways the run had then. A
  walker held by what its ways do not know (a door the bot opened swung its leaf onto the dog in the hall) has them made
  again round the props as they stand, as the bot does, and the dog backs out the way with the most room; held again
  (the leaf had swung into its capsule, which a character controller cannot walk out of) it is set down on the clear
  point of its tile or one beside it on its own floor, and waits 4 s. `plainWays()`, the site's alone, places the dog
  and its ball in the setup.
- **Two spots the soak found**: a neighbour's nav built in the setup saw no props, so the porch's walker met the front
  yard's fence and the gardener the patio's grill (the ways are made at the first step now); and the gardener's second
  stop stood 0.12 m from the house's back wall, nearer than its capsule can come (moved 0.6 m off it).
- **Measured**: the house's soak (labs/playground/scenes/site-soak.test.ts) judges the cast through the bot's tour of
  every room and 15 s after it: no neighbour and not the dog stuck (told to go and not 0.3 m on for 8 s; the dog's one
  hold, the door's leaf, lasted 6 s), every neighbour at each of its stops, the dog with the player again, and every
  camera still inside its bounds.

## Amendment 29 (2026-10-23, WP 13.22): the playground's sound

- **The map** (labs/playground/sounds/events.ts): every event the playground emits plays a sound, from the engine's
  foley (engine/audio/data/foley.ts, 41 effects: steps on seven surfaces, the moves, doors and windows, blows, impacts
  by material, the guns, the wind) and its own (labs/playground/sounds/effects.ts: the dog's bark, whine, huff, tags and
  bouncing ball, people's wordless voices, the bench's creak, and the two beds). It asks the entries, never the ids: a
  weapon names its shot (`sound`, a new field of the kind `weapon`, which the sim never plays), a move its limb (a
  kick's blow or a punch's), a prop its make (its biggest part's material: the dummy's pad is soft, the target's plate
  metal, a door's planks wood), a thing its prop, a door how it opens (a window and the garage's tilting door slide),
  the ground its surface under the feet. One event can sound twice (a shot at the muzzle and where it strikes), so a
  scene's `sounds` hook may give a list (engine/sim/scene.ts; `x audio --replay` reads each). Quiet by design: a
  slide's footsteps (its scrape is the `move` it begins) and a hit that downs its thing (its `thingDown` sounds once:
  with both, the range's mix peaked at 1.03 and clipped); a gunshot at a thing leaves its impact to the thing's own.
- **Footsteps by surface and gait** live in engine/world/footsteps.ts, not the planned engine/audio/runtime/: the
  scenes' sound map is sim-side and reads them through engine/sim-api.ts, which may re-export sim-side layers only
  (audio/runtime is a page's; audio/data registers its effects when it loads). The gait is the movement model's
  (`motion.gait`), else by speed (a walk under 2.6 m/s, a run under 5.4, then a sprint).
- **The ground** (labs/playground/sounds/ground.ts, `SITE_GROUND`): a house room sounds as the floor `HOUSE_ROOMS`
  names; the playground's sidewalks and road line carry tags of their own (concrete, asphalt: labs/playground/levels/
  street.ts); a structure's floors as `FLOORS` names them (the street's asphalt, the path's flagstones, the shed's,
  the treehouse's and the lookout's wood, the ring's canvas as carpet); off them the terrain's (grass, rock where
  steep). A flat paving's box is no taller than its top, so it is found by its footprint. The shed and the treehouse are
  small wooden rooms only where their own floor is underfoot (among the treehouse's stilts is the lawn: its test).
- **Movement foley** needs the sim to say what a move began: the character's step names it (`entered`:
  engine/physics/character.ts) and the actors' system emits `move` `{ id, what }` (mantle, climb, ladder, zipline,
  skydive, slide, crouch, stand). An actor's body events (`footstep`, `jump`, `land`, `dash`, `launch`, `move`) now
  carry its feet as the step began (`at`), a footstep its movement model's gait: the page reads the events once a
  frame, and a step read late took the floor he had reached by then (the porch's concrete heard as the hall's wood:
  the browser spec found it, the page reading every 20 steps). Events are not hashed, so no golden changed; the box's
  map still reads where its actors are when it reads (box content, its timeline's golden unchanged).
- **Rooms and walls** (engine/audio/runtime/reverb.ts `roomAcoustics`, spatial.ts `wallsBetween`): a room's reverb is
  worked out of its make by Sabine's RT60 = 0.161 V / A, the room taken as square, its contents soaking up a quarter of
  its floor's area at the mids (a bare room a tenth): the carpeted bedrooms 0.56 s, the tiled kitchen 0.95, the hall
  0.90, the attic 1.31, the bare garage 1.56 and the basement's concrete rooms 1.8 to 2.15, the shed 0.68; the open
  air is `ROOMS.outdoor`. Up to three walls between the listener and a sound muffle it, each halving the lowpass's
  cutoff from 900 Hz and taking its gain by 0.6; a sound eases between counts (`Sound.occlude`). The mixer, named in the
  plan's Owns, needed nothing: it already takes a room's numbers.
- **The page** (labs/playground/sounds/page.ts): the listener is at the player's head, turned as the camera looks,
  so every camera hears what he hears (the isometric camera, high over a cutaway, would hear the house through its
  walls); the reverb follows his room, the beds crossfade over 1.5 s (the block's breeze and birds out of doors, the
  house's hum in a room), the wind past his ears rises from 3 m/s to full at 12, and the zipline's run hums while he
  rides. `Sound.volume(vol, ease)` sets a loop's level.
- **Loops without a seam**: a looped effect that fades in and out at its ends dips at every repeat (18 to 30 dB for the
  wind, the zipline and the beds: a pulse). An effect now names the pass it repeats (`loop`, a field of the kind
  `sfx`), and played looped the runtime folds what sounds past it over its start (engine/audio/runtime/buffers.ts
  `foldLoop`, the songs' fold alone), a fading voice crossfading into itself: the deepest dip is now 1 to 4 dB. A
  tone in a loop turns a whole number of times a pass (the zipline's 190 Hz and its 9 Hz vibrato in 2 s, the hum's
  120 Hz in 3 s), so the fold adds it to itself in phase. The box's torch keeps its fades: box content, unchanged.
- **Measured**: `x audio --replay` mixes all eight playground replays unclipped (peaks 0.24 to 0.78, the range's at
  0.78 once its shots play at 0.8); the house replay's timeline gives 55 sounds, hash `017481cb37c16edc`, in Node, as
  Chromium must (tests/e2e/playground-audio.spec.ts); the coverage test plays every playground replay and hears every
  event but the two quiet kinds.

## Amendment 30 (2026-10-23, WP 11.5): lighting and shading upgrades

- **Where they live.** Each technique is a module of engine/gfx/enhanced/ that declares its feature and advice code
  (`<X>_FEATURE`, `<X>_CODES`) and makes it; engine/gfx/features.ts registers them and hands each out only while its
  feature is on (`lightingFor`, `cascadeSunFor`, `shadingFor`, `temporalAaFor`, `sceneTargetsFor`), and only it may
  import engine/gfx/enhanced/ (ESLint's layer rule). Beyond the plan's Owns: `gi.ts` and `air.ts` (the GI tier and
  the air), engine/gfx/post/shading.ts (the chain's shading stage), engine/gfx/backdrop.ts (split out of sky.ts for the
  length limit), and extensions to engine/gfx/post/{chain,filters,mrt,aa,settings,looks,presets}.ts,
  engine/gfx/{lights,sky,stage,stageSky,renderer,sceneDump,quality,shadows}.ts and engine/app/engine.ts (the stage
  takes the renderer's features); the box's `look:daylight` (labs/box/looks/daylight.ts), the comment of
  `look:torch-lit` and labs/box/README.md; the advice trap (tests/setup/adviceTrap.ts, its test,
  tests/baselines/advice/README.md and docs/TESTING.md: below);
  tests/e2e/{post,renderer,box-look,box-menu,parity}.spec.ts and tests/pages/post.ts (the looks' counts, TRAA's
  measure, the features' ids, the day look), box-menu's replay list among them, which missed WP 10.2's two; and the
  kind `feature`'s template (below). Seven features: `feature:tiledLighting`, `feature:cascadedShadows`,
  `feature:ao`, `feature:gi`, `feature:air`, `feature:ssr`, `feature:traa`.
- **Tiled lighting** is r182's `TiledLightsNode` with its faults fixed in a subclass (engine/gfx/enhanced/lighting.ts):
  shadow casters stay ordinary lights (r182 tiled them and lost their shadows); its buffers are made once for 4,096²
  and its grid read from uniforms, so a resize rebuilds nothing (r182 baked the size into its shaders); its compute
  pass covers the grid's tiles alone (r182's dispatched 32 times too many); the grid follows the render target, not
  the canvas; the reach test is in pixels from the projection, right for any aspect and for orthographic cameras; a
  tile holds 16 lights, not 8. The decisive one: r182's uniforms are object-group uniforms, written only when an
  object's own uniforms update, so still objects drew with a stale light list (the hall came out darker than with the
  pool); they are render-group uniforms now. With it the light pool holds 64 lights (`POOL_SIZES.tiled`), else 12.
- **Cascaded shadows** (csm.ts): the sky's sun casts through r182's `CSMShadowNode`, three cascades over the view's
  first 90 m at 1,024² each; the node takes its camera at its first build, so `follow` hands it each frame's camera
  and splits the cascades again only when the camera or its projection changed. The scene dump says `×3 cascades`.
- **The chain's shading stage** (engine/gfx/post/shading.ts) lays the look's new sections on the scene's light, before
  bloom: `ao` (r182's `GTAONode`, half resolution, 16 samples) multiplies it; `ssr` mixes reflections over metal;
  `gi` and `air` run inside the display pass, a part of its WGSL included only while the feature is on, behind
  render-group uniforms. The AO and SSR passes run only in frames that ask for them (and the warm-up's), so switching
  any section builds no pipeline. The techniques see each frame's camera through a lens whose matrices copy it, after
  pixel art's block snap has moved it: r182's nodes keep the camera they are made with, and the chain draws through
  any of the five camera codes, orthographic ones among them.
- **GI is shardfall's 12-tap spiral** (gi.ts, its "Bounce light"), with its radius in metres at the pixel's depth and
  the orthographic case added; r182's `SSGINode`, the plan's tier above, reads a perspective camera's field of view and
  waits for a look that needs it (the Build line's "when a look needs it"; none does yet).
- **The air is shardfall's haze march** (air.ts): 32 steps through haze thick at its base, sunlight scattered toward
  the camera by a Henyey–Greenstein phase where the sun's shadow map says it reaches (shafts), the sky's light in the
  haze, and lamp halos in closed form. three.js's intensities are taken as radiance times π (its BRDF divides by π):
  read raw, 86% of the arena's pixels came out white. The shadow map is read and compared by hand (WGSL `textureLoad`),
  the widest cascade's when the sun casts through cascades; the lamps and the sun are brought up to date before they
  are read (the gathering runs before the scene pass), and the shadow camera's matrix is read as the display pass
  draws, after the scene pass has moved it. The quality tiers turn bounce light and shafts off below `high` and halos
  at `low`; a look that asks for one there gets `GFX_POST_TIER` once.
- **Reflections** (ssr.ts) are r182's `SSRNode`, which decides at build time whether its camera is perspective: two
  passes, one per kind of lens, only the frame camera's running. The scene pass writes (metalness, roughness) into a
  `metalrough` target only while `feature:ssr` is on, and the mix is gated by the pixel's own metalness, since r182's
  blurred levels spread a reflection past a metal surface's edge. The box draws no metal (its materials are Lambert
  unless a look draws them in the pbr style, and its iron is on props it never places), so the reflections are shown
  on a fixture page of their own, tests/pages/shading.html, with a steel ball and plate.
- **TRAA** (aa.ts) is r182's `TRAANode`, chosen by the new view setting `post.aa` (`fxaa`, `smaa`, `traa`; the chain
  reads it when made), never by default: it smooths a still picture by gathering frames, which a single frame of play
  never has. The camera is jittered by r182's Halton steps only in frames the filter runs; the scene pass writes
  motion (`velocity`) only for it.
- **Looks**: shardfall's Sunbeams and Lamplit fog (`look:sunbeams`, `look:lamplit-fog`), its seven air presets
  (`look:air/…`) and its bounce light (`look:gi/bounce-light`), and one preset each for the sections it lacked
  (`look:ao/corners`, `look:ssr/metal`): 98 looks. The playground's own looks take the sections in WP 13.24, which owns
  labs/playground/looks/.
- **Found on the way, and fixed.** Under tiled lighting every toon-style material failed to build (r182 hands its
  tiled lights to the lighting model as the tiles' node, which has no colour, and the toon style reads one), and r182
  drew its default material in their place, saying so only through `console.error`: no spec failed. The advice trap
  now fails a test on r182's `THREE.TSL:` errors. The review found a second: the sun's cascades were never made when
  the sun first cast after its sky was shown (from `look:torch-lit` to `look:daylight`, or from the low tier to the
  high), since `follow` handed r182's node a camera before its first build, and r182 makes its cascades only while it
  has none; `follow` now waits for that build, the scene dump counts the cascades made, and enhanced.spec switches
  both ways. Also: the shading follows the camera after pixel art's block snap; the air brings its lights up to date
  before it reads them, reads the shadow camera as the display pass draws, and lets a sun that stops casting go; the
  tiles leave out the pool's empty slots and lights wholly behind a perspective camera, and a target past the buffers
  made lights its outer tiles with the ordinary lights alone; the `metalrough` target is 8 bits a channel, as
  three.js's own SSR example keeps it. And a fault of r182's that the new `look:daylight` showed in box-look.spec's
  switches, with the features off too: once a point light stops casting, r182 still brings its shadow's matrices up to
  date (`accessors/Lights.js:47`), reading a `target` that point lights lack, and the warm-up failed; the pool's point
  casters get a target (engine/gfx/shadows.ts). The same spec's switch between the hall's looks and the day's warms up
  each way, every time (over three rounds, 43 pipelines to the day and 25 back, then 36 and 25): r182 frees the
  pipelines a sky leaves unused and builds them again when it returns (engine/gfx/pipelines.ts). Keeping each
  caster's shadow node across the switch, tried, changed none of it. A switch never builds in a frame, among the
  torch-lit looks builds nothing, and a second round trip to the day costs no more than the first; the spec says so,
  and its knock replay now plays through the day too (its view at step 180, the replay's last, never applied). Tiled
  lighting's buffers are made for 4,096²: a larger target's outer tiles draw the ordinary lights alone, and say so once
  a size (`GFX_TILES_PAST`).
- **Measured** with `x perf labs/box --feature` (GPU ms a frame on SwiftShader, on less off: they rank the techniques
  here and budget nothing, ADR-0022): tiled lighting −40 on the torch-lit hall (189 against 229, 64 lights against
  12), cascaded shadows +130 on crowd-100 by day (+24 draw calls), and on the room with its section on, AO +9.9, GI
  +22, air +68, SSR +20 and TRAA +38 against FXAA. `feature:ssr`'s `metalrough` target is written on every frame its
  feature is on, the default, even where no look asks for reflections: +1.2 on the room (46.1 against 44.8), with
  5 textures and 4 pipelines more and no draw call, kept so that a look switching reflections on builds nothing. No
  run built a pipeline after its warm-up. The governor's part, demoting a technique under load, waits for WP 7.5.
- **The kind `feature` has its template.** Seven techniques wrote their entries and advice codes by hand, the
  third time and more, so `node x new feature engine/gfx/enhanced/<name>` writes the module of a new one: its entry,
  its advice code `GFX_NO_<NAME>` (x new's new placeholder `{{NAME}}`, the name in upper case, words split by `_`) and
  a unit test that reads both through the registry, the feature turned off; `x new --test-all` keeps it working. A
  feature is engine-internal (a game turns one off, never defines one: the manifest's `games`), and its gate in
  engine/gfx/features.ts stays by hand, each technique handed out its own way (the manifest's `next` says so). The
  kind's schema checks every entry as it is defined (`FEATURE_FIELDS`), and engine/gfx/features.test.ts lists them.

## Amendment 31 (2026-10-23, WP 13.23): light and time

- **Where it lives.** The clock is sim state (engine/sim/lights.ts): `setDaytime(w, { hour, rate })` sets the world's
  clock (the component `daytime`, one a world), `lightsAtDusk(w, group, { on, off })` a rule (the component `dusk`)
  that switches a light group (engine/sim/switches.ts) as the clock passes its hours, and the system `daytime` moves
  the clock on and switches at the crossings; the names reach game code through engine/sim/houseApi.ts. The view's
  side is engine/gfx/daylight.ts: four key skies (`sky:night`, `sky:dawn`, `sky:noon`, `sky:dusk`), the sky at an hour
  eased between them (`daylightAt`), and the light's arc (`lightAt`). Beyond the plan's Owns: engine/gfx/sceneDump.ts (a light's intensity, `lit n`,
  so a dump says which lamps shine), engine/app/view.ts (the hour and the frame's lamps to the stage's lights), the
  playground's site scenes, furnish.ts and the streetlight's description, and the four site replays' goldens.
- **The house's lamps lit nothing until now.** WP 13.16 drew a lamp's shade on or off by its switch, but nothing gave
  the props' light spots to the light pool (engine/gfx/props.ts `lights()` had no caller), and the playground's looks
  show `sky:daylight`, whose pool is out (`pointLights` 0). The pool now ranks the frame's lamps beside the level's
  spots (`update(focus, time, lamps)`), each with its own colour, intensity and reach, a declared `light:<tag>` giving
  its priority; the view hands it the props' lamps that are on. A lamp standing on one of the level's spots of its
  kind is that spot's light, lit once: the box's hall stands a brazier, its torch light where the spot is, on each of
  its 30 torch spots, and would have lit every torch twice.
- **The clock sets the rules on the step after.** What a scene's setup spawns is in the world only once the setup is
  over (engine/sim/world.ts: spawns wait for the step's boundary), so a rule made there could not switch its group at
  once: the system puts each new rule's group as the hour has it on its first step (`dusk.set`), and again after the
  clock is set by hand; between its hours a player's switch holds. No event: the rule's switching is the switches'.
  Found by the page's test, whose virtual clock never stepped: a frame drawn before the first step showed the street
  lit at noon. So the block spawns its dusk groups' lamps and switches as the starting hour has them (site.ts
  `litAtStart`), and the rule's first step changes nothing there; a test that sets the hour steps once after.
- **One shader key all day.** Who casts shadows is part of every lit shader's key, and r182 builds the pipelines
  again on each change (amendment 30's box-look switches: 43 and 25 each time), so the day never changes it: the sky's
  light never goes out (the moon by night, a twenty-fifth of the key's light where sun and moon swap, so the light's
  jump from west to east goes unseen), and every key lights the pool (`pointLights` 1): a lamp shines by its switch,
  not the hour. The light is held 7° above the horizon at least, so no shadow stretches across the site.
- **The sky follows the clock over the look's.** While a scene runs a clock, the stage's sky shows the hour's sky in
  place of the preset its look names (a look naming none keeps the stage's own lights); it is shown again when the
  hour has moved a minute, and from the look's first show once the view knows the hour, so the warm-up compiles what
  the frames draw. The backdrop's silhouettes darken by a tint (`backdrop.tint`, a new field of `sky`, white by
  default: the material's colour, a uniform), and the strip is baked again only when its silhouettes change. Found
  on the way: on a stage with no level (a site, a terrain) the sky's sun was fitted to 16 m round the origin, so with
  its cascades off the block had shadows in one corner; it covers the terrain's ground now, as the stage's own sun.
- **The block.** The street's four lamps are the light group `street`, lit at dusk (18:30) and put out at dawn
  (06:30); the porch has a lamp over the front door, its switch inside, lit at dusk too (`room:porch`); the
  crawlspace has its lamp under its 1.4 m ceiling and its switch at 0.9 m by its low door (PROGRESS's wait since WP
  13.18). Its scenes start at `playground.hour` (12) and pass a day in `playground.day` minutes (0 holds it); their dev
  actions `daytime { hour, rate }` and `lights { group, on }` set the clock and switch a group, so an agent or a test
  reaches any hour without a restart.
- **Measured.** From the street at cam iso (480 × 270), the luma mean at noon, dusk and night is 0.484, 0.106 and
  0.097 in the cel look and 0.483, 0.123 and 0.115 in the pixel look, at most 31% near-black and nothing blown after
  dusk; 0 pipelines are built through the hours and both looks once a shot in each has built the shot's own passes;
  the street's four lamps shine in the pool at dusk and night and not at noon, the moon and the nearest lamp casting
  (tests/e2e/lights.spec.ts). Dusk and night are dim and flat (luma spreads 0.13 to 0.16, the pixel look 36 to 39
  colours): WP 13.24 tunes both looks by night.

## Amendment 32 (2026-10-23, WP 11.3): GPU particles

- **Where it lives.** engine/gfx/enhanced/particles.ts is the technique `feature:gpuParticles`: a ring of 65,536
  particles (`GPU_RING`) the GPU moves in compute and draws, decorative only, handed out by engine/gfx/features.ts
  (`gpuParticlesFor`) while the feature is on. The stage's effects get it when they register with the warm-up
  (engine/gfx/stageFx.ts `gpuParticles`, `useGpuParticles`), where an emitter of the registry asks for it: a page with
  none makes none, so the box's pages pay nothing. The frame carries it (`FrameView.particles`), and the post chain
  draws it through its particle layer (engine/gfx/post/particles.ts). Which particles go to it is the emitter's to
  say: the kind's new field `gpu` (false by default), so the engine's own emitters keep the CPU pool, their tests and
  pictures as they were, and the playground's rain and dust ask for the ring. The CPU pool takes them where the
  feature is off, thinned to its 4,096 and the rest counted (`GFX_NO_GPU_PARTICLES` says so once). Beyond the plan's
  Owns: engine/gfx/fx/{particles,emitters,effects}.ts, engine/gfx/fx/rings.ts (the floor rings, split from effects.ts
  to keep it under 400 lines), engine/gfx/{features,stageFx,stage,renderer}.ts, engine/gfx/post/{particles,chain}.ts,
  engine/app/{view,drawing,engine,viewMembers}.ts, labs/playground/{weather,main}.ts and README.md, docs/PLAYGROUND.md
  §9.3.
- **Births on the CPU, into a buffer of their own.** shardfall writes each birth into the ring itself. r182 uploads a
  storage buffer's whole array when it first creates it and keeps the update ranges asked for before that, so a later
  upload would put back births the GPU had moved on. So the CPU writes births only into a births buffer, through the
  CPU pool's own writer (`planBurst`, `writeParticle`: the same floats and the same draws, so a burst gives the same
  particles on either), and one compute pass a frame copies each into its slot of the ring and moves every slot used,
  as the CPU pool moves its particles. Nothing is read back: the CPU counts the live ones by their lives.
- **No normal written: a pass of its own.** r182 has one colour write mask for every target of a pass and blends only
  the first, so a transparent object drawn in the scene pass replaces the normals and flags under it (the CPU's
  sprites do). The ring is drawn in a pass of its own, cleared to nothing (r182 clears a pass to the renderer's clear
  colour, so the layer's pass sets it for its draw), tested by hand against the scene pass's depth, and laid
  premultiplied over the scene's light before bloom's glow and the display pass, so the looks' filters reach the rain;
  a plain frame draws it straight after the scene, against the screen's own depth. It is out of the ID pass for free:
  the ID pass draws the stage's scene, and the ring's mesh is in a scene of its own.
- **The warm-up.** The warm frame draws a slot of the ring and steps it, building the pass's, the plain frame's and
  the step's pipelines. Found by a probe at the device: `warmBoth` (engine/app/drawing.ts) handed the warm-up views
  without the ring, and the first rainy frame built two; it hands them over now.
- **The page's frame.** `EngineFrame` gains `emit(id, at, key, scale)`, which runs an emitter at its rate times
  `scale` (`Effects.emit` takes the scale too), and `setting(key)`, so a page's own presentation follows a view
  setting live; both types moved with `FrameWorld` to engine/app/drawing.ts (engine/app/engine.ts was at its cap),
  re-exported from engine.ts, so engine/index.ts is as it was. The inspector's new `fx.stats()` gives the effects'
  counts, the ring's among them.
- **The playground's weather** (labs/playground/weather.ts): rain over a 36 m square round the player, falling 13 m at
  14 m/s, and dust motes about him indoors, at `playground.rain` and `playground.dust` (0 to 1, view settings, 0 by
  default); no rain falls while he is indoors, since no drop finds a roof.
- **The budget.** `GPU_RING.budgetMs`: a downpour adds at most 1 ms of GPU time a frame on a desktop GPU, which the
  owner's playtest checks (docs/PLAYGROUND.md §9.3, item 11): SwiftShader's GPU time is a CPU's (WP 11.2), so here it
  is measured and ranks nothing (ADR-0022).
- **Debris stays on the CPU.** The trigger names rain, dust and debris; the debris the block makes (a kicked door's
  splinters, a shot's impact, `emitter:bits`) bursts in tens of particles, well inside the CPU pool, so the engine's
  emitters keep `gpu` false; one that needs more says so.
- **Measured** (tests/e2e/enhanced-particles.spec.ts, the street from cam iso, the sim paused): a downpour holds
  28,524 drops on the ring and none in the CPU pool, changes 22.5% of the picture's pixels, builds nothing after the
  warm-up and leaves the ID pass and the normals view the same pixel for pixel; a light rain (2,895 drops) drawn by
  the ring and, the feature off, by the CPU pool's sprites, the same frames in the clean look, differs in 0.10% of the
  pixels (`PARITY` 1%); a rain drawn plain and through the chain (a neutral grade laid on, the chain's draw calls
  telling it apart) is the same picture, 0 pixels apart: the hand-made depth test against the scene pass's hides what
  the screen's does; the feature off, a downpour fills the CPU pool to 3,804 of its 4,096 with 24,871 drops left out
  in 60 frames, building nothing; the street replay, a frame every 10 steps through a downpour on the ring, gives its
  goldens to step 240. `x perf labs/playground --scene site-street --set playground.rain=1 --feature
  feature:gpuParticles`, on less off (SwiftShader, ranking only): GPU ms +113 (737 against 623, about 28,500 drops
  against the pool's 4,096), CPU render ms −1.2, one compute call, 52,454 triangles, five pipelines more, 0 after the
  warm-up.

## Amendment 33 (2026-10-24, WP 13.24): the two looks, finished

- **A ramp per material, from its own colour.** The toon style (engine/gfx/materials/toon.ts) gains `shade` and
  `dither`. Each material's light falls from its lit colour to its shade: the indirect light, what lights its shadows,
  falls on the colour times `SHADE_TINT` (cooler, toward violet) with its saturation raised (`shadeOf`), `shade` of
  the way, so a shadow keeps its material's hue shifted rather than going grey; a ramp per material then needs no data
  per material, and a material whose shade reads wrong can say so later. `dither` makes the bands' edges hard and
  mixes neighbouring bands over that share of each step by a 4 × 4 ordered pattern (`bayer4`, the composite's table
  built from Bayer's 2 × 2 order) laid on the grid the chain hands it (`toon.grid`). The toon uniforms are
  render-group uniforms now, as the sky's knobs are (an object-group uniform reaches a still mesh only when its object
  or material changes, and switching between two toon looks changes neither); `shade` and `dither` 0 draw as before
  them.
- **The pixel grid** (engine/gfx/post/grid.ts, the chain's per-frame part, split from chain.ts at its cap): the pixel
  filter's `size` 0 is the art block, the largest whole block giving 240 to 360 lines (one drawn pixel at the engine's
  `pixels` resolution, 270 lines on a 1080 or 540-line screen; four at `full` on 1080); the snap now holds at one
  drawn pixel too (`snapBlock` gives 0 for none; it gave 1); `snapGrid` (engine/gfx/post/snap.ts) says where it put
  the camera: the whole blocks (`cells`), which both dithers add to their screen cells so their patterns stay on the
  world (the composite's palette dither through `frame.zw`; `post_bayer4` wraps negative cells now), and the remainder
  as the picture's offset (`shift`). The outline filter's new `lines` scales its width with the picture's lines in
  whole pixels (`inkWidth`): 1 px at 270 lines is 4 at 1080.
- **The glide.** The pixel filter's new `smooth` hands the snap's remainder to the page: engine/gfx/resolution.ts
  `shift(x, y)` moves the canvas by that fraction of a pixel (a CSS transform; `stats().shift` reports it), so the
  snapped picture glides as the camera does and never shimmers. One drawn pixel's CSS size is the canvas's variable
  `--my3dge-pixel`, which the playground's page uses to give its canvas a margin of two drawn pixels, drawn and
  hidden, so the glide never shows an edge: its picture is 484 × 274 at 960 × 540 (it was 480 × 270). The offset is a
  page's, so a shot reads the snapped picture: the shimmer metric is measured there.
- **The perspective variant.** A look's new `perspective` names the look whose filters and toon numbers the chain
  draws while the camera is a perspective one (its style and sky stay the look's, so no camera change warms up);
  `look:playground-pixel-perspective` draws unsnapped, with no glide and a lighter dither on the screen, for first
  person, the shooter and the platformer (the plan names two; the platformer's lens is a perspective one too).
- **Outline shells on the stage** (engine/gfx/stageShells.ts): every prop batch's pages (pushed from each part's
  centre) and every actor's puppet get a shell as they appear; a skinned mesh's shell is a skinned mesh bound to its
  skeleton, its push skinning the geometry's vertex and normal through r182's `SkinningNode` read off the vertex
  stage's stack, as the instance's matrix is (`GFX_OUTLINE_TARGET` no longer refuses skinned meshes). A look's new
  `shells` (`width` px at 270 lines, scaled in the shader to the target's lines; `color`) shows them, through the
  page's look (engine/app/look.ts); 0 hides them. They are registered with the warm-up whatever the look, so switching
  builds nothing, and the ID pass leaves them out (`userData.outline`), so a shot's objects are the same in every
  look. The crowd's batches keep only the chain's ink: a crowd of hundreds would double its draw calls.
- **The sky's gradient.** A look's new `skyGradient` (0 to 1) mixes the dome toward a clean gradient, the fog's haze
  at the horizon to the background deepened at the zenith (engine/gfx/sky.ts `gradient`, render-group uniforms, so the
  hour's sky keeps it); the cel look draws it whole.
- **Night has a key.** Night was dim and flat (amendment 31: luma spreads 0.13 to 0.16). A toon band's share is the
  light's falloff alone (its intensity only brightens the band), and the streetlights' falloff (decay 1 from 4.2 m up)
  left the ground under them at a share of 0.23, below the cel look's first band (0.25): their pools never showed. The
  streetlight's decay is 0.75 now (labs/playground/props/outdoors.ts), `sky:night`'s ambient 0.25 (it was 0.55) and
  its fog 0.55 (0.7), and `sky:dusk`'s ambient 1.1 (0.9), so dusk stays brighter than night (the ambient's change a
  minute stays under daylight.test's bound); the moon and the lamps' brightness are as they were. A flat surface whose
  share sat at a band's edge dithered whole (a quarter of the frame in 1-pixel checkers at dusk, the moon low), so the
  dither works only where the light changes across the picture (`fwidth` of the share) and a flat share keeps a hard
  band. The visual review asked for the pixel look's sky to be a gradient too (its dusk read overcast): it is.
- **The looks.** `look:playground-cel`: three bands and a rim, `shade` 0.7, ink 1 px at 270 lines at sharp creases,
  shells of 1 px, the gradient sky. `look:playground-pixel`: the art block, four bands, `shade` 0.6, `dither` 0.5, ink
  1 px at 270 lines, 24 shades a channel, snapped and gliding, the gradient sky, its perspective variant. Ink never
  comes from texture brightness: the outline filter reads depth and normals.
- Split for the line caps: the filter chain's checks to engine/gfx/post/filterChecks.ts (re-exported from filters.ts).
  Beyond the plan's Owns: engine/gfx/{stage,stageShells,idpass,sky,daylight,renderer}.ts,
  engine/gfx/post/{grid,filterChecks,chain}.ts, engine/gfx/post/shaders/common.ts, engine/app/look.ts,
  labs/playground/index.html and README.md, docs/PLAYGROUND.md §5.2, tests/e2e/playground-looks.spec.ts (the plan's
  Verify names it now), tests/baselines/thumbs (ten cases).
- **Measured** (tests/e2e/playground-looks.spec.ts, the street, the sim paused): each look from each of the five
  cameras at noon and at 22:00, none blank or empty, the player in view in the four that show him, night darker than
  noon; at night the cel look's luma spread is 0.29 to 0.85 and the pixel look's 0.56 to 0.69 (WP 13.23 measured 0.13
  to 0.16, low contrast in four cameras of five), `LOOK_FEW_COLOURS` left on top-down (25 to 31 colours, a few large
  ground materials) and some night frames; 0 pipelines built through the night after the noon round; the noon
  thumbnails recorded (tests/baselines/thumbs/playground-*.json); 177 of 214 shells shown in the cel look and none in
  the pixel look, the ID pass the same objects in both; the pixel look at 274 lines (484 × 274 with the margin). The
  visual review passed both looks. The shimmer metric is 0 in the pixel look: isometric panned 1.4 mm at a time in its
  image plane changes no pixel in seven steps, the glide carrying the remainder (within half a pixel), while the same
  pans change 2.3 to 2.7% of the cel look's pixels; top-down is pixel-exact by itself (WP 13.8), so its pans move
  neither look. A pan with a dolly in it (camera codes keep 1 mm, so a target moved off the plane by their rounding)
  changed 1 to 8 pixels, the cascades off too: an orthographic picture ignores a dolly, its depth-dependent parts do
  not; the spec pans in whole millimetres along the plane.

## Amendment 34 (2026-10-24, WP 13.24): the shells priced, as a feature

- **The shells are a feature,** `feature:shells` (engine/gfx/features.ts, advice `GFX_NO_SHELLS`): they need nothing
  of the device, so only `gfx.featuresOff` turns them off, and then the stage makes, registers and shows no shell
  (engine/gfx/stageShells.ts, handed the renderer's report at `register` as the stage's effects are). That is what
  `x perf --feature` prices a technique by (WP 11.1), and what the feature matrix (tests/e2e/features.spec.ts) plays
  the box's climb under, its goldens and entities kept with the shells off.
- **Measured,** `node x perf labs/playground --scene site-street --feature feature:shells` on SwiftShader (the cel
  look, 60 frames; ADR-0022: its times are noise to compare runs, not proof): the shells cost 177 draw calls (3,509
  against 3,332), 72,060 triangles (834,653 against 762,593), 10 pipelines and 26.7 ms of the GPU's 816.8 a frame, 0
  pipelines after the warm-up either way.

## Amendment 35 (2026-10-25, WP 13.24): the pixel look's pans cross whole pixels

- **Found at review:** amendment 33's shimmer metric panned isometric 2 mm along each axis it uses (about a twentieth
  of a pixel) for seven steps, a third of a pixel in all, so its picture never moved a whole pixel; the amendment
  said 1.4 mm. Panned 6 mm a frame for fifteen frames, two whole pixels, the pixel look changed pixels each time the
  snap moved the picture, in two ways, both mended:
  - **The shadows' noise.** r182's PCF filters turn each pixel's five samples by a noise read where the pixel lies on
    the screen (`interleavedGradientNoise(screenCoordinate)`), fixed to the screen while the snapped picture moves by
    whole pixels, so a shadow's edge changed at every snap. Every caster now filters through copies of r182's filters
    (engine/gfx/shadows.ts `SNAPPED_PCF`, `SNAPPED_POINT`, set by `snapShadow` as the light's `filterNode`, which
    r182's shadow node reads before the renderer's map type) whose noise is read where the pixel lies on the frame's
    grid, `screen + cells × block` (`SHADOW_GRID`, set by the post chain each frame and put back after, so outside its
    frames, and on every unsnapped frame, the filters give r182's values exactly). A cascade's shadow is a clone of
    the sun's, which `LightShadow.copy` makes without the filter: the sun's shadow makes clones that take it again
    (engine/gfx/enhanced/csm.ts).
  - **The shading's derivatives.** The GPU takes a shader's screen derivatives (`fwidth`, which the toon ramp's dither
    gate and rim read) over 2 × 2 pixels fixed to the screen; a picture moved by one pixel paired each pixel with other
    neighbours, and 11 of the street's 130,000 pixels changed band at each crossing, back again at the next. A gliding
    snap of one drawn pixel now moves the camera by two (engine/gfx/post/grid.ts `QUAD`), the glide carrying up to a
    drawn pixel each way (the page's margin is two), so every pixel keeps its neighbours. A block of 3 or more keeps
    its own snap (twice it would pass the margin); its pixels may still pair anew as it crosses.
- **Measured** (tests/e2e/playground-looks.spec.ts, the street, the sim paused): isometric panned 6 mm a frame for
  fifteen frames moves its picture by two whole pixels once and changes no other pixel, its glide wrapping from −0.85
  to +0.99 of a drawn pixel; the cel look's same pans change 6.6 to 7.6% of its pixels a frame; the noon thumbnails
  hold. Top-down keeps its sub-pixel pans (2 mm a frame, eight frames: nothing moves, nothing glides): panned across a
  whole pixel, it changed 7 to 10 pixels in one soft shadow band, the red channel one palette step (0 with no shadow
  casters, the `low` tier; as many with the cascades off); the cause is not found and docs/PROGRESS.md lists it.
- Files: engine/gfx/{shadows,sky,stageSky}.ts, engine/gfx/enhanced/csm.ts, engine/gfx/post/{chain,grid,filters}.ts
  and their tests, tests/e2e/playground-looks.spec.ts. `--my3dge-pixel` is the CSS variable the page's margin uses
  (the pixel filter's `smooth` said `--my3dge-block`).

## Amendment 36 (2026-10-25, WP 10.8): the lab pages

- **Seven labs and an index** (labs/index/): each lab a page under labs/ with a panel beside its canvas (labs/index/
  lab.ts: its title, what it is for, the `x` command that does the same job without the page, entries that are links,
  so the address is what shows), each a view over the inspector (`__engine`) and the registries: the Animation Lab
  (the scene `lab:lineup`, labs/anim/scenes/lineup.ts: every humanoid build and the mannequin in a row, told one
  state, pose, stance or move from one clock; a move's phases on a timeline that scrubs it, `lab.anim.time`; the bones
  drawn over the figures from `__engine.anim(id).joints`, labs/anim/overlay.ts), the Materials, Props and Effects labs
  (the gallery's kinds, labs/index/gallery.ts), the Cameras Lab (one set seen through every camera code, each a link,
  and a blend to each), the Physics Lab (the box's ragdolls and the hall's props, their settings as links, gravity,
  the sim's speed, pause and step) and the Library Lab (the box's clip mode with the catalog searched, the clip's
  text applied, reset, mirrored and copied, its frames stepped). labs/labs.json lists them, with the engine's own pages
  (the box, the playground, the starter game); a temporary lab carries its question, its answer once settled and the
  date it expires (labs/index/labs.ts `checkLabs`, `expiredLabs`), and `node x lab list|add|answer|rm` keeps the file,
  `list` failing on a lab past its date (tools/cmd/lab.ts; `my-3d2dge:tools/labs-test.mjs`, ported).
- **Beyond Owns, a core change:** the animator's inspect report (engine/anim/character.ts, what `__engine.anim(id)`
  returns) gains `joints`, each joint's world position at the frame, so a page can draw bones without importing the
  engine's FK; its snapshot test grows with it. The lineup scene lives in the lab (labs/anim/scenes/), as each lab's
  content does (PLAN.md §5.7).
- **Calls:** the Library Lab's Apply plays the edited text as a set of its own (`lab<n>`, registered by the page) and
  starts the scene again with its seed (`__engine.seed(n)`): a set registered while a scene runs reaches it only at its
  next start. The Animation Lab shows the moves and states the engine's registries hold; the my-3d2dge animlab's skins
  are the builds in its row, its frozen key poses the scrubbed timeline, its dummy the mannequin; the Mocap Lab's
  retarget preview across the builds is that row playing a library clip (`lab.anim.play=clip:<set>/<clip>`, the
  Library Lab's link `On every build`).
- Evidence: tests/e2e/labs.spec.ts (the index's links; each lab ready on WebGPU with its panel, no advice; the
  Animation Lab's phases and bones, the Cameras Lab's blend, the Physics Lab's step, the Library Lab's search, mirror
  and apply), tools/cmd/lab.test.ts, labs/anim/scenes/lineup.test.ts, engine/anim/character.test.ts (`joints`).

## Amendment 37 (2026-10-25, WP 7.5): the performance governor

- **What it moves:** `quality` `auto` between WP 3.12's tiers (engine/dev/governor.ts; engine/gfx/quality.ts), which
  hold the light and shadow budget, the GI, god rays, bloom and halos, and the drawn pixels; on a touch screen it also
  scales the drawn pixels (shardfall's dynamic resolution). A tier set by hand is kept; `gfx.governor` (a view
  setting) turns it off; it is frozen while a replay plays, and the tools' virtual clock gives it even frames, so no
  spec sees it move. Each move is advice, `GFX_GOVERNOR`.
- **Its numbers,** from the two carried mechanisms (`my-3d2dge:src/emberdeep/95-perf.js`,
  `shardfall:crates/pav_app/src/quality.rs:89-113`): a second at a time; slower than 50 frames a second is bad, faster
  than 57 good; three bad seconds demote a tier, ten good ones promote one (never above `auto`'s own); a demotion
  within 25 s of a promotion doubles the ten, up to 80, so a machine on the edge settles (simulated: 11 moves in five
  minutes, 46 without the doubling); on touch a bad second scales the pixels by 0.88 (to 0.6), four good ones by 1.06.
- **Calls:** the governor moves the tiers only. Turning an optional GPU feature off mid-play would build pipelines in
  a frame (engine/gfx/features.ts decides them at the renderer's start), and pose LOD and draw distance belong to no
  tier yet: each joins a tier when a measured scene needs it. Its state is read through its advice and the settings
  (`quality`, `gfx.governor`), not a member of its own.
- Evidence: engine/dev/governor.test.ts (the demotions and promotions on simulated frame times, the edge machine,
  the hand-set tier, the freeze, the touch scale, a headless run's hash unchanged with the governor moving between its
  steps); engine/app/engine.ts and drawing.ts feed it the frames' real time and read its budget.
