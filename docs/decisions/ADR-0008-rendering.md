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
