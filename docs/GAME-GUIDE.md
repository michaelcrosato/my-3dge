# Making a game with my-3dge

You are making a game with the my-3dge engine. Read this once, start to finish; after that, look things up (section
8). A game's AGENTS.md sends you here after `node tools/game/new-game.mjs` made the game. For a model without the
repository, this one file is also the engine in brief: its public API by area is section 10.

## 1. What you have

my-3dge is a 3D web game engine built for AI coding agents: TypeScript, three.js r182 on WebGPU, Rapier physics, the
UI in HTML/CSS. Three promises shape everything you write:

- **Play is reproducible.** The rules (the _sim_) run on the CPU at a fixed 60 steps a second. The same seed and the
  same intents give the same state, bit for bit, in Node and in Chromium; every state has a 16-digit hash.
- **Nothing needs a screen.** The sim runs headless in Node (tests, `node x sim`). The page renders on WebGPU in a
  headless Chromium (`node x shot`) and reports what it drew as numbers: which object covers which pixels (the ID
  pass), the look's metrics, a text thumbnail. You prove a game works with commands, not by looking.
- **Code and data, not binary files.** Levels are text maps; materials and textures are generators with parameters;
  sounds are voices and tracker notes; characters are procedural bodies, with a library of readable motion clips.

A game's repository:

| Path                                                             | What it is                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `labs/game/`                                                     | The game: the page, the rules (`scenes/`), the characters (`cast/`), the bot, the replays |
| `labs/box/`                                                      | The engine's worked example: a hero, crowds, combat, props, looks, sound (read-only)   |
| `engine/`                                                        | The engine. Game code imports only engine/index.ts and engine/sim-api.ts            |
| `tools/`, `x.js`                                                 | The `node x` commands, the lint rules, the templates (tools/templates/)               |
| `data/anim/`                                                     | The animation library: readable clips, and the engine's actions                       |
| `docs/`                                                          | This guide, API.md (every public name) and ERRORS.md (every error code, with its fix) |
| `engine-lock.json`, `ENGINE-FEEDBACK.md`                         | The engine's pinned commit and file hashes; what you needed from the engine           |

Everything but `labs/game/` and the root's game files (AGENTS.md, README.md, package.json…) is the engine's,
read-only: `npm run check` compares every engine file with engine-lock.json.

## 2. The model

**Two halves.** The sim is the game's rules: entities holding components (plain data), systems that change them each
step, events. Sim-side code (labs/game/scenes/, labs/game/cast/) imports only engine/sim-api.ts and never touches the
DOM, the GPU, the clock or `Math.random`. The page (labs/game/main.ts) imports engine/index.ts: `createEngine` starts
the sim, turns the keyboard, mouse, pads and touch into intents, draws every frame on WebGPU, and calls your `onFrame`
for the game's own presentation (the HUD, sound). The page reads the sim and never writes it. Lint enforces the split.

**A scene** is the unit `x sim`, the page and the tests run: `defineScene('game:play', { level, physics, settings,
setup(w), step(w, intents) })`. `setup` spawns entities and adds systems; `step` runs first in every step. One page can
offer several scenes (`createEngine({ scenes })`, `?scene=<id>` picks one); a running page cannot switch scenes yet,
so a level select reloads the page with another `?scene`.

**The world, `w`**, is what systems get:

- **Components and entities.** `defineComponent('gem', { description, fields })` declares a component: typed fields
  with defaults and units, so the state can be hashed, captured and checked. `w.spawn({ gem: { x, z } })` returns an
  id; `w.query('gem')` returns the live entities holding it, in id order; `w.get(id)`, `w.add`, `w.remove` and
  `w.despawn` do the rest. An entity whose component declares `x` and `z` in metres is drawn as a stand-in box until
  something draws it properly (an actor, a prop, a crowd body).
- **Systems** run in phases, in this order: `intents`, `ai`, `anim`, `physics`, `readback`, `rules`.
  `w.systems.add('game.collect', collect, { phase: 'rules' })` puts a rule after the physics moved the bodies and the
  readback copied their places into components.
- **Events.** `w.emit('gem', payload)` delivers at the end of the step to `w.events.on('gem', …)` listeners. A page
  reads them from `frame.world.events.trace` (sounds, effects); emitters burst on them; tests count them.
- **Time** is steps: `w.tick`, `w.dt` (1/60 s), `w.hz`. Count a duration in whole steps (30 s is 1,800), never by
  adding up `w.dt`: floating-point sums drift (the starter's clock does it right). `w.timers` schedule in sim seconds.
- **Randomness** comes from named streams seeded by the run: `w.rng('gems').int(0, 9)`, `.range(a, b)`, `.chance(p)`.
- **Settings** are the game's tunable numbers: `defineSettings({ 'game.gems': { type, default, minimum, maximum,
  unit, when: 'scene', description } })`, read with `w.settings.get('game.gems')`. Each is reachable from the URL
  (`?game.gems=20`), from `node x sim … --set game.gems=20`, `node x set` and `__engine.set`, and replays record them.

**Intents** are everything the sim reads from outside, once per step, as plain data: `move` (a world-space
direction `[x, z]`), `b` (buttons held), `p` (pressed this step), `aim`, `look`, `cam`, and the game's own
`'game:<name>'` keys. A player actor reads the step's intents itself; systems get them as their second argument
(`held(intents, 'jump')`, `pressed(intents, 'attack')`). In a page, devices make intents through an action map
(`actionMap:thirdPerson` by default: WASD or the arrows run, Space jumps, Shift dashes); a map with `look: true` sends
the camera's view as `look`, and its `aimWith` fills `aim` (`centre`: what the screen's middle points at; `pointer`:
the pointer on the player's floor), and a game with several camera modes gives `createEngine` a map per camera
(`actionMap: (code) => …`). A bot or a test writes them directly: `engine.step(1, { move: [1, 0] })`. A replay is the
intents of a run, recorded.

**Proof.** `engine.hash()` digests the whole sim. A replay file (labs/game/replays/bot.replay.json) holds a scene,
seed, settings, the intents at each step that changed them, and the golden hashes at its checkpoints, per platform
(`linux-x64`). `capture()` and `restore()` copy a run and continue it exactly. If a hash changes, play changed.

## 3. The starter, file by file

The starter (labs/game/) is a whole small game: run round an arena collecting every gem before the clock runs out.
Grow your game from it; keep its tests as they are, and change what they check as the game changes.

| File                         | What it shows                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| labs/game/scenes/play.ts     | The rules: a level as text, settings, components (`gem`, `round`), systems, a random stream, events |
| labs/game/cast/player.ts     | The player: a character on the controller (run, jump, dash) drawn as the humanoid          |
| labs/game/bot.ts             | A bot that plays through intents, steering down a flow field to the nearest gem            |
| labs/game/main.ts            | The page: `createEngine`, the HUD in `onFrame`, Enter to play again, the chase camera     |
| labs/game/scenes/play.test.ts | The tests: the golden replay, capture and restore, the bot wins on 10 seeds, the clock     |
| labs/game/replays/bot.replay.json | The bot's play, recorded, with its golden hashes                                      |
| labs/game/README.md          | The game's own page: what it is, how it plays, the calls made                              |

## 4. What to reach for

The public names below are in engine/sim-api.ts (sim-side) or engine/index.ts (pages); section 10 lists them all.
The box (labs/box/, its README says which scene shows what) has a working use of almost each one.

| You need                       | Reach for                                                                                 | See it in                          |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| A level                        | A text map in a scene module; `compileLevel`, glyphs (`#` wall, `.` floor, `@` spawn, `w` low wall, `P` pillar, `^` stairs, `=` gallery, `o` dais, `t` brazier), `defineGlyph` for your own; `addLevelBodies`; the page registers the text (`createEngine({ levels })`) | labs/game/scenes/play.ts, labs/box/levels/hall.txt |
| A player or character          | `createCharacter` (speed, jump, dash, coyote time, buffer), `spawnActor`, `measureFeel`   | labs/game/cast/player.ts, labs/box/cast/hero.ts |
| Physics                        | `physics: true` in the scene, `physicsOf(w)`: bodies, `raycast`, `overlap`, `probe`; `addBox`, `addSensor`, `knock`, movers | labs/box/scenes/hall.ts |
| Props                          | `defineProp` (meshes, a body, hooks), `spawnProp`, `hitProp`; the engine's `prop:crate`, `prop:barrel`, `prop:brazier`, `prop:pillar` | labs/box/scenes/hall-props.ts |
| Enemies and crowds             | Crowd bodies (`addAgent`, `updateCrowd`, `knockback`, `killAgent`), steering (`seek`, `followFlow`, `approachRing`), `NavGrid` and `FlowField`, attack tokens, `canSee` | labs/box/cast/walker.ts, labs/box/scenes/crowd-1000.ts |
| Combat                         | Moves as data (`defineMove`, `Attack`, `Combo`), hit queries (`coneHits`, `sweepHits`), `damage` and `HEALTH`, projectiles, telegraphs, `reactTo`, `requestHitStop` | labs/box/scenes/fight.ts, labs/box/cast/hero.ts |
| Animation                      | Actors animate themselves (`spawnActor({ anim: { build } })`); builds, bodies, the animator's body states, actions (`defineAction`, played on an actor with `actOn`), clips from the library (`playClip`) | labs/box/scenes/clips.ts, `node x anim find` |
| How it looks                   | Materials and textures as data (`defineMaterial`, `defineTexture`), looks (`?post.look=look:cartoon`; `defineLook`), skies, lights | labs/box/looks/torch-lit.ts, `node x describe look` |
| Effects                        | Emitters as data, bursting on sim events (`defineEmitter`); telegraphs; screen shake      | labs/box/scenes/fight.ts           |
| UI                             | `engine.ui`: `hud(id, text, { at })`, `label`, `damage`, `crosshair`; menus and screens as plain HTML/CSS in the page | labs/game/main.ts, labs/box/menu.ts |
| Sound                          | Effects and songs as data (`defineSfx`, `defineSong`), the page's `createAudio`; a scene's `sounds` maps events to sounds | labs/box/sounds/effects.ts, labs/box/sounds/page.ts |
| Cameras                        | `?cam=iso` (`threequarter`, `topdown`, `brawler`, `side`), `?cam3=chase` (`orbit`, `fly`, `fixed`, `first`, `rail`); `__engine.camera.set(code)` | labs/game/main.ts |
| Touch controls                 | `defineTouchLayout`, `createEngine({ touchLayout })` (built, not yet tested on phones)   | labs/box/touch.ts                  |
| A new entry of a kind          | `node x new <kind> labs/game/<dir>/<name>`: the module and its test from a template (`node x new` lists the kinds; a new scene starts as a copy of play.ts instead) | tools/templates/                    |

Saves and high scores have no engine store yet: keep them in the page (`localStorage`), outside the sim.

## 5. Rules that keep play reproducible

- Sim-side code (labs/game/scenes/, labs/game/cast/) imports only engine/sim-api.ts; pages only engine/index.ts.
  Never import three.js or Rapier directly: the public API re-exports what a game needs.
- No clocks, timers, `Math.random`, `crypto`, DOM, storage, Web Audio or Node built-ins in sim-side code, and no
  dynamic `import()`: lint refuses each, and its message names the fix. No network either: what the sim needs from
  outside arrives as intents or settings. Write `Math.pow`, not `**`. Use the standard `Math`: the sim swaps in
  portable ports while it steps, so the results match in Node and Chromium.
- Time in steps; randomness from named streams; entities in `w.query`'s id order.
- A sim-side module reads no files: a level's text lives in a string in the scene module.
- Presentation never writes the sim: cameras, looks, particles, sound and the HUD change freely without changing a hash.
- Units: metres, seconds, radians; +Y up, x east, z south; characters face +Z.

**Assets.** Make them with code and data first: geometry, textures and materials as generators with parameters,
sounds as voices and tracker notes, levels as text. A binary file (an image, a recorded sound, a model) needs the
owner's approval: ask, and once they approve, list it in APPROVED-BINARIES.json at the game's root as
`{ "path", "reason" }`, the reason their answer, who and when; `npm run check` fails a binary listed nowhere. Fonts
are approved: anywhere in labs/game/, each with its license file beside it.

## 6. Seeing it without a screen

Every command prints its verdict first, about 20 lines at most, and writes `out/<cmd>/<target>/report.json`;
`node x help <cmd>` gives its manual.

| Command                                                     | What it does                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm test`                                                  | The game's tests (Vitest), headless                                              |
| `npm run check`                                             | Types, lint, format, `node x check` (the asset rules; the engine as pinned)       |
| `node x sim labs/game/scenes/play.ts [--steps n] [--seed s] [--set k=v] [--feel]` | Runs a scene in Node: its hash, events, entities; `--feel` measures the player |
| `node x replay labs/game/replays [--browser sim] [--update] [--bisect]` | Checks replays' goldens; `--update` records them; `--bisect` finds where two runs part |
| `node x shot labs/game [--cam code] [--set k=v] [--png]`    | Renders the page on WebGPU: coverage, visible objects, a text thumbnail; an image only with `--png` |
| `node x film labs/game --steps "…" [--compare ref]`         | Films scripted play as a contact sheet; `--compare` names the objects whose pixels changed |
| `node x gallery <kind> [id] --page labs/game [--look id]`   | Films every prop, material, emitter, look, body or move as a labelled contact sheet; `#gallery/<kind>/<id>` opens one on any page |
| `node x inspect --page labs/game`, then `node x eval "<js>"`, `node x dump`, `node x set <key> <value>` | A live headless page to question: the HUD through DOM queries, `__engine` |
| `node x perf labs/game [--scene id]`                        | Performance as counters (ms per step and frame, draw calls), never frames per second |
| `node x describe [kind [id]]`                               | The registries: every kind's fields and entries (materials, moves, looks, sounds…) |
| `node x qa geo tex audio`                                   | Content QA by numbers: the engine's and the game's geometry, props, textures and sounds (the modules in a geometry, props, textures or sounds folder of labs/game/); a new or worse violation fails, and one the game accepts goes in its own `tests/baselines/qa-<family>-game.json` with the reason |
| `node x new <kind> <id>`                                    | A new entry from its template, with its test                                     |
| `node x audio sfx:<id>` · `node x anim find <words>`        | A sound rendered in Node, as numbers · the clip library searched                 |
| `node x engine`                                             | Which engine the game is on, and whether its files are as shipped                |

In a page, `window.__engine` is the inspector, and a headless engine in tests (`createHeadless({ scene, seed,
settings })`) has the same members but the rendering ones: `__engine.help()` lists them (`step`, `hash`,
`capture`, `restore`, `replay`, `input.press`, `input.axis`, `input.record`, `set`, `state`, `get`, `entities`,
`shot`, `stats`…).

## 7. Testing a game

- The starter's test shows the four kinds every game keeps: its golden replay, a run that continues exactly after a
  capture and a restore, the bot winning on 10 seeds, and a rule (the clock). Tests sit beside their module
  (`play.test.ts`) and run with `npm test`.
- Keep the bot as the game grows: teach it each new rule. "The bot wins on 10 seeds" keeps proving the game can be won,
  and finds the seeds that softlock.
- Check the UI through the DOM: the overlay's elements are `[data-ui]` (`node x inspect`, then `node x eval`).
- When play changes on purpose, record the goldens again (`node x replay labs/game/replays --browser sim --update`) and
  say why in the commit. When a hash changes by surprise, `node x replay <file> --browser sim --bisect` narrows it
  down: to the step, entity and field where two runs part (Node and Chromium, or Node and Node again), or, when every
  run agrees but they all left the goldens, to the checkpoints between which they did (then the code, data or a
  dependency changed what the sim does). The usual causes of runs that part: a `Math` function held in a variable or
  destructured, `**` (lint bans both sim-side), iteration over something whose order is not fixed, state kept in a
  module between runs, view settings or presentation reaching the sim, and `async` code in a step.

## 8. Looking things up

- **docs/API.md**: every public name with the first sentence of its doc comment, the public API first. The comment at
  the link is the full manual: grep engine/ for the name.
- **docs/ERRORS.md**: every error and advice code with its fix. Errors print as `[CODE] message`, and the fix says
  what to do.
- **The engine's file comments**: each module opens with what it is for, its rules and a runnable `@example`.
- **`node x describe`** for data, **`node x help`** for commands, **`__engine.help()`** for the inspector.
- **labs/box/** for a working example; **labs/box/README.md** says which scene shows what.
- **The engine's repository** (https://github.com/michaelcrosato/my-3dge) for its plan, its decisions and its tests.

## 9. When the engine is in your way

1. Work round it in the game: a component, a system, page code of your own.
2. Write it in ENGINE-FEEDBACK.md for an engine agent who has never seen your game: what you tried, what happened
   (the command, the error code), what you expected, what you did instead. The owner collects these from every game.
3. Never change the engine quietly: `npm run check` compares every engine file with engine-lock.json. When no
   workaround exists, patch the file and list it under "Local engine patches" in ENGINE-FEEDBACK.md, with why.
4. The owner decides when a game moves to a newer engine (`node x engine --update`). It replaces nothing of the
   game's own (it stops and names what is in the way); the engine's package.json entries win, and it names any it
   drops or sets back. It says which root files it brought to the engine's templates, and which ones you edited
   whose templates changed: compare those with tools/game/template/ and take what applies. After it: `npm ci`,
   `npm run check`, `npm test`, and record the goldens again where play changed.

## 10. The public API by area

<!-- api-map:start: generated by `node x docs --write` from the area comments of engine/sim-api.ts, engine/anim/api.ts and engine/index.ts; edit those, not this section -->
Sim-side code imports these from engine/sim-api.ts; pages get them from engine/index.ts as well. Each name has the
first sentence of its doc comment in docs/API.md, and its whole manual where it is declared.

**Scenes**: defined as data with a setup and a step, run by x sim, x replay and createHeadless.
`defineScene`, `defineDevAction`; types `Scene`, `SceneSpec`, `SceneAction`, `SceneSound`, `DevActionSpec`.

**The world**: entities, components, systems, timers, events.
`defineComponent`, `PHASES`; types `World`, `SimRng`, `WorldTimers`, `WorldEvents`, `Entity`, `With`, `SpawnSpec`, `ComponentOf`, `Phase`, `SystemFn`.

**Registries and settings**: content as data, one schema for every setting.
`defineKind`, `def`, `defineSettings`; types `Entry`, `Kind`, `KindSpec`, `Field`, `Schema`, `SimSettings`, `SettingValue`.

**Intents**: what the sim reads from outside each step.
`held`, `pressed`, `fromCamera`, `INTENT_KEYS`, `createInputBuffer`, `updateInputBuffer`, `released`, `buffered`, `consume`, `consumeAll`, `repeated`, `BUFFER_STEPS`, `REPEAT_DELAY`, `REPEAT_RATE`; types `Intents`, `IntentValue`, `CustomIntentKey`, `InputBuffer`.

**Math**: three.js's math classes and the engine's helpers (MathUtils covers clamp, lerp, damp, smoothstep).
`Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3`, `Sphere`, `Ray`, `Plane`, `Color`, `MathUtils`, `approach`, `angDiff`, `lerpAng`, `approachAng`, `smoothDamp`, `ease`, `swingTwist`.

**Randomness**: seeded streams (the world's are w.rng('<stream>')).
`Rng`.

**Events**: emitted with w.emit, heard with w.events.on.
types `EventMap`, `Listener`, `TraceRecord`.

**Levels**: a legend of glyphs, level text compiled to plain data (heights, solid grid, colliders, meshes, spawns).
`compileLevel`, `validateLevel`, `defineGlyph`, `defineLevel`, `getLevel`, `floorHeight`, `topHeight`, `solidAt`, `tileAt`, `LEVEL_FORMAT`; types `CompileOptions`, `LevelSource`, `LevelProblem`, `Glyph`, `GlyphSpec`, `LevelEntry`, `CompiledLevel`, `LevelGlyph`, `BoxCollider`, `ColliderDescriptor`, `GroundDescriptor`, `MeshDescriptor`, `SpawnPoint`, `LightSpot`, `TileRect`, `Point3`.

**Animation (WP 3.4)**: the humanoid skeleton (a root plus 23 joints) and its builds, poses with three.js quaternions, blending under bone masks, additive layers, forward kinematics, SVG contact sheets and the pose checks.
`JOINTS`, `SOCKETS`, `MASKS`, `createSkeleton`, `boneMask`, `defineBuild`, `getBuild`, `Pose`, `blendPoses`, `makeAdditive`, `addPose`, `hashPose`, `forwardKinematics`, `createWorldPose`, `jointPosition`, `jointRotation`, `jointMatrix`, `jointToWorld`, `socketPosition`, `tipPosition`, `animSheet`, `animCheck`, `twoBone`, `twoBoneRot`, `LIMBS`, `aim`, `AIM_CHAIN`, `footPlant`, `createFootPlantState`, `FOOT_LOCK`, `FOOT_PLANT`, `FootPlant`, `queryGround`, `handTo`; types `JointName`, `SocketName`, `MaskName`, `Skeleton`, `BoneMask`, `Build`, `BuildSpec`, `JointRef`, `BlendOptions`, `WorldPose`, `Sheet`, `SheetFrame`, `SheetOptions`, `SheetView`, `AnimCheckSpec`, `AnimCheckReport`, `AnimProblem`, `RigidPair`, `PointName`, `TwoBoneOptions`, `LimbEnd`, `Limb`, `AimOptions`, `AimLink`, `FootPlantOptions`, `FootPlantState`, `FootLock`, `FootPlantLayerOptions`, `GroundQueries`, `GroundProbe`, `GroundHit`.

**The procedural humanoid (WP 3.6)**: my-3d2dge's gait, idle, lean, arm swing, held poses and stances as effector targets written with B(forward, right, up), solved onto the skeleton; a fixed step and a seeded stream.
`Humanoid`, `POSES`, `STANCES`, `WEAPONS`, `B`, `turnRight`; types `HumanoidOptions`, `HumanoidInput`, `HumanoidState`, `HumanoidWeights`, `BodyMotion`, `PoseName`, `StanceName`, `Weapon`, `Effectors`, `FRU`, `LimbSide`, `Sided`.

**The character animator (WP 3.7)**: a body driven through an explicit layer stack (weights, base, override, solve, then layers in clips, additive, post, physics and secondary), told its body states each step (unknown words warn with the closest), with footsteps, sockets, a trail and detail levels; step runs in the sim, pose in the view.
`Animator`, `BODY_STATES`, `checkBodyStates`, `TRAILS`, `SAMPLE_STATES`, `SLOTS`, `LAYER_SLOTS`, `LOD`, `easeWeight`, `HUMANOID_WEIGHTS`; types `AnimatorOptions`, `PoseOptions`, `AnimatorReport`, `AnimEvent`, `TrailSample`, `BodyStateName`, `AnimatorInput`, `TrailName`, `SampleState`, `SlotName`, `LayerSlot`, `AnimLayer`, `WeightRates`, `WeightInfo`.

**Blob and floater rigs (WP 5.3)**: my-3d2dge's squash-and-stretch blob on a minimal skeleton (a volume-preserving squash spring, a smoothed look, wings, its moves as data: bite, leap, pounce, spit) and a floater that hovers over the floor, banks into turns and carries orbiting motes; step runs in the sim, pose in the view.
`Blob`, `BLOB`, `BLOB_JOINTS`, `BLOB_LEAP`, `BLOB_MOVES`, `blobMove`, `blobMoveTimes`, `Floater`, `FLOATER`; types `BlobOptions`, `BlobInput`, `BlobState`, `BlobJoint`, `BlobPose`, `BlobLeap`, `BlobMove`, `BlobMoveName`, `BlobMoveFrame`, `FloaterOptions`, `FloaterInput`, `FloaterState`, `FloaterPose`.

**The animation library (WP 8.4)**: readable key-pose clips (format 1 and 2: parse, print, check, the normalized lens, mirroring, the decode to 36 body points), loaded per set; baked to 30 fps rotation tracks on the skeleton, retargeted onto any build (rotation copy aligned at rest, the hip-height ratio, contact IK) or given to three.js as AnimationClip JSON; played by the clip layer in the animator's clip slot, loops at the ground speed, with shardfall's walk-run switch and strike time.
`parseClip`, `parseClipSet`, `validateClip`, `poseError`, `poseMeanError`, `clipText`, `normalizedLens`, `mirrorClip`, `decodePose`, `samplePose`, `POSE_POINTS`, `POINT_INDEX`, `bakeClip`, `sampleBaked`, `travelAt`, `BAKE_FPS`, `retargetPose`, `clipJSON`, `hipRatio`, `standingHipHeight`, `restSkeleton`, `restPoints`, `restBuild`, `RETARGET`, `loadClipLibrary`, `clipPace`, `walkRate`, `runOverWalk`, `strikeTime`, `GROUND_SPEED`, `STRIKE`, `ClipLayer`, `CLIP_LAYER`; types `ClipSet`, `ClipSource`, `RestBody`, `ClipWarning`, `Clip`, `ClipKey`, `KeyPose`, `LimbPose`, `ClipEvent`, `ClipContact`, `BakedClip`, `RetargetOptions`, `AnimationClipJSON`, `ClipLibrary`, `ClipOrigin`, `ClipLayerOptions`, `ClipPlay`, `ClipSlot`, `ClipLayerState`, `ClipLayerEvent`, `ClipStepInput`.

**Moves (WP 6.1)**: moves as data in metres (the kind move: my-3d2dge's 24, converted by Appendix C's table), timelines whose events carry leftover time, attacks and combos with hit windows, sweeps and root motion, moves played on a humanoid through its body state (the arm path), moves at a moment for previews, measured hit shapes, the cone helpers and a hit's knockback velocity.
`defineMove`, `getMove`, `resolveMove`, `MOVE_PHASES`, `LEGACY_FIELDS`, `fromLegacy`, `Timeline`, `Attack`, `Combo`, `moveAt`, `measureMove`, `strikePart`, `strikeSegment`, `inArc`, `inHitShape`, `knockbackVelocity`; types `Move`, `MoveSpec`, `MoveInput`, `MovePhase`, `LegacyMove`, `TimelinePhase`, `TimelineMark`, `TimelineEvent`, `TimelineState`, `AttackState`, `ComboState`, `Sweep`, `HitShape`, `StrikeBody`, `StrikeAnimator`, `ArmState`.

**Reactions and secondary motion (WP 6.2)**: a directional flinch, knockdown, death and the get-up chosen by how the body lies (face up or face down), stepped in the sim; verlet chains (hair, tails) with bone-capsule colliders, a floor probe and a rest shape, a cape of two chains, and the squash spring as a volume-preserving root scale, drawn by an animator layer in the view.
`Reactions`, `REACTION`, `REACTIONS`, `lyingOf`, `Chain`, `CHAIN`, `Cape`, `Secondary`, `HAIR`, `CAPE`, `TAIL`, `SQUASH`, `squashScale`, `BODY_CAPSULES`, `bodyCapsules`; types `ReactionOptions`, `ReactionState`, `ReactionBody`, `ReactionName`, `Lying`, `ChainOptions`, `ChainTuning`, `BoneCapsule`, `CapeOptions`, `SecondaryOptions`.

**Animation checks (WP 6.6)**: the state matrix (each body state held at each facing, from rest and back to rest) and animCheckBody, which checks a whole body over it: every pose, the same hashes twice, 1/60 s against 1/120 s; and the camera presets sheets of it are drawn from.
`stateMatrix`, `STATE_MATRIX`, `animCheckBody`, `SHEET_CAMERAS`; types `MatrixState`, `MatrixRun`, `StateMatrixOptions`, `BodyCheckOptions`, `BodyCheckReport`, `AnimCheckName`.

**Actions (WP 8.7)**: multi-beat sequences a body plays, beats of body states, clips, IK targets, flips and squashes with held contact frames, events, flags and cancel windows; the engine's set is data/anim/actions/, which loadActions defines.
`Actions`, `defineAction`, `getAction`, `loadActions`, `actionCheck`, `ACTION`, `FLIP_AXES`, `EFFECTORS`, `CHANNELS`; types `ActionsOptions`, `ActionsState`, `Action`, `Beat`, `ActionSpec`.

**Clip sets in the registry (WP 8.9)**: the kind clipset, one entry per set of readable clips, which a page or tool registers from data/anim/sets/ (defineClipSet), and the clip layer of an entity kept as plain data, loaded from it at every use (ClipLayerPool), as an actor's component clips holds it.
`defineClipSet`, `clipSetFromFiles`, `getClipSet`, `clipSetId`, `clipSetIds`, `defineSetBuild`, `CLIPSET_FIELDS`, `CLIPS_FIELDS`, `emptyClipState`, `ClipLayerPool`; types `ClipSetEntry`, `ClipsData`.

**Physics (WP 3.1)**: Rapier behind plain terms. A scene with `physics: true` has a physics world: bodies by id, raycasts, shape casts, overlaps and ground probes, collision groups by name, a level's bodies; presentation reads it through the read-only QueryView.
`physicsOf`, `COLLISION_GROUPS`, `PHYSICS_SETTINGS`, `addLevelBodies`, `queryViewOf`; types `Physics`, `BodySpec`, `ColliderSpec`, `BodyState`, `BodyChange`, `BodyType`, `Shape`, `Vec3Like`, `QuatLike`, `Hit`, `Ground`, `QueryOptions`, `RayOptions`, `ShapeCastOptions`, `OverlapOptions`, `ProbeOptions`, `GroupName`, `QueryView`.

**Characters (WP 3.2)**: actors moved by the character controller (Rapier's, moved across then down), with an action game's feel: acceleration and skid, coyote time, a jump buffer, a variable jump, a wall jump, a dash, pushing props; the feel meter measures how one handles. A body's reactions and an actor's secondary motion as components (WP 7.8), and its actions (`actOn`, WP 13.11).
`createCharacter`, `CHARACTER_FIELDS`, `CHARACTER_STATE_FIELDS`, `spawnActor`, `removeActor`, `measureFeel`, `reactTo`, `stepReactions`, `REACTION_FIELDS`, `SECONDARY_FIELDS`, `actOn`, `ACTIONS_FIELDS`; types `Character`, `CharacterState`, `ActorSpec`, `ActorComponent`, `ActorComponents`, `FeelReport`, `FeelOptions`, `AnimatorComponent`, `SecondaryComponent`, `ReactionComponents`, `ActionComponents`.

**Levels v2 (WP 4.2)**: the hall's glyphs (gallery =, stairs ^, dais o, brazier t), ramps and daises, hull and cylinder colliders, and the surface tag underfoot.
`surfaceAt`; types `HullCollider`, `CylinderCollider`, `RampDescriptor`, `DaisDescriptor`, `Side`.

**Navigation and spatial queries (WP 4.3)**: a level's walkable grid under a climb limit (the crowd's, or a hero's jump reach from measureFeel), A* paths smoothed by line of sight, cached flow fields with reach and a look-ahead direction, and a spatial hash on typed arrays for neighbours.
`NavGrid`, `FlowField`, `NAV_GRID_FIELDS`, `NAV_DIRECTIONS`, `LOOK_AHEAD`, `NEAREST_RINGS`, `NAV_CLIMB`, `SpatialHash`, `SPATIAL_HASH_FIELDS`; types `NavGridOptions`, `FlowOptions`, `GroundPoint`, `SpatialHashOptions`.

**Bodies and props (WP 4.1)**: props of one shape in the prototype's material, torque impulses and the knock; movers, kinematic bodies whose pose is a function of time, carrying riders; sensors and triggers; the lost-body rescue.
`PROP_MATERIAL`, `addProp`, `addBox`, `addBall`, `addCapsule`, `addCylinder`, `applyTorqueImpulse`, `knock`, `MOVER_FIELDS`, `MOVER`, `moverPose`, `driveBody`, `driveMover`, `addSensor`, `sensorHits`, `TRIGGER_FIELDS`, `updateTrigger`, `rescueLost`; types `PropSpec`, `KnockOptions`, `Mover`, `SensorSpec`, `Trigger`, `RescueLevel`.

**Props as data (WP 4.5)**: the registry kind `prop` (meshes by geometry and material id, a body, a light spot, where a level places it, the hit and use hooks), the engine's crate, barrel, brazier fire and pillar, the library's sconce, banner, chest, door, table, bench, statue and lantern (WP 10.3), and their placement.
`defineProp`, `getProp`, `propCentre`, `levelProps`, `propBody`, `propPose`; types `Prop`, `PropDefinition`, `PropPart`, `PropTouch`, `PropKnock`, `PropPlacement`, `PropBody`, `PropPose`.

**Props in a scene (WP 4.6)**: spawnProp stands a prop in a running scene (its body, and an entity with the component sceneProp whose pose is read back after each step, which the view draws as the prop); hitProp calls its hit hook with the means to knock it; removeProp.
`spawnProp`, `removeProp`, `hitProp`, `SCENE_PROP_FIELDS`; types `ScenePropComponent`, `ScenePropComponents`.

**Crowd bodies (WP 5.1)**: agents as dynamic capsules and balls driven by the velocities their AI wants (approach limits, only on their feet), knockback and launches, the corpse group and its timers, spawn and despawn queues.
`CROWD_AGENT_FIELDS`, `CROWD_AGENT`, `CROWD_MATERIAL`, `CROWD_LIMITS`, `CROWD_GROUNDED`, `addAgent`, `removeAgent`, `setVelocity`, `knockback`, `launch`, `killAgent`, `updateCrowd`; types `CrowdAgent`, `AgentState`, `VelocityOptions`, `CrowdOptions`, `CrowdChanges`, `CrowdStepper`.

**Steering kit (WP 5.2)**: the velocity a crowd agent wants (seek and arrive, flow-field following, approach rings, a flyer's hover, a jumper's hop), attack tokens that cap the attackers at once, and awareness by distance and sight.
`seek`, `followFlow`, `approachRing`, `hover`, `airTime`, `hop`, `FOLLOW`, `APPROACH_RING`, `HOVER`, `HOP`, `ATTACK_TOKENS_FIELDS`, `ATTACK_TOKENS`, `takeToken`, `releaseToken`, `holdsToken`, `keepTokens`, `canSee`, `clearSight`, `SIGHT`; types `SteerPoint`, `FollowOptions`, `ApproachRingOptions`, `HoverOptions`, `AttackTokens`, `SightOptions`.

**Crowd bodies (WP 5.7)**: a crowd member's look and rig (a humanoid in a build, a blob, a floater) in the component crowdBody, its rig stepped in the sim by stepCrowdBody; the stage draws them through a crowd with its level of detail.
`CROWD_BODY_FIELDS`, `CROWD_BODY`, `stepCrowdBody`; types `CrowdBody`, `CrowdRig`, `CrowdBodyInput`.

**Telegraphs (WP 6.4)**: an attack's warning shape on the floor as data (an arc, a ring, a line or a cone, in metres), and the geometry sim code tests it with as it goes off: a body inside it is hit, one just outside it a near miss.
`TELEGRAPH_SHAPES`, `defineTelegraph`, `getTelegraph`, `telegraphGap`, `inTelegraph`, `nearMiss`, `telegraphFill`, `coneOf`; types `Telegraph`, `TelegraphSpec`, `TelegraphPlace`, `PointLike`.

**Combat helpers (WP 6.3)**: hit queries against hurt capsules found through a spatial hash (cones with height windows, weapon sweeps), damage on health and crowd bodies (knockback as momentum, launches, death into the corpse group, the event damage), hit-stop handed to the frame clock's budget, and projectiles with swept tests.
`PROJECTILE_FIELDS`, `PROJECTILE`, `stepProjectiles`, `capsuleCast`, `inCone`, `coneHits`, `sweepTouches`, `sweepHits`, `physicsWalls`, `HEALTH_FIELDS`, `HEALTH`, `damage`, `requestHitStop`; types `Projectile`, `ProjectileState`, `ProjectileStep`, `ProjectileHit`, `HurtCapsule`, `HurtSet`, `WallTest`, `WallContact`, `Health`, `DamageTarget`, `HitSpec`, `DamageEvent`, `DamageEvents`.

**Clips on actors (WP 8.9)**: the clip layer in an actor's animator as sim data, the component clips, stepped at the actor's ground speed and drawn over its body by the view; its events come as `clip`. spawnActor's `body` names the body it is drawn as (body:mannequin).
`addClips`, `playClip`, `stopClip`, `seekClip`, `locomoteClips`, `clipLayerOf`; types `ClipsSpec`, `PuppetComponent`.

**Movement profiles (WP 13.3)**: the registry kind `movement`, and the shooter model (Apex's) a profile gives a character.
`defineMovement`, `getMovement`, `listMovements`, `MODEL_FIELDS`, `MOTION_FIELDS`; types `MovementProfile`, `MovementSpec`, `MovementModel`, `MovementModelSpec`, `MotionState`, `MotionFeel`.

**The feel kit, sim-side (WP 13.4)**: the shooter model's live tuning, `movement.<group>.<field>` (a setting off its default replaces that number in every model character's model, from the next step), and an actor placed at rest (a scene's dev action: a feel course's start).
`MOVEMENT_SETTINGS`, `movementOverrides`, `tuneCharacter`, `placeActor`; types `MovementOverride`.

**Rides (WP 13.7)**: ziplines, ladders and launchers as world data (engine/world/traverse.ts), placed in a scene (engine/sim/rides.ts) and ridden by the shooter model (engine/physics/movement/ride.ts, ladder.ts): a zipline and the poles under its anchors, the redeploy balloon's line and its skydive, a ladder (or every ladder a level's ladder glyph `|` stands), a jump pad or a trampoline. Use is the button `interact`; the look's pitch picks a vertical zipline's way and a skydive's dive.
`addZipline`, `addLadder`, `addLauncher`, `addLevelLadders`, `ridesOf`, `levelLadders`; types `ZiplineSpec`, `LadderSpec`, `LauncherSpec`, `Rides`, `RideCable`, `RideLadder`, `RideLauncher`.

**Storeys (WP 13.13)**: format 2, levels written as storeys, read a storey at a time or in 3D: the highest surface at or under a point, its storey (by height, or by that surface) and its room.
`LEVEL_FORMAT_2`, `storeyView`, `floorBelow`, `surfaceBelow`, `storeyAt`, `storeyBelow`, `roomAt`; types `StoreyDescriptor`, `RoomDescriptor`, `OpeningDescriptor`, `RoofDescriptor`.

**Terrain (WP 10.5)**: the registry kind `terrain`, a seeded heightfield, its queries, its body and its navigation.
`defineTerrain`, `getTerrain`, `makeTerrain`, `terrainProblems`, `TERRAIN_FIELDS`, `terrainHeight`, `terrainGradient`, `terrainNormal`, `terrainGrade`, `terrainSurface`, `scatterTerrain`, `addTerrainBody`, `terrainNavGrid`, `terrainNavSurface`; types `Terrain`, `TerrainSpec`, `TerrainEntry`, `TerrainHill`, `TerrainFlat`, `ScatterRule`, `TerrainPlace`, `TerrainNavOptions`, `NavSurface`, `NavSource`.

**Sites (WP 13.15)**: levels standing on a terrain, each placed and turned in quarter turns, the terrain cut under them; the queries over all of it, the bodies, the ladders and the navigation over every storey and the terrain.
`defineSite`, `getSite`, `makeSite`, `SITE_FIELDS`, `toWorld`, `toLocal`, `siteFloorBelow`, `siteSurfaceBelow`, `siteStructureAt`, `siteSolidAt`, `siteClearSight`, `siteRescueGrid`, `createSiteNav`, `addSiteBodies`, `addSiteLadders`; types `Site`, `SiteSpec`, `SiteStructure`, `StructureSpec`, `SiteRescueGrid`, `SiteNav`, `SiteNavOptions`.

**Use (WP 13.16)**: the system `interact` (a player's use of the thing in reach and in view, with its prompt; carrying and throwing a light prop; a melee strike), the kinds `usable` and `strikable`, and the body-to-entity lookup.
`addInteraction`, `defineUsable`, `defineStrikable`, `strikeEntity`, `USE_REACH`, `CARRY_MASS`, `THROW_SPEED`, `propOfBody`; types `UsableSpec`, `InteractorComponent`, `StrikeForce`, `SpawnPropOptions`, `PropHealthComponent`, `PropLightComponent`.

**Doors (WP 13.16)**: hung on a hinge or sliding, opened away from the user, locked, blocked, burst open and broken.
`addDoor`, `addLevelDoors`, `useDoor`, `strikeDoor`, `breakDoor`, `DOOR_SWING`; types `DoorSpec`, `DoorComponent`.

**Windows and breakables (WP 13.16)**: props with health and their breaking, a level's window panes, a bolt's strike.
`addLevelWindows`, `addBreakables`, `damageProp`, `breakProp`, `strikeBody`, `BREAK_SPEED`.

**Switches (WP 13.16)**: a room's lights and the garage door, as sim state the view reads.
`addSwitch`, `switchGroup`, `flipSwitch`; types `SwitchSpec`, `SwitchComponent`.

Pages only, from engine/index.ts:

**Headless**: the engine without a page, and its inspector (window.__engine in a page).
`createHeadless`; types `Headless`, `HeadlessOptions`, `Inspector`, `EngineInfo`, `EntitySummary`.

**Materials and procedural textures (WP 2.3)**: materials as data with three.js's classic parameters, seeded tiling texture generators and their helpers, the CPU bake, and the page's material library.
`defineMaterial`, `getMaterial`, `createMaterialLibrary`, `defineTexture`, `bakeTexture`, `cellHash`, `wrapIndex`, `palette`, `pickTone`, `runningBond`, `tileNoise`; types `MaterialEntry`, `MaterialSpec`, `MaterialLibrary`, `TextureEntry`, `Texel`, `TextureContext`, `TextureSpec`, `TextureLook`, `TextureBake`, `TextureRef`.

**Input (WP 3.3)**: the devices of a page sampled into intents (keys by physical code, mouse with pointer lock and the wheel, gamepads in any slot), action maps and their presets, bindings players change and keep, prompts per device, the virtual device that __engine.input drives, and the scripted gamepad for tests.
`createInput`, `defineActionMap`, `getActionMap`, `listActionMaps`, `SYSTEM_ACTIONS`, `RESERVED_CODES`, `createBindings`, `codeLabel`, `readKeyboardLayout`, `isCode`, `createVirtualDevice`, `connectVirtualDevice`, `createScriptedGamepad`; types `Input`, `InputOptions`, `CameraLike`, `CameraInputSample`, `ActionMap`, `ActionMapSpec`, `Bindings`, `BindingsOptions`, `BindingsStorage`, `BindingsFile`, `RebindResult`, `DeviceKind`, `VirtualDevice`, `ScriptedGamepad`, `GamepadLike`.

**Aiming and look (WP 13.9)**: the point the intents' aim carries by a map's rule, and the look settings input.*.
`aimPoint`, `screenRay`, `onFloor`, `AIM_RULES`, `AIM_RANGE`, `STICK_REACH`, `lookOptions`, `scaleLook`, `LOOK_SETTING_FIELDS`, `LOOK_SETTINGS`, `DEGREES_PER_COUNT`; types `AimRule`, `AimPose`, `AimView`, `AimDevices`, `AimRay`, `LookOptions`, `RawLook`, `ScaledLook`.

**Geometry kit and level meshes (WP 2.4)**: shapes standing on the ground with UVs in metres, the geometry registry (props and levels name geometry by id), their QA measures, and a compiled level drawn as meshes.
`boxGeometry`, `roundedBoxGeometry`, `limbGeometry`, `rampGeometry`, `frustumGeometry`, `pillarGeometry`, `pillarParts`, `ringGeometry`, `sidesThenTops`, `mergeGeometries`, `defineGeometry`, `getGeometry`, `buildGeometry`, `inspectGeometry`, `createLevelMeshes`, `LEVEL_RECIPES`, `createTerrainMeshes`; types `BoxOptions`, `RoundedBoxOptions`, `LimbOptions`, `RampOptions`, `FrustumOptions`, `PillarOptions`, `PillarPart`, `RingOptions`, `GeometryEntry`, `GeometrySpec`, `GeometryRef`, `GeometryReport`, `LevelMeshes`, `LevelMeshesOptions`, `LevelMeshPart`, `LevelCell`, `LevelRecipe`, `LevelShape`, `TerrainMeshes`, `TerrainMeshesOptions`.

**Sound data (WP 9.2)**: effects and songs as registry entries (voices, layers, variants; tracker-notation tracks), rendered offline by the DSP core into reproducible samples.
`defineSfx`, `getSfx`, `renderSfx`, `sfxVoices`, `defineSong`, `getSong`, `renderSong`, `songVoices`, `songTiming`; types `Sfx`, `SfxSpec`, `SfxLayer`, `SfxBus`, `SfxRenderOptions`, `Song`, `SongSpec`, `SongTrack`, `SongTiming`, `SongRenderOptions`, `Voice`, `SoundDef`.

**The audio runtime (WP 9.3)**: a page's sound through Web Audio, started by the first gesture: buses with ducking and voice limits, sounds placed in 3D and occluded through the QueryView, room reverb, and music in intensity layers that change on the beat and the bar line.
`createAudio`, `BUS_VOLUMES`, `ROOMS`, `roomReverb`, `VOICE_LIMITS`; types `Audio`, `AudioOptions`, `AudioState`, `AudioInfo`, `PlayOptions`, `Sound`, `ListenerPose`, `GestureTarget`, `AudioBus`, `MixerInfo`, `MusicChange`, `MusicPosition`, `Quantize`, `RoomName`, `RoomSpec`, `VoiceLimits`.

**The engine in a page (WP 2.7)**: createEngine reads the routes, starts the scene with its view, publishes window.__engine, warms up and runs the frame loop; createHeadless({ view: true }) builds the same view in Node.
`createEngine`, `parseRoutes`, `routeQuery`; types `Engine`, `EngineOptions`, `Routes`, `CameraInfo`, `PlayResult`, `PlayIntoOptions`, `ViewChange`.

**A page's own presentation (WP 9.5)**: createEngine's onFrame, once per drawn frame, with the run to read and the camera.
types `EngineFrame`, `FrameWorld`, `CameraPose`.

**Touch controls (WP 3.12; built, not tested, ADR-0021)**: a page's touch layout (the corner fan's buttons and the menu button) for createEngine's touchLayout and onMenu, the touch device on input.touch, and the touch codes it writes.
`defineTouchLayout`, `getTouchLayout`, `touchCode`; types `TouchLayout`, `TouchLayoutSpec`, `TouchButtonSpec`, `TouchDevice`, `StickView`, `TouchSetting`.

**Level meshes v2 and the cutaway (WP 4.4)**: galleries, stairs, the dais, pillars with plinths and capitals and brazier stands as recipe shapes; walls facing an outside camera cut low and pillars before the hero as stumps.
`createCutaway`, `planCutaway`; types `Cutaway`, `CutawayReport`, `CutTarget`, `LevelCut`, `CutWhen`, `PartCut`.

**Instancing and puppets (WP 3.8)**: batches of instanced copies in pages above r182's 1,000-slot uniform path; puppet bodies as data (one line per part on the humanoid skeleton's bones, mirrored parts, material slots), compiled per build and drawn as one rigid-skinned mesh per character or as instanced parts for crowds; blob shadows.
`createInstancedBatch`, `defineBody`, `getBody`, `compileBody`, `recolor`, `createPuppet`, `createPuppetBatches`, `createBlobShadows`, `blobScale`; types `InstancedBatch`, `InstancedBatchOptions`, `InstancedBatchStats`, `InstanceColor`, `Body`, `BodySpec`, `BodyPart`, `BodyPoint`, `BodyLength`, `PartOptions`, `CompiledBody`, `BodyPiece`, `PieceShape`, `Puppet`, `PuppetMaterials`, `PuppetBatches`, `BlobShadows`.

**The HTML/CSS overlay (WP 6.5)**: world-anchored labels and damage numbers placed from projected coordinates each frame (three.js's CSS2DRenderer pattern), HUD lines and a crosshair over the canvas; ui.state() for tests.
`createOverlay`, `DAMAGE_NUMBERS`, `uiState`; types `Overlay`, `OverlayOptions`, `HudOptions`, `HudPlace`, `Label`, `LabelOptions`, `DamageOptions`, `WorldPoint`, `Anchor`, `OverlayCamera`, `UiState`, `UiElementState`.

**The widgets (WP 10.6)**: bars, hearts and boxes, the dialog box and the menu as HTML/CSS over the overlay, reading the page's input (its system layer) and asking the page for sound cues; a gamepad's cursor over any panel. A menu sends the picks that change play as input (`send`), so replays hold them.
`createBar`, `createHearts`, `createBox`, `createPadCursor`, `createDialog`, `createMenu`.

**The store (WP 10.9)**: what a game keeps across sessions (high scores, progress, its settings) in the page's localStorage under the game's prefix, versioned and checked on load; memory in Node and in the isolated modes.
`createStore`, `memoryBackend`.

**Lights, shadows, atmosphere and sky (WP 7.1)**: light kinds for a level's light spots, a fixed pool of point lights near the focus with a shadow budget by quality tier, and sky presets (background, dome, backdrop, sun, ambient light, fog) that a sky puts on a scene.
`defineLight`, `defineSky`, `createSky`; types `LightEntry`, `LightSource`, `SkyEntry`, `SkySpec`, `Sky`.

**Materials v2 (WP 7.2)**: the same material data drawn in four styles (lambert, toon, flat, pbr), switched at run time with every style warmed; the toon look (bands and rim) as uniforms; outline shells for meshes and instanced batches.
`createStyleSet`, `MATERIAL_STYLES`, `TOON_LOOK`, `createOutline`, `OUTLINE_MODES`; types `MaterialStyle`, `StyleSet`, `StyleSetOptions`, `ToonLook`, `ToonUniforms`, `Outline`, `OutlineMode`, `OutlineOptions`, `OutlineShells`.

**Post-processing (WP 7.4)**: one chain every frame draws through, every filter a uniform (scoped to the characters, the objects or the environment), looks as data (a material style plus a filter chain, and the sky that lights it, WP 7.8), objects tagged by part.
`createPost`, `POST_SETTINGS`, `definePostSettings`, `setPart`, `PARTS`, `defineLook`, `FILTER_NAMES`, `SCOPES`, `PALETTES`, `STYLIZE_KINDS`; types `Post`, `PostOptions`, `Part`, `PostTag`, `LookEntry`, `LookSpec`, `FilterName`, `Scope`, `FilterChain`, `FilterSpec`, `PostShow`.

**Props drawn (WP 4.5)**: every prop part a batch of the instancing service, posed by its body, the flames dancing on the visual streams, the light spots flickering, for the light pool; a part's geometry and where it stands (its matrix in the prop's frame), for a prop's tests.
`createPropMeshes`, `FLICKER`, `buildPropPart`, `partMatrix`; types `PropMeshes`, `PropMeshesOptions`, `PropMeshPose`, `PropLight`.

**Crowd rendering and pose LOD (WP 5.4)**: thousands of humanoids, blobs and floaters in a few dozen draw calls over the instancing service, each body seen through bands of detail by its distance (the animator's pose level, capes), culled by the view; the blob and floater bodies as data.
`createCrowd`, `createCrowdLod`, `CROWD_LOD`, `BLOB_BODY`, `blobBody`, `FLOATER_BODY`; types `Crowd`, `CrowdDraw`, `CrowdRigDraw`, `CrowdStats`, `RigBody`, `RigPart`, `RigJoints`, `RigShape`, `CrowdLod`, `CrowdLodOptions`, `CrowdLodCounts`, `CrowdBand`, `CrowdBandSpec`, `BlobFeatures`.

**Performance counters (WP 5.5)**: what `__engine.stats()` returns, means in ms and the renderer's counts, never fps.
types `EngineStats`.

**The texture library (v2, WP 7.3)**: a level's whole floor as a texture generator (define it under a game's id), with moss at the walls' feet, a rune circle on each dais and contact shadows along every block's foot.
`levelFloorTexture`; types `LevelFloorOptions`, `ContactShadowOptions`, `FloorMossOptions`, `FloorRuneOptions`.

**Clips in pages (WP 8.4)**: three.js's AnimationClip and AnimationMixer, for presentation only (a page plays a baked clip on a puppet with clipJSON and AnimationClip.parse); the sim samples the same tracks through the clip layer. The mannequin: the Quaternius figure the library was measured on, as a body and a build.
`AnimationClip`, `AnimationMixer`, `defineMannequin`, `mannequinBody`, `MANNEQUIN_SLOTS`; types `MannequinData`.

**Effects (WP 6.4)**: particles as data (emitters: shardfall's presets, the 2D engine's kinds, event effects), drawn with telegraphs on the floor, socket trails, bolts and camera shake by a view's effects; never part of the hash.
`createEffects`, `FX_BUDGET`, `BOLT`, `defineEmitter`, `getEmitter`, `TRAIL_TINTS`, `ScreenShake`, `SHAKE`; types `Effects`, `EffectsOptions`, `FxEventPayload`, `FxStats`, `Emitter`, `EmitterSpec`, `EmitterLayer`, `ParticleFields`, `FxLight`, `BurstOptions`, `ParticleStats`, `TrailSampleLike`.

**The feel kit (WP 13.4)**: courses, scripted runs of a scene and the numbers measured on them (`node x feel`); the runner and its verdicts; the owner's feel panel and copy as profile.
`defineCourse`, `getCourse`, `listCourses`, `METRICS`, `runCourse`, `createFeelPanel`, `tunedSpec`, `profileText`; types `Course`, `Measure`, `Metric`, `CourseResult`, `CourseSample`, `MeasureResult`, `FeelPanel`, `FeelRow`, `FeelInspector`.

**Camera modes (WP 2.5, WP 3.9, WP 13.8)**: a code to a camera, each mode's factory, and a game's own.
`readCameraCode`, `createCamera`, `createShoulderCamera`, `SHOULDER`, `createFollowCamera`, `FOLLOW_RIG`, `createFirstCamera`, `createChaseCamera`, `createViewCamera`, `followCamera`, `defineCamera`, `makePose`, `poseForward`, `poseRight`, `poseUp`, `poseTarget`; types `AnyCamera`, `AnyCameraSpec`, `ShoulderInput`, `ShoulderSpec`, `FollowInput`, `FollowSpec`, `FollowCamera`, `FollowSteps`, `CameraKindSpec`, `Camera`, `CameraInput`.

**The rig a view steps (WP 13.8)**: blends on live switches, the view effects, the view settings cam.*.
`createCameraRig`, `rigOptions`, `CAMERA_SETTINGS`, `blendCameras`, `BLEND_TIME`, `createCameraEffects`, `applyEffects`, `cameraPlayer`, `apexFov`, `EFFECTS`; types `CameraRig`, `RigOptions`, `RigInput`, `CameraPlayer`, `EffectWeights`, `EffectsFrame`.
<!-- api-map:end -->
