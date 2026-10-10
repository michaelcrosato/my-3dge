/**
 * @file The compiled level's shape (PLAN.md WP 2.2, §6.1 "data descriptors"): what `compileLevel` returns, plain data
 * that the level meshes (WP 2.4), the level bodies (WP 3.1), navigation (WP 4.3) and scenes read, with no meshes, no
 * Rapier bodies and no functions in it. Its `format` tag, `my3dge-level/1`, changes only when the shape changes in a
 * way a reader would notice; adding a field is not such a change (WP 4.2 adds hull colliders and ramps that way).
 *
 * Coordinates (PLAN.md §6.3): metres, +Y up, the ground the XZ plane. Map column c covers x from c·tile to
 * (c + 1)·tile, and map row r (row 0 the first, north, row) covers z from r·tile to (r + 1)·tile, so the map reads as
 * a top-down view with +X to the right and +Z down the page. The level's north-west corner is the origin.
 *
 * Invariants: per-tile arrays are row-major (index r · cols + c) and `cols · rows` long; lists come in a fixed order
 * (colliders and meshes by glyph id, each one's boxes in the greedy merge's order; spawns and lights in reading
 * order), so equal text and legend give equal data, and equal hashes (`hashValue`, engine/core/hash.ts). A compiled
 * level is frozen all the way down.
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
  /** The collider recipe: `'box'` or `'none'` in v1. */
  readonly collider: string;
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

/** A collider descriptor; WP 4.2 adds hull shapes beside the box. */
export type ColliderDescriptor = BoxCollider;

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
  /** The height its pieces stand on (m): their glyphs' floor. */
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
  /** Per tile: solid (blocks movement at ground level). */
  readonly solid: readonly boolean[];
  /** Per tile: walkable at its floor height. */
  readonly walkable: readonly boolean[];
  /** Per tile: the walkable surface's height (m). */
  readonly floor: readonly number[];
  /** Per tile: the top of what stands there (m). */
  readonly top: readonly number[];
  /** The level's extent (m): from the origin to (cols·tile, the highest top, rows·tile). */
  readonly bounds: { readonly min: Point3; readonly max: Point3 };
  readonly ground: GroundDescriptor;
  readonly colliders: readonly ColliderDescriptor[];
  readonly meshes: readonly MeshDescriptor[];
  readonly spawns: readonly SpawnPoint[];
  readonly lights: readonly LightSpot[];
}
