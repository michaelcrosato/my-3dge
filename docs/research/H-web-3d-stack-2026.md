# H: Web 3D stack, current state (as of 2026-10-09)

**Scope.** This covers three.js, Rapier, WebGPU availability, WebGPU-only enhancement tiers, headless testing, procedural audio, AI-native engine practice, and procedural skinning/animation, all as they stand for a WebGPU-first engine that must also run fully on WebGL 2.

**Method.** I used npm registry publish times and diffed the actual tarballs (`three@0.182.0` vs `three@0.186.1`; Rapier `0.19.3` vs `0.21.0`). I also read the upstream changelogs, the migration guide, issues and PRs, three.js's own CI scripts, browser-status pages and survey data. Most of the version and API facts in sections 1–2 come from reading package source, which carries more weight than blog coverage.

**Markers.** **[src]** means verified in the package source. **[doc]** means an upstream changelog or docs. **[2nd]** means secondary coverage (blogs or news). **[inf]** means my inference, which needs a test.

---

## 0. Decision summary

1. **three.js: move from r182 to an exact pin of `three@0.186.1`** (2026-09-24, npm `latest`).
   - Vendor the unminified ESM build plus the version-matched `llms-full.txt` and TSL Guide.
   - Add a lint deny-list of renamed or removed APIs.
   - Several r182 bugs land squarely on our WebGL 2 promise: InstancedMesh with 257–1000 instances fails to link on Apple WebGL 2 (#33009), BatchedMesh renders nothing on Firefox's WebGL 2 fallback (#31070), and BatchedMesh draws wrong offsets on WebGPU (#34211). Section 1.5 lists them.
   - Skip r187 (milestone due 2026-10-21) until it has a patch release, because it rewrites PMREM.
2. **Rapier: switch the flavor now and leave the version until later.** Use `@dimforge/rapier3d-deterministic-compat@0.19.3`. It has the same API and size as `simd-compat@0.19.3`, and it is the only flavor whose README promises cross-platform determinism.
   - Treat 0.21.x as a planned upgrade. Its defaults for sleep, CCD, velocity caps and contacts all change, which affects gameplay.
   - Its snapshot format changes, and its bundle is twice the size because of the new soft bodies.
3. **WebGPU reaches about 83% of real devices; WebGL 2 reaches about 98%.** WebGPU is weak on Linux (18%) and Firefox (60%).
   - Gate WebGPU tiers on all three of these: `renderer.backend.isWebGPUBackend`, `!renderer.backend.compatibilityMode`, and per-feature checks.
   - Prefer half-float render targets. `float32-filterable` is missing on about 46% of iOS and 29% of Android WebGPU devices.
4. **Testing: copy three.js's own CI recipe.** That is Chromium with Mesa lavapipe (Vulkan) and a fixed flag set. Run compute and unit tests headless; take screenshots headful under `xvfb-run`.
   - Prefer in-page render-target readback to page screenshots. Keep separate baselines per backend.
5. **Audio: synthesize in pure JS** into `Float32Array`s using a seeded RNG, and hash those buffers.
   - `OfflineAudioContext` output is not bit-identical across browsers or OSes; it is a known fingerprinting vector, and Safari and Brave add noise to it. Use it only for smoke tests.
   - jsfxr (Unlicense) and ZzFX/ZzFXM (MIT) are good reference designs.
6. **AI-native:** every major engine shipped MCP in 2025–26. The common pattern is an inspect / step / inject-input / capture / read-logs surface over the running game, deterministic replay with tick-level state assertions, and docs-in-repo with mechanical enforcement (section 7).
7. **Procedural characters:** build `Bone`/`Skeleton`/`SkinnedMesh` in code and drive them either directly or through code-built `QuaternionKeyframeTrack`s.
   - Use analytic two-bone IK, or `CCDIKSolver`, which is CPU-only and works with any renderer.
   - Skinning works on both backends through TSL `skinning()`.

---

## 1. three.js

### 1.1 Releases since r182 (npm publish times) [doc]

| Release | npm | Notes |
|---|---|---|
| r182 | 2025-12-10 | Our current pin |
| r183 / .1 / .2 | 2026-02-18 / 02-20 / 02-28 | |
| r184 | 2026-04-16 | |
| r185 / .1 | 2026-06-25 / 07-01 | .1 fixes an r185.0 InstancedMesh regression (#33889) |
| r186 / .1 | 2026-09-08 / 09-24 | **`latest` on 2026-10-09** |
| r187 | in `dev` | [Milestone](https://github.com/mrdoob/three.js/milestone/100) due 2026-10-21 |

Releases now come about every two months. Sources: `npm view three time`, the release pages ([r183](https://github.com/mrdoob/three.js/releases/tag/r183), [r184](https://github.com/mrdoob/three.js/releases/tag/r184), [r185](https://github.com/mrdoob/three.js/releases/tag/r185), [r186](https://github.com/mrdoob/three.js/releases/tag/r186)) and the [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide). The guide's header says deprecation warnings last 10 releases.

### 1.2 WebGPURenderer maturity, fallback and tooling

**Fallback**
- Unchanged. `new WebGPURenderer()` falls back to the WebGL 2 backend when no adapter is available, and `forceWebGL: true` still exists [src].

**WebGPU compatibility mode (r183)** [src]
- The backend now always calls `requestAdapter({ featureLevel: 'compatibility' })` and requests every feature the adapter offers. Requesting `core-features-and-limits` upgrades the device to core.
- A device without core features gets `backend.compatibilityMode = true` and MSAA is forced off (`renderer._samples = 0`).
- In r182, compat-only devices (for example Android on GLES 3.1 under Chrome 146+) fell back to WebGL 2. They now get a restricted WebGPU device instead.
- three.js adapts depth-texture sampling for compat mode. MRT per-attachment blending falls back to material blending, with a warning. It does **not** handle vertex-stage storage-buffer limits [src/inf]. Gate GPU-driven tiers on `!compatibilityMode`.

**Errors and lifecycle**
- r185 forwards uncaptured GPU errors and WGSL diagnostics to `renderer.onError` [src].
- Since r181, the `*Async` methods are deprecated: `await renderer.init()` once, then call the sync methods.
- `initRenderTarget()` and `hasCompatibility()` arrived in r183. r186 makes `renderer.dispose()` async (callers should `await` it) and adds `compileComputeAsync()` and `resetState()` [src].

**compileAsync**
- r183 fixed `targetScene`. r184 made it truly non-blocking (#32984). r185 fixed bugs. r186 added an `onProgress` callback and a crash fix.
- Still open: [#34681](https://github.com/mrdoob/three.js/issues/34681), where PassNode prepares a context it never renders, a regression since r183.

**Readback**
- `readRenderTargetPixelsAsync()` works on both backends.
- r184 added a reusable `ReadbackBuffer` for partial readback and fixed GC pressure in `getArrayBufferAsync` (#33281) [doc].

**Stats**
- r182's `renderer.info.memory` held only `geometries` and `textures`. r184 added byte counters: `texturesSize`, `attributesSize`, `programsSize`, `uniformBuffersSize`, `readbackBuffersSize` and `total`, plus per-type counts. r186 moved the tracking to a WeakMap [src]. These are useful as budgets an agent can check. `render.drawCalls`, `frameCalls` and `triangles` already existed in r182.

**GPU timing**
- Enable with `new WebGPURenderer({ trackTimestamp: true })`, then `await renderer.resolveTimestampsAsync('render' | 'compute')`, then read `info.render.timestamp`.
- Timing turns itself off if the adapter lacks `timestamp-query` [src].
- On the WebGL backend it needs `EXT_disjoint_timer_query_webgl2`. That extension reaches about 81% of Chrome and about 0% of Firefox and Safari ([web3dsurvey](https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2)).

**Inspector**
- The `three/addons/inspector/Inspector.js` overlay arrived in r181. r184 added Memory and Timeline tabs.
- The repo also ships a Chrome DevTools extension in [`devtools/`](https://github.com/mrdoob/three.js/tree/dev/devtools). It works off `window.__THREE_DEVTOOLS__` hooks that core already dispatches.

**Workers, OffscreenCanvas and Node**
- The renderer is typed to accept `OffscreenCanvas`. The only official worker example is WebGL (`webgl_worker_offscreencanvas`). WebGPURenderer-in-a-worker is unverified.
- In Node there is no DOM canvas. You can inject `WebGPURenderer({ device, context })` [src], but running three in Node on Dawn is unsupported. Use headless Chromium (section 5).

**Positioning and packaging**
- three.js's own [llms.txt](https://threejs.org/docs/llms.txt) still calls WebGLRenderer "default, mature" and recommends WebGPURenderer for TSL, compute and node materials. It also publishes a 363 KB [llms-full.txt](https://threejs.org/docs/llms-full.txt) pinned to 0.186.0.
- The TSL spec now lives in the repo as `tsl/content/Guide.md` (the "TSL Guide").
- r186 removed all `*.min.js` builds. `three.cjs` is now a stub that warns and re-exports the ESM build. `three.webgpu.js` is 2.28 MB unminified, 447 KB gzipped [src].

### 1.3 Breaking changes an agent will trip on (r182 → r186, plus r187 preview)

| Release | Change | Agent failure mode / fix |
|---|---|---|
| r183 | `PostProcessing` renamed to `RenderPipeline`; the old internal `RenderPipeline` became `RenderObjectPipeline` | r186 still exports `PostProcessing` as a `warnOnce` alias [src]. **Trap:** on r182, `THREE.RenderPipeline` is not exported, so mixed-version knowledge gives a TypeError. |
| r183 | `Clock` deprecated in favor of `Timer` (core `Timer` since r179) | Use `Timer`. |
| r183, r185, r186 | Deprecated TSL aliases removed in three waves (list below) | A named ES import of a removed export is a **link-time SyntaxError that stops the whole module graph**. |
| r183 | Shadows reworked (reduce bias); `RoomEnvironment` moved; `Sky` legacy gamma removed; `WebGLCubeRenderTarget` replaced by `CubeRenderTarget` under WebGPU | Visual baseline changes. This matters for procedural sky and environment lighting. |
| r184 | Env/background rotation aligned with objects; `FileLoader.load()` returns nothing | |
| r185 | Premultiplied-alpha handling changed | Use an opaque clear color or `scene.background`. |
| r185 | `positionLocal` in `positionNode` no longer reflects skinning or morphs | Use `positionGeometry`. |
| r185 | `updateWorldMatrix()` honors `matrixWorldNeedsUpdate` | Engines that set `matrixAutoUpdate = false` must set the flag. |
| r185 | `TiledLighting` removed, replaced by `ClusteredLighting`; `directionToColor` renamed `packNormalToRGB`; `colorToDirection` renamed `unpackRGBToNormal`; `directionToFaceDirection` renamed `negateOnBackSide`; GTAO is darker and wider; SSR and SSGI APIs tweaked; `AnamorphicNode` removed | |
| r186 | `Object3D.dispose()` added | Subclasses must call `super.dispose()`. |
| r186 | `PCFSoftShadowMap` removed from WebGPU | `PCFShadowMap` is now soft. |
| r186 | `Source` renamed `TextureSource`; `Sky` `up` uniform removed | |
| r186 | `InstanceNode`, `SkinningNode`, `MorphNode`, `BatchNode` classes no longer exported | They are TSL `Fn`s now. |
| r186 | Minified builds dropped | |
| r187 (dev) | PMREM built on cube render targets (`CubeUVReflectionMapping` removed, materials look slightly different); custom-light registration becomes `Light.registerNode()`; `pixelationPass(pixelSize)` takes a number only | |

**TSL names removed between r182 and r186, with replacements** [src]. I found the release of each removal by checking each version's `build/three.tsl.js`. The replacements are the strings from r182's own deprecation warnings.

| Removed | In | Use instead |
|---|---|---|
| `atan2` | r183 | `atan(y, x)` |
| `equals` | r183 | `equal` |
| `storageObject()` | r183 | `storage().setPBO(true)` |
| `burn` / `dodge` / `overlay` | r183 | `blendBurn` / `blendDodge` / `blendOverlay` |
| `scriptable*` | r183 | (none) |
| `modInt` | r185 | `mod(int(...))` |
| `string` / `arrayBuffer` | r185 | (none) |
| `rangeFog(c, n, f)` | r186 | `fog(c, rangeFogFactor(n, f))` |
| `densityFog` | r186 | `fog(c, densityFogFactor(d))` |
| `viewportResolution` | r186 | `screenSize` |
| `screen` | r186 | `blendScreen` |
| `append` | r186 | `Stack` |
| `PCFSoftShadowFilter` | r186 | (none) |
| `textureCubeUV`, `getDirection`, `blur`, `getShadowMaterial` | r186 | (none; internals) |

Every name that has a replacement listed already printed a deprecation warning on r182; the rest were internals or rarely used. `rangeFog`, `viewportResolution` and `append` are common in LLM-written code. Code that runs warning-free on r182 therefore mostly runs on r186. Between r182 and r186, 23 TSL exports were removed and 76 added (629 → 682). New ones include `OnFrameUpdate`, `OnBeforeFrameUpdate`, `negateOnBackSide`, `packNormalToRGB`, `storageTexture3D`, `batchIndirectIndex` and `pack4xU8`. Texture gather (r185) is a `TextureNode` feature, not a top-level export. `softParticles` (r186) is an addon in `three/addons/tsl/utils/SoftParticles.js`. The compute API (`Fn().compute(count, workgroupSize)`, `instancedArray`, `attributeArray`) is unchanged.

### 1.4 Ready-made render features: what r182 already had, and what is new

First release in which the addon file appears, from jsDelivr file listings [src]:

- **Already in r182:**
  - Post effects: `SSRNode`, `GTAONode`, `BloomNode`, `DenoiseNode`
  - Shadows: `CSMShadowNode`, `TileShadowNode` (r176)
  - Anti-aliasing and GI: `TRAANode` (r179; named `TRAAPassNode` r170–178), `SSGINode` (r181), `SSSNode` screen-space shadows (r181)
  - Lighting: `TiledLighting` (r170–184), `VolumetricLightingModel` (r174)
  - GPU data and skinning: `IndirectStorageBufferAttribute` (r170), `instancedArray` (r171), `computeSkinning()`
- **New since r182:**
  - r183: `GodraysNode`, `retroPass`, `exponentialHeightFogFactor`
  - r184: `TAAUNode`, `FSR1Node`, `DynamicLighting`, `ReadbackBuffer`
    - `DynamicLighting` batches lights into uniform arrays, so changing the light count does not recompile shaders.
  - r185: `ClusteredLighting` (Forward+), WebXR on WebGPU, SSR denoiser, `storageTexture3D`, texture gather
  - r186: `SSAONode`, VXGI (voxel cone-traced GI), `OITPassNode`, `SunLight` (two-cascade CSM), WebGPU `LightProbeGrid`, `GaussianSplat`, `DirectRenderPipeline`

### 1.5 r182 bugs fixed later (relevant to us)

1. **InstancedMesh: uniform-buffer overflow on WebGL 2.**
   - r182 hard-codes "≤1000 instances → UBO" with the comment "Both backends have ~64kb UBO limit" [src].
   - Most Apple WebGL 2 devices report `MAX_UNIFORM_BLOCK_SIZE = 16384`. On web3dsurvey, only 7% of macOS reports are at least 32 KB, and only 1–2% of Safari and iOS reports are at least 64 KB ([web3dsurvey](https://web3dsurvey.com/webgl2/parameters/MAX_UNIFORM_BLOCK_SIZE)).
   - Result: an InstancedMesh with **257–1000 instances fails to link and doesn't render**. The error is "uniform block exceeds GL_MAX_UNIFORM_BLOCK_SIZE (16384)".
   - This is [#33009](https://github.com/mrdoob/three.js/issues/33009), reproduced on r182 in Chrome with ANGLE on Metal on macOS, using `forceWebGL`. The reporter said Safari and Firefox happened to work.
   - Fixed in r183 ([#32949](https://github.com/mrdoob/three.js/pull/32949)). The threshold now comes from `getUniformBufferLimit()`, which is `MAX_UNIFORM_BLOCK_SIZE` on WebGL and `maxUniformBufferBindingSize` on WebGPU. Skinning uses the same check [src].
   - **A Linux CI on Mesa or SwiftShader would probably never catch this**, because those report larger limits [inf].
   - To catch it, wrap `gl.getParameter` in a test harness so `MAX_UNIFORM_BLOCK_SIZE` reports 16384, emulating Apple. Or test on a real Mac.
2. **InstancedMesh: dynamic updates on the attribute path** (above the UBO threshold).
   - r182's `InstanceNode.update()` copies the version to its internal interleaved buffer only when `usage !== DynamicDrawUsage` [src]. Dynamic meshes therefore depend on the usage that was captured when the material was first compiled.
   - Calling `setUsage(DynamicDrawUsage)` after the first render leaves the GPU copy stale [inf]. This is the likely mechanism behind our ">1000 instances + DynamicDrawUsage not updating" bug. I found no upstream issue with exactly that title.
   - Related problems in the same path: `updateRanges` were applied one frame late ([#33614](https://github.com/mrdoob/three.js/issues/33614)) and never cleared.
   - r185 rewrote the path as a TSL function in `Instance.js` ([#33615](https://github.com/mrdoob/three.js/pull/33615), #33674). It syncs the version unconditionally, regardless of usage, in an `OnFrameUpdate` hook [src].
   - r185.0 introduced a capacity regression that r185.1 fixed ([#33889](https://github.com/mrdoob/three.js/pull/33889)).
   - r186 moved the sync to `OnBeforeFrameUpdate`, so it runs before the upload, and clears the source `updateRanges` so they no longer accumulate [src].
   - **Still present in r186.1:** a `setColorAt()` call made for the first time after the mesh has rendered never shows on WebGPU ([#34748](https://github.com/mrdoob/three.js/issues/34748)). It is fixed in r187 by #34752. Workaround: initialize the colors before the first render.
3. **BatchedMesh.**
   - Nothing rendered on the WebGL 2 fallback in Firefox ([#31070](https://github.com/mrdoob/three.js/issues/31070)). Fixed in r184 with a `WEBGL_multi_draw` fallback (#33238).
   - On the WebGPU backend, every geometry after the first was drawn at half its index offset when the index was Uint16 ([#34211](https://github.com/mrdoob/three.js/issues/34211)). Fixed in r186. Workaround: use a Uint32 index.
   - Shadow-pass culling is wrong; fixed in r187 dev (#34822).
4. **Other fixes:**
   - `compileAsync` blocked the main thread until r184.
   - Shadows: an Adreno compare bug (r183) and WebGL-fallback normal bias and compare fallbacks (r184).
   - CSM rendered a frame late until r186.
   - Bone counts above the UBO limit fall back to a bone texture from r186.
   - Stale occlusion-query results fixed in r186.
   - A draw-call-heavy performance regression present since r176 ([#32675](https://github.com/mrdoob/three.js/issues/32675)) was closed under r183; the issue names no fix PR.

### 1.6 Recommendation: pin `three@0.186.1`

**Why move rather than stay**
- **LLM familiarity is about the surface agents write against, and that surface barely changed.**
  - Core objects, materials, the TSL basics and compute APIs are stable.
  - The one high-traffic rename (`PostProcessing`) is still aliased.
  - The removed TSL names were already deprecated in r182.
  - Starting a new repo on r182 would build on names that are already deprecated.
  - Familiarity also fades over time: each month, more training data covers r183–r186.
- **The fixes sit exactly in our risk areas.** These are WebGL 2 parity on Apple hardware and Firefox, instancing, batching, shader-compile stutter, and readback for tests.

**Mitigations for unfamiliar APIs**
- Vendor `llms-full.txt` for 0.186 and the TSL Guide into `docs/vendor/`.
- Write a one-page "r182 → r186 delta" for agents covering the tables above.
- Add ESLint `no-restricted-imports` and `no-restricted-properties` rules that name the replacement for every removed or deprecated API.
- Add a startup check that turns any three.js `warnOnce` deprecation into a test failure.

**Upgrade policy**
- Upgrade one release at a time, and only to `.1` patch releases. r185.0 shipped an instancing regression.
- Run a canary CI job against the next release.
- Upgrade only when golden-image and determinism suites pass on both backends.

**If we stay on r182 anyway**
- Cap an InstancedMesh at 256 instances, or above 1000 with the usage set before the first render.
- Initialize instance colors before the first render.
- Avoid BatchedMesh.
- Treat `PostProcessing` as the name to use.

---

## 2. Rapier

### 2.1 Versions and repo move [doc]

| Version | Date | Notes |
|---|---|---|
| `0.19.3` | 2025-11-05 | Our current pin |
| `0.20.0` | 2026-08-08 | Built on Rapier 0.35 |
| `0.21.0` | 2026-09-24 changelog / 09-25 npm | Built on Rapier 0.36; npm `latest`; canary builds tagged `0.0.0-<sha>-<date>` |

The `dimforge/rapier.js` repo was **archived on 2026-07-12** ([repo](https://github.com/dimforge/rapier.js)). The bindings now live in [`dimforge/rapier/bindings/typescript`](https://github.com/dimforge/rapier/tree/master/bindings/typescript), and that is where the [TS changelog](https://github.com/dimforge/rapier/blob/master/bindings/typescript/CHANGELOG.md) is kept.

### 2.2 What changed since 0.19.3

**JS API (small for World-level users)** [src/doc]
- The `-compat` files moved into `dist/`. Deep imports and pinned CDN URLs break; imports through the package entry still work.
- `IntegrationParameters.minIslandSize` removed.
- `NarrowPhase.contactPair` and `TempContactManifold` APIs changed.
- 0.21 threads a `SoftBodySet` through the low-level pipeline APIs. `World` itself only gained soft-body methods.
- `KinematicCharacterController` is unchanged apart from two things:
  - `computedMovement(target?)` now takes an optional out-parameter.
  - The docs now say collision witness points and normals are in world space.
- `takeSnapshot(): Uint8Array` and `World.restoreSnapshot()` are unchanged.

**Behavior (Rapier 0.35, via JS 0.20), which changes gameplay** ([Rust changelog](https://github.com/dimforge/rapier/blob/master/CHANGELOG.md))
- Sleeping uses persistent islands. `normalized_linear_threshold` went from 0.4 to 0.05 and `time_until_sleep` from 2.0 s to 0.5 s.
- Sweep-based CCD is always on for fast dynamic bodies against fixed colliders.
- Velocities are capped by default: 400 units/s linear and about 45° per step angular.
- Contact defaults changed:
  - prediction distance from 0.002 to 0.02
  - maximum corrective velocity from 10 to 3
  - allowed linear error from 0.001 to 0.005
- Restitution is now applied in an end-of-step pass.
- **KCC fix:** with snap-to-ground on, purely lateral movement no longer makes the `grounded` flag flicker. 0.19.3 has the bug; feeding a small downward component each step works around it.
- The broad phase now filters by collision groups.
- Contact impulses canonicalize signed zeros, which removes a source of cross-platform divergence.
- Not exposed in JS: Rust's NaN quarantine.

**Snapshots are version-locked.** The island serialization format changed in 0.35. 0.36 states that "snapshots serialized with previous versions can't be loaded anymore". Replays must record the Rapier version.

**Size**

| Package | `rapier.mjs` | gzipped | `.wasm` |
|---|---|---|---|
| `simd-compat@0.19.3` | 2.31 MB | 0.86 MB | 1.62 MB |
| `deterministic-compat@0.19.3` | 2.28 MB | 0.85 MB | 1.60 MB |
| `0.21.0` (soft bodies + FEM) | 4.37–4.62 MB | 1.66 MB | 3.1–3.3 MB |

### 2.3 Determinism: which package guarantees it

Since `0.15.0` (March 2025) there are separate builds:

| Flavor | Feature flags (0.21 build generator) | Cross-platform guarantee |
|---|---|---|
| `rapier3d` / `-compat` | none | No. The README says "locally deterministic, on the same machine". |
| `rapier3d-simd` / `-compat` | `+simd128` | No. Same README wording. |
| `rapier3d-deterministic` / `-compat` | `enhanced-determinism` | **Yes.** "a guarantee of a cross-platform deterministic execution" |

Sources: the build generator ([`main.rs`](https://github.com/dimforge/rapier/blob/master/bindings/typescript/builds/prepare_builds/src/main.rs)) and the npm READMEs.

- The rapier.rs [JS determinism guide](https://rapier.rs/docs/user_guides/javascript/determinism) still says the JS version is "fully cross-platform deterministic". That predates the 0.15 split, so trust the READMEs.
- The guide's conditions still apply:
  - the same Rapier version
  - identical parameters
  - the same construction and insertion/removal order
  - hashing `takeSnapshot()` bytes after the same number of steps
- It also warns that JS `Math.sin` and `Math.cos` differ across platforms, so anything that feeds the simulation must use our own deterministic math.
- In practice, WASM float semantics are deterministic: no FMA contraction, and simd128 is deterministic apart from NaN bit patterns. The `simd` build therefore probably matches across browsers, but upstream won't promise it. I found no divergence reports in the rapier.js issues [inf].

### 2.4 Recommendation

1. **Now:** switch to `@dimforge/rapier3d-deterministic-compat@0.19.3`.
   - It is the same API, the same `init()` and the same size.
   - Benchmark `world.step()` against `simd-compat`. I found no published numbers.
   - Add a CI job that hashes snapshots after N steps in Chromium, Firefox and WebKit through Playwright, plus Node.
2. **Later:** move to `0.21.x-deterministic-compat` as a deliberate change.
   - Re-tune gameplay constants against the new sleep, CCD and contact defaults.
   - Re-baseline replays.
   - Accept the +0.8 MB gzipped bundle.

---

## 3. WebGPU availability (October 2026)

| Platform | Status | Source |
|---|---|---|
| Chrome / Edge on Windows, macOS, ChromeOS | On since 113 | [gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), edited 2026-10-02 |
| Chrome on Linux | Intel Gen12+ since 144 (Jan 2026); NVIDIA on Wayland since 147; other setups behind flags | gpuweb wiki |
| Chrome on Windows ARM64 | Flag only | gpuweb wiki |
| Chrome on Android | 121+ on Android 12+ with Qualcomm/ARM/Intel GPUs; Imagination on Android 16+ since 139 | gpuweb wiki |
| Chrome compat mode | **Shipped in 146** for OpenGL ES 3.1 (Android first; ChromeOS and D3D11 being explored) | [Chrome 146 post](https://developer.chrome.com/blog/new-in-webgpu-146) |
| Safari 26 | On by default on iOS/iPadOS/visionOS 26 and **macOS Tahoe 26+ only** | gpuweb wiki; [caniuse](https://caniuse.com/webgpu) note 7 |
| Firefox on Windows | Since 141 (2025-07-22) | gpuweb wiki |
| Firefox on macOS | Apple Silicon only: 145 on macOS 26, then 147 on all macOS versions ([147 notes](https://www.firefox.com/firefox/147.0/releasenotes/)) | |
| Firefox on Intel Macs / Linux / Android | Not shipped (Linux is Nightly only; Android behind a flag; Mozilla targets 2026) | gpuweb wiki |

**Share of users**

[web3dsurvey](https://web3dsurvey.com/webgpu) (rolling window, fetched 2026-10-09; no date range shown):

| Group | Working WebGPU adapter |
|---|---|
| All reports | **83.3%** (WebGL 2 is 97.8%) |
| ChromeOS | 92.6% |
| macOS | 90.1% |
| Windows | 87.5% |
| iOS | 85.4% |
| Android | 73.6% |
| Linux | **17.8%** |
| Firefox (by browser) | 60.4% |

caniuse, by browser version only (data from 2026-10-06), gives WebGPU 85.7% full plus 3.1% partial, and WebGL 2 96.4%.

**Feature gaps among WebGPU devices** (web3dsurvey)

| Feature | Overall | Notes |
|---|---|---|
| `timestamp-query` | 98.8% | Safari 92.7% |
| `float32-filterable` | 91.2% | **iOS 53.8%, Android 70.7%**, Safari 56.3% |
| `subgroups` | 68.5% | **Chromium only**; Firefox and Safari about 0% |
| `shader-f16` | 94.0% | |
| `core-features-and-limits` | 99.1% | Android 98.2%; that is, about 1% of devices are compat-only |

**How three.js handles these gaps** [src]
- It requests every feature the adapter offers.
- `trackTimestamp` switches itself off without timestamp support.
- It falls back to unfilterable float sampling without `float32-filterable`. Visuals can degrade, so use `HalfFloatType` targets.
- It enables subgroups only when they are present.
- On compat-only devices, MSAA is off.
- Firefox's wgpu backend shipped without `importExternalTexture` and with IPC overhead ([2nd](https://linuxiac.com/webgpu-lands-in-firefox-141-on-windows-eyes-linux-and-macos-next/)).

---

## 4. WebGPU-only enhancement tiers

**How the WebGL 2 backend runs compute.** It emulates TSL compute with transform feedback: a vertex shader runs once per element under `RASTERIZER_DISCARD` and writes to ping-pong buffers [src].
- So "map"-style kernels, where element *i* reads and writes element *i*, run on **both** backends.
- Atomics, workgroup memory, scatter writes, storage textures, indirect dispatch and indirect draw are WebGPU-only. Passing an `IndirectStorageBufferAttribute` count on WebGL only produces a warning.
- Fragment-based TSL post effects should compile for both backends [inf]. Their cost differs, and some examples are explicitly gated on WebGPU with `WebGPU.isAvailable()` (for instance `webgpu_lights_clustered` and `webgpu_struct_drawindirect`). In the table, "both backends" means expected to work: confirm each effect with a `forceWebGL` CI job.

| Technique | Ready-made in three.js | Our tier |
|---|---|---|
| GPU particles | `instancedArray` + `Fn().compute()`; examples `webgpu_compute_particles` (plus rain, snow, fluid), `tsl_vfx_*`; `SoftParticles` addon in r186 | Simple integrators run on both backends. Sorting, atomics and collisions are WebGPU tier. |
| GPU culling with indirect draws | Building blocks only: `IndirectStorageBufferAttribute` (r170), `geometry.setIndirect()`, `webgpu_struct_drawindirect` (gated on WebGPU), `webgpu_compute_rasterizer`. No ready-made culling pipeline. | WebGPU tier. The fallback is CPU culling (BatchedMesh `perObjectFrustumCulled`, or `@three.ez/instanced-mesh` with BVH, MIT). Occlusion queries (`object.occlusionTest`, `renderer.isOccluded()`) work on both backends. |
| Compute skinning | `computeSkinning()` (in r182), `webgpu_skinning_points`; instanced skinning examples | Normal vertex skinning runs on both backends. Compute skinning is an optional WebGPU tier. |
| GPU-driven instancing | `StorageInstancedBufferAttribute` written by compute; BatchedMesh multi-draw (WebGL fallback since r184) | WebGPU tier when compute writes the transforms. |
| Clustered / Forward+ lighting | `TiledLighting` (r170–184), now **`ClusteredLighting`** (r185+); its example is gated on WebGPU | WebGPU tier. On WebGL, use `DynamicLighting` (r184; uniform arrays, no recompiles) with capped light counts [inf: uniform-only, so it should run on WebGL]. |
| SSGI, SSR, GTAO, SSAO | SSGI r181, SSR (≤r170; denoiser r185), GTAO (≤r170; reworked r185–186), SSAO r186, VXGI r186 | Visual tier. Default to off on WebGL and mobile. |
| Volumetric fog / light | `VolumetricLightingModel` (r174); `webgpu_volume_lighting*`; post-process fog example (r186); `exponentialHeightFogFactor` (r183) | Height fog on both backends; volumetrics as a WebGPU tier. |
| TAA and upscaling | `TRAANode` (r179), `TAAUNode` (r184), `FSR1Node` (r184) | Both backends. Temporal effects need deterministic jitter in tests. |
| Bloom | `BloomNode` (≤r170, faster blur in r186) | Both backends. |

---

## 5. Headless testing

**The proven recipe is three.js's own CI** ([ci.yml](https://github.com/mrdoob/three.js/blob/dev/.github/workflows/ci.yml), [puppeteer.js](https://github.com/mrdoob/three.js/blob/dev/test/e2e/puppeteer.js)).
- Runner: `ubuntu-latest` with `apt-get install mesa-vulkan-drivers xvfb`.
- Environment: `VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json` (lavapipe).
- Chrome flags: `--enable-unsafe-webgpu --enable-features=Vulkan --disable-vulkan-surface --ignore-gpu-blocklist --disable-gpu-driver-bug-workarounds --disable-gpu-watchdog --no-sandbox`.
- Unit and compute tests run **headless**. Screenshot e2e tests run **headful under `xvfb-run -a`**.
- A [deterministic injection](https://github.com/mrdoob/three.js/blob/dev/test/e2e/deterministic-injection.js) seeds `Math.random`, freezes `performance.now`, `Date.now` and rAF, and forces `trackTimestamp` off in software mode.
- Comparison: a 0.1 per-pixel threshold and at most 0.1% differing pixels. Several WebGPU examples are excluded because rasterizers disagree, for example sub-pixel coverage (#33817).

**Playwright specifics**
- The default headless build is `chromium-headless-shell`. Use `channel: 'chromium'` for new headless, which is real Chrome ([docs](https://playwright.dev/docs/browsers)), or run headful under Xvfb.
- [agent-browser's notes](https://agent-browser.dev/webgpu) [2nd] agree with three.js's setup:
  - On Linux, headless capture of WebGPU canvases is not supported upstream; use headful with Xvfb.
  - On Windows, headless screenshots of WebGPU canvases come out black.
  - Without `libvulkan1` and `mesa-vulkan-drivers`, `requestAdapter()` returns null.
  - SwiftShader is an alternative: `--use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --use-angle=vulkan`.
- `page.clock` overrides rAF, `performance`, `Date` and timers ([docs](https://playwright.dev/docs/clock)). An engine-level `step(n)` is still better.
- Playwright `1.64.0` shipped 2026-10-07.

**WebGL 2 in software**
- Since Chrome 139, WebGL no longer falls back to SwiftShader silently ([intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM/m/oLrB5up_BwAJ)).
- On GPU-less CI, pass `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`, or use ANGLE on lavapipe as three.js does.

**Golden images**
1. Render the frame through the normal pipeline into a `RenderTarget`, read it back with `readRenderTargetPixelsAsync`, and encode the PNG in Node. Do not use `drawImage` or `toDataURL` on the WebGPU canvas.
2. Keep separate baselines per backend: WebGPU on lavapipe and WebGL 2 on SwiftShader or lavapipe.
3. Before comparing pixels, assert the backend type and the adapter info, and check that the image is not blank. A WebGPU-to-WebGL fallback is otherwise silent.
4. Freeze temporal effects to a fixed frame index and jitter.
5. Prefer ID-buffer and statistics assertions to raw pixel diffs where possible.
6. Use the MRT pass for an object-ID buffer.

**Node without a browser**
- [`webgpu`](https://github.com/dawn-gpu/node-webgpu) on npm is Dawn's binding: `0.6.2`, published 2026-10-02. npm lists it as MIT; the repo says BSD-3-Clause.
  - It supports render-to-texture, compute and readback, but no canvas.
  - The backend is selectable (`backend=vulkan` works with lavapipe).
  - Good for unit-testing raw WGSL and compute. Not for three.js scenes.
- Deno has `navigator.gpu` behind `--unstable-webgpu`. My sources date from 2024, so verify.
- Run engine logic in plain Node: simulation, Rapier `-compat` and audio DSP. It is fast and deterministic.

---

## 6. Procedural audio

**Platform state**
- `AudioWorklet` is universal: Chrome 66, Firefox 76, Safari 14.1. So is `OfflineAudioContext`.
- Web Audio 1.1 is a [Working Draft dated 2026-09-22](https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/).
- A configurable render quantum (`renderSizeHint`) is still a Chromium origin trial ([intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/B3OnsU0V-i4)).

**Determinism**
- `OfflineAudioContext` renders are **not bit-identical** across browsers, OSes and CPUs; they are a fingerprinting signal.
- Safari's Advanced Fingerprinting Protection adds per-sample noise ([fingerprint.com](https://fingerprint.com/blog/bypassing-safari-17-audio-fingerprinting-protection/)). It is on by default in Private Browsing since Safari 17, and reportedly in all modes in Safari 26 [2nd].
- Brave "farbles" audio output ([Brave](https://brave.com/privacy-updates/4-fingerprinting-defenses-2.0/)).
- Rule: synthesize sound in pure JS into `Float32Array`s from a seeded PRNG, and hash those buffers in tests. Play them through `AudioBufferSourceNode`, or stream them through an AudioWorklet. Use `OfflineAudioContext` only for tolerance-based smoke tests.
- For capture: use an offline mode with a fixed frame rate and a sample rate divisible by that frame rate, like Godot's [Movie Maker](https://docs.godotengine.org/en/stable/tutorials/animation/creating_movies.html).

**Reference libraries**

| Library | License | Notes |
|---|---|---|
| [jsfxr](https://github.com/chr15m/jsfxr) | **Unlicense** | npm `1.4.1`. sfxr port with presets (pickup, laser, explosion, jump and others). |
| [ZzFX](https://github.com/KilledByAPixel/ZzFX) | **MIT** | `1.4.0`. About 20 positional parameters, under 1 KB. Computes samples in JS, then builds an `AudioBuffer`. Its randomness uses unseeded `Math.random`, so reimplement it with our PRNG. |
| [ZzFXM](https://github.com/keithclark/ZzFXM) | **MIT** | GitHub only. A tiny tracker: instruments, patterns, sequence. |

**iOS**
- Web Audio counts as "ambient" audio, so it obeys the silent switch ([WebKit 252746](https://bugs.webkit.org/show_bug.cgi?id=252746)).
- `navigator.audioSession.type = 'playback'` is experimental. Resume the audio context on a user gesture, and offer an in-game mute.

---

## 7. AI-native engine practices (2025–26)

**The landscape**
- **MCP is now standard in engines and editors:**
  - Unity's official MCP server went into open beta on 2026-05-11 ([Unity](https://unity.com/blog/unity-ai-mcp-how-to-get-started)). Its tools cover scene hierarchy, component read/write, console logs and custom C# tools, used in a "read console, fix, re-read" loop.
  - UE 5.8 (June 2026) has an experimental editor MCP plugin [2nd] ([Puget](https://www.pugetsystems.com/blog/2026/07/09/unreal-engine-mcp-hands-on-testing-ai-inside-the-editor/)).
  - The [PlayCanvas Editor MCP server](https://developer.playcanvas.com/user-manual/editor/mcp-server/) has runtime tools to capture the viewport, launch the app, capture the running app, read runtime logs, query entity state, and inject keyboard, mouse and touch input. Its guidance says: "do not rely on source inspection alone".
  - Bevy's [BRP MCP](https://github.com/natepiano/bevy_brp) gives JSON-RPC query, mutate and watch over ECS components.
  - Community MCP servers exist for Godot.
- **Browser automation for agents:** [Chrome DevTools MCP](https://developer.chrome.com/blog/chrome-devtools-mcp) (2025-09-23) offers traces, console, screenshots and network inspection. Playwright MCP is the other option.
- **Repo conventions:** [AGENTS.md and MCP moved to the Linux Foundation's AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) on 2025-12-09.
  - OpenAI's "Harness engineering" (2026-02-11; [InfoQ](https://www.infoq.com/news/2026/02/openai-harness-engineering-codex)) describes zero hand-written code.
  - Its practices: a docs directory as the system of record, mechanically enforced by linters, CI and structural tests, plus logs, metrics and spans that agents can read.
- **Research:**
  - [GameLogicBench](https://arxiv.org/abs/2609.21562) (2026-09) checks Godot game rules with **tick-level state assertions** and validates its tests against mutants. Without the mutant check, wrong submissions passed. The best of 20 agent setups solved 52.8% of tasks.
  - [GameXpert-Bench](https://arxiv.org/abs/2608.21833) (2026-08) finds agents are reliable at building foundations but weak at finding defects, verifying runtime behavior and preserving functionality across changes.
  - [OpenGame](https://arxiv.org/abs/2604.18394) runs games in a headless browser with VLM judging and keeps a "Debug Skill" of verified fixes.
  - [Compiled Agency](https://arxiv.org/abs/2609.18996): access to the environment added 10–78 percentage points of held-out success.
  - [LibraryDesignBench](https://arxiv.org/abs/2609.36730): agents underuse libraries that are rigid or hard to use and re-implement their features instead. Testing a library with subagents helps.
  - [Orak](https://arxiv.org/abs/2506.03610) (ICLR 2026) plugs agents into games through MCP.
  - On stale training data, [Pinecone](https://www.pinecone.io/blog/designing-agent-friendly-apis/) warns that old API shapes dominate a model's priors. Docs and errors must steer agents to the current path.

**Ideas to adopt**
1. **In-page `window.__engine` API** plus a thin MCP or Playwright bridge. It should expose:
   - `query` and `get`/`set` on entities and components
   - `pause`, `step(n)` with a fixed timestep, and `seed`
   - input injection and recording
   - `capture` (render-target readback, per pass or MRT)
   - stats (`renderer.info`, GPU timestamps, Rapier counters)
   - structured logs and backend and capability info
2. **Determinism as a contract.**
   - Fixed timestep, seeded RNG streams, our own trig and math for anything that feeds the simulation, ordered entity iteration, and Rapier's deterministic flavor.
   - A per-tick state hash that combines the engine state hash with a hash of the Rapier snapshot.
   - Replays that record the engine, three.js and Rapier versions.
3. **Tests as tick-level assertions over replays.** Validate the suite with mutation testing.
4. **Version-pinned knowledge in the repo:**
   - `AGENTS.md` as the map
   - `docs/` holding invariants, the API delta and vendored `llms-full.txt` and TSL Guide
   - lint rules that turn deprecated names into actionable errors
   - deprecation warnings that fail tests
5. **Errors written for agents.** Say what failed, which tier or backend was active, how to fix it, and link the doc. **Never fall back silently.** Log and expose the WebGPU-to-WebGL fallback and every tier downgrade.
6. **Engine logic runs headless in Node,** and the renderer is tested in Chromium. Visual checks start with structural assertions, with VLM judging last.
7. **Small, flexible APIs.** Test them with subagents before calling them stable.

---

## 8. Procedural characters: skinning and animation in three.js

**Building the character in code** [src]
- Generate limb geometry and add the `skinIndex` attribute (`Uint16BufferAttribute`, 4 per vertex) and `skinWeight` (`Float32BufferAttribute`, 4 per vertex).
- Create a `Bone` hierarchy and a `Skeleton`, then call `mesh.add(rootBone)` and `mesh.bind(skeleton)`.
- Bounds: `SkinnedMesh.computeBoundingBox()` and `computeBoundingSphere()` follow the current pose. Recompute them, or set `frustumCulled = false` on characters.
- Alternative: rigid segments parented to bone `Object3D`s. They are cheaper and fully deterministic.

**Animation**
- Either set bone quaternions directly each tick (procedural gait), or build clips:
  `new AnimationClip(name, dur, [new QuaternionKeyframeTrack('thigh_L.quaternion', times, values)])`
- Drive clips with `AnimationMixer.update(fixedDt)`.
- Tracks bind by bone name. A single canonical rig definition therefore lets clips apply to every character without retargeting.
- `AnimationUtils.makeClipAdditive` and `subclip` work as before.
- r183 added Bezier interpolation (`InterpolateBezier` with tangents in `track.settings`), and r186 added tangent serialization. It is optional and unfamiliar to LLMs.
- `AnimationClip.parseAnimation` was removed in r185.

**IK**
- `CCDIKSolver` is a CPU addon and works with any renderer. r184 fixed sign handling for rotations along the limitation axis; before that, negative hinge rotations were mirrored.
- For legs and arms, an analytic two-bone IK in engine code is simpler and deterministic.

**Retargeting**
- `SkeletonUtils.retarget()` and `retargetClip()` run on the CPU. Since r186, `source` can be a `Skeleton`.
- The `webgpu_animation_retargeting` example shows it working under WebGPU.

**WebGPU**
- Node materials apply TSL `skinning()` automatically on both backends.
- Bones go in a UBO up to the device limit, and in a bone texture above it (r186). That limit is 16 KB, or 256 bones, on Apple WebGL 2.
- `computeSkinning()` and instanced skinning are optional WebGPU-tier features.
- **Gotcha (r185):** use `positionGeometry`, not `positionLocal`, for pre-skin positions in a custom `positionNode`.

---

## Sources (main)

**three.js**
- [Releases](https://github.com/mrdoob/three.js/releases)
- [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
- Issues and PRs: [#33009](https://github.com/mrdoob/three.js/issues/33009), [#32949](https://github.com/mrdoob/three.js/pull/32949), [#33614](https://github.com/mrdoob/three.js/issues/33614), [#33889](https://github.com/mrdoob/three.js/pull/33889), [#34748](https://github.com/mrdoob/three.js/issues/34748), [#31070](https://github.com/mrdoob/three.js/issues/31070), [#34211](https://github.com/mrdoob/three.js/issues/34211), [#34681](https://github.com/mrdoob/three.js/issues/34681)
- [llms.txt](https://threejs.org/docs/llms.txt), [examples index](https://threejs.org/examples/files.json), [CI e2e](https://github.com/mrdoob/three.js/blob/dev/test/e2e/puppeteer.js)

**Rapier**
- [TS changelog](https://github.com/dimforge/rapier/blob/master/bindings/typescript/CHANGELOG.md), [Rust changelog](https://github.com/dimforge/rapier/blob/master/CHANGELOG.md), [determinism guide](https://rapier.rs/docs/user_guides/javascript/determinism)

**WebGPU**
- [gpuweb status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [web3dsurvey](https://web3dsurvey.com/webgpu), [caniuse](https://caniuse.com/webgpu), [Chrome WebGPU news](https://developer.chrome.com/docs/web-platform/webgpu/news)

**Testing**
- [agent-browser WebGPU](https://agent-browser.dev/webgpu), [Chrome headless AI testing](https://developer.chrome.com/blog/supercharge-web-ai-testing)

All the remaining sources are linked inline.
