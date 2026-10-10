/**
 * @file A level's tile grid (PLAN.md WP 2.2): its size, its tile size and the glyph of each tile, as compile.ts hands
 * it to the descriptor builders (colliders.ts, meshes.ts), with the two questions both ask: which glyphs it holds, in
 * id order, and whether a tile holds one of some glyphs.
 *
 * Invariants: `tiles` is row-major (index row · cols + col), `cols · rows` long; `glyphsOf` sorts by id in code-unit
 * order, never by locale or first appearance, so everything built from it comes in a fixed order.
 *
 * @example
 * import { legendOf } from './glyph';
 * const legend = legendOf();
 * const grid: TileGrid = { cols: 2, rows: 1, tile: 1, tiles: [legend.get('#')!, legend.get('.')!] };
 * glyphsOf(grid).map((glyph) => glyph.id); // ['glyph:floor', 'glyph:wall']
 * holds(grid, [legend.get('#')!])(0, 0); // true
 * @see engine/world/level/compile.test.ts
 */
import type { Glyph } from './glyph';

/** A level's grid: its size, its tile size (m) and each tile's glyph, row-major. */
export interface TileGrid {
  cols: number;
  rows: number;
  tile: number;
  tiles: readonly Glyph[];
}

/** Code-unit order, so sorting never depends on the locale. */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The distinct glyphs of `grid`, by id. */
export function glyphsOf(grid: TileGrid): Glyph[] {
  return [...new Set(grid.tiles)].sort((a, b) => byText(a.id, b.id));
}

/** A predicate: whether tile (col, row) of `grid` holds one of `glyphs`. */
export function holds(grid: TileGrid, glyphs: readonly Glyph[]): (col: number, row: number) => boolean {
  return (col, row) => glyphs.includes(grid.tiles[row * grid.cols + col]);
}
