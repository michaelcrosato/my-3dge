/**
 * @file Collider descriptors from a level's tiles (PLAN.md WP 2.2, §5.1 "colliders from text", §6.1 "data
 * descriptors"): plain data saying which boxes the level bodies (WP 3.1, engine/sim/levelBodies.ts) make, with no
 * Rapier here. `levelColliders` merges each box-collider glyph's tiles into boxes from the ground to its top;
 * `groundSlab` is the slab under everything.
 *
 * Invariants: a glyph's boxes cover exactly its tiles, each tile once (the greedy merge of engine/world/level/rects.ts),
 * so the boxes of the solid glyphs cover exactly the solid grid. Colliders come by glyph id, then in the merge's
 * order. Inputs are never changed.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:188-193` (`hallColliders`: the floor slab and the merged boxes
 * of `# P w`), in metres and as descriptors; the hulls for stairs and the dais arrive with WP 4.2.
 *
 * @example
 * import { legendOf } from './glyph';
 * const legend = legendOf();
 * const tiles = [...'#..#..'].map((char) => legend.get(char)!);
 * levelColliders({ cols: 3, rows: 2, tile: 1, tiles }).map((box) => [box.min, box.max]); // [[[0, 0, 0], [1, 3, 2]]]
 * groundSlab({ cols: 3, rows: 2, tile: 1 }); // { min: [-1, -1, -1], max: [4, 0, 3] }
 * @see engine/world/level/compile.test.ts
 */
import { glyphsOf, holds, type TileGrid } from './grid';
import { mergeRects } from './rects';
import type { ColliderDescriptor, GroundDescriptor } from './types';

/** The ground slab's depth below y 0 (m): the prototype's 16 units. */
const GROUND_DEPTH = 1;

/** The box colliders of every glyph whose collider recipe is `'box'`: merged boxes from the ground to its top. */
export function levelColliders(grid: TileGrid): ColliderDescriptor[] {
  const t = grid.tile;
  return glyphsOf(grid)
    .filter((glyph) => glyph.collider === 'box')
    .flatMap((glyph) =>
      mergeRects(grid.cols, grid.rows, holds(grid, [glyph])).map((tiles): ColliderDescriptor => ({
        shape: 'box',
        glyph: glyph.id,
        surface: glyph.surface,
        min: [tiles[0] * t, 0, tiles[1] * t],
        max: [(tiles[2] + 1) * t, glyph.top, (tiles[3] + 1) * t],
        tiles,
      })),
    );
}

/** The slab under the whole level, one tile wider than the map all round, from 1 m down to y 0. */
export function groundSlab(grid: Pick<TileGrid, 'cols' | 'rows' | 'tile'>): GroundDescriptor {
  const t = grid.tile;
  return { min: [-t, -GROUND_DEPTH, -t], max: [(grid.cols + 1) * t, 0, (grid.rows + 1) * t] };
}
