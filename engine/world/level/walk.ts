/**
 * @file Where bodies walk on a level (PLAN.md WP 2.2, WP 4.2, I-22): the steps between neighbouring walkable tiles and
 * the areas they make, for validate.ts's reachability checks (and a model for navigation, WP 4.3). `canStep` says
 * whether a body walks from one tile's centre to a neighbour's: neither may be unwalkable, and the floor along the
 * line between them (floorHeight, sampled every eighth of the way) never rises more than the climb limit from one
 * sample to the next. So stairs and a dais's edge climb gently, while a gallery's edge is a wall from below and a drop
 * from above: where floors differ, steps go one way. `walkAreas` groups the walkable tiles into areas whose tiles
 * reach each other both ways (strongly connected, through the 4 neighbours).
 *
 * Invariants: pure functions of the level and the limit. Areas come in reading order of their first tile, so the same
 * level gives the same areas. The search keeps its own stack (no recursion), however large the map.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:126-142` (`PASS`: the walkable grid's steps, sampled at 8
 * points, up at most `CLIMB`, down anywhere), through the 4 neighbours, in metres.
 *
 * @example
 * import { compileLevel } from './compile';
 * const level = compileLevel('#####\n#.=.#\n#####\n');
 * [canStep(level, 2, 1, 1, 0, 0.2), canStep(level, 1, 1, 1, 0, 0.2)]; // [true, false]: down off the gallery, not up
 * walkAreas(level, 0.2).areas.map((area) => area.tiles); // [1, 1, 1]: nobody walks back up onto it
 * @see engine/world/level/walk.test.ts
 */
import { floorHeight, type HeightSource } from './heights';

/** How many points along a step `canStep` samples the floor at. */
export const STEP_SAMPLES = 8;

/** The four neighbours, in a fixed order: east, west, south, north. */
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Whether the tile at index `i` is walkable: its glyph says so. */
const walkableAt = (level: HeightSource, i: number) => level.legend[level.tiles[i]].nav.walkable;

/**
 * Whether a body walks from the centre of tile (col, row) to the centre of tile (col + dc, row + dr), climbing at most
 * `climb` metres between samples. False when either tile is unwalkable or off the map.
 */
export function canStep(level: HeightSource, col: number, row: number, dc: number, dr: number, climb: number): boolean {
  const [toCol, toRow] = [col + dc, row + dr];
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < level.cols && r < level.rows;
  if (!inside(col, row) || !inside(toCol, toRow)) return false;
  if (!walkableAt(level, row * level.cols + col) || !walkableAt(level, toRow * level.cols + toCol)) return false;
  const t = level.tile;
  let height = floorHeight(level, (col + 0.5) * t, (row + 0.5) * t);
  for (let s = 1; s <= STEP_SAMPLES; s++) {
    const next = floorHeight(
      level,
      (col + 0.5 + (dc * s) / STEP_SAMPLES) * t,
      (row + 0.5 + (dr * s) / STEP_SAMPLES) * t,
    );
    if (next - height > climb) return false;
    height = next;
  }
  return true;
}

/** An area of tiles that reach each other both ways: its first tile in reading order and its tile count. */
export interface WalkArea {
  first: readonly [col: number, row: number];
  tiles: number;
}

/** The areas of `level`'s walkable tiles under the climb limit, and the area index of every tile (−1 if unwalkable). */
export function walkAreas(level: HeightSource, climb: number): { areas: WalkArea[]; areaOf: Int32Array } {
  const { cols, rows } = level;
  const n = cols * rows;
  const steps = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [col, row] = [i % cols, Math.floor(i / cols)];
    NEIGHBOURS.forEach(([dc, dr], k) => {
      if (canStep(level, col, row, dc, dr, climb)) steps[i] |= 1 << k;
    });
  }
  const component = strongComponents(cols, n, (i) => walkableAt(level, i), steps);
  // Number the components in reading order of their first tile.
  const order = new Map<number, number>();
  const areas: WalkArea[] = [];
  const areaOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (component[i] < 0) continue;
    let area = order.get(component[i]);
    if (area === undefined) {
      area = areas.length;
      order.set(component[i], area);
      areas.push({ first: [i % cols, Math.floor(i / cols)], tiles: 0 });
    }
    areaOf[i] = area;
    areas[area].tiles++;
  }
  return { areas, areaOf };
}

/** Tarjan's strongly connected components over the tiles, each tile's steps a bit per neighbour; −1 off the graph. */
function strongComponents(cols: number, n: number, node: (i: number) => boolean, steps: Uint8Array): Int32Array {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const component = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  let [counter, components] = [0, 0];
  const visit = (i: number, frames: [number, number][]) => {
    index[i] = low[i] = counter++;
    stack.push(i);
    onStack[i] = 1;
    frames.push([i, 0]);
  };
  for (let start = 0; start < n; start++) {
    if (!node(start) || index[start] >= 0) continue;
    const frames: [number, number][] = [];
    visit(start, frames);
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const [i, k] = frame;
      if (k < NEIGHBOURS.length) {
        frame[1]++;
        if (!(steps[i] & (1 << k))) continue;
        const j = i + NEIGHBOURS[k][1] * cols + NEIGHBOURS[k][0];
        if (index[j] < 0) visit(j, frames);
        else if (onStack[j]) low[i] = Math.min(low[i], index[j]);
        continue;
      }
      frames.pop();
      if (frames.length) {
        const parent = frames[frames.length - 1][0];
        low[parent] = Math.min(low[parent], low[i]);
      }
      if (low[i] !== index[i]) continue;
      for (let j = -1; j !== i;) {
        j = stack.pop() as number;
        onStack[j] = 0;
        component[j] = components;
      }
      components++;
    }
  }
  return component;
}
