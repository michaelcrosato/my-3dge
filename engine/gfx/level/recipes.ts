/**
 * @file Level mesh recipes (PLAN.md WP 2.4, WP 4.4): how the level meshes (engine/gfx/level/meshes.ts) draw the tiles
 * of a glyph whose `mesh` names a recipe (engine/world/level/legend.ts). A recipe is data: its shape (`LevelShape`,
 * built by engine/gfx/level/shapes.ts), its materials by id, one per slot of the shape, whether it casts and receives
 * shadows, and whether the cutaway (engine/gfx/cutaway.ts) cuts it (`LevelCut`). One material draws a whole shape at
 * once (one draw call); otherwise each slot is its own draw group, a slot past the last material taking the last.
 *
 * The engine's recipes: `floor` (flagstones), `wall` (brick sides, dressed-stone tops, cut to 0.4375 m facing the
 * camera: the prototype's `CUT_H`, 7 units), `lowWall` (dressed stone), `pillar` (dressed stone, with plinth and
 * capital, cut to a 0.875 m stump when blocking: the prototype's 14 units), and v2's `gallery` (brick sides, a
 * flagstone walk), `stairs` (dressed stone), `dais` (a dressed-stone edge, a flagstone top) and `brazier` (a stone
 * stand, glowing coals: WP 4.5's brazier prop adds the flames and the torch). A game's own glyph meshes come as
 * recipes passed to `createLevelMeshes` (`recipes`), never edits here.
 *
 * Invariants: plain data; `materials` holds at least one id; a recipe nobody defined draws as `FALLBACK_RECIPE`,
 * with advice (`GFX_LEVEL_RECIPE`).
 *
 * Carried from the materials and shadows of `my-3d2dge:src/stress-world/10-hall.js:302-405` (the walls and their cut
 * twins, the pillars and their stumps, the galleries, stairs and dais) and `:409-421` (a brazier's base, bowl and
 * coals; no shadow, as its own torch sits on it).
 *
 * @example
 * LEVEL_RECIPES.wall.materials; // ['material:brick', 'material:stone']
 * LEVEL_RECIPES.wall.cut; // { height: 0.4375, when: 'facing' }
 * LEVEL_RECIPES.floor.shape; // 'surface'
 * @see engine/gfx/level/meshes.test.ts
 * @see engine/gfx/level/shapes.test.ts
 */

/**
 * How a recipe draws its pieces, with what each material slot draws:
 * - `surface`: one welded surface over the pieces at their bottom height, facing up, UVs in metres along X and -Z
 *   (one draw call): the floor. [surface]
 * - `block`: a box per piece from its bottom to its top, every piece one instance of an `InstancedMesh`: walls, low
 *   walls. [sides, tops]. A shape other than a slab whose top is not above its bottom is drawn as a surface.
 * - `pillar`: a pillar per piece, a plinth, a shaft and a capital (engine/gfx/geometry/pillar.ts) sized to the
 *   piece's footprint and height, instanced. [sides, tops]
 * - `slab`: one mesh over the pieces from their bottom to their top: a welded top, and sides along the outline only
 *   (a gallery). [sides, top]
 * - `stairs`: each ramp (level.ramps) under the pieces drawn as a flight of steps, two per metre of run, the ramp's
 *   slope through the middle of every tread; one mesh for the descriptor's flights. [risers and sides, treads]
 * - `dais`: each dais (level.daises) under the pieces drawn as its octagonal frustum, the very corners its hull
 *   collider has, with the ground under its tiles where the octagon leaves them bare. [sloped edge, top and ground]
 * - `brazier`: a stone foot and a bowl of glowing coals on each piece, sized to its glyph's radius and top, with the
 *   ground under its tile. [foot and bowl, coals, ground]
 */
export type LevelShape = 'surface' | 'block' | 'pillar' | 'slab' | 'stairs' | 'dais' | 'brazier';

/**
 * When the cutaway cuts a piece: `'facing'`, when the camera stands on the side the piece faces out to (walls);
 * `'blocking'`, when it stands between the camera and what the camera follows (pillars).
 */
export type CutWhen = 'facing' | 'blocking';

/**
 * How the cutaway cuts a recipe's pieces: to a twin `height` metres tall, `when` the view needs it. Only the
 * instanced shapes (`block`, `pillar`) cut.
 */
export interface LevelCut {
  height: number;
  when: CutWhen;
}

/** A level mesh recipe: its shape, materials, shadows and cut. */
export interface LevelRecipe {
  shape: LevelShape;
  /** Material ids, one per slot of the shape (the file comment lists them), or one for the whole shape. */
  materials: readonly string[];
  castShadow: boolean;
  receiveShadow: boolean;
  /** How the cutaway cuts its pieces (`block` and `pillar` only); never, without. */
  cut?: LevelCut;
}

/** The wall's cut twin (m): the prototype's 7 units. */
const WALL_CUT = 0.4375;
/** A pillar's stump (m): the prototype's 14 units, its plinth and the foot of its shaft. */
const PILLAR_STUMP = 0.875;

/** The engine's recipes, by the name a glyph's `mesh` gives. */
export const LEVEL_RECIPES: Readonly<Record<string, LevelRecipe>> = {
  floor: { shape: 'surface', materials: ['material:flagstone'], castShadow: false, receiveShadow: true },
  wall: {
    shape: 'block',
    materials: ['material:brick', 'material:stone'],
    castShadow: true,
    receiveShadow: true,
    cut: { height: WALL_CUT, when: 'facing' },
  },
  lowWall: { shape: 'block', materials: ['material:stone', 'material:stone'], castShadow: true, receiveShadow: true },
  pillar: {
    shape: 'pillar',
    materials: ['material:stone', 'material:stone'],
    castShadow: true,
    receiveShadow: true,
    cut: { height: PILLAR_STUMP, when: 'blocking' },
  },
  gallery: {
    shape: 'slab',
    materials: ['material:brick', 'material:flagstone'],
    castShadow: true,
    receiveShadow: true,
  },
  stairs: { shape: 'stairs', materials: ['material:stone'], castShadow: true, receiveShadow: true },
  dais: { shape: 'dais', materials: ['material:stone', 'material:flagstone'], castShadow: false, receiveShadow: true },
  brazier: {
    shape: 'brazier',
    materials: ['material:stone', 'material:glow', 'material:flagstone'],
    castShadow: false,
    receiveShadow: true,
  },
};

/** What a recipe nobody defined draws: grey blocks (`material:default`), casting and receiving shadows. */
export const FALLBACK_RECIPE: LevelRecipe = {
  shape: 'block',
  materials: ['material:default', 'material:default'],
  castShadow: true,
  receiveShadow: true,
};
