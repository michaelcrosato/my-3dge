/**
 * @file The engine's front page: the public API for pages and tools (PLAN.md §6.1, §6.9, WP 1.6; doctrine: Quality
 * under the hood). A game's pages import only this module, its sim-side code only engine/sim-api.ts, which this module
 * re-exports whole (ESLint's public-API rule enforces both), so game agents never read the internals. docs/API.md is
 * the manual: every public name with its doc comment; docs/ERRORS.md gives every error and advice code with its fix.
 *
 * What is here, beyond the sim API: `createHeadless`, the engine without a page (Node, tests, `x sim`), whose object
 * is the inspector a page publishes as `window.__engine` (`help()` lists its members); `createEngine`, the engine in
 * a page, arrives with WP 2.7.
 *
 * Invariants: a flat list of `export … from` lines, one name per line, grouped by area, and append-only: each WP adds
 * its public names at the end of their area, so parallel lanes merge cleanly (§11.3). Each name is documented where
 * it is declared (`x docs --check` fails one without). No engine module imports this file or engine/sim-api.ts
 * (ESLint's layer rules): the barrels are for game code.
 *
 * @example
 * // labs/box/main.ts
 * // import { createEngine, defineScene } from '../../engine';
 * @see engine/sim-api.ts
 */

// The sim API: everything sim-side game code uses.
export * from './sim-api';

// Headless: the engine without a page, and its inspector (window.__engine in a page).
export { createHeadless } from './app/headless';
export type { Headless } from './app/headless';
export type { HeadlessOptions } from './app/headless';
export type { Inspector } from './dev/inspector';
export type { EngineInfo } from './dev/inspector';
export type { EntitySummary } from './dev/inspector';

// Materials and procedural textures (WP 2.3): materials as data with three.js's classic parameters, seeded tiling
// texture generators and their helpers, the CPU bake, and the page's material library.
export { defineMaterial } from './gfx/materials/material';
export { getMaterial } from './gfx/materials/material';
export type { MaterialEntry } from './gfx/materials/material';
export type { MaterialSpec } from './gfx/materials/material';
export { createMaterialLibrary } from './gfx/materials/library';
export type { MaterialLibrary } from './gfx/materials/library';
export { defineTexture } from './gfx/textures/texture';
export type { TextureEntry } from './gfx/textures/texture';
export type { Texel } from './gfx/textures/types';
export type { TextureContext } from './gfx/textures/types';
export type { TextureSpec } from './gfx/textures/types';
export type { TextureLook } from './gfx/textures/types';
export { bakeTexture } from './gfx/textures/bake';
export type { TextureBake } from './gfx/textures/bake';
export type { TextureRef } from './gfx/textures/bake';
export { cellHash } from './gfx/textures/tile';
export { wrapIndex } from './gfx/textures/tile';
export { palette } from './gfx/textures/tile';
export { pickTone } from './gfx/textures/tile';
export { runningBond } from './gfx/textures/tile';
export { tileNoise } from './gfx/textures/tile';

// Geometry kit and level meshes (WP 2.4): shapes standing on the ground with UVs in metres, the geometry registry
// (props and levels name geometry by id), their QA measures, and a compiled level drawn as meshes.
export { boxGeometry } from './gfx/geometry/box';
export type { BoxOptions } from './gfx/geometry/box';
export { roundedBoxGeometry } from './gfx/geometry/roundedBox';
export type { RoundedBoxOptions } from './gfx/geometry/roundedBox';
export { limbGeometry } from './gfx/geometry/limb';
export type { LimbOptions } from './gfx/geometry/limb';
export { rampGeometry } from './gfx/geometry/ramp';
export type { RampOptions } from './gfx/geometry/ramp';
export { frustumGeometry } from './gfx/geometry/frustum';
export type { FrustumOptions } from './gfx/geometry/frustum';
export { pillarGeometry } from './gfx/geometry/pillar';
export { pillarParts } from './gfx/geometry/pillar';
export type { PillarOptions } from './gfx/geometry/pillar';
export type { PillarPart } from './gfx/geometry/pillar';
export { ringGeometry } from './gfx/geometry/ring';
export type { RingOptions } from './gfx/geometry/ring';
export { sidesThenTops } from './gfx/geometry/groups';
export { mergeGeometries } from './gfx/geometry/groups';
export { defineGeometry } from './gfx/geometry/geometry';
export { getGeometry } from './gfx/geometry/geometry';
export { buildGeometry } from './gfx/geometry/geometry';
export type { GeometryEntry } from './gfx/geometry/geometry';
export type { GeometrySpec } from './gfx/geometry/geometry';
export type { GeometryRef } from './gfx/geometry/geometry';
export { inspectGeometry } from './gfx/geometry/inspect';
export type { GeometryReport } from './gfx/geometry/inspect';
export { createLevelMeshes } from './gfx/level/meshes';
export type { LevelMeshes } from './gfx/level/meshes';
export type { LevelMeshesOptions } from './gfx/level/meshes';
export type { LevelMeshPart } from './gfx/level/meshes';
export type { LevelCell } from './gfx/level/cells';
export { LEVEL_RECIPES } from './gfx/level/recipes';
export type { LevelRecipe } from './gfx/level/recipes';
export type { LevelShape } from './gfx/level/recipes';
