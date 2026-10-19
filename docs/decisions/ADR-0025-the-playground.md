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
  and the look's for a camera that looks along it (first person and the shooter follow a course's look).
- **The shooter** (shoulder.ts): §4's 0.5 m right, 0.3 m up and 3.8 m back from the eye, lagged 0.05 s and never
  0.5 m behind, looking along the aim. X swaps by the code (`cam3=shoulder,…,-1`, blended); a swap input eases in the
  camera over 0.12 s. The sights pull the arm in to 1.5 m by the effects' share (the aim button is WP 13.9's: the view
  reads `aim` from the step's held buttons). Under 1.2 m of room behind the eye draws the shoulder point in, across by
  the share and up by its square, so a camera backed against a wall still sees him.
- **The platformer** (follow.ts): §4's arm, pitch, recentring, look-ahead and dead zone, and ours: recentring eased
  over 0.6 s and at most 1.5 rad/s; the look-ahead full at 5 m/s, eased over 0.5 s; the dead zone's ground settling
  in 0.3 s; the lift (an arm cut 0.25 m short by a slope or a wall tilts the camera down at 1.5 rad/s, up to 50°, and
  back at 0.6 rad/s once clear); a 60° lens.
- **Collision that never jumps** (collide.ts). The chase keeps WP 3.9's spring arm; the shooter and the platformer
  move their camera on as a ball: carried with the arm, then toward the arm's end where the ball fits there (else as
  far as a sweep from the arm's base clears), in at up to 10 m/s and out eased over 0.3 s no faster, each leg slid
  along the walls; carried over 2 m in a frame (the player put elsewhere), or a second stuck over a metre off, it goes
  at once. The arm's base follows by sliding too. §4's 0.3 m bound rules the spring arm out: on the courses it snapped
  0.7 m dropping off the hang's wall, 3.3 m at the tunnel's mouth, 3.2 m at the ladder's top, 10 to 13 m stuck on the
  ramps.
- **The occluder fade hides** (cutaway.ts): with a camera that may stand behind a wall (the shooter's, the
  platformer's), the block pieces and the rides that a line from it to the player's head or chest crosses leave the
  picture until the line clears; cut pieces stay cut; parts drawn as one mesh (ramps, floors) and props (instanced
  batches, with no hiding per instance yet) are not faded. Hidden rather than see-through: a translucent twin of every
  look's materials would add materials and pipelines. A partial fade, and the props, are the playtest's to ask for.
- **Effects** (effects.ts): Apex's eye heights (1.524 and 0.8128 m, the duck's share between) are the cameras' until
  the sim needs the eye (WP 13.9's aim): in the model's profile now they would re-record every playground golden for
  numbers the sim never reads. Ours where §4 gives none: the punch's spring at 2.5 Hz and 0.6 damping, a landing 0.4°
  per m/s over 3 m/s up to 5°, a jump 1°, a grab 1.5°; the bob 1.2 cm down and 0.6 cm across at 5 m/s; the sights
  55° at a 70° lens in 0.25 s; screen shake 4 mm per m/s of a landing over 10 m/s. First person takes them all, the
  shooter its lens, the sights and half the roll and punch, the platformer 0.3 of the punch, the views none.
- **The overhead view** is a classic view: straight down, north up (never turned), orthographic, in whole zoom steps,
  its target on its pixel grid (1/(24 × zoom) m). Views never trail the followed point more than 2 m once within it,
  nor first person's eye 0.2 m, so a 20 m fall's stop is never overshot.
- **A game's own camera:** the registry kind `camera` (`defineCamera(name, { create })`, its code `cam3=<name>[,…]`)
  and `followCamera(type, state, steps, { effects, fade })`; the factories are public (engine/gfx/cameras/api.ts,
  re-exported whole by engine/index.ts at its line cap).
- **The courses:** the playground's modes are the rigs (`cam3=shoulder`, `cam3=first`, `cam3=follow`, `cam=iso`,
  `cam=overhead`); every course keeps every camera's bounds, the watches of amendments 5 to 7 lifted. The launcher's
  drop and the ladder's climb down look down: the shooter's view is the aim, and looking level off the tower no camera
  behind the player sees him below. The soak course `cameras` blends through the five modes twice round a square by
  the north wall: 0.08 m and 1.3° at worst, never inside, never lost outside first person.
