/**
 * @file Height, solid and surface queries on a compiled level (PLAN.md WP 2.2, WP 4.2, WP 13.13, §5.1):
 * `floorHeight(level, x, z)`, the walkable surface's height at a point (the prototype's `floorH`: where feet, spawns
 * and nav stand), `topHeight`, the top of whatever stands there (`topH`: a wall's top over its tiles, for shots and
 * particles), `surfaceAt`, the surface tag underfoot (footsteps, particles), `solidAt` and `tileAt`; and in 3D, for
 * levels written as storeys, `floorBelow(level, x, y, z)` and `surfaceBelow`, the highest surface at or under a point
 * (a storey's floor, a solid's top, a roof, the ground), `storeyAt(level, y)` by height alone, `storeyBelow` by that
 * surface, and `roomAt`. The 2D queries read one storey: a format-1 level, a format-2 level's ground storey, or any
 * storey through `storeyView` (storeys.ts). Pure functions of the compiled data, so they run sim-side and in
 * presentation alike.
 *
 * The floor: a flat glyph's floor over its tiles (a gallery 1 m up), a ramp's slope over its rectangle (stairs), and
 * a dais's frustum wherever its base reaches, half a tile past its drawn tiles: the highest of these at the point,
 * exactly the surface the level bodies make. The top: the floor, or a flat glyph's top where it stands higher (a
 * cylinder's only within its radius of the tile's centre).
 *
 * Invariants: a point at (x, z) metres is in the tile (⌊x / tile⌋, ⌊z / tile⌋), so a point on a tile edge belongs to
 * the tile east or south of it. Outside the map nobody stands: `solidAt` is true, both heights are 0 (the ground
 * slab's top; engine/world/level/types.ts) and the surface is ''. A storey's flat floors stand on its `base`; its ramps,
 * flights and daises are measured absolutely. `floorBelow` counts a surface at most a micrometre above the point.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:101-115` (`octR`, `floorH`, `topH`), in metres, with the
 * stairs and the dais found by shapes.ts rather than written into the function.
 *
 * @example
 * import { compileLevel } from './compile';
 * const level = compileLevel('####\n#.w#\n####\n');
 * [floorHeight(level, 1.5, 1.5), topHeight(level, 2.5, 1.5), topHeight(level, 0.2, 0.2)]; // [0, 0.75, 3]
 * [solidAt(level, 2.5, 1.5), solidAt(level, -1, 0), tileAt(level, 2.5, 1.5)]; // [true, true, { col: 2, row: 1 }]
 * surfaceAt(level, 1.5, 1.5); // 'stone'
 * [floorBelow(level, 1.5, 5, 1.5), floorBelow(level, 2.5, 5, 1.5), storeyAt(level, 5)]; // [0, 0.75, 0]: the floor, the low wall's top
 * @see engine/world/level/compile.test.ts
 */
import { roofHeight, roofUnder } from './roofs';
import { daisHeight, rampHeight } from './shapes';
import type { CompiledLevel, DaisDescriptor, LevelGlyph, RampDescriptor, RoomDescriptor } from './types';

/**
 * What the height queries read: a compiled level, or validate.ts's view of one before it compiles; a storey's view
 * adds its `base` (where its flat floors stand), `fullTop` (where its full glyphs rise to) and its `roofs` (a pitched
 * one clips them).
 */
export type HeightSource = Pick<CompiledLevel, 'tile' | 'cols' | 'rows' | 'tiles' | 'legend' | 'ramps' | 'daises'> &
  Pick<CompiledLevel, 'base' | 'fullTop' | 'roofs'>;

/** The tile under (x, z) metres, or null outside the map. */
export function tileAt(
  level: Pick<CompiledLevel, 'tile' | 'cols' | 'rows'>,
  x: number,
  z: number,
): { col: number; row: number } | null {
  const col = Math.floor(x / level.tile);
  const row = Math.floor(z / level.tile);
  if (!(col >= 0 && row >= 0 && col < level.cols && row < level.rows)) return null;
  return { col, row };
}

/** What stands at (x, z): its tile's glyph, the ramp holding it, the highest dais there and the floor's height. */
function standing(level: HeightSource, x: number, z: number) {
  const at = tileAt(level, x, z);
  if (!at) return null;
  const glyph: LevelGlyph = level.legend[level.tiles[at.row * level.cols + at.col]];
  const [col, row] = [at.col, at.row];
  const ramp: RampDescriptor | undefined =
    glyph.floorShape === 'ramp' || glyph.floorShape === 'flight'
      ? level.ramps.find(({ tiles: [c0, r0, c1, r1] }) => col >= c0 && col <= c1 && row >= r0 && row <= r1)
      : undefined;
  let floor = ramp ? rampHeight(ramp, level.tile, x, z) : (level.base ?? 0) + glyph.floor;
  let dais: DaisDescriptor | undefined;
  for (const each of level.daises) {
    const height = daisHeight(each, x, z);
    if (height > floor) [floor, dais] = [height, each];
  }
  return { at, glyph, floor, dais };
}

/** The walkable surface's height (m) at (x, z): the highest flat floor, ramp or dais there; 0 outside the map. */
export function floorHeight(level: HeightSource, x: number, z: number): number {
  return standing(level, x, z)?.floor ?? 0;
}

/**
 * The top (m) of whatever stands at (x, z): a wall's top over its tiles, a brazier's within its radius, the floor
 * elsewhere; 0 outside the map.
 */
export function topHeight(level: HeightSource, x: number, z: number): number {
  const here = standing(level, x, z);
  if (!here) return 0;
  const { at, glyph, floor } = here;
  if (glyph.floorShape !== 'flat') return floor;
  if (glyph.collider === 'cylinder') {
    const [dx, dz] = [x - (at.col + 0.5) * level.tile, z - (at.row + 0.5) * level.tile];
    if (dx * dx + dz * dz > glyph.radius * glyph.radius) return floor;
  }
  if (glyph.full && level.fullTop !== undefined) return fullTopAt(level, x, z);
  return Math.max(floor, (level.base ?? 0) + glyph.top);
}

/** Where a storey's full glyphs and heads rise to at (x, z): its full top, or under a pitched roof the roof's underside. */
function fullTopAt(level: HeightSource, x: number, z: number): number {
  const roof = level.roofs?.find((each) => each.kind !== 'flat');
  return roof ? Math.min(level.fullTop!, roofUnder(roof, x, z)) : level.fullTop!;
}

/** The surface tag underfoot at (x, z): a dais's where it stands highest, else its tile's glyph's; '' outside the map. */
export function surfaceAt(level: HeightSource, x: number, z: number): string {
  const here = standing(level, x, z);
  return here ? (here.dais?.surface ?? here.glyph.surface) : '';
}

/** Whether (x, z) is in a solid tile (a wall, a pillar, a low wall, a brazier), or outside the map. */
export function solidAt(level: Pick<CompiledLevel, 'tile' | 'cols' | 'rows' | 'solid'>, x: number, z: number): boolean {
  const at = tileAt(level, x, z);
  return at ? level.solid[at.row * level.cols + at.col] : true;
}

/** How far above a point `floorBelow` still counts a surface (m). */
const REACH = 1e-6;

/** Each storey of `level` as a height source, bottom first: a format-1 level is one, standing on 0. */
function storeySources(level: CompiledLevel): HeightSource[] {
  if (!level.storeys) return [level];
  const { tile, cols, rows, legend } = level;
  return level.storeys.map((s) => {
    const roofs = level.roofs?.filter((roof) => roof.storey === s.index);
    return { tile, cols, rows, legend, tiles: s.tiles, ramps: s.ramps, daises: s.daises, base: s.base, fullTop: s.fullTop, roofs }; // prettier-ignore
  });
}

/** What `underfoot` finds: the surface's height and tag, and its storey (−1 for the ground slab and a roof). */
type Underfoot = { height: number; surface: string; storey: number };

/** The highest surface at or under (x, y, z), its surface tag and its storey, or null where nothing is. */
function underfoot(level: CompiledLevel, x: number, y: number, z: number): Underfoot | null {
  let best: Underfoot | null = null;
  const consider = (height: number, surface: string, storey: number) => {
    if (Number.isFinite(height) && height <= y + REACH && (!best || height > best.height)) best = { height, surface, storey }; // prettier-ignore
  };
  const [min, max] = [level.ground.min, level.ground.max];
  if (x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2]) consider(max[1], '', -1);
  storeySources(level).forEach((source, k) => {
    const here = standing(source, x, z);
    if (!here || here.glyph.void) return;
    consider(here.floor, here.dais?.surface ?? here.glyph.surface, k);
    if (here.glyph.solid) consider(topHeight(source, x, z), here.glyph.surface, k);
    if ((here.glyph.head ?? 0) > 0 && source.fullTop !== undefined) consider(fullTopAt(source, x, z), here.glyph.surface, k); // prettier-ignore
  });
  for (const roof of level.roofs ?? []) consider(roofHeight(roof, x, z), roof.surface, -1);
  return best;
}

/**
 * The height (m) of the highest surface at or under (x, y, z): a storey's floor (flat, a ramp, a flight, a dais, under
 * a solid too), the top of a solid standing there (a low wall, a railing, a wall, the head over a door, a window or a
 * low ceiling, even with no floor above it), a roof's top, or the ground slab under the level; null where nothing is
 * (outside the ground slab). For a format-1 level as for one written as storeys.
 */
export function floorBelow(level: CompiledLevel, x: number, y: number, z: number): number | null {
  return underfoot(level, x, y, z)?.height ?? null;
}

/** The surface tag of `floorBelow`'s surface at (x, y, z): '' on the ground slab or where nothing is. */
export function surfaceBelow(level: CompiledLevel, x: number, y: number, z: number): string {
  return underfoot(level, x, y, z)?.surface ?? '';
}

/**
 * The storey a height is in (an index into `level.storeys`): the highest whose floor slab's underside is at or below
 * `y`; 0 below them all, and in a format-1 level, which is one storey.
 */
export function storeyAt(level: CompiledLevel, y: number): number {
  const storeys = level.storeys ?? [];
  for (let k = storeys.length - 1; k > 0; k--) if (storeys[k].base - storeys[k].slab <= y + REACH) return k;
  return 0;
}

/**
 * The storey of the surface `floorBelow` finds at (x, y, z), an index into `level.storeys` (0 in a format-1 level): a
 * flight's tiles are the storey they rise from, all the way to their top, where `storeyAt` already reads the next; −1
 * on a roof, on the ground slab, or over nothing.
 */
export function storeyBelow(level: CompiledLevel, x: number, y: number, z: number): number {
  return underfoot(level, x, y, z)?.storey ?? -1;
}

/**
 * The room at (x, y, z): the room of the tile under it on `storeyBelow`'s storey (a hall's stairs are the hall's to
 * their top), or null (outside every room, on a roof, or a level without rooms).
 */
export function roomAt(level: CompiledLevel, x: number, y: number, z: number): RoomDescriptor | null {
  const storey = level.storeys?.[storeyBelow(level, x, y, z)];
  const at = tileAt(level, x, z);
  if (!storey || !at) return null;
  return level.rooms?.[storey.room[at.row * level.cols + at.col]] ?? null;
}
