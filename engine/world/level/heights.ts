/**
 * @file Height, solid and surface queries on a compiled level (PLAN.md WP 2.2, WP 4.2, §5.1): `floorHeight(level, x,
 * z)`, the walkable surface's height at a point (the prototype's `floorH`: where feet, spawns and nav stand),
 * `topHeight`, the top of whatever stands there (`topH`: a wall's top over its tiles, for shots and particles),
 * `surfaceAt`, the surface tag underfoot (footsteps, particles), `solidAt` and `tileAt`. Pure functions of the
 * compiled data, so they run sim-side and in presentation alike.
 *
 * The floor: a flat glyph's floor over its tiles (a gallery 1 m up), a ramp's slope over its rectangle (stairs), and
 * a dais's frustum wherever its base reaches, half a tile past its drawn tiles: the highest of these at the point,
 * exactly the surface the level bodies make. The top: the floor, or a flat glyph's top where it stands higher (a
 * cylinder's only within its radius of the tile's centre).
 *
 * Invariants: a point at (x, z) metres is in the tile (⌊x / tile⌋, ⌊z / tile⌋), so a point on a tile edge belongs to
 * the tile east or south of it. Outside the map nobody stands: `solidAt` is true, both heights are 0 (the ground
 * slab's top; engine/world/level/types.ts) and the surface is ''.
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
 * @see engine/world/level/compile.test.ts
 */
import { daisHeight, rampHeight } from './shapes';
import type { CompiledLevel, DaisDescriptor, LevelGlyph, RampDescriptor } from './types';

/** What the height queries read: a compiled level, or validate.ts's view of one before it compiles. */
export type HeightSource = Pick<CompiledLevel, 'tile' | 'cols' | 'rows' | 'tiles' | 'legend' | 'ramps' | 'daises'>;

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
    glyph.floorShape === 'ramp'
      ? level.ramps.find(({ tiles: [c0, r0, c1, r1] }) => col >= c0 && col <= c1 && row >= r0 && row <= r1)
      : undefined;
  let floor = ramp ? rampHeight(ramp, level.tile, x, z) : glyph.floor;
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
  return Math.max(floor, glyph.top);
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
