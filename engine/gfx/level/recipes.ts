/**
 * @file Level mesh recipes (PLAN.md WP 2.4): how the level meshes (engine/gfx/level/meshes.ts) draw the tiles of a
 * glyph whose `mesh` names a recipe (engine/world/level/legend.ts). A recipe is data: its shape, its materials by id
 * and whether it casts and receives shadows.
 *
 * Shapes:
 * - `surface`: one welded surface over the pieces at their bottom height, facing up, UVs in metres along X and -Z
 *   (one draw call): the floor.
 * - `block`: a box per piece from its bottom to its top, every piece one instance of an `InstancedMesh`, its faces
 *   in two draw groups, sides then tops (two draw calls however many pieces): walls, low walls, pillars. A block
 *   whose top is not above its bottom is drawn as a surface.
 *
 * The v1 recipes: `floor` (flagstones), `wall` (brick sides, dressed-stone tops), `lowWall` and `pillar` (dressed
 * stone). WP 4.4 adds stairs, galleries, the dais and pillars with plinths and capitals. A game's own glyph meshes
 * come as recipes passed to `createLevelMeshes` (`recipes`), never edits here.
 *
 * Invariants: plain data; `materials` holds one id for a surface, and two (sides, then tops: two draw calls) or one
 * (the whole box: one draw call) for a block; a recipe nobody defined draws as `FALLBACK_RECIPE`, with advice
 * (`GFX_LEVEL_RECIPE`).
 *
 * @example
 * LEVEL_RECIPES.wall.materials; // ['material:brick', 'material:stone']
 * LEVEL_RECIPES.floor.shape; // 'surface'
 * @see engine/gfx/level/meshes.test.ts
 */

/** How a recipe draws its pieces: see the file comment. */
export type LevelShape = 'surface' | 'block';

/** A level mesh recipe: its shape, materials and shadows. */
export interface LevelRecipe {
  shape: LevelShape;
  /** Material ids: [the surface's] for a surface; [the sides', the tops'] for a block, or one for the whole box. */
  materials: readonly string[];
  castShadow: boolean;
  receiveShadow: boolean;
}

/** The engine's v1 recipes, by the name a glyph's `mesh` gives. */
export const LEVEL_RECIPES: Readonly<Record<string, LevelRecipe>> = {
  floor: { shape: 'surface', materials: ['material:flagstone'], castShadow: false, receiveShadow: true },
  wall: { shape: 'block', materials: ['material:brick', 'material:stone'], castShadow: true, receiveShadow: true },
  lowWall: { shape: 'block', materials: ['material:stone', 'material:stone'], castShadow: true, receiveShadow: true },
  pillar: { shape: 'block', materials: ['material:stone', 'material:stone'], castShadow: true, receiveShadow: true },
};

/** What a recipe nobody defined draws: grey blocks (`material:default`), casting and receiving shadows. */
export const FALLBACK_RECIPE: LevelRecipe = {
  shape: 'block',
  materials: ['material:default', 'material:default'],
  castShadow: true,
  receiveShadow: true,
};
