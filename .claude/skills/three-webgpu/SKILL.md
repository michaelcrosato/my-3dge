---
name: three-webgpu
description: Writing three.js code in my-3dge — the pinned release's idioms on WebGPU only (three/webgpu, three/tsl, three/addons), what game code meets (material parameters, the math classes) versus the TSL, compute and node post-processing that stay inside engine/gfx, the banned APIs and their replacements, and the traps from newer or older releases. Use before writing, reviewing or debugging code that imports three.js.
---

# three.js on WebGPU, as pinned

The engine pins three.js r182 (`tools/deps.json`). Write r182's idioms, never another release's from memory.

## Where the truth is

1. `node_modules/three/src/` (with its JSDoc) and `node_modules/three/examples/jsm/`; the types in
   `node_modules/@types/three/`. `tsc` rejects a name r182 lacks; in the browser it is a link error that stops the
   whole module graph.
2. docs/THREE-DELTA.md: every place r182 differs from r180 and from r183–r187, and how to write code the upgrades
   carry without rework.
3. docs/reference/three-tsl-wiki.md: the TSL guide as it stood for r182.
4. tools/eslint/banned.ts (PLAN.md Appendix B): every banned name, with the message naming its replacement. The
   PostToolUse hook prints that message on the edit that writes one, and any three.js deprecation warning fails a
   test.

## Imports and layers (PLAN.md §6.1, §6.7)

- `three/webgpu` (renderer, node materials, `PostProcessing`), `three/tsl` (nodes), `three/addons/*`. A bare `three`
  is banned: Node would load the WebGL build.
- Only `engine/gfx/` imports `three/webgpu` and TSL. Sim-side code reaches three.js only through
  `engine/core/math.ts` (the math classes listed in tools/eslint/layers.ts), and no GPU result ever reaches the sim.
- Game code meets plain terms: material parameters as data (`color`, `roughness`, `metalness`, `emissive`…), the
  math classes, clips as data. Nodes, passes and compute stay behind `engine/index.ts`.

## Idioms inside engine/gfx

- WebGPU only: `requestWebGPU()` and `createRenderer()` (engine/gfx/renderer.ts) hand a device to
  `WebGPURenderer`; no WebGL fallback (`GFX_NO_WEBGPU`). `await renderer.init()` once, then the synchronous
  `render()`, `clear()`, `compute()`; `compileAsync()` is the warm-up.
- Node materials and TSL: `colorNode`, `positionNode`… on `*NodeMaterial`, `Fn`, `uniform`, `storage`; never
  `onBeforeCompile` or GLSL. `positionGeometry` for the vertex before instancing and skinning (r182's
  `positionLocal` inside `positionNode` is already transformed).
- Post: `PostProcessing` with `pass()` and the TSL display nodes from `three/addons/tsl/display/*`, only under
  `engine/gfx/post/`. `new WebGPURenderer({ outputBufferType })` (r182 ignores `colorBufferType`).
- `.isolate()` is a method: `three/tsl` has no named `isolate` export.
- Readbacks (`readRenderTargetPixelsAsync`) only in `engine/gfx/shot.ts` (and `engine/gfx/enhanced/timing.ts`).

## Banned, and what to write instead (the common ones)

| Banned | Write |
|---|---|
| `WebGLRenderer`, `forceWebGL` | `WebGPURenderer`, WebGPU only |
| `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` | node materials and TSL inside gfx |
| `EffectComposer` | `PostProcessing` |
| `Clock` | `core/time` on the sim side, `Timer` inside gfx |
| `renderAsync`, `clearAsync`, `waitForGPU` | `await renderer.init()` once, then `render()`, `clear()` |
| `RenderPipeline`, `TextureSource`, `packNormalToRGB` (newer releases) | `PostProcessing`, `Source`, `directionToColor` |
| `atan2`, `equals`, `label()`, `cache()`, `.varying()` (deprecated) | `atan`, `equal`, `setName()`, `.isolate()`, `.toVarying()` |
| `DynamicDrawUsage` on instance matrices | the instancing service (`StaticDrawUsage` with update ranges) |

The rest are in docs/THREE-DELTA.md and tools/eslint/banned.ts. When a name is not there and `tsc` accepts it,
check its source in `node_modules/three/src/` before relying on it.
