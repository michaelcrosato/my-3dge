/**
 * @file Navigation over terrain (PLAN.md WP 10.5): `terrainNavGrid(terrain, options)` is a `NavGrid`
 * (engine/world/nav.ts) over a terrain's cells (engine/world/terrain.ts), from its north-west corner. A cell is open
 * when neither of its triangles rises more than `grade` metres a metre (1, 45°, by default: walls of rock close it),
 * its floor the ground's height at its centre; a step goes to a neighbour when the ground along the line between
 * their centres never rises more than `climb` metres from one of its 8 samples to the next, as on a level
 * (engine/world/level/walk.ts). A terrace's riser is a cell's slope here (heights stand at the corners), so the grade
 * closes a high one and the climb rarely binds.
 *
 * Invariants: derived data, a pure function of the terrain and the options; paths and flow fields answer in world
 * metres, the terrain's own.
 *
 * @example
 * import { makeTerrain } from './terrain';
 * const ground = makeTerrain({ size: [8, 8], origin: [10, 0, 0], hills: [{ at: [18, 4], radius: 4, height: 8 }] });
 * const grid = terrainNavGrid(ground);
 * [grid.cellAt(10.5, 0.5), grid.open[grid.cellAt(10.5, 0.5)], grid.open[grid.cellAt(16.5, 4.5)]]; // [0, 1, 0]: the flank too steep
 * @see engine/world/terrainNav.test.ts
 */
import { NavGrid, type NavGridOptions, type NavSurface } from './nav';
import { terrainHeight, type Terrain } from './terrain';

/** How many samples a step's line takes: a level's (engine/world/level/walk.ts). */
const STEP_SAMPLES = 8;

/** What `terrainNavGrid` takes: a grid's options, and the steepest ground it walks (m a metre; 1 by default). */
export interface TerrainNavOptions extends NavGridOptions {
  grade?: number;
}

/** The walkable surface of `terrain`'s cells (see the file comment). */
export function terrainNavSurface(terrain: Terrain, grade = 1): NavSurface {
  const { cols, rows, cell, origin, heights } = terrain;
  const walkable: boolean[] = [];
  const floor: number[] = [];
  const corner = (c: number, r: number) => heights[r * (cols + 1) + c];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const [h00, h10, h01, h11] = [corner(col, row), corner(col + 1, row), corner(col, row + 1), corner(col + 1, row + 1)]; // prettier-ignore
      // Each triangle's rise a metre (the split of engine/world/terrain.ts): north-west's, then south-east's.
      const a = Math.hypot((h10 - h00) / cell, (h01 - h00) / cell);
      const b = Math.hypot((h11 - h01) / cell, (h11 - h10) / cell);
      walkable.push(a <= grade && b <= grade);
      floor.push(terrainHeight(terrain, origin[0] + (col + 0.5) * cell, origin[2] + (row + 0.5) * cell)!);
    }
  }
  const height = (x: number, z: number) => terrainHeight(terrain, origin[0] + x * cell, origin[2] + z * cell) ?? -Infinity; // prettier-ignore
  return {
    cols,
    rows,
    tile: cell,
    origin: [origin[0], origin[2]],
    walkable,
    floor,
    canStep(col, row, dc, dr, climb) {
      const [to, toRow] = [col + dc, row + dr];
      if (to < 0 || toRow < 0 || to >= cols || toRow >= rows) return false;
      if (!walkable[row * cols + col] || !walkable[toRow * cols + to]) return false;
      let last = height(col + 0.5, row + 0.5);
      for (let s = 1; s <= STEP_SAMPLES; s++) {
        const next = height(col + 0.5 + (dc * s) / STEP_SAMPLES, row + 0.5 + (dr * s) / STEP_SAMPLES);
        if (next - last > climb) return false;
        last = next;
      }
      return true;
    },
  };
}

/** A navigation grid over `terrain`'s cells (see the file comment). */
export function terrainNavGrid(terrain: Terrain, options: TerrainNavOptions = {}): NavGrid {
  const { grade, ...grid } = options;
  return new NavGrid(terrainNavSurface(terrain, grade), grid);
}
