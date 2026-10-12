# ADR-0008: Rendering: WebGPU only

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.7, §3

## Decision
- WebGPU is the only renderer. It is required at startup (`GFX_NO_WEBGPU` without it); three.js's WebGL 2 fallback
  is switched off.
- Everything WebGPU offers, compute included, serves looks and speed, never play.
- Materials are data with familiar parameters, drawn inside the renderer by whatever looks best (TSL, compute, the
  addons).
- Game UI is HTML/CSS over the canvas.
- Gameplay runs only on the CPU: sim-side code never imports the renderer, `gfx/`, the DOM or Web Audio, and nothing
  is read back from the GPU into the sim (§6.7).
- Optional GPU features arrive on demand. One fixed MRT set is created at startup, with every filter gated by a
  uniform (§6.7).

## Why
Doctrine WebGPU only. Keeping play on the CPU keeps it reproducible and headless (doctrines: Reproducible,
Verifiable).

## Enforced by
ESLint's layer rules; `tests/e2e/parity.spec.ts` (rendering never changes the hash); the startup test without WebGPU.

## Amendment 1 (2026-10-10, WP-2.1)
- **Errors.** r182's renderer has no `renderer.onError`. WebGPU's errors reach the log by its two routes: the device's
  `uncapturederror` event (`GFX_GPU_ERROR`, handled with `preventDefault()` so the browser does not print it again
  without a code) and `renderer.onDeviceLost` (`GFX_DEVICE_LOST`; three.js's own handler still runs). The WP-2.1
  entry in PLAN.md says so.
- **Pipelines are counted at the device.** `engine/gfx/pipelines.ts` wraps the device's pipeline and shader-module
  methods before three.js gets the device. Measured on r182: `renderer._pipelines.caches` shrinks when pipelines are
  released (12 built, 9 cached after a post pass), so it is a live count and cannot count builds. The module stays the
  one reader of renderer internals: the cache size, and the node frame below.
- **The warm-up compiles for the frame's real target, then draws one warm frame.** Measured on r182: `render()` draws
  into an internal half-float target whenever it converts colours for the screen, and a plain `compileAsync(scene,
  camera)` built 4 pipelines `render()` never used and missed 4. Compiling with a 1 × 1 stand-in that has the internal
  target's attachments (or a post pass's own target) shares its render context; the warm frame, drawn through the
  frame's own `draw`, builds the shadow, post and output passes. Frames re-warm when the shader key changes and skip
  drawing meanwhile, so a toggle never builds a pipeline inside a drawn frame.
- **`frame()` starts r182's node frame itself.** r182 advances its node frame only in its own requestAnimationFrame
  loop, so a frame drawn off that loop (a warm frame, a test's frame) showed a post pass's previous picture.
- **The device asks for the adapter's limits** (`requiredLimits`), the "larger limits" of §6.7; when refused, the
  default limits with advice `GFX_DEFAULT_LIMITS`.
- **No `feature` scaffold template yet** (§8.13, §9.3 item 4). The three built-in features are one table in
  `engine/gfx/features.ts`, as the settings and the inspector members are, and game code never writes a feature. The
  first WP that adds features outside that table (WP 11.1, which completes the framework) adds the template.

## Amendment 2 (2026-10-10, WP-4.4): level meshes v2 and the cutaway

- **Core change.** WP 4.4 re-records `tests/baselines/thumbs/box-room-iso.json` (WP 2.7's file). The room's pillar now
  stands on a plinth under a capital, so 3 cells moved by up to 28/255.
- **Stairs.** Each ramp is one stepped solid with two steps per metre. Each tread sits on the hull's slope at its
  middle, so feet are never more than half a riser off. All flights of one descriptor share a mesh; the stage's runs
  give each flight its own.
- **Cutaway.** Walls are cut by their outward direction relative to the camera (cos > 0.3, none steeper than 85°).
  Pillars become stumps when a sight line to the hero's head, feet or the floor around him passes through them,
  measured in boosted picture heights. The rule applies to any camera.
- **Pages that switch between projections warm up through both cameras.**

## Amendment 3 (2026-10-11, WP-7.2): material styles, toon and outlines

- **Styles are view state.** Material styles (lambert, toon, flat, pbr) are view state held by a style set
  (`createStyleSet`). The material registry gets no style or bands fields. The toon look (bands, rim) is a set of
  shared uniforms, and WP 7.4's looks pick the style and the look. Lambert stays as a fourth style.
- **Each warm-up compiles every style.** Entries `~styles/<style>` point the drawn meshes at that style and `~styles~`
  restores them. Probes per material cannot stand in, because r182 compiles a shader per instanced mesh of 1,000 slots
  or fewer (the level's walls).
- **Toon is a TSL lighting model** (smoothed bands, gated rim), chosen over `MeshToonMaterial` with a gradient map:
  r182's ToonLightingModel uses `normalGeometry` against a view-space light. The comparison is in `toon.ts`'s file
  comment and asserted by tests/e2e/materials-v2.spec.ts. Toon and flat draw no normal map.
- **Outline push.** r182's InstanceNode transforms `positionNode`'s result afterwards, so the push returns
  `positionGeometry` plus the offset taken back through the instance's turn. It reads the instance matrix from the
  vertex-stage InstanceNode (advice `GFX_OUTLINE_UNPINNED` otherwise). Skinned meshes are refused
  (`GFX_OUTLINE_TARGET`); WP 7.4's edge filter covers them.

## Amendment 4 (2026-10-11, WP-3.10): actors on the stage, the view follows the player

- **Core change:** `engine/gfx/puppets/actors.ts` draws every actor with an animator as a `body:humanoid` puppet in
  its build. Each frame a view-side AnimatorPool poses it at the interpolated feet, and the stage skips its stand-in.
  `Puppet.hide(joints)` zeroes those joints' skin weights for first-person culling (an attribute upload, never a
  pipeline; hidden parts cast no shadow).
- `engine/app/view.ts` follows the first player actor, else the level's middle. In physics scenes chase gets the
  sim's QueryView; first person gets the player's eye, and `camera.get()` reports `culled`.
- `place.ts`: `readCameraCode` and `createCamera` read WP 3.9's chase, first and rail codes (`FOLLOW_CAMERAS`) without
  touching codes.ts. `createCamera` returns `AnyCamera`, and routes validate with `readCameraCode`.
- The level's cutaway is made when a player first stands on it and runs while the view follows him, so side and
  brawler views see the hero. A level with no player (Box 1) never has one.
- Plan edit: WP-3.10's Owns names the core proposal's files (accepted).

## Amendment 5 (2026-10-11, WP-4.6): props stand in a running scene and draw themselves

- **Core change:** `engine/sim/props.ts`: `spawnProp(w, placement)` adds the `propBody` and an entity with the engine
  component `sceneProp` (prop, body, x/y/z centre, q turn). The system `props.readback` (phase readback) copies each
  body's pose into that component. `hitProp` calls the prop's `hit` hook with `knock` wired to `bodies.ts` on its
  body, plus the caller's strength; `removeProp` removes both. The name is `sceneProp` because
  `fixtures/scenes/physics-props` declares `prop`.
- `engine/gfx/stageProps.ts`: the stage draws `sceneProp` entities through `createPropMeshes`, lerping position and
  slerping turn between steps. The meshes are made with the first prop, so stages without props keep their graph.
  They are registered with the warm-up, with the key part `stage:props`, and get no stand-in.
- Plan edit: WP-4.6's Owns adds the core proposal `engine/sim/props{,.test}.ts` and `engine/gfx/stageProps{,.test}.ts`,
  and extends `engine/gfx/stage.ts` and `engine/sim-api.ts` (accepted).

## Amendment 6 (2026-10-11, WP-5.7): crowd bodies draw themselves

- **Core change, sim:** `engine/sim/crowdBodies.ts` adds the engine component `crowdBody` (`CROWD_BODY_FIELDS`: rig
  humanoid|blob|floater, look as a build id or blob features, size, x/y/z, yaw, state) and
  `stepCrowdBody(w, id, body, input)`. This is the rig's sim step under ADR-0009 (an animator, blob or floater), pooled
  per world and loaded from and saved to state. It emits no footsteps.
- **Core change, gfx:** `engine/gfx/stageCrowd.ts` draws `crowdBody` entities through `createCrowd` (WP 5.4) with its
  LOD. A body never stepped is not drawn. Looks are prepared on arrival and warmed up under the key part `stage:crowd`.
  Crowd bodies get no stand-in.
- `engine/gfx/stage.ts` gains `crowd`. `engine/app/view.ts` draws it after placing the frame camera, and before a dump
  that follows steps with no frame. `engine/sim-api.ts` appends the exports.
- `tests/e2e/parity.spec.ts`: replays may run longer than 600 steps.
- Plan edit: WP-5.7's Owns adds `engine/sim/crowdBodies{,.test}.ts` and `engine/gfx/stageCrowd{,.test}.ts`, and
  extends `engine/gfx/stage.ts`, `engine/app/view.ts` and `engine/sim-api.ts` (accepted).

## Amendment 7 (2026-10-11, WP-7.4): every frame through the post chain; props and crowds tagged

- **Core change, app:** `engine/app/engine.ts`: `createEngine` declares the post settings (`definePostSettings`) before
  it reads the URL, makes one chain (`createPost`) after the renderer, attaches it to the warm-up before the first
  warm-up, and draws the warm-up, every frame and `drawing.shot` through `post.view`. On the default look
  (`look:clean`) a frame is plain and draws the scene straight. `tests/baselines/perf/box-room.json` records the
  chain's targets and warm-up pipelines as the new budgets (its reason says why).
- **Core change, tools:** `tools/cmd/set.ts` hands `pageUrl` the raw pair, so the page URL is no longer encoded twice.
- **Core change, gfx:** `engine/gfx/props.ts` tags the props' root as an object and `engine/gfx/puppets/crowd.ts`
  tags its puppet and rig batches as characters (`setPart`, engine/gfx/post/mrt.ts), one outline group per drawer
  (the root's id), not per batch page, so no ID outline falls between a body's own batches. Blob shadows stay
  environment.
- Plan edit: WP-7.4's Owns extends `engine/app/engine.ts`, `engine/gfx/props.ts`, `engine/gfx/puppets/crowd.ts` and
  `tools/cmd/set.ts`, and names the kind `look`'s template `tools/templates/look/` (accepted).

## Amendment 8 (2026-10-11, WP-6.7): the stage's effects and the page's damage numbers

- **Core change, gfx:** `engine/gfx/stageFx.ts` draws a running scene's effects from plain data (WP 6.4's effects):
  flying bolts (entities declaring the projectile's fields, drawn instead of a stand-in), telegraphs, every actor's
  trail as a ribbon, and bursts from the world's event trace, read without listening. `engine/gfx/stage.ts` makes one
  (`stage.fx`); `engine/gfx/puppets/actors.ts` gains `trails()`; `engine/gfx/fx/ribbons.ts` keeps a non-empty draw
  range while hidden, so the warm-up never draws an empty one. The view setting `gfx.effects` (true) turns them on and
  off; off, they draw nothing, draw no random number and claim no bolt, so bolts draw as their named stand-ins, and
  the hash is the same either way. When `gfx.effects` is switched between steps, the next frame re-reads the entities
  before drawing (`engine/app/view.ts`), so a flying bolt is drawn by the effects or as its named stand-in from that
  frame, and never by neither.
- **Core change, app:** `engine/app/damageNumbers.ts` shows each `damage` event that took hit points as a damage number
  on the HTML/CSS overlay (engine/ui/labels.ts), read from the trace once per frame. `engine/app/engine.ts` puts the
  overlay over the canvas, shakes the camera by the effects, draws, then shows the numbers and updates the overlay.
- Perf: the effects' pools add 7 geometries (the sprites' 5 pages, the decals' page, the ribbon mesh) and, through
  the post chain, 9 pipelines, all built at warm-up: `tests/baselines/perf/box-room.json` budgets geometries 17 and
  pipelines 75, with 0 after warm-up. `tests/e2e/box.spec.ts`: the room's ID pass counts the effects' 7 drawables.
- Plan edit: WP-6.7's Owns adds `engine/gfx/stageFx{,.test}.ts` and `engine/app/damageNumbers{,.test}.ts`, and extends
  `engine/gfx/stage{,.test}.ts`, `engine/gfx/puppets/actors.ts`, `engine/gfx/fx/ribbons.ts`,
  `engine/app/{engine,view,view.test}.ts`, `tests/e2e/box.spec.ts` and `tests/baselines/perf/box-room.json`
  (accepted).

## Amendment 9 (2026-10-11, gate G6's review): a page's warm-up compiles what its frames draw, and builds little

- **Measured:** T2 took 14 min 16 s at gate G6 against its 6 min (it fails at 9 min), 6 min 28 s at G5. A Stress Box
  page's warm-up was the cause: on SwiftShader the hall's built 566 pipelines and the page was ready in 15 to 19 s
  (205 and 8 to 9 s before WP 7.4, at the same load; WP 6.7's effects added 9). A pipeline the warm frame builds is
  built alone, about 45 ms each, while `compileAsync` builds its pipelines side by side, about 7 ms each.
- **The warm-up compiles for every pass** (`engine/gfx/warmup.ts`): a view gives its `passes`, each a target with
  `enter`/`leave`, compiled in order, the first step by step and the others once. The chain's (`Post.view`) are its
  scene pass with the MRT on, then the target `render()` draws plain frames into. Before, it compiled once, for the
  scene pass's target before its MRT entry (`!post-mrt`, now gone) turned the MRT on, a variant no frame draws, and
  left every plain-frame variant to the warm frame (155 of the hall's).
- **The scene pass has both attachments from the start** (`createScenePass` asks for `normal`): r182's `MRTNode`
  writes only the outputs its target has textures for, so the MRT variants compiled before the chain first drew were
  one-attachment ones, built again by the warm frame.
- **The warm frame draws the chain's passes over an empty scene**, so it builds only the chain's 11 full-screen
  passes: drawing the scene through the chain there too made each page about 1 s slower to start (a pipeline's first
  draw costs time again on SwiftShader), for a picture a clean look never draws. The first frame of another look pays
  that instead, once, building nothing.
- **Instanced level meshes share their shaders** (`instanceSlots`, `engine/gfx/level/shapes.ts`; the cutaway's twins
  too): r182 reads the matrices of an instanced mesh of 1,000 slots or fewer from a uniform buffer named after its
  node, a shader per mesh, so the hall's 37 instanced parts and 26 twins were a pipeline each per material, pass and
  camera. At 1,024 slots, as the instancing service's pages have (WP 3.8), they read an instanced attribute and share
  one; each costs 64 KiB of matrices.
- **Result** (load 4 to 7): the hall's page builds 35 pipelines and is ready in about 4 s, the room's 24 in 2 s, the
  fight's 45 in 4 s; 0 after the warm-up, as before. Measured one after another at load 13 to 19, from a cold page
  to the end of a drawn 600-step replay: the hall 26 s before WP 7.4, 38 s at gate G6, 23 s now; the room 9.6, 15.1
  and 10.8 s. A frame costs what it did before WP 7.4 (27 ms a step drawn in the hall, 13 to 17 in the room). T2
  stays over 6 minutes for its content: ADR-0014 amendment 14.
- Perf: `tests/baselines/perf/box-room.json` budgets pipelines 24 (75) and textures 32 (30: the warm-up's 1 × 1
  stand-in for the plain frame's compile), its reason says how they were measured.
- Tests: `engine/gfx/warmup.test.ts` (every pass compiled, entered and left, also on a failure),
  `engine/gfx/level/meshes.test.ts` and `engine/gfx/cutaway.test.ts` (every instanced part and twin on the attribute
  path); T2's own 0-pipelines checks hold.
- Plan edit: none: gate G6's review fixes, in files of WPs 2.1 (the warm-up), 4.4 (the level meshes, the cutaway)
  and 7.4 (the chain, the MRT).
