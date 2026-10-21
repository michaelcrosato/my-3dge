/**
 * @file The compiled level's shape (PLAN.md WP 2.2, WP 13.13, §6.1 "data descriptors"): what `compileLevel` returns,
 * plain data that the level meshes (WP 2.4), the level bodies (WP 3.1), navigation (WP 4.3) and scenes read, with no
 * meshes, no Rapier bodies and no functions in it. Its `format` tag, `my3dge-level/1`, changes only when the shape
 * changes in a way a reader would notice; adding a field is not such a change (WP 4.2 added the per-tile characters,
 * ramps, daises, hull and cylinder colliders that way). A level written as storeys (format 2, docs/PLAYGROUND.md
 * §6.1) compiles to `my3dge-level/2`: the same fields, with its storeys, rooms, openings and roofs beside them.
 *
 * A format-2 level's format-1 fields are those of its ground storey (the one standing at 0, else the lowest) where
 * they are per tile or drawn (`map`, `tiles`, `solid`, `walkable`, `floor`, `top`, `ramps`, `daises`, `meshes`), so a
 * reader of one storey reads the ground floor; and they cover every storey where they are about the whole level
 * (`bounds`, `ground`, `colliders`, `spawns`, `lights`). `storeys` holds each storey's own (engine/world/level/
 * storeys.ts's `storeyView` makes any storey read as a format-1 level).
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
 * LEVEL_FORMAT_2; // 'my3dge-level/2'
 * @see engine/world/level/compile.test.ts
 */

/** The format tag of a compiled level. */
export const LEVEL_FORMAT = 'my3dge-level/1';

/** The format tag of a compiled level written as storeys (WP 13.13). */
export const LEVEL_FORMAT_2 = 'my3dge-level/2';

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
  /** Format 2 (absent from a format-1 level's legend): no floor on its tiles (engine/world/level/glyph.ts). */
  readonly void?: boolean;
  /** Format 2: its box rises to the storey above. */
  readonly full?: boolean;
  /** Format 2: `'door'`, `'window'` or `'none'`. */
  readonly opening?: string;
  /** Format 2: a solid from this height over its floor to the storey's full top (m); 0 for none. */
  readonly head?: number;
  /** Format 2: the room it marks, or ''. */
  readonly room?: string;
}

/**
 * What a format-2 collider holds up beyond its glyph (absent on a glyph's own): `'slab'` a storey's floor (its glyph
 * `''`), `'head'` the wall over an opening or a low ceiling, `'roof'` a roof's slab (its glyph `''`).
 */
export type ColliderPart = 'slab' | 'head' | 'roof';

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
  /** Format 2: its storey (an index into `storeys`). */
  readonly storey?: number;
  readonly part?: ColliderPart;
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
  /** Format 2: its storey (an index into `storeys`). */
  readonly storey?: number;
  readonly part?: ColliderPart;
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
  /** Format 2: its storey (an index into `storeys`). */
  readonly storey?: number;
  readonly part?: ColliderPart;
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
  /** Format 2: its storey (an index into `storeys`). */
  readonly storey?: number;
}

/** A light spot: a tile's centre, `lightHeight` above its top. */
export interface LightSpot {
  readonly tag: string;
  readonly glyph: string;
  readonly col: number;
  readonly row: number;
  readonly position: Point3;
  /** Format 2: its storey (an index into `storeys`). */
  readonly storey?: number;
  /** Format 2: the room it stands in (`room:<name>`), its light group (WP 13.15); '' outside every room. */
  readonly room?: string;
}

/** One storey of a format-2 level (WP 13.13): its heights and its own grids and descriptors, heights absolute. */
export interface StoreyDescriptor {
  /** Its name (`storey: ground`) and its index, from 0 at the lowest. */
  readonly name: string;
  readonly index: number;
  /** Its floor's height (m). */
  readonly base: number;
  /** Its clear height (m), floor to ceiling; under a pitched roof, floor to the ridge's underside. */
  readonly height: number;
  /** Its floor slab's thickness (m): the gap under its base, 0.3 m under the lowest storey. */
  readonly slab: number;
  /** The height its full glyphs (walls) rise to (m): the next storey's floor, else its ceiling. */
  readonly fullTop: number;
  readonly map: readonly string[];
  readonly tiles: readonly string[];
  readonly solid: readonly boolean[];
  readonly walkable: readonly boolean[];
  /** Per tile: whether it has a floor (a void tile has none). */
  readonly floored: readonly boolean[];
  readonly floor: readonly number[];
  readonly top: readonly number[];
  /** Per tile: the room it is in (an index into `rooms`), or −1. */
  readonly room: readonly number[];
  /** Its ramps, flights of stairs to the storey above among them, by glyph id, then in reading order. */
  readonly ramps: readonly RampDescriptor[];
  readonly daises: readonly DaisDescriptor[];
  readonly meshes: readonly MeshDescriptor[];
}

/** A room: the floor a room marker's tile reaches inside walls and doors (docs/PLAYGROUND.md §6.2). */
export interface RoomDescriptor {
  /** `room:<name>`. */
  readonly id: string;
  readonly name: string;
  /** The marker's glyph and tile. */
  readonly glyph: string;
  readonly marker: readonly [col: number, row: number];
  readonly storey: number;
  /** Its tiles' count, their area (m²) and their bounding rectangle. */
  readonly tiles: number;
  readonly area: number;
  readonly rect: TileRect;
  /** The marker tile's centre, on its floor. */
  readonly position: Point3;
}

/** A door or a window: a filled rectangle of an opening glyph's tiles in a wall. */
export interface OpeningDescriptor {
  readonly kind: 'door' | 'window';
  readonly glyph: string;
  readonly surface: string;
  readonly storey: number;
  readonly tiles: TileRect;
  /** The axis its wall runs along: `'x'` (east to west) or `'z'` (north to south). */
  readonly axis: 'x' | 'z';
  /** Its width along the wall and its depth through it (m). */
  readonly width: number;
  readonly depth: number;
  /** Its bottom and top (m): a door's floor and head, a window's sill and head. */
  readonly bottom: number;
  readonly top: number;
  /** The centre of its bottom (m). */
  readonly center: Point3;
  /** The rooms on its two sides, the lower x or z first (indexes into `rooms`, −1 outside any). */
  readonly rooms: readonly [number, number];
}

/** A roof over a storey (its block's `roof` key): its shape, footprint and heights. */
export interface RoofDescriptor {
  readonly kind: 'gable' | 'hip' | 'flat';
  readonly storey: number;
  readonly surface: string;
  /** The storey's floored tiles' bounds (m), `[x0, z0, x1, z1]`; the roof reaches `eaves` past them. */
  readonly footprint: readonly [x0: number, z0: number, x1: number, z1: number];
  readonly eaves: number;
  /** Its pitch (°), 0 when flat, and the rise per metre run (its tangent). */
  readonly pitch: number;
  readonly slope: number;
  /** The axis its ridge runs along (a hip's: the longer side's). */
  readonly ridge: 'x' | 'z';
  /** Its top's height at the footprint's edge (m): its storey's ceiling (an attic's floor), or a flat roof's top. */
  readonly eave: number;
  /** Its highest point (m). */
  readonly peak: number;
  /** Its slab's depth, measured straight down (m). */
  readonly thickness: number;
}

/** A compiled level: the map, its legend, per-tile grids and descriptors; see the file comment. */
export interface CompiledLevel {
  readonly format: typeof LEVEL_FORMAT | typeof LEVEL_FORMAT_2;
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
  /** The level's extent (m): from the origin to (cols·tile, the highest top, rows·tile); format 2 from its lowest slab's underside, and over a roof's eaves. */
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
  /** Format 2: the storeys, bottom first. */
  readonly storeys?: readonly StoreyDescriptor[];
  /** Format 2: the rooms, by storey, then in reading order of their markers. */
  readonly rooms?: readonly RoomDescriptor[];
  /** Format 2: the doors and windows, by storey, then in reading order. */
  readonly openings?: readonly OpeningDescriptor[];
  /** Format 2: the roofs. */
  readonly roofs?: readonly RoofDescriptor[];
  /** A storey's view (storeys.ts's `storeyView`): its floor's height, where its flat glyphs stand (m). */
  readonly base?: number;
  /** A storey's view: the height its full glyphs rise to (m). */
  readonly fullTop?: number;
}
