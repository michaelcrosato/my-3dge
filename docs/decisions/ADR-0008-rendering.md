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
