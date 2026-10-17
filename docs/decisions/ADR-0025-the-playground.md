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
  - The lurch, which Apex added after er-apex's season: a new key is the move turning by 22.5° or more in one tick,
    so a stick turning smoothly never lurches.
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
  - The table's "about 0.87 s" from the run to the sprint is 0.83 s: Apex's run band overshoots the run by a tick
    (R5Reloaded's trial); docs/PLAYGROUND.md says so now.
- **The keys, ahead of WP 13.9.** createEngine takes an `actionMap`, and the playground binds `actionMap:playground`
  (labs/playground/controls.ts): Shift sprints, Left Alt walks, Left Ctrl crouches. WP 13.9 adds the rest of §3.3's
  table and rebinding.
- **The feel course moved** to engine/sim/feelCourse.ts (engine/sim/actors.ts was at its 400 lines) and measures the
  model (`FeelReport.motion`), which `node x sim <scene> --feel` prints.
