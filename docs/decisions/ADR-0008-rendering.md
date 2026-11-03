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

## Amendment 10 (2026-10-11, WP-7.8): the look's sky, the page's styles, level material swaps

- **The look kind gains `sky`** (`''` keeps the scene's own lights).
- **Core change, gfx:** `engine/gfx/stageSky.ts` (`stage.sky`): the stage keeps its own lights until a look names a
  sky. The sky is then made once (`createSky` from the level's light spots, phases from `fxRng`) and the stage's
  lights are hidden. `''` hides the sky, removes the fog and restores the background. Hidden lights stay out of the
  shader key, so a page with no sky keeps its pipelines, and switching warms up first.
- **Core change, app:** `engine/app/look.ts` plus `createEngine`: one style set for the chain. Before each warm-up,
  frame and shot the page applies the look's sky and the tier's shadow budget; at the first look in another style,
  the style set joins the warm-up, and later re-points newly shown meshes.
- **Level entry `materials`** (id → id, presentation only; the view passes them to the level meshes).
- **`engine/gfx/post/chain.ts`:** the warm frame's straight pass draws in the set's own style. Without this fix, a
  page opened in a styled look built 7 to 23 cold pipelines when it went plain.
- `tests/baselines/thumbs/box-hall-iso.json` re-recorded (the hall's floor is its rune bake).
- Plan edit: WP-7.8's Owns adds `engine/gfx/stageSky{,.test}.ts` and `engine/app/look{,.test}.ts`, and extends
  `engine/gfx/{stage,post/looks,post/looks.test,post/chain}.ts`, `engine/app/{engine,view,view.test}.ts`,
  `engine/world/level/level{,.test}.ts` and `tests/baselines/thumbs/{box-hall-iso.json,README.md}`.
  The planned `box.json` perf budget becomes `tests/baselines/perf/box-fight-1000.json` and `box-crowd-5000.json`
  (`x perf` names budget files per scene) (accepted).

## Amendment 11 (2026-11-02, the owner's "why does it take so long to load, change maps, change filters?"): a page warms up only what it draws

- **Measured** (SwiftShader, this container): the playground's gym from `playground.html` was ready in 64.7 s with
  102 pipelines; its CPU profile put 58 of 77 s in three.js's node builder (TSL to WGSL, `NodeBuilder.build` under
  `compileAsync`) and under 1 s in the engine's own code. r182 builds a shader for each render object whose cache key
  differs (`RenderObject.getCacheKey`), and the key holds the camera's id, the render context and an instanced mesh's
  uuid: the gym's warm-up made 3,310 builds for its 102 pipelines. Of them the plain frame's pass took 930, the style
  set's own style 476 (the playground's looks are both toon) and the orthographic camera's whole warm-up 1,408 (36 s).
  Changing maps reloads the page, so it costs a start; a look switch builds nothing and never froze (gym and site).
- **Measured, the site:** ready in 242 s, then two more whole warm-ups (338 s) after the first frame: the performance
  governor demoted `auto` twice (high to medium to low), and each demotion changes the shadow casters, so the shader
  key. With `quality=high` held, one warm-up and none after.
- **`gfx.warmUp`** (engine/gfx/warmup.ts): `all`, the default, compiles what amendments 9 and 10 compile; `asked`
  only the cameras the page has drawn (engine/app/drawing.ts: a camera's first frame or shot waits for its own
  warm-up), the plain frame's pass and straight draw once a plain frame is asked for (engine/gfx/post/chain.ts: until
  then the warm frame draws the scene through the chain, which builds its shadow passes), and the style set's own
  style once a look in it is asked for, or the page drew in it first (engine/app/look.ts); the chain puts a look's
  style on the meshes before the warm-up compiles them. Each first use changes nothing in a frame: it warms up before
  the frame that needs it, so `pipelinesAfterWarmUp` stays 0. The playground asks for it (labs/playground/main.ts).
- **The governor remembers** (engine/dev/governor.ts, `governorMemory`): the tier `auto` settled at, per scene, in the
  page's store (`gfx.governor`), where `auto` starts next time (never above its own tier); a demotion on the first
  visit still costs its warm-up.
- **Fixed on the way:** `warmBoth` asked for the perspective camera while the renderer's own warm-up for the
  orthographic one ran, got that one's promise back, and left the perspective camera cold under the new key; the
  report now names its camera (`WarmupReport.camera`) and `warmCameras` warms each camera not warm under the key now.
- **Result** (the same probes, same container): the gym ready in 23.7 s (was 64.7) with 50 pipelines (102) and 84
  shader modules (165), 0 after the warm-up, look switches as before. The site from `playground.html`: its first
  visit ready in 62.4 s (was 242), its governor's two demotions then cost two warm-ups, the longest 38 s (were 338 s
  together); a second visit in the same browser started at `low`, was ready in 32.9 s, and drew 972 frames in the
  next 240 s with no warm-up and no pipeline built (its longest gap between frames 553 ms).
- Stats: `__engine.stats().warmUps` (the warm-ups run). Owner check `load-times` (labs/playground/ui/checkList.ts).
- Tests: `tests/e2e/warm-up.spec.ts` (asked starts on fewer pipelines than all; a new camera and a first plain frame
  warm up before they draw, nothing built in a frame), `engine/app/look.test.ts`, `engine/app/drawing.test.ts`,
  `engine/dev/governor.test.ts`, `engine/dev/stats.test.ts`, `engine/gfx/warmup.test.ts`.
- Plan edit: none: the gate's 0-pipelines rule holds; `all` stays the default for every other page.

## Amendment 12 (2026-11-03, main red on b9d8690): a warm-up's frame draws the camera it warms

- **Found:** main's full run on b9d8690 failed one test, tests/e2e/gallery.spec.ts's looks: `GFX_COLD_PIPELINE`, a
  pipeline built in its 78th frame, `look:screen/flat-screen` drawn plain in the gallery's isometric camera; here the
  same frame. Amendment 11's fix was half of it. While the renderer's own warm-up for the orthographic camera awaited
  its compiles, `warmCameras` made the perspective camera's view through the chain (`post.view`) before asking, and
  the chain's scene pass, which a warm-up's frame draws through, pointed at the perspective camera from then on. The
  warm-up's report still named the orthographic camera, so it counted as warm, though its plain frame's straight draw
  was never built. `warmBoth` had warmed the orthographic camera again whatever the report said, which hid it.
- **Fixed:** the view `post.view(frame)` gives aims the scene pass and the particles at its frame again as it draws
  (engine/gfx/post/chain.ts), so a warm-up's frame draws the camera it warms whatever views were made while it
  awaited; a shot made while a warm-up runs (engine/gfx/shot.ts waits for it) no longer turns that warm-up's frame
  either.
- **Split on the way:** the chain's look resolution, whole, to engine/gfx/post/resolveLook.ts (chain.ts stood at its
  size cap, docs/PROGRESS.md's list), unit-tested there; the chain is 374 lines.
- **Evidence:** gallery.spec's look test failed here as on GitHub (frame 78) and passes with the fix.
- Plan edit: none.

## Amendment 13 (2026-11-03, WP-13.30): a look's resolution and textures

- **Found:** asked why the playground's clean look looked as blocky as the pixel look ("this is clean, with no
  filter? also cel and pixel kinda look the same?"), every page drew at `gfx.resolution: pixels`, its default since
  WP 2.1 (at most 330 lines, enlarged in whole screen pixels: my-3d2dge's stress world's `fit()`), and every
  procedural texture was magnified nearest at 16 texels a metre, so every look was drawn as chunky as the pixel one.
  The owner chose: "yes, full res for clean and cel, and smooth textures too".
- **Decided:**
  - `gfx.resolution` takes `auto`, its new default: the mode the page's look asks for, `pixels` while it names none;
    `pixels`, `balanced` and `full` hold whatever the look asks (a page or a test pins one). Every engine look names
    none, so every page but the playground draws as before. `RESOLUTION_MODES` stays the three modes, and `Fit.mode`
    and `stats().mode` the one drawn.
  - Two look fields (engine/gfx/post/looks.ts): `resolution` (`''`, `pixels`, `balanced` or `full`) and `textures`
    (`''`, `pixel` or `smooth`: every material's maps filtered crisp or blended, `''` each map's own). The page's look
    applies both before each frame, warm-up and shot (engine/app/look.ts): `resolution.prefer(mode)`
    (engine/gfx/resolution.ts), applied at once so a shot after a switch is drawn at the look's size, and
    `library.filter(look)` (engine/gfx/materials/library.ts), which re-filters every map made and filters every one
    made later, null putting back each map's own look; neither does anything while the look's value is the last one's.
  - A perspective variant is drawn at its base look's resolution and textures, as with its style and sky.
- **Why neither builds a pipeline:** changing the drawing buffer's size never did (WP 2.1, measured). A texture's
  filters reach r182's shader only through `isUnfilterable` (nearest magnification and `NearestFilter`
  minification together read it with `textureLoad`, WGSLNodeBuilder.js); a `pixel` map minifies with
  `NearestMipmapLinearFilter`, so both looks read it with `textureSample` through the same shader. A changed filter
  bumps the texture's version (`filterTexture`, engine/gfx/textures/dataTexture.ts): r182 uploads its levels again
  and swaps its sampler by the sampler key (Bindings.js, WebGPUTextureUtils.js `updateSampler`), rebinding its bind
  group. The toon ramp (nearest both ways, engine/gfx/materials/toon.ts) is never touched.
- **Corrected on the way:** dataTexture.ts said a `pixel` map minified with "nearest texels blended between levels";
  r182's WebGPU backend takes the mipmap filter from the minification filter (`_convertFilterMode`), so
  `NearestMipmapLinearFilter` reads the nearest level. Its comment says so now; nothing drawn changed.
- **Evidence:** unit tests (engine/gfx/resolution.test.ts, materials/library.test.ts, textures/dataTexture.test.ts,
  engine/app/look.test.ts); the playground's specs (ADR-0025 amendment 47).
- Plan edit: WP 13.30.

## Amendment 14 (2026-11-03, WP-13.31, WP-13.32): Style Lab's filters, every filter's amount, combining looks

- **Found:** the owner asked whether this engine could adopt the filters of Style Lab
  (michaelcrosato/my-ai-3d-demo@34c6fa1), and the ability to tune and combine them, then directed: "make this your
  own, inspect each filter, decide which ones to bring over … we just want the filters, tuning, and ability to
  combine filters and where the filters are applied (objects, environment, characters, etc)", "I am not asking you
  to adjust your rendering pipeline". Style Lab has 85 effects in twelve families (its `src/runtime/registry/`); it
  compiles only the effects a look turns on and rebuilds its graph when one is switched on, the pause this engine's
  single composite (WP 7.4) and warm-up (amendment 11) were made to avoid.
- **Decided, effect by effect** (Style Lab's ids by family; the composite's stages are engine/gfx/post/filters.ts's):
  - *Ported, as filters of the one composite, each switched by uniforms:* lens `distortion` (`lens`), `dof`,
    `tiltShift` (`tiltshift`), `flare`, `anamorphic` (`streaks`), `letterbox`, `vignette` with its softness, roundness
    and colour (`vignette`; `screen`'s plain one stays); grade `split`, `selective`, `gradientMap` (`duotone`, three
    stops), `lift`, `gamma`, `vibrance`, `hue`, `sepia`, `bleach` (`grade`'s new numbers); media `watercolor`,
    `misregistration` (`misregister`), `paper` (four kinds, procedural), `sharpen`; retro `crt`'s mask, glow and
    flicker (`crt`; its scanlines and curvature were `scanlines` and `screen`), `vhs`; motion `speedLines`
    (`speedlines`) and `boil` (`outline.boil`); lines `wobble`, `fade`, `fadeStart`, `fadeEnd` (`outline`'s).
  - *Already here, kept as they are:* bloom, colour fringes (`chroma`), edge smoothing (`aa`), the resolution and
    texture filtering (amendment 13), tone mapping and exposure (the renderer's), temperature, tint, contrast,
    saturation and gain (`grade`), film grain, Kuwahara (`stylize`'s `paint`, a generalized Kuwahara), halftone and
    hatching (`stylize`), pixelation, quantizing, dithering and palettes (`pixel`, `palette`), the inverted-hull and
    screen lines (shells, `outline` with its creases), Sobel edges (`outline`'s depth and normal edges), ambient
    occlusion, bounce light, reflections, god rays and fog (`ao`, `gi`, `ssr`, `air`), the sky (engine/gfx/sky.ts) and
    the toon, flat and lit surfaces (the material styles, WP 7.2).
  - *Left out, not filters:* the lighting family (key, ambient, shadows, time of day, practicals, blob and contact
    shadows, vertex AO: the stage's and the sky's), the atmosphere's clouds and particles (scene content), the
    surface family's material effects (object-space halftone, hatching and dither, colour variation, gradients, toon
    water, wind, Gooch, matcaps, toon specular: each a shader variant, so switching one would build pipelines), the
    retro vertex snap and affine textures (vertex shaders), `lens.fovScale` (the camera's), `lines.highlight` (a
    gameplay selection, not a look) and the frame-rate effects `stepped` and `lowFps` (presentation timing).
  - *Left out, needing more than the composite:* motion blur and afterimage (a history target, a new pass), the
    anisotropic Kuwahara (a structure-tensor pass), LUTs (`.cube` files, data the owner would supply; `grade`, `split`,
    `selective` and `duotone` cover the grades they are used for), and a line's texture and light weighting.
- **Every filter's `amount`** (0 to 1, engine/gfx/post/filterSchema.ts): the composite mixes each filter's result with
  its input by it (`am0`–`am6`, engine/gfx/post/filterUniforms.ts); the filters that move where a pixel looks scale
  their size by it, the blocks are off below half, and the passes before the composite take it in their strengths
  (`foldAmounts`). At 1 nothing changes, so every look drew as before; `grain` and `chroma` had an `amount` of their
  own, their strength, which serves.
- **Sizes in pixels at 1080 lines:** the new filters' blurs, offsets and lengths scale with the drawing buffer's
  height (`unit`, engine/gfx/post/composite.ts), so a look reads the same at the engine's pixels and at full
  resolution (amendment 13).
- **Combining** (engine/gfx/post/combine.ts): Style Lab's recipes (a source look per family, blends, a strength,
  overrides) become a look's `combine` (layers, each a look, an `amount`, `only` some of its filters, and `filters`
  changing them first) and `strength`, and the view settings `post.combine` and `post.strength` over the page's look,
  with `post.filters` between them. A layer fades a filter in where the chain has it off; where both have it on, its
  numbers lerp (whole numbers round), its colours mix in linear light and its choices switch at half: Style Lab's
  blend rules. A cycle is skipped with advice `GFX_LOOK_COMBINE_LOOP`. Its graph rebuilds were not adopted: every
  blend resolves to one chain, written as uniforms, so tuning and combining build nothing.
- **Where filters apply:** Style Lab's sixteen part kinds map onto this engine's three (characters, objects, the
  environment) and their pairs, the scope every filter already had; a filter keeps one set of numbers for all the
  parts it covers. Different numbers per part (an outline thinner on the scenery than on the characters) would need a
  filter's uniforms per part: left until a game asks for it.
- **Not verified here:** how the new filters read to the owner (the playground's Tune panel and its try check,
  ADR-0025 amendment 50), and their cost on a real GPU; on SwiftShader each adds its taps only while it is on.
- **Corrected after the merge (#48), from a visual review of the combined looks on the playground's street:**
  `look:red-coat` kept no red. The selective colour filter measured the kept hue as OKLCH's angle (Style Lab's: red
  about 29°) while its field and presets give the colour wheel's (0 red, 120 green), and it also greyed what OKLab
  finds dull (chroma under 0.06), taking half the colour of dark reds and browns of the kept hue. It now measures the
  wheel's hue (`post_hue`, engine/gfx/post/shaders/tone.ts) and counts a pixel as coloured by its saturation (HSV's,
  0.08 to 0.2), so a warm grey pavement stays grey and a dark red keeps its colour; the field's default is red, 0.
  Measured on the street from isometric: all 7,225 red pixels of the clean frame keep their colour (755 did), all
  187,442 coloured pixels of other hues turn grey, and 269 of the 512,957 others keep a trace of tint (saturation
  over 0.06). `look:storybook` lays its wash wetter and its paper stronger (its change from the clean frame 14.9
  levels a channel, now 25.5), the review's pick of three. A test holds the hue: tests/e2e/filters.spec.ts keeps the room's commonest hue as its
  field names it and greys it when named the opposite.
- **Evidence:** engine/gfx/post/filters.test.ts, combine.test.ts, resolveLook.test.ts, looks.test.ts and
  chain.test.ts; tests/e2e/filters.spec.ts (each new filter in each scope, amounts, combining live, 0 pipelines);
  tests/e2e/post.spec.ts (every look, the new ones among them, switched with 0 pipelines).
- Plan edits: WP 13.31, WP 13.32.
