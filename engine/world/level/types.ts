/**
 * @file The compiled level's shape (PLAN.md WP 2.2, §6.1 "data descriptors"): what `compileLevel` returns, plain data
 * that the level meshes (WP 2.4), the level bodies (WP 3.1), navigation (WP 4.3) and scenes read, with no meshes, no
 * Rapier bodies and no functions in it. Its `format` tag, `my3dge-level/1`, changes only when the shape changes in a
 * way a reader would notice; adding a field is not such a change (WP 4.2 added the per-tile characters, ramps, daises,
 * hull and cylinder colliders that way).
 *
 * Coordinates (PLAN.md §6.3): metres, +Y up, the ground the XZ plane. Map column c covers x from c·tile to
 * (c + 1)·tile, and map row r (row 0 the first, north, row) covers z from r·tile to (r + 1)·tile, so the map reads as
 * a top-down view with +X to the right and +Z down the page. The level's north-west corner is the origin.
 *
 * Invariants: per-tile arrays are row-major (index r · cols + c) and `cols · rows` long, the heights sampled at each
 * tile's centre; lists come in a fixed order (colliders and meshes by glyph id, each one's boxes in the greedy merge's
 * order; ramps, daises, spawns and lights in reading order), so equal text and legend give equal data, and equal
 * hashes (`hashValue`, engine/core/hash.ts). A compiled level is frozen all the way down.
 *
 * @example
 * const rect: TileRect = [2, 3, 4, 3]; // columns 2–4 of row 3, inclusive
 * LEVEL_FORMAT; // 'my3dge-level/1'
 * @see engine/world/level/compile.test.ts
 */

/** The format tag of a compiled level. */
export const LEVEL_FORMAT = 'my3dge-level/1';

/** A rectangle of tiles, inclusive: `[col0, row0, col1, row1]`. */
export type TileRect = readonly [col0: number, row0: number, col1: number, row1: number];

/** A point in metres: `[x, y, z]`. */
export type Point3 = readonly [x: number, y: number, z: number];

/** One glyph as the level used it: the `glyph` entry's fields (engine/world/level/glyph.ts) and its id. */
export interface LevelGlyph {
  readonly id: string;
  readonly char: string;
  readonly description: string;
  /** The walkable surface's height on its tiles (m). */
  readonly floor: number;
  /** The top of what stands on its tiles (m). */
  readonly top: number;
  readonly solid: boolean;
  /** The collider recipe: `'none'`, `'box'`, `'hull'` or `'cylinder'`. */
  readonly collider: string;
  /** How its floor runs: `'flat'`, `'ramp'` (rising from floor to top toward one side) or `'dais'`. */
  readonly floorShape: string;
  /** A dais's sloped edge, measured across (m). */
  readonly edge: number;
  /** A cylinder collider's radius (m). */
  readonly radius: number;
  /** The mesh recipe, or `'none'`. */
  readonly mesh: string;
  readonly nav: { readonly walkable: boolean; readonly standable: boolean };
  /** The spawn name its tiles mark, or `''`. */
  readonly spawn: string;
  /** The light-spot tag its tiles hold, or `''`. */
  readonly light: string;
  /** The light spot's height above the tile's top (m). */
  readonly lightHeight: number;
  readonly surface: string;
  /** A ladder stands on its tiles (WP 13.7: engine/world/traverse.ts's `levelLadders`). */
  readonly ladder: boolean;
  /** Its footprint in tiles (a pillar 2). */
  readonly footprint: number;
}

/** An axis-aligned box collider (Rapier's cuboid: half extents `(max − min)/2`, centred at `(min + max)/2`). */
export interface BoxCollider {
  readonly shape: 'box';
  /** The glyph whose tiles it covers. */
  readonly glyph: string;
  readonly surface: string;
  /** The low corner (m): the ground (y 0) under the rectangle's north-west corner. */
  readonly min: Point3;
  /** The high corner (m): the glyph's top over the rectangle's south-east corner. */
  readonly max: Point3;
  /** The tiles it covers. */
  readonly tiles: TileRect;
}

/** A convex hull collider (Rapier's convex hull of its points): a ramp's wedge or a dais's frustum, from the ground. */
export interface HullCollider {
  readonly shape: 'hull';
  readonly glyph: string;
  readonly surface: string;
  /** Its corners (m): on the ground (y 0) and on the slope's edges. */
  readonly points: readonly Point3[];
  /** The tiles of the ramp or the dais it stands under (a dais's bounding rectangle). */
  readonly tiles: TileRect;
}

/** An upright cylinder collider (Rapier's cylinder, three.js's CylinderGeometry): one per tile, at its centre. */
export interface CylinderCollider {
  readonly shape: 'cylinder';
  readonly glyph: string;
  readonly surface: string;
  /** Its centre (m), half its height above the glyph's floor. */
  readonly center: Point3;
  readonly radius: number;
  /** Its full height (m): from the glyph's floor to its top. */
  readonly height: number;
  /** Its tile. */
  readonly tiles: TileRect;
}

/** A collider descriptor: a merged box, a hull or a cylinder, by `shape`. */
export type ColliderDescriptor = BoxCollider | HullCollider | CylinderCollider;

/** A compass side of a block: north is −Z (row 0's edge), south +Z, west −X, east +X. */
export type Side = 'north' | 'south' | 'west' | 'east';

/**
 * A ramp: a filled rectangle of a ramp glyph's tiles (stairs) whose floor rises in a straight slope from `bottom`
 * along the side opposite `rises` to `top` along `rises`, the side whose neighbours stand at its top (a gallery).
 */
export interface RampDescriptor {
  readonly glyph: string;
  readonly surface: string;
  readonly tiles: TileRect;
  /** The side it rises toward. */
  readonly rises: Side;
  /** Its height at its low edge (m): the glyph's floor. */
  readonly bottom: number;
  /** Its height at its high edge (m): the glyph's top. */
  readonly top: number;
}

/**
 * A dais: an octagonal frustum (faces toward the axes and the diagonals) standing on a block of a dais glyph's tiles.
 * Its base's faces stand half a tile outside the block's bounding square, so its tiles are those whose centres it
 * covers; its sloped edge rises from `bottom` at the base to `top`, `edge` metres in from the base all round.
 */
export interface DaisDescriptor {
  readonly glyph: string;
  readonly surface: string;
  /** The block's bounding square. */
  readonly tiles: TileRect;
  /** Its centre on the ground (m): `[x, z]`. */
  readonly center: readonly [x: number, z: number];
  /** The distance from the centre to the base's faces (m). */
  readonly baseRadius: number;
  /** The distance from the centre to the top's faces (m): `baseRadius − edge`. */
  readonly topRadius: number;
  /** Its height at the base (m): the glyph's floor. */
  readonly bottom: number;
  /** Its height on top (m): the glyph's top. */
  readonly top: number;
}

/** The slab under the whole level: the ground's collider, one tile wider than the map all round, 1 m deep. */
export interface GroundDescriptor {
  readonly min: Point3;
  readonly max: Point3;
}

/** What the level meshes (WP 2.4) build for one recipe at one height: the tiles, merged and as pieces. */
export interface MeshDescriptor {
  /** The mesh recipe (`'floor'`, `'wall'`, `'lowWall'`, `'pillar'`…). */
  readonly recipe: string;
  /** The glyphs whose tiles it draws, by id, sorted. */
  readonly glyphs: readonly string[];
  readonly surface: string;
  /**
   * The height its pieces stand on (m): the ground (0) for glyphs whose box or hull collider rises from it (a gallery
   * is a block from the ground to its floor), else their floor.
   */
  readonly bottom: number;
  /** The height of their tops (m). */
  readonly top: number;
  /** The footprint of one piece, in tiles. */
  readonly footprint: number;
  /** One rectangle per piece (a tile, or a footprint square: one pillar), in reading order. */
  readonly pieces: readonly TileRect[];
  /** The same tiles merged into few rectangles (greedy, rows first). */
  readonly rects: readonly TileRect[];
}

/** A spawn point: a tile's centre, on its floor. */
export interface SpawnPoint {
  /** `spawn:<name>`; several tiles may share one. */
  readonly id: string;
  readonly name: string;
  readonly glyph: string;
  readonly col: number;
  readonly row: number;
  readonly position: Point3;
}

/** A light spot: a tile's centre, `lightHeight` above its top. */
export interface LightSpot {
  readonly tag: string;
  readonly glyph: string;
  readonly col: number;
  readonly row: number;
  readonly position: Point3;
}

/** A compiled level: the map, its legend, per-tile grids and descriptors; see the file comment. */
export interface CompiledLevel {
  readonly format: typeof LEVEL_FORMAT;
  /** The level's name (a file's name without `.txt`). */
  readonly name: string;
  readonly description: string;
  /** Metres per map character. */
  readonly tile: number;
  /** Map columns (along +X) and rows (along +Z). */
  readonly cols: number;
  readonly rows: number;
  /** The map as written, north row first. */
  readonly map: readonly string[];
  /** The glyphs the map uses, keyed by character. */
  readonly legend: { readonly [char: string]: LevelGlyph };
  /** Per tile: its character, a key of `legend`. */
  readonly tiles: readonly string[];
  /** Per tile: solid (blocks movement at ground level). */
  readonly solid: readonly boolean[];
  /** Per tile: walkable at its floor height. */
  readonly walkable: readonly boolean[];
  /** Per tile: the walkable surface's height at its centre (m); floorHeight answers anywhere. */
  readonly floor: readonly number[];
  /** Per tile: the top of what stands at its centre (m); topHeight answers anywhere. */
  readonly top: readonly number[];
  /** The level's extent (m): from the origin to (cols·tile, the highest top, rows·tile). */
  readonly bounds: { readonly min: Point3; readonly max: Point3 };
  readonly ground: GroundDescriptor;
  readonly colliders: readonly ColliderDescriptor[];
  /** The ramps (stairs), by glyph id, then in reading order. */
  readonly ramps: readonly RampDescriptor[];
  /** The daises, by glyph id, then in reading order. */
  readonly daises: readonly DaisDescriptor[];
  readonly meshes: readonly MeshDescriptor[];
  readonly spawns: readonly SpawnPoint[];
  readonly lights: readonly LightSpot[];
}
