/**
 * @file Where on a tile a site's navigation walks a body (PLAN.md WP 13.15, WP 13.18; engine/world/siteNav.ts): its
 * clear point. `clearOffset` looks, every 5 cm (`CLEAR_SAMPLES`) within `keep` of the tile's centre (a body's radius and a
 * margin), for the nearest point at least `keep` from every tile round it a body cannot walk onto and every block
 * standing there: a tile closed in its own grid (a wall, a void), a side's neighbour more than `climb` above or below
 * it (a ledge, a drop), a ladder's foot (`ladders`: pushed into, a ladder takes hold), but never one a link crosses
 * into (`entered`: a flight's top, a ladder's, a doorway out to the terrain), and a scene's block (`NavBlock`: a
 * prop's own box, not the margin the graph closes round it). Where no point is that far
 * from them all (a gap narrower than the body), it takes the one farthest from them. So the shooter's 0.81 m hull
 * passes a 1 m doorway midway between its jambs, rounds a wall's corner clear of it, and climbs a flight off its open
 * side.
 *
 * `clearPoints` gives every node of a site's graph its clear point, found once, the tiles its links cross into open.
 *
 * Invariants: pure functions of their inputs; the samples go in a fixed order, the nearest to the centre winning a tie.
 *
 * @example
 * import { compileLevel } from './level/compile';
 * import { NavGrid } from './nav';
 * const room = compileLevel('---\ntile: 0.25\n---\n######\n#....#\n#....#\n#....#\n#....#\n######\n');
 * const grid = new NavGrid(room, { radius: 0.1 });
 * clearOffset(grid, room.walkable, 7, { keep: 0.45, climb: 0.5 }); // [0.35, 0.35]: 0.45 m off both walls of its corner
 * @see engine/world/siteNavClear.test.ts
 */
import { Vector3 } from '../core/math';
import type { NavGrid } from './nav';
import type { NavBlock } from './siteNavGrids';

/** How finely `clearOffset` samples a tile for its clear point: samples a metre (every 5 cm). */
export const CLEAR_SAMPLES = 20;

/** What `clearOffset` keeps clear of (see the file comment). */
export interface ClearOptions {
  /** How far the body's centre keeps from what it cannot walk into (m): its radius and a margin. */
  keep: number;
  /** The most a side's step climbs or drops and still counts as walked (m). */
  climb: number;
  /** The scene's blocks, and how tall the body stands over its floor (m) for one to count. */
  blocks?: readonly NavBlock[];
  stand?: number;
  /** Per tile of the grid, 1 where a link crosses into it: open whatever it is. */
  entered?: ArrayLike<number>;
  /** Per tile of the grid, 1 where a ladder stands: kept clear of as a wall is (a body pushing into one takes hold). */
  ladders?: ArrayLike<number>;
}

/**
 * `tile`'s clear point on `grid` as an offset from its centre (m; see the file comment); `own` is each tile's
 * openness in its own grid, before the blocks closed any.
 */
export function clearOffset(
  grid: NavGrid,
  own: ArrayLike<boolean>,
  tile: number,
  options: ClearOptions,
): [number, number] {
  const { keep, climb, blocks = [], stand = Infinity, entered, ladders } = options;
  const { cols, rows, tile: size } = grid;
  const floors = grid.level.floor;
  const [c0, r0] = [tile % cols, Math.floor(tile / cols)];
  const floor = floors[tile];
  const reach = Math.ceil((2 * keep + size / 2) / size);
  const boxes: number[] = []; // west, north, east and south edges (m) off the centre
  for (let r = r0 - reach; r <= r0 + reach; r++) {
    for (let c = c0 - reach; c <= c0 + reach; c++) {
      const [dc, dr, t] = [c - c0, r - r0, r * cols + c];
      const inside = c >= 0 && r >= 0 && c < cols && r < rows;
      if ((!dc && !dr) || (inside && entered?.[t])) continue;
      const side = Math.abs(dc) + Math.abs(dr) === 1;
      if (!inside || !own[t] || ladders?.[t] || (side && Math.abs(floors[t] - floor) > climb)) boxes.push((dc - 0.5) * size, (dr - 0.5) * size, (dc + 0.5) * size, (dr + 0.5) * size); // prettier-ignore
    }
  }
  const centre = grid.center(tile);
  for (const { min, max } of blocks) {
    if (max[1] <= floor + 0.05 || min[1] >= floor + stand) continue;
    const box = [min[0] - centre.x, min[2] - centre.z, max[0] - centre.x, max[2] - centre.z];
    if (box[0] < 2 * keep && box[1] < 2 * keep && box[2] > -2 * keep && box[3] > -2 * keep) boxes.push(...box);
  }
  const n = Math.ceil(keep * CLEAR_SAMPLES - 1e-9);
  let [bx, bz, best, near] = [0, 0, -1, Infinity];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const [px, pz] = [i / CLEAR_SAMPLES, j / CLEAR_SAMPLES];
      let clear = keep;
      for (let b = 0; b < boxes.length && clear > 0; b += 4) {
        const dx = Math.max(boxes[b] - px, 0, px - boxes[b + 2]);
        const dz = Math.max(boxes[b + 1] - pz, 0, pz - boxes[b + 3]);
        clear = Math.min(clear, Math.sqrt(dx * dx + dz * dz));
      }
      const far = px * px + pz * pz;
      if (clear > best + 1e-9 || (clear > best - 1e-9 && far < near)) [bx, bz, best, near] = [px, pz, clear, far];
    }
  }
  return [bx, bz];
}

/** What `clearPoints` reads of a site's graph: its grids, each one's tiles open in its own surface, its links. */
export interface ClearGraph {
  readonly grids: readonly { readonly grid: NavGrid; readonly offset: number }[];
  readonly owns: readonly ArrayLike<boolean>[];
  readonly links: readonly (readonly [number, number])[];
  readonly nodes: number;
}

/**
 * Every node's clear point on a site's graph (engine/world/siteNav.ts), each found once: a function giving a node's on
 * its floor (m). The tiles each grid's links cross into count as open (`entered`), and the lower end of a link whose
 * floors stand more than a climb apart is a ladder's foot (`ladders`).
 */
export function clearPoints(
  graph: ClearGraph,
  options: Omit<ClearOptions, 'entered' | 'ladders'>,
): (node: number, out?: Vector3) => Vector3 {
  // prettier-ignore
  const { grids, owns, links, nodes } = graph;
  const where = (node: number) => {
    let g = grids.length - 1;
    while (g > 0 && grids[g].offset > node) g--;
    return { g, tile: node - grids[g].offset };
  };
  const entered = grids.map(({ grid }) => new Uint8Array(grid.cols * grid.rows));
  const ladders = grids.map(({ grid }) => new Uint8Array(grid.cols * grid.rows));
  const at = new Vector3();
  const floor = ({ g, tile }: { g: number; tile: number }) => grids[g].grid.level.floor[tile];
  for (const [a, b] of links) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const [f, t] = [where(from), where(to)];
      grids[t.g].grid.center(t.tile, at);
      const tile = grids[f.g].grid.cellAt(at.x, at.z);
      if (tile >= 0) entered[f.g][tile] = 1;
      if (floor(t) - floor(f) > options.climb) ladders[f.g][f.tile] = 1;
    }
  }
  const offsets = new Float64Array(2 * nodes).fill(NaN); // x and z off each centre, once found
  return (node, out = new Vector3()) => {
    const { g, tile } = where(node);
    if (Number.isNaN(offsets[2 * node])) {
      [offsets[2 * node], offsets[2 * node + 1]] = clearOffset(grids[g].grid, owns[g], tile, { ...options, entered: entered[g], ladders: ladders[g] }); // prettier-ignore
    }
    grids[g].grid.center(tile, out);
    return out.set(out.x + offsets[2 * node], out.y, out.z + offsets[2 * node + 1]);
  };
}
