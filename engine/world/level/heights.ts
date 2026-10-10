/**
 * @file Height and solid queries on a compiled level (PLAN.md WP 2.2, §5.1): `floorHeight(level, x, z)`, the walkable
 * surface's height at a point (the prototype's `floorH`: where feet, spawns and nav stand), `topHeight`, the top of
 * whatever stands there (`topH`: a wall's top over its tiles, for shots and particles), `solidAt` and `tileAt`. Pure
 * functions of the compiled data, so they run sim-side and in presentation alike.
 *
 * v1 heights are constant over each tile (every v1 glyph is flat). WP 4.2 adds stairs and the dais, whose floors
 * slope across their tiles, behind the same functions.
 *
 * Invariants: a point at (x, z) metres is in the tile (⌊x / tile⌋, ⌊z / tile⌋), so a point on a tile edge belongs to
 * the tile east or south of it. Outside the map nobody stands: `solidAt` is true and both heights are 0 (the ground
 * slab's top; engine/world/level/types.ts).
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:104-115` (`floorH`, `topH`), in metres and without the stairs
 * and dais, which arrive with their glyphs (WP 4.2).
 *
 * @example
 * import { compileLevel } from './compile';
 * const level = compileLevel('####\n#.w#\n####\n');
 * [floorHeight(level, 1.5, 1.5), topHeight(level, 2.5, 1.5), topHeight(level, 0.2, 0.2)]; // [0, 0.75, 3]
 * [solidAt(level, 2.5, 1.5), solidAt(level, -1, 0), tileAt(level, 2.5, 1.5)]; // [true, true, { col: 2, row: 1 }]
 * @see engine/world/level/compile.test.ts
 */
import type { CompiledLevel } from './types';

/** The tile under (x, z) metres, or null outside the map. */
export function tileAt(level: CompiledLevel, x: number, z: number): { col: number; row: number } | null {
  const col = Math.floor(x / level.tile);
  const row = Math.floor(z / level.tile);
  if (!(col >= 0 && row >= 0 && col < level.cols && row < level.rows)) return null;
  return { col, row };
}

/** The index of the tile under (x, z) in the per-tile arrays, or −1 outside the map. */
function indexAt(level: CompiledLevel, x: number, z: number): number {
  const at = tileAt(level, x, z);
  return at ? at.row * level.cols + at.col : -1;
}

/** The walkable surface's height (m) at (x, z): its tile's floor; 0 outside the map. */
export function floorHeight(level: CompiledLevel, x: number, z: number): number {
  const i = indexAt(level, x, z);
  return i < 0 ? 0 : level.floor[i];
}

/** The top (m) of whatever stands at (x, z): a wall's top over its tiles, the floor on open ones; 0 outside the map. */
export function topHeight(level: CompiledLevel, x: number, z: number): number {
  const i = indexAt(level, x, z);
  return i < 0 ? 0 : level.top[i];
}

/** Whether (x, z) is in a solid tile (a wall, a pillar, a low wall), or outside the map. */
export function solidAt(level: CompiledLevel, x: number, z: number): boolean {
  const i = indexAt(level, x, z);
  return i < 0 ? true : level.solid[i];
}
