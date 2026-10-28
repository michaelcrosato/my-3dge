/**
 * @file The searches over a site's navigation graph (PLAN.md WP 13.15, WP 13.18; engine/world/siteNav.ts builds it).
 * `nodeAt(x, y, z)` finds the node under a point: the open tile with the highest floor at or under it, within the
 * climb limit (a flight's tile reads its centre, so a body on its upper half is still on it, not on the storey above),
 * unless that floor is more than a step below it, where an open tile beside it within a step of its height wins (a
 * body on a hatch's rim); else the nearest open tile of the storey the point is in, else of the terrain.
 * `findPath(from, to)` is Dijkstra over the steps within grids (engine/world/nav.ts: the climb limit and the corners)
 * and the links, the way smoothed by line of sight inside each grid, a step down more than the climb limit costing its
 * drop as well (so a way round beats a jump off a flight's side); `flowField(goal)` gives every node its walking
 * distance to the goal, and `direction` the way down it, across links too, to the next node's clear point (`clearAt`,
 * engine/world/siteNavClear.ts: where a body `radius` round clears what it cannot walk into) not yet reached (nor, in
 * the body's grid, behind it). `crouch` and `rise` look a few nodes along the way: a low ceiling a duck must start
 * before, a ladder whose way leads up. Split from siteNav.ts at its line cap.
 *
 * A flood runs backwards from the goal over each node's steps and links into it, kept as flat arrays (`incoming`). A
 * lazy field (`{ lazy: true }`: the cast's, labs/playground/cast/ways.ts) floods only as far as the searches read it:
 * before `direction`, `crouch` or `rise` reads from a node, its flood runs on, on a heap of its own, until that node and
 * every one no farther from the goal are final (`settle`). Its nodes leave its heap in a full flood's order, only
 * paused, so they answer as on the full field; its other entries are not final yet. The dog following a player
 * across tiles floods a few metres a step, not the block (3–15 ms a flood, about ten a second, before).
 *
 * Invariants: derived data, a pure function of the graph; ties go to the lower node; paths and directions answer in
 * world metres; a lazy field's searches answer exactly as a full one's.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineLevel } from './level/level';
 * import { defineSite, getSite } from './site';
 * import { createSiteNav } from './siteNav';
 * import { defineTerrain } from './terrain';
 * const reg = createRegistry();
 * defineTerrain('terrain:lot', { size: [32, 32] }, reg);
 * defineLevel('level:hut', { text: '#####\n#...#\n#....\n#####\n', file: 'hut.txt' }, reg);
 * defineSite('site:lot', { terrain: 'terrain:lot', structures: [{ level: 'level:hut', at: [4, 0, 4] }] }, reg);
 * const nav = createSiteNav(getSite('site:lot', reg));
 * const [full, lazy] = [nav.flowField([6.5, 0, 6.5]), nav.flowField([6.5, 0, 6.5], { lazy: true })];
 * nav.direction(lazy, 12, 0, 6)!.equals(nav.direction(full, 12, 0, 6)!); // true: the same way in through the door
 * @see engine/world/siteNav.test.ts
 */
import { Vector3 } from '../core/math';
import type { Point3 } from './level/types';
import { NAV_DIRECTIONS } from './nav';
import type { Site } from './site';
import type { SiteNav, SiteNavGrid } from './siteNav';
import { clearPoints } from './siteNavClear';
import type { NavBlock } from './siteNavGrids';
import { siteStructureAt } from './siteQueries';
import { TileHeap } from './tileHeap';

/** How many times its length a step costs where a body must crouch to take it (a crouch-walk's pace against a run). */
export const CROUCH_COST = 2.5;
/** How near a clear point counts as reached (m), and how many nodes on `direction` looks past reached ones. */
const [REACHED, LOOK] = [0.1, 3];
/** How far past a body's radius a clear point keeps it off a side it has no step through (m). */
const CLEAR = 0.04;

/** The graph's searches over `grids` and `links` (see the file comment). */
export function siteNavGraph(
  site: Site,
  grids: SiteNavGrid[],
  links: [number, number][],
  nodes: number,
  { climb, radius, stand, owns, blocked }: { climb: number; radius: number; stand: number; owns: ArrayLike<boolean>[]; blocked: readonly NavBlock[] }, // prettier-ignore
): SiteNav {
  const jumps = new Map<number, number[]>();
  for (const [a, b] of links) {
    jumps.set(a, [...(jumps.get(a) ?? []), b]);
    jumps.set(b, [...(jumps.get(b) ?? []), a]);
  }
  const locate = (node: number) => {
    let g = grids.length - 1;
    while (g > 0 && grids[g].offset > node) g--;
    return { grid: grids[g], tile: node - grids[g].offset };
  };
  const center = (node: number, out = new Vector3()) => {
    const { grid, tile } = locate(node);
    return grid.grid.center(tile, out);
  };
  const [here, there] = [new Vector3(), new Vector3()];
  const clearAt = clearPoints({ grids, owns, links, nodes }, { keep: radius + CLEAR, climb, blocks: blocked, stand });
  /** A step's clear height (m): the ceiling over `to` less the higher of the two floors; Infinity under the sky. */
  const headroom = (from: number, to: number) => {
    const [a, b] = [locate(from), locate(to)];
    const ceiling = b.grid.ceilings?.[b.tile] ?? Infinity;
    const high = ({ grid, tile }: typeof a) => grid.highs?.[tile] ?? grid.grid.level.floor[tile];
    return ceiling - Math.max(high(a), high(b));
  };
  /** Whether a body must crouch to step from `from` to `to`, or to stand on `from` at all. */
  const low = (from: number, to: number) => headroom(from, from) < stand || headroom(from, to) < stand;
  /** Each node a step or a link from `node`, with its cost (m: its length, `CROUCH_COST` times that crouched, and a drop's height past the climb). */ // prettier-ignore
  const next = (node: number, visit: (to: number, length: number) => void) => {
    const { grid, tile } = locate(node);
    const { cols, steps, level } = grid.grid;
    const cost = (to: number, length: number) => visit(to, low(node, to) ? length * CROUCH_COST : length);
    for (let k = 0; k < 8; k++) {
      if (!(steps[tile] & (1 << k))) continue;
      const [dc, dr] = NAV_DIRECTIONS[k];
      const to = tile + dr * cols + dc;
      const drop = Math.max(0, level.floor[tile] - level.floor[to] - climb); // a way round beats a jump off a flight's side
      cost(node + dr * cols + dc, (dc && dr ? Math.SQRT2 : 1) * grid.grid.tile + drop);
    }
    for (const to of jumps.get(node) ?? []) cost(to, center(node, here).distanceTo(center(to, there)));
  };
  /** Every node's steps and links into it, for a flood backwards from a goal: node n's are `from` and `length` at `first[n]` to `first[n + 1]`, in the order `next` gives them. */ // prettier-ignore
  let into: { first: Int32Array; from: Int32Array; length: Float64Array } | null = null;
  const incoming = () => {
    if (into) return into;
    const edges: number[] = []; // each step's to, from and length, in node order
    for (let node = 0; node < nodes; node++) next(node, (to, length) => edges.push(to, node, length));
    const first = new Int32Array(nodes + 1);
    for (let k = 0; k < edges.length; k += 3) first[edges[k] + 1]++;
    for (let n = 0; n < nodes; n++) first[n + 1] += first[n];
    const [at, from, length] = [first.slice(0, nodes), new Int32Array(edges.length / 3), new Float64Array(edges.length / 3)]; // prettier-ignore
    for (let k = 0; k < edges.length; k += 3) {
      const slot = at[edges[k]]++;
      [from[slot], length[slot]] = [edges[k + 1], edges[k + 2]];
    }
    return (into = { first, from, length });
  };
  const heap = new TileHeap(nodes);
  /** The floods lazy fields have still to run, each on a heap of its own. */
  const pending = new WeakMap<Float64Array, TileHeap>();
  /** Takes the nearest node off a flood's `queue` and relaxes the steps and links into it. */
  const relax = (distance: Float64Array, queue: TileHeap) => {
    const { first, from, length } = into!;
    const node = queue.pop();
    for (let k = first[node], end = first[node + 1]; k < end; k++) {
      const through = distance[node] + length[k];
      if (!(through < distance[from[k]])) continue;
      distance[from[k]] = through;
      queue.push(from[k]);
    }
  };
  /** Every node's walking distance to `goal` (m): Dijkstra backwards along the steps and links; a lazy one left to `settle`. */ // prettier-ignore
  const flood = (goal: number, lazy = false): Float64Array => {
    const distance = new Float64Array(nodes).fill(Infinity);
    const queue = lazy ? new TileHeap(nodes) : heap;
    incoming();
    distance[goal] = 0;
    queue.start(distance);
    queue.push(goal);
    if (lazy) pending.set(distance, queue);
    else while (heap.size) relax(distance, heap);
    return distance;
  };
  /** Runs a lazy `field`'s flood on until `node` and every node no farther from its goal are final (see the file comment). */ // prettier-ignore
  const settle = (field: Float64Array, node: number) => {
    const queue = pending.get(field);
    if (!queue) return;
    while (queue.size && !(field[queue.peek()] > field[node])) relax(field, queue);
    if (!queue.size) pending.delete(field);
  };
  /** The neighbour of `node` on its shortest way down `field` (the least distance plus step, ties to the lower node); −1 at the bottom. */
  const downhill = (field: Float64Array, node: number) => {
    let [best, low] = [-1, Infinity];
    next(node, (to, length) => {
      const cost = field[to] + length;
      if (cost < low || (cost === low && to < best)) [best, low] = [to, cost];
    });
    return best >= 0 && field[best] < field[node] ? best : -1;
  };
  const nodeAt = (x: number, y: number, z: number) => {
    let [best, high] = [-1, -Infinity];
    for (const g of grids) {
      const tile = g.grid.cellAt(x, z);
      if (tile < 0 || !g.grid.open[tile]) continue;
      const floor = g.grid.level.floor[tile];
      if (floor <= y + climb && floor > high) [best, high] = [g.offset + tile, floor];
    }
    if (best >= 0 && high >= y - climb) return best;
    // More than a step over the floor found: on a rim (a hatch's, a stairwell's) the body stands on the tile beside it.
    let [rim, near] = [-1, Infinity];
    for (const g of grids) {
      const tile = g.grid.nearestOpen(x, z);
      if (tile < 0 || Math.abs(g.grid.level.floor[tile] - y) > climb) continue;
      g.grid.center(tile, here);
      const d = Math.hypot(here.x - x, here.z - z);
      if (d <= g.grid.tile && d < near) [rim, near] = [g.offset + tile, d];
    }
    if (rim >= 0 || best >= 0) return rim >= 0 ? rim : best;
    const inside = siteStructureAt(site, x, y, z);
    const g = inside
      ? grids.find((each) => each.structure === inside.structure.index && each.storey === inside.storey)
      : grids.find((each) => each.structure < 0);
    if (!g) return -1;
    const tile = g.grid.nearestOpen(x, z);
    return tile < 0 ? -1 : g.offset + tile;
  };
  return {
    grids,
    links,
    nodes,
    nodeAt,
    locate,
    center,
    clearAt,
    findPath(from, to) {
      const [start, goal] = [nodeAt(...from), nodeAt(...to)];
      if (start < 0 || goal < 0) return null;
      const field = flood(goal);
      if (!(field[start] < Infinity)) return null;
      const way: number[] = [];
      for (let node = start; node !== goal && way.length < nodes;) {
        node = downhill(field, node);
        if (node < 0) return null;
        way.push(node);
      }
      return way.length ? smooth(way, from) : [clearAt(goal)];
    },
    flowField: (goal, { lazy = false } = {}) => {
      const node = nodeAt(...goal);
      return node < 0 ? new Float64Array(nodes).fill(Infinity) : flood(node, lazy);
    },
    crouch(field, x, y, z, ahead = 0) {
      let node = nodeAt(x, y, z);
      if (node < 0) return false;
      settle(field, node);
      if (headroom(node, node) < stand) return true;
      const { grid } = locate(node);
      for (let gone = 0; gone <= ahead;) {
        const to = downhill(field, node);
        // A link (a ladder, a flight's top) is crossed standing: crouching on a ladder lets go of it.
        if (to < 0 || locate(to).grid !== grid) return false;
        if (headroom(node, to) < stand) return true;
        gone += center(node, here).distanceTo(center(to, there));
        node = to;
      }
      return false;
    },
    rise(field, x, y, z) {
      let node = nodeAt(x, y, z);
      if (node < 0) return 0;
      settle(field, node);
      let high = center(node, here).y;
      for (let k = 0, to = downhill(field, node); k < LOOK && to >= 0; k++, node = to, to = downhill(field, to)) {
        high = k ? Math.max(high, center(to, here).y) : center(to, here).y;
      }
      return high - y;
    },
    over(x, y, z) {
      const node = nodeAt(x, y, z);
      return node < 0 ? 0 : y - center(node, here).y;
    },
    direction(field, x, y, z, out = new Vector3()) {
      const node = nodeAt(x, y, z);
      if (node >= 0) settle(field, node);
      if (node < 0 || !(field[node] < Infinity)) return null;
      let to = downhill(field, node);
      clearAt(to < 0 ? node : to, out);
      // A clear point already reached (one off its tile's centre may lie in the body's own tile, or back from a link's
      // hole) gives way to the next one down, across a link too, and so does one in the body's grid behind it on the
      // way on (back from a doorway's jamb, a hatch's rim).
      const { grid } = locate(node);
      for (let k = 0; to >= 0 && k < LOOK; k++) {
        const next = downhill(field, to);
        if (next < 0) break;
        const ahead = clearAt(next, there);
        const [ax, az] = [out.x - x, out.z - z];
        const behind = locate(to).grid === grid && ax * (ahead.x - out.x) + az * (ahead.z - out.z) < 0;
        if (Math.hypot(ax, az) >= REACHED && !behind) break;
        [to] = [next, out.copy(ahead)];
      }
      const [dx, dz] = [out.x - x, out.z - z];
      const length = Math.sqrt(dx * dx + dz * dz);
      return length < 1e-3 ? null : out.set(dx / length, 0, dz / length);
    },
  };

  /** The way's nodes as points, each run inside one grid smoothed by its line of sight. */
  function smooth(way: readonly number[], from: Point3): Vector3[] {
    const out: Vector3[] = [];
    let [ax, az] = [from[0], from[2]];
    for (let k = 0; k < way.length;) {
      const { grid } = locate(way[k]);
      let far = k;
      while (far + 1 < way.length && locate(way[far + 1]).grid === grid) {
        const p = clearAt(way[far + 1]);
        if (!grid.grid.lineOfSight(ax, az, p.x, p.z)) break;
        far++;
      }
      const point = clearAt(way[far]);
      out.push(point);
      [ax, az] = [point.x, point.z];
      k = far + 1;
    }
    return out;
  }
}
