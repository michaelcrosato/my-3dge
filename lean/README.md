# my-3dge, lean

The my-3dge game engine as a library, the way three.js or Rapier ship: one ES module, nothing to install, build or
test. It makes 3D games for the browser: three.js r182 draws on WebGPU, Rapier simulates the physics, a fixed 60 Hz
sim runs the rules, and HTML/CSS draws the UI. This file is all you need, in a chat with no sandbox too: a game is
one HTML file.

## Start

1. Take `game.html` (in full below): a small game that already plays. You run round an arena and collect the gems
   before the clock runs out.
2. Change it into the game you are asked for. Keep its head: it loads the engine, three.js and Rapier from jsDelivr.
3. Open it in a browser with WebGPU (current Chrome, Edge or Safari; Firefox where it has WebGPU): double-click it, or
   serve its folder (`npx serve`, `python3 -m http.server`). There is no WebGL fallback.

A bigger game can split its code into module files that each import `my3dge`; serve the folder then, since browsers
load module files over http, not from a double-clicked page.

## How a game is made

**Two halves.** The _sim_ is the rules: entities holding components (plain data), systems that change them every
step, and events. The _page_ calls `createEngine`, which starts the sim, turns the keyboard, mouse, pads and touch into
intents, draws every frame on WebGPU, and calls your `onFrame` for the game's own presentation (the HUD, sound). The
page reads the sim and never writes it.

**A scene** is a game mode: `defineScene('game:play', { level, physics, settings, setup(w), step(w, intents) })`.
`setup` spawns entities and adds systems; `step` runs first in every step. A page offers its scenes with
`createEngine({ scenes })`, and `?scene=<id>` picks one.

**The world, `w`,** is what systems get:

- `defineComponent('gem', { description, fields })` declares a component: typed fields with defaults. `w.spawn({ gem:
  { x, z } })` returns an id; `w.query('gem')` returns the entities holding it, in id order; `w.get`, `w.add`,
  `w.remove` and `w.despawn` do the rest. A component with `x` and `z` in metres is drawn as a stand-in box.
- Systems run in phases, in order: `intents`, `ai`, `anim`, `physics`, `readback`, `rules`:
  `w.systems.add('game.collect', collect, { phase: 'rules' })` runs after the physics moved the bodies.
- `w.emit('gem', payload)` delivers at the end of the step to `w.events.on('gem', …)`; a page reads
  `frame.world.events.trace`.
- Time is steps: `w.tick`, `w.dt` (1/60 s), `w.hz`. Count a duration in whole steps (30 s is 1,800).
- Randomness comes from named streams: `w.rng('gems').int(0, 9)`, `.range(a, b)`, `.chance(p)`.
- Settings are the game's tunable numbers: `defineSettings({ 'game.gems': { type, default, minimum, maximum, when:
  'scene', description } })`, read with `w.settings.get('game.gems')`, set from the URL (`?game.gems=20`).

**Intents** are everything the sim reads from outside, once a step: `move` (a direction `[x, z]`), buttons held and
pressed, and the game's own keys. A player actor (`spawnActor(w, { player: true, … })`) reads them itself; systems
get them as their second argument (`held(intents, 'jump')`, `pressed(intents, 'attack')`). WASD or the arrows run,
Space jumps, Shift dashes.

**Characters, physics and the rest** are in the API below, area by area: levels as text (`compileLevel`, glyphs `#`
wall, `.` floor, `@` spawn, `w` low wall, `P` pillar, `^` stairs), characters (`createCharacter`, `spawnActor`),
physics (`physicsOf(w)` and its `.raycast`, `.overlap`), props, crowds and steering, combat, materials and textures as
data, looks and post-processing, particle emitters, sound as data, cameras (`?cam=iso`, `?cam3=chase`), the HUD
(`engine.ui.hud`) and touch controls.

## Rules that keep play reproducible

The engine runs the same seed and the same intents to the same state, bit for bit, on every machine. Keep these in
the sim (a scene's `setup`, `step` and systems) and replays, `__engine.hash()` and capture and restore keep working:

- No `Date`, timers, `Math.random`, DOM, network or storage in the sim. Randomness from `w.rng`, time in steps.
- Write the standard `Math` (the sim swaps in portable versions while it steps), but never keep a `Math` function in a
  variable, and write `Math.pow`, not `**`.
- Keep the sim's state in components, not in variables beside it; loop over entities in `w.query`'s order.
- Presentation never writes the sim: the camera, looks, particles, sound and the HUD change nothing a hash sees.
- Units: metres, seconds, radians; +Y up, x east, z south; characters face +Z.

## Look inside a running game

The browser console has `__engine`: `__engine.help()` lists it all; `step(n)`, `hash()`, `state('round')`,
`set('game.gems', 20)`, `seed(7)`, `camera.set('cam=iso')`. The URL takes the same: `?seed=7&game.gems=20&cam=iso`.
Errors name their fix, and docs/ERRORS.md in the engine's repository lists every code.

## Versions

The head's URLs pin three.js and Rapier, and take the engine at `@main`, its latest (jsDelivr refreshes it within 12
hours). To freeze a game on today's engine, replace `main` with a commit of
https://github.com/michaelcrosato/my-3dge in its two engine URLs (`my3dge.js`, `my3dge.css`).

More: the engine's repository has the full guide (docs/GAME-GUIDE.md), every export (docs/API.md) and the source. An
agent that can run commands and wants the engine's checks too can start from the repository's README instead.
License: MIT; `my3dge.js` carries @stdlib functions (Apache-2.0): see LICENSE beside this file.

## game.html

<!-- lean:game:start -->
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Gem run: a my-3dge game</title>
    <!--
      A whole game in one page: run round an arena collecting the gems before the clock runs out. Make your game by
      changing this file (lean/README.md says how). Open it in a browser with WebGPU: double-click it, or serve its
      folder. The block below loads the engine, three.js and Rapier from jsDelivr; keep it as it is.
    -->
    <!-- lean:head:start -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/michaelcrosato/my-3dge@main/lean/my3dge.css" />
    <script type="importmap">
      {
        "imports": {
          "my3dge": "https://cdn.jsdelivr.net/gh/michaelcrosato/my-3dge@main/lean/my3dge.js",
          "three": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.webgpu.js",
          "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.webgpu.js",
          "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.tsl.js",
          "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.182.0/examples/jsm/",
          "@dimforge/rapier3d-simd-compat": "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-simd-compat@0.21.0/dist/rapier.mjs"
        }
      }
    </script>
    <!-- lean:head:end -->
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: #15171c;
      }
      canvas {
        display: block;
        width: 100vw;
        height: 100dvh;
        outline: none;
        touch-action: none;
      }
      #msg {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font:
          18px system-ui,
          sans-serif;
        color: #c9ccd4;
        text-align: center;
        white-space: pre-line;
        pointer-events: none;
      }
    </style>
    <script>
      // Until the engine starts, a script that fails shows here in one line, never as a blank page.
      window.__engine = { ready: false, errors: [] };
      function failed(message) {
        if (typeof window.__engine.help === 'function') return; // the engine shows its own errors
        window.__engine.errors.push({
          code: 'APP_START',
          message: message,
          fix: 'the browser console names the cause',
        });
        document.getElementById('msg').textContent = 'The game failed to start: ' + message;
      }
      addEventListener('error', (event) => failed(event.message || 'a script failed to load'));
      addEventListener('unhandledrejection', (event) => failed(String(event.reason?.message ?? event.reason)));
    </script>
  </head>
  <body>
    <canvas id="view"></canvas>
    <div id="msg" role="status">Loading…</div>
    <script type="module">
      import {
        addLevelBodies,
        compileLevel,
        createCharacter,
        createEngine,
        defineComponent,
        defineScene,
        defineSettings,
        physicsOf,
        spawnActor,
      } from 'my3dge';

      // ---- The sim: everything that decides play. It runs 60 steps a second, the same on every machine. ----

      // The arena as text: # wall, . floor, P pillar, w low wall (jump it), @ the player's spawn. 1 m a character.
      const ARENA_TEXT = `---
description: The arena. 18 × 14 m inside walls, two pillars, two low walls to jump, the player's spawn.
---
##################
#................#
#..@.............#
#.......PP.......#
#.......PP.......#
#................#
#....w......w....#
#....w......w....#
#................#
#.......PP.......#
#.......PP.......#
#................#
#................#
##################
`;
      const ARENA = compileLevel(ARENA_TEXT, { file: 'game.html', name: 'arena' });

      // Settings: change them from the URL (?game.gems=20) or the console (__engine.set('game.gems', 20)).
      defineSettings({
        'game.gems': {
          type: 'integer', default: 10, minimum: 1, maximum: 40, when: 'scene', description: 'How many gems.',
        },
        'game.seconds': {
          type: 'number', default: 30, minimum: 5, maximum: 600, unit: 's', when: 'scene', description: 'The clock.',
        },
        'game.speed': {
          type: 'number', default: 6, minimum: 1, maximum: 20, unit: 'm/s', when: 'scene', description: 'Run speed.',
        },
      });

      // Components: data on entities. A component with x and z in metres and a material is drawn by the page.
      defineComponent('gem', {
        description: 'A gem to collect.',
        fields: {
          x: { type: 'number', default: 0, unit: 'm', description: 'East.' },
          y: { type: 'number', default: 0.5, unit: 'm', description: 'Up.' },
          z: { type: 'number', default: 0, unit: 'm', description: 'South.' },
          yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its spin.' },
          size: { type: 'number', default: 0.4, unit: 'm', description: 'Its size.' },
          material: { type: 'string', default: 'material:glow', description: 'How it is drawn.' },
        },
      });
      defineComponent('round', {
        description: 'The round: gems collected, steps left on the clock, and whether it is playing, won or lost.',
        fields: {
          gems: { type: 'integer', default: 0, description: 'How many gems.' },
          collected: { type: 'integer', default: 0, description: 'How many are collected.' },
          left: { type: 'integer', default: 0, description: 'Steps left on the clock (60 a second).' },
          state: { type: 'string', default: 'playing', description: "'playing', 'won' or 'lost'." },
        },
      });

      const REACH = 0.8; // how close the player's feet come to a gem to collect it, m
      const START = ARENA.spawns.find((spawn) => spawn.name === 'hero').position;

      // Scatters the gems over floor tiles at least 3 m from the spawn, drawn from the named random stream 'gems'.
      function scatterGems(w, count) {
        const tiles = [];
        ARENA.tiles.forEach((char, i) => {
          const [x, z] = [((i % ARENA.cols) + 0.5) * ARENA.tile, (Math.floor(i / ARENA.cols) + 0.5) * ARENA.tile];
          if (char === '.' && Math.hypot(x - START[0], z - START[2]) >= 3) tiles.push([x, z]);
        });
        const rng = w.rng('gems');
        for (let k = 0; k < count && tiles.length > 0; k++) {
          const [[x, z]] = tiles.splice(rng.int(0, tiles.length - 1), 1);
          w.spawn({ gem: { x, z, yaw: rng.range(0, Math.PI) } });
        }
      }

      // Ends the round: the player stops, and the event says how it ended.
      function endRound(w, round, state) {
        round.state = state;
        for (const e of w.query('actor')) {
          e.actor.player = false;
          e.actor.intents = {};
        }
        w.emit(state, { collected: round.collected, gems: round.gems });
      }

      // A system: spins the gems and collects those an actor reaches (a despawn waits for the step's end).
      function collect(w) {
        const [{ round }] = w.query('round');
        for (const gem of w.query('gem')) gem.gem.yaw += 2 * w.dt;
        if (round.state !== 'playing') return;
        const taken = new Set();
        for (const { actor } of w.query('actor')) {
          for (const gem of w.query('gem')) {
            if (taken.has(gem.id) || Math.hypot(gem.gem.x - actor.x, gem.gem.z - actor.z) > REACH) continue;
            taken.add(gem.id);
            w.despawn(gem.id);
            round.collected += 1;
            w.emit('gem', { id: gem.id, collected: round.collected });
          }
        }
        if (round.collected >= round.gems) endRound(w, round, 'won');
      }

      // A system: the clock counts whole steps, never summed seconds; at 0 the round is lost.
      function clock(w) {
        const [{ round }] = w.query('round');
        if (round.state !== 'playing') return;
        round.left = Math.max(0, round.left - 1);
        if (round.left === 0) endRound(w, round, 'lost');
      }

      // The scene: the level, its physics, and what happens when it starts.
      const play = defineScene('game:play', {
        description: 'Run round the arena collecting the gems before the clock runs out.',
        level: 'level:arena',
        physics: true,
        setup(w) {
          addLevelBodies(physicsOf(w), ARENA);
          const gems = w.settings.get('game.gems');
          w.spawn({ round: { gems, left: Math.round(w.settings.get('game.seconds') * w.hz) } });
          scatterGems(w, gems);
          const character = createCharacter({ speed: w.settings.get('game.speed'), jumpSpeed: 9 });
          const anim = { build: 'build:chibi', weapon: 'none' }; // a humanoid that animates itself
          spawnActor(w, { at: [START[0], START[1], START[2]], character, player: true, anim });
          w.systems.add('game.collect', collect, { phase: 'rules' });
          w.systems.add('game.clock', clock, { phase: 'rules' });
        },
      });

      // ---- The page: draws the run and shows the HUD. It only reads the sim, never changes it. ----

      const search = new URLSearchParams(location.search);
      if (!search.has('cam') && !search.has('cam3')) search.set('cam3', 'chase'); // the camera follows the player
      let engine = null;
      let ended = false;

      // Each drawn frame: the gems, the clock, the keys, and how the round ended.
      function showRound({ world }) {
        const entity = world.query('round')[0];
        if (!engine || !entity) return;
        const { gems, collected, left, state } = entity.round;
        engine.ui.hud('gems', `Gems ${collected} / ${gems}`, { at: 'top-left' });
        const color = left < 10 * world.hz ? '#ff8f6b' : '';
        engine.ui.hud('clock', `${Math.ceil(left / world.hz)} s`, { at: 'top-right', color });
        engine.ui.hud('keys', 'WASD: run · Space: jump · Shift: dash', { at: 'bottom', keys: true });
        ended = state !== 'playing';
        engine.ui.hud('end', ended ? `${state === 'won' ? 'Every gem!' : 'Time!'} Enter: play again` : null, {
          at: 'top',
        });
      }

      engine = await createEngine({
        canvas: document.querySelector('#view'),
        scenes: [play.id],
        levels: { 'level:arena': { text: ARENA_TEXT, file: 'game.html' } },
        search: `?${search}`,
        onFrame: showRound,
      });
      document.getElementById('msg').hidden = true;

      // Enter after a round: the next round, on the next seed.
      addEventListener('keydown', (event) => {
        if (event.code === 'Enter' && ended) engine.inspector.seed(engine.inspector.seed() + 1);
      });
    </script>
  </body>
</html>
```
<!-- lean:game:end -->

## The API by area

<!-- lean:api:start -->
Every name below is an export of `my3dge` (`import { createEngine, defineScene } from 'my3dge'`). Each has the
first sentence of its doc comment in docs/API.md, and its whole manual where engine/ declares it.

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

**Props as data (WP 4.5)**: the registry kind `prop` (meshes by geometry and material id, a body, a light spot, where a level places it, the hit and use hooks), the engine's crate, barrel, brazier fire and pillar, and their placement.
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

For the page (the browser side), not for code that runs in the sim:

**Headless**: the engine without a page, and its inspector (window.__engine in a page).
`createHeadless`; types `Headless`, `HeadlessOptions`, `Inspector`, `EngineInfo`, `EntitySummary`.

**Materials and procedural textures (WP 2.3)**: materials as data with three.js's classic parameters, seeded tiling texture generators and their helpers, the CPU bake, and the page's material library.
`defineMaterial`, `getMaterial`, `createMaterialLibrary`, `defineTexture`, `bakeTexture`, `cellHash`, `wrapIndex`, `palette`, `pickTone`, `runningBond`, `tileNoise`; types `MaterialEntry`, `MaterialSpec`, `MaterialLibrary`, `TextureEntry`, `Texel`, `TextureContext`, `TextureSpec`, `TextureLook`, `TextureBake`, `TextureRef`.

**Input (WP 3.3)**: the devices of a page sampled into intents (keys by physical code, mouse with pointer lock and the wheel, gamepads in any slot), action maps and their presets, bindings players change and keep, prompts per device, the virtual device that __engine.input drives, and the scripted gamepad for tests.
`createInput`, `defineActionMap`, `getActionMap`, `listActionMaps`, `SYSTEM_ACTIONS`, `RESERVED_CODES`, `createBindings`, `codeLabel`, `readKeyboardLayout`, `isCode`, `createVirtualDevice`, `connectVirtualDevice`, `createScriptedGamepad`; types `Input`, `InputOptions`, `CameraLike`, `CameraInputSample`, `ActionMap`, `ActionMapSpec`, `Bindings`, `BindingsOptions`, `BindingsStorage`, `BindingsFile`, `RebindResult`, `DeviceKind`, `VirtualDevice`, `ScriptedGamepad`, `GamepadLike`.

**Aiming and look (WP 13.9)**: the point the intents' aim carries by a map's rule, and the look settings input.*.
`aimPoint`, `screenRay`, `onFloor`, `AIM_RULES`, `AIM_RANGE`, `STICK_REACH`, `lookOptions`, `scaleLook`, `LOOK_SETTING_FIELDS`, `LOOK_SETTINGS`, `DEGREES_PER_COUNT`; types `AimRule`, `AimPose`, `AimView`, `AimDevices`, `AimRay`, `LookOptions`, `RawLook`, `ScaledLook`.

**Geometry kit and level meshes (WP 2.4)**: shapes standing on the ground with UVs in metres, the geometry registry (props and levels name geometry by id), their QA measures, and a compiled level drawn as meshes.
`boxGeometry`, `roundedBoxGeometry`, `limbGeometry`, `rampGeometry`, `frustumGeometry`, `pillarGeometry`, `pillarParts`, `ringGeometry`, `sidesThenTops`, `mergeGeometries`, `defineGeometry`, `getGeometry`, `buildGeometry`, `inspectGeometry`, `createLevelMeshes`, `LEVEL_RECIPES`; types `BoxOptions`, `RoundedBoxOptions`, `LimbOptions`, `RampOptions`, `FrustumOptions`, `PillarOptions`, `PillarPart`, `RingOptions`, `GeometryEntry`, `GeometrySpec`, `GeometryRef`, `GeometryReport`, `LevelMeshes`, `LevelMeshesOptions`, `LevelMeshPart`, `LevelCell`, `LevelRecipe`, `LevelShape`.

**Sound data (WP 9.2)**: effects and songs as registry entries (voices, layers, variants; tracker-notation tracks), rendered offline by the DSP core into reproducible samples.
`defineSfx`, `getSfx`, `renderSfx`, `sfxVoices`, `defineSong`, `getSong`, `renderSong`, `songVoices`, `songTiming`; types `Sfx`, `SfxSpec`, `SfxLayer`, `SfxBus`, `SfxRenderOptions`, `Song`, `SongSpec`, `SongTrack`, `SongTiming`, `SongRenderOptions`, `Voice`, `SoundDef`.

**The audio runtime (WP 9.3)**: a page's sound through Web Audio, started by the first gesture: buses with ducking and voice limits, sounds placed in 3D and occluded through the QueryView, room reverb, and music in intensity layers that change on the beat and the bar line.
`createAudio`, `BUS_VOLUMES`, `ROOMS`, `VOICE_LIMITS`; types `Audio`, `AudioOptions`, `AudioState`, `AudioInfo`, `PlayOptions`, `Sound`, `ListenerPose`, `GestureTarget`, `AudioBus`, `MixerInfo`, `MusicChange`, `MusicPosition`, `Quantize`, `RoomName`, `RoomSpec`, `VoiceLimits`.

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
<!-- lean:api:end -->
