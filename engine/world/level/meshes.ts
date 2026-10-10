/**
 * @file Mesh descriptors from a level's tiles (PLAN.md WP 2.2, §6.1 "data descriptors"): plain data saying which
 * pieces the level meshes (WP 2.4, engine/gfx/level/) draw, with no three.js here. `levelMeshes` groups the tiles of
 * every glyph with a mesh recipe by recipe, bottom, top, surface and footprint, giving each group its pieces (a tile,
 * or a footprint square: one pillar) and the same tiles merged into few rectangles.
 *
 * Invariants: one descriptor per distinct recipe, bottom, top, surface and footprint (so floor tiles under spawn
 * markers join the floor), in that order of keys; pieces in reading order of their north-west corners; the rects
 * cover exactly the group's tiles. Inputs are never changed.
 *
 * Carried from the meshes of `my-3d2dge:src/stress-world/10-hall.js:253-324` (floor, walls, low walls, pillars),
 * as descriptors: the geometry itself is WP 2.4's.
 *
 * @example
 * import { legendOf } from './glyph';
 * const legend = legendOf();
 * const tiles = [...'#..#..'].map((char) => legend.get(char)!);
 * levelMeshes({ cols: 3, rows: 2, tile: 1, tiles }).map((mesh) => [mesh.recipe, mesh.rects]); // [['floor', [[1, 0, 2, 1]]], ['wall', [[0, 0, 0, 1]]]]
 * @see engine/world/level/compile.test.ts
 */
import type { Glyph } from './glyph';
import { byText, glyphsOf, holds, type TileGrid } from './grid';
import { findBlocks, mergeRects } from './rects';
import type { MeshDescriptor, TileRect } from './types';

/**
 * One rectangle per piece of `glyph` in `grid`: each tile, or with a footprint above 1 each footprint square of its
 * blocks (filled rectangles of whole squares, validate.ts), split row by row.
 */
function piecesOf(grid: TileGrid, glyph: Glyph): TileRect[] {
  const n = glyph.footprint;
  const inside = holds(grid, [glyph]);
  const pieces: TileRect[] = [];
  if (n === 1) {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) if (inside(col, row)) pieces.push([col, row, col, row]);
    }
    return pieces;
  }
  for (const { rect } of findBlocks(grid.cols, grid.rows, inside).blocks) {
    for (let row = rect[1]; row + n - 1 <= rect[3]; row += n) {
      for (let col = rect[0]; col + n - 1 <= rect[2]; col += n) pieces.push([col, row, col + n - 1, row + n - 1]);
    }
  }
  return pieces;
}

/** The mesh descriptors: one per recipe, bottom, top, surface and footprint, for every glyph whose mesh is not 'none'. */
export function levelMeshes(grid: TileGrid): MeshDescriptor[] {
  const groups = new Map<string, Glyph[]>();
  for (const glyph of glyphsOf(grid)) {
    if (glyph.mesh === 'none') continue;
    const key = JSON.stringify([glyph.mesh, glyph.floor, glyph.top, glyph.surface, glyph.footprint]);
    groups.set(key, [...(groups.get(key) ?? []), glyph]);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const [x, y] = [a[0], b[0]];
    return (
      byText(x.mesh, y.mesh) ||
      x.floor - y.floor ||
      x.top - y.top ||
      byText(x.surface, y.surface) ||
      x.footprint - y.footprint
    );
  });
  return ordered.map((glyphs): MeshDescriptor => {
    const [first] = glyphs;
    const pieces = glyphs.flatMap((glyph) => piecesOf(grid, glyph)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return {
      recipe: first.mesh,
      glyphs: glyphs.map((glyph) => glyph.id),
      surface: first.surface,
      bottom: first.floor,
      top: first.top,
      footprint: first.footprint,
      pieces,
      rects: mergeRects(grid.cols, grid.rows, holds(grid, glyphs)),
    };
  });
}
