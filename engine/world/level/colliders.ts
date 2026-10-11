/**
 * @file Collider descriptors from a level's tiles (PLAN.md WP 2.2, WP 4.2, §5.1 "colliders from text", §6.1 "data
 * descriptors"): plain data saying which shapes the level bodies (WP 3.1, engine/sim/levelBodies.ts) make, with no
 * Rapier here. `levelColliders` gives, glyph by glyph, each box-collider glyph's tiles merged into boxes from the
 * ground to its top, a hull under each ramp (a wedge) and dais (a frustum) of a hull-collider glyph, and an upright
 * cylinder on each tile of a cylinder-collider glyph; `groundSlab` is the slab under everything.
 *
 * Invariants: a glyph's boxes cover exactly its tiles, each tile once (the greedy merge of engine/world/level/rects.ts),
 * so the boxes of the solid box glyphs cover exactly their solid tiles. A hull's top is the ramp's or the dais's
 * surface (engine/world/level/shapes.ts), so the bodies stand as high as `floorHeight` says. Colliders come by glyph
 * id, then in the merge's order, the ramps' and daises' order, or reading order. Inputs are never changed.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:188-200` (`hallColliders`: the floor slab, the merged boxes of
 * `# P w =`, the stairs' wedges, the dais's frustum and the braziers' cylinders), in metres and as descriptors.
 *
 * @example
 * import { legendOf } from './glyph';
 * const legend = legendOf();
 * const tiles = [...'#..#..'].map((char) => legend.get(char)!);
 * levelColliders({ cols: 3, rows: 2, tile: 1, tiles }).map((c) => [c.shape, c.tiles]); // [['box', [0, 0, 0, 1]]]
 * groundSlab({ cols: 3, rows: 2, tile: 1 }); // { min: [-1, -1, -1], max: [4, 0, 3] }
 * @see engine/world/level/compile.test.ts
 */
import type { Glyph } from './glyph';
import { glyphsOf, holds, type TileGrid } from './grid';
import { mergeRects } from './rects';
import { frustumPoints, wedgePoints } from './shapes';
import type { ColliderDescriptor, DaisDescriptor, GroundDescriptor, RampDescriptor } from './types';

/** The ground slab's depth below y 0 (m): the prototype's 16 units. */
const GROUND_DEPTH = 1;

/** The level's ramps and daises (engine/world/level/shapes.ts), which the hull colliders stand under. */
export interface Slopes {
  readonly ramps: readonly RampDescriptor[];
  readonly daises: readonly DaisDescriptor[];
}

/** The colliders of one glyph, by its collider recipe. */
function glyphColliders(grid: TileGrid, glyph: Glyph, slopes: Slopes): ColliderDescriptor[] {
  const t = grid.tile;
  const { id, surface } = { id: glyph.id, surface: glyph.surface };
  if (glyph.collider === 'box') {
    return mergeRects(grid.cols, grid.rows, holds(grid, [glyph])).map((tiles) => ({
      shape: 'box',
      glyph: id,
      surface,
      min: [tiles[0] * t, 0, tiles[1] * t],
      max: [(tiles[2] + 1) * t, glyph.top, (tiles[3] + 1) * t],
      tiles,
    }));
  }
  if (glyph.collider === 'hull') {
    const ramps = slopes.ramps.filter((ramp) => ramp.glyph === id);
    const daises = slopes.daises.filter((dais) => dais.glyph === id);
    return [
      ...ramps.map((ramp): ColliderDescriptor => ({
        shape: 'hull',
        glyph: id,
        surface,
        points: wedgePoints(ramp, t),
        tiles: ramp.tiles,
      })),
      ...daises.map((dais): ColliderDescriptor => ({
        shape: 'hull',
        glyph: id,
        surface,
        points: frustumPoints(dais),
        tiles: dais.tiles,
      })),
    ];
  }
  if (glyph.collider === 'cylinder') {
    const inside = holds(grid, [glyph]);
    const height = glyph.top - glyph.floor;
    const cylinders: ColliderDescriptor[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if (!inside(col, row)) continue;
        const center = [(col + 0.5) * t, glyph.floor + height / 2, (row + 0.5) * t] as const;
        cylinders.push({
          shape: 'cylinder',
          glyph: id,
          surface,
          center,
          radius: glyph.radius,
          height,
          tiles: [col, row, col, row],
        });
      }
    }
    return cylinders;
  }
  return [];
}

/** The colliders of every glyph with a collider recipe, by glyph id: merged boxes, hulls under `slopes`, cylinders. */
export function levelColliders(grid: TileGrid, slopes: Slopes = { ramps: [], daises: [] }): ColliderDescriptor[] {
  return glyphsOf(grid).flatMap((glyph) => glyphColliders(grid, glyph, slopes));
}

/** The slab under the whole level, one tile wider than the map all round, from 1 m down to y 0. */
export function groundSlab(grid: Pick<TileGrid, 'cols' | 'rows' | 'tile'>): GroundDescriptor {
  const t = grid.tile;
  return { min: [-t, -GROUND_DEPTH, -t], max: [(grid.cols + 1) * t, 0, (grid.rows + 1) * t] };
}
