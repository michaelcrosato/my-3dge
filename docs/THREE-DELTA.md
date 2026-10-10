# THREE-DELTA: three.js r182, for agents who know another release

The engine pins three.js **r182** (`three@0.182.0`, `@types/three@0.182.0`; `tools/deps.json`, PLAN.md §4.7). Write
r182's idioms. This page lists where r182 differs from the releases around it, so knowledge from a newer or older
release does not leak in. The authorities, in order: r182's own sources with their JSDoc in
`node_modules/three/src/` and `node_modules/three/examples/jsm/`, its types in `node_modules/@types/three/`, then the
TSL guide as it stood for r182 (`docs/reference/three-tsl-wiki.md`). A name r182 lacks is a type error and, in the
browser, a link error that stops the whole module graph. ESLint's bans name each replacement (PLAN.md Appendix B), and
any three.js deprecation warning fails a test.

Every r182 claim below was checked against `node_modules/three` (the sources and what `three/webgpu` and `three/tsl`
export); the newer releases' changes against their npm packages and the wiki's Migration Guide. Each three.js upgrade
rewrites this page (PLAN.md §9, Upgrade work packages); `node x deps --check` fails when it falls behind the pin.

## 1. For agents who know newer releases (r183 to r187)

### Names r182 does not have

| Newer name | Arrived | In r182 |
|---|---|---|
| `RenderPipeline` (the post-processing class) | r183 | `PostProcessing`, from `three/webgpu`. r182 has a `src/renderers/common/RenderPipeline.js`, but it is the internal GPU pipeline object and is not exported: never import it |
| `GodraysNode` | r183 | Not in r182: a custom TSL pass, when a look needs one |
| `DynamicLighting` | r184 | Not in r182: the engine's light pool (WP 7.1) |
| `ClusteredLighting` | r185 | The `TiledLighting` addon (`three/addons/lighting/TiledLighting.js`, WebGPU compute; WP 11.5, on demand). r185 removes `TiledLighting` |
| `packNormalToRGB`, `unpackRGBToNormal` (TSL) | r185 | `directionToColor`, `colorToDirection`. r182's `packNormalToRGB` is a GLSL chunk function of `WebGLRenderer`, not TSL |
| `negateOnBackSide` (TSL) | r185 | `directionToFaceDirection` |
| `TextureSource` | r186 | `Source` |
| `Object3D.dispose()` | r186 | Not in r182: dispose geometries, materials and textures yourself |

### Behaviour that r182 still has the old way

- **`positionLocal` inside `material.positionNode`** is the transformed position in r182: the instancing, batching,
  skinning and morph nodes assign their results to it (`InstanceNode`, `BatchNode`, `SkinningNode`, `MorphNode`).
  From r185 it no longer follows skinning there. For the pre-transform vertex (outline push directions), use
  `positionGeometry` in every release.
- **`updateWorldMatrix()`** recomputes the world matrix every call in r182; from r185 it honours
  `matrixWorldNeedsUpdate`. With `matrixAutoUpdate = false`, set `matrixWorldNeedsUpdate = true` after writing
  `matrix`: harmless in r182, required later.
- **`Clock`** is not deprecated in r182 (r183 deprecates it). The engine bans it anyway: `core/time` on the sim side,
  three.js's `Timer` (in r182: `update()`, `getDelta()`, `getElapsed()`, `connect(document)`) inside `gfx/` only.
- **Shadows:** `PCFSoftShadowMap` still works on `WebGPURenderer` in r182 (r186 removes it there and makes
  `PCFShadowMap` soft). r183 improves WebGPU shadows and needs less bias, so bias values tuned on r183 or later can
  show acne on r182.
- **Looks that change later:** environment and background rotation (`Scene.environmentRotation`,
  `backgroundRotation`) follow r182's convention, not r184's; premultiplied alpha is r182's, not r185's; `GTAONode`'s
  AO is r182's (r185 darkens and widens it; r186 drops `distanceExponent` and `distanceFallOff`); `RoomEnvironment` and
  `Sky` look as in r182 (r183 moves the room and drops `Sky`'s gamma); `SSRNode` blends with `blendColor()` (r183:
  additively).
- **`renderMultiDrawInstances`** still exists in r182, deprecated; r184 removes it. Use `renderMultiDraw` with
  indirection.
- **r186 does not run here:** it passes a `swizzle` to `GPUTexture.createView()`, which the platform's Chromium 141
  rejects at startup (PLAN.md §4.7).

## 2. For agents who know older releases (r180 and before)

### Changed in r181 and r182

| Was | In r182 | Since |
|---|---|---|
| `renderer.renderAsync()`, `clearAsync()`, `clearColorAsync()`, `clearDepthAsync()`, `clearStencilAsync()`, `initTextureAsync()`, `hasFeatureAsync()`; `PostProcessing.renderAsync()`; `QuadMesh.renderAsync()`; `PMREMGenerator`'s `fromSceneAsync()`, `fromEquirectangularAsync()`, `fromCubemapAsync()`; `KTX2Loader.detectSupportAsync()` | `await renderer.init()` once, then the synchronous forms (`render()`, `clear()`, `fromScene()`…). The async forms warn. `compileAsync()`, `computeAsync()`, `readRenderTargetPixelsAsync()` and `resolveTimestampsAsync()` stay | r181 |
| `renderer.waitForGPU()` | Removed: it logs an error and does nothing | r181 |
| `PassNode.setResolution()`, `getResolution()` | `setResolutionScale()`, `getResolutionScale()` | r181 |
| `PI2` (TSL) | `TWO_PI` (`PI2` still exports, without a warning) | r181 |
| `cache()` (TSL) | `.isolate()`, the method. r182's `three/tsl` does **not** export a named `isolate` (types and module agree: a named import fails); `TSL.isolate` from `three/webgpu` also works | r181 |
| `GTAONode`'s AO in every channel | The `r` channel only: blend with `vec4(scenePassColor.rgb.mul(aoPass.r), scenePassColor.a)` | r181 |
| `WaterMesh`'s `resolution` | `resolutionScale` | r181 |
| `new WebGPURenderer({ colorBufferType })` | `outputBufferType`. r182 **silently ignores** `colorBufferType` | r182 |
| `renderer.getColorBufferType()` | `getOutputBufferType()` (the old name warns) | r182 |
| `PCFSoftShadowMap` on `WebGLRenderer` | `PCFShadowMap`, now soft (the engine has no `WebGLRenderer` anyway) | r182 |

r181 also changes how PBR materials look: better indirect specular, energy conservation that brightens rough
materials (roughness over 0.5), and better PMREM reflections. Colours tuned on r180 or earlier look slightly different.

### Still warning in r182, deprecated earlier

Each prints a warning on use, and any warning fails a test (WP 0.5).

| Deprecated | Use instead | Since |
|---|---|---|
| `atan2(y, x)` | `atan(y, x)` | r172 |
| `equals` | `equal` | r172 |
| `modInt` | `mod(int(…))` | r175 |
| `rangeFog(c, n, f)`, `densityFog(c, d)` | `fog(c, rangeFogFactor(n, f))`, `fog(c, densityFogFactor(d))` | r171 |
| `burn`, `dodge`, `overlay`, `screen` | `blendBurn`, `blendDodge`, `blendOverlay`, `blendScreen` | r171 |
| `append`, `.append()` | `Stack`, `.toStack()` | r176 |
| `label()` | `setName()` | r179 |
| `.varying()`, `.vertexStage()` | `.toVarying()`, `.toVertexStage()` | r173 |
| `texture(…).uv(u)` | `.sample(u)` | r172 |
| `viewportResolution` | `screenSize` | r169 |
| `transformedNormalView`, `transformedNormalWorld`, `transformedClearcoatNormalView` | `normalView`, `normalWorld`, `clearcoatNormalView` | r177 |
| `storageObject` | `storage().setPBO(true)` | r171 |
| `material.shadowNode`, `material.shadowPositionNode` | `castShadowNode`, `receivedShadowPositionNode` | r171, r176 |
| `ReflectorNode`'s `resolution` | `resolutionScale`, a number | r180 |
| `ColorManagement.fromWorkingColorSpace()`, `toWorkingColorSpace()` | `workingToColorSpace()`, `colorSpaceToWorking()` | r177 |
| `AnimationClip.parseAnimation()` | Build clips from tracks (`new AnimationClip(name, duration, tracks)`); removed in r185 | r175 |

From r180: `RGBELoader` is `HDRLoader` (the old name warns), `RGBMLoader` is gone, and `DepthOfFieldNode` has a new
API.

## 3. What r183 to r186 change, so code written now avoids it

Write r182, in a form the upgrades (U-3, U-7) can carry without rework:

- **No `Clock`.** r183 deprecates it: `core/time` on the sim side, `Timer` inside `gfx/`.
- **No async render methods.** Deprecated since r181 and still deprecated in r186; deprecations last about ten
  releases. `await renderer.init()` once at startup, then `render()`; `compileAsync()` for the warm-up.
- **`positionGeometry`, not `positionLocal`, for the untransformed vertex.** r185 stops `positionLocal` from following
  skinning in `material.positionNode`; code that needs the skinned position there reads it where the engine computes
  it, never through `positionLocal`.
- **`PostProcessing` in one place.** r183 renames it `RenderPipeline` (the old name still works, with a warning, which
  fails a test). Only `engine/gfx/post/` names it.
- **Renamed TSL helpers in one place each:** `directionToColor`, `colorToDirection` and `directionToFaceDirection`
  become `packNormalToRGB`, `unpackRGBToNormal` and `negateOnBackSide` in r185; `Source` becomes `TextureSource` in
  r186. Wrap them inside `gfx/` instead of spreading the names.
- **Set `matrixWorldNeedsUpdate`** whenever code writes `matrix` by hand (r185's `updateWorldMatrix()`).
- **Opaque backgrounds.** r185 changes premultiplied alpha on `WebGPURenderer`; an opaque `Scene.background` or clear
  colour looks the same on both.
- **The shadow map type in one place** (the shadow setup in `gfx/`): r186 removes `PCFSoftShadowMap` from WebGPU, and
  no shadow bias is tuned on a newer release.
- **No `TiledLighting` outside its on-demand WP:** r185 replaces it with `ClusteredLighting`.
- **Looks are re-recorded at each upgrade:** environment rotation (r184), `RoomEnvironment` and `Sky` (r183), `GTAONode`
  (r185, r186) and shadows (r183) change pixels, never the sim: thumbnails are re-recorded, goldens hold.
