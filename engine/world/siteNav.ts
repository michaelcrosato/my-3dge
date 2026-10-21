/**
 * @file Navigation over a site (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): one graph over a grid per walkable
 * surface, for the bot and the neighbours. The grids (engine/world/siteNavGrids.ts): the terrain's cells, closed where
 * the terrain is cut and over every structure's footprint; and each storey of each structure, in the world's
 * orientation, a step only where a body `height` tall fits under what is above it. Links join them both ways where a
 * body passes from one to another: a flight of stairs' top edge to the floor above it, a ladder's tile to the open
 * floor beside it on the storey above, and a ground storey's open tile on its map's edge to the terrain cell outside
 * it, when their floors meet within the climb limit (a doorway, a porch's step).
 *
 * A node is a grid's tile, numbered after the grids before it (`grids[g].offset`). `nodeAt(x, y, z)` finds the node
 * under a point: the open tile with the highest floor at or under it, within the climb limit (a flight's tile reads
 * its centre, so a body on its upper half is still on it, not on the storey above), unless that floor is more than a
 * step below it, where an open tile beside it within a step of its height wins (a body on a hatch's rim); else the
 * nearest open tile of the storey the point is in, else of the terrain. `findPath(from, to)` is Dijkstra over the
 * steps within grids (engine/world/nav.ts: the climb limit and the corners) and the links, the way smoothed by line of
 * sight inside each grid; `flowField(goal)` gives every node its walking distance to the goal, and `direction` the way
 * down it, across links too. Both walk to each node's clear point (`clearAt`): its tile's centre moved off each side it has no step
 * through, as far as a body `radius` round needs where its tiles are narrower than it (the shooter's 0.81 m hull in a
 * stairwell of two 0.5 m tiles walks its middle, not a tile's centre against the railing).
 *
 * Invariants: derived data, a pure function of the site and the options; ties go to the lower node; paths and
 * directions answer in world metres.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineLevel } from './level/level';
 * import { defineSite, getSite } from './site';
 * import { defineTerrain } from './terrain';
 * const reg = createRegistry();
 * defineTerrain('terrain:lot', { size: [16, 16] }, reg);
 * defineLevel('level:hut', { text: '#####\n#...#\n#....\n#####\n', file: 'hut.txt' }, reg);
 * defineSite('site:lot', { terrain: 'terrain:lot', structures: [{ level: 'level:hut', at: [4, 0, 4] }] }, reg);
 * const nav = createSiteNav(getSite('site:lot', reg));
 * [nav.grids.map((g) => g.name), nav.findPath([1, 0, 1], [6.5, 0, 6.5])!.length > 1]; // [['terrain', 'hut/0'], true]: in through the door
 * @see engine/world/siteNav.test.ts
 */
import { Vector3 } from '../core/math';
import { storeyView } from './level/storeys';
import type { Point3 } from './level/types';
import { LEVEL_BODY, NAV_CLIMB } from './level/validate';
import { NAV_DIRECTIONS, NavGrid, type NavSurface } from './nav';
import { toWorld, type Site, type SiteStructure } from './site';
import { siteTerrainSurface, storeyLinks, storeySurface } from './siteNavGrids';
import { siteStructureAt } from './siteQueries';
import { TileHeap } from './tileHeap';

/** One of a site's grids: the terrain's or a structure's storey's, and its first node's number. */
export interface SiteNavGrid {
  /** `terrain`, or `<structure>/<storey index>`. */
  readonly name: string;
  /** The structure's index in the site, or −1 for the terrain; the storey's index. */
  readonly structure: number;
  readonly storey: number;
  readonly grid: NavGrid;
  readonly offset: number;
  /** A storey's: each tile's ceiling and its highest floor (m; at the structure's height); none over the terrain. */
  readonly ceilings?: readonly number[];
  readonly highs?: readonly number[];
}

/**
 * How `createSiteNav` builds: the climb limit (m), the steepest ground (m a metre), and the body it walks (m; the
 * shooter's hull, `LEVEL_BODY`, by default, the largest the engine ships): its radius, the clear height a step needs
 * (crouched, with a margin) and the height it stands (a step lower costs `CROUCH_COST` times its length, crouched).
 */
export interface SiteNavOptions {
  climb?: number;
  grade?: number;
  radius?: number;
  height?: number;
  stand?: number;
}

/** How many times its length a step costs where a body must crouch to take it (a crouch-walk's pace against a run). */
export const CROUCH_COST = 2.5;

/** A site's navigation (see the file comment). */
export interface SiteNav {
  readonly grids: readonly SiteNavGrid[];
  /** Every link, as pairs of nodes, each once (the graph walks them both ways). */
  readonly links: readonly (readonly [number, number])[];
  /** How many nodes there are. */
  readonly nodes: number;
  /** The node under (x, y, z) (see the file comment); −1 where none is open. */
  nodeAt(x: number, y: number, z: number): number;
  /** A node's grid and tile. */
  locate(node: number): { grid: SiteNavGrid; tile: number };
  /** A node's tile centre on its floor (m). */
  center(node: number, out?: Vector3): Vector3;
  /** A node's clear point (see the file comment) on its floor (m). */
  clearAt(node: number, out?: Vector3): Vector3;
  /** The way from `from` to `to` (see the file comment): clear points after `from`, the last the goal's; null when none leads there. */ // prettier-ignore
  findPath(from: Point3, to: Point3): Vector3[] | null;
  /** Every node's walking distance (m) to the node under `goal`; Infinity where none leads. */
  flowField(goal: Point3): Float64Array;
  /** The unit way across the ground to walk from (x, y, z) down `field`, toward the next node; null at the goal or off it. */ // prettier-ignore
  direction(field: Float64Array, x: number, y: number, z: number, out?: Vector3): Vector3 | null;
  /** Whether a body at (x, y, z) on its way down `field` must crouch: under a ceiling, or for its next step in the same grid (never for a link), lower than it stands. */ // prettier-ignore
  crouch(field: Float64Array, x: number, y: number, z: number): boolean;
  /** How far the floor of the next node down `field` from (x, y, z) stands over `y` (m; below it, negative). */
  rise(field: Float64Array, x: number, y: number, z: number): number;
  /** How far `y` stands over the floor of the node under (x, y, z) (m; 0 where none is). */
  over(x: number, y: number, z: number): number;
}

/** Builds `site`'s navigation (see the file comment). */
export function createSiteNav(site: Site, options: SiteNavOptions = {}): SiteNav {
  const climb = options.climb ?? NAV_CLIMB;
  const grids: SiteNavGrid[] = [];
  let nodes = 0;
  const radius = options.radius ?? LEVEL_BODY.width / 2;
  const height = options.height ?? LEVEL_BODY.crouched + HEAD_MARGIN;
  const stand = options.stand ?? LEVEL_BODY.standing + HEAD_MARGIN;
  const add = (
    name: string,
    structure: number,
    storey: number,
    surface: NavSurface & { ceilings?: number[]; highs?: number[] },
  ) => {
    // prettier-ignore
    const grid = new NavGrid(surface, { climb, radius: Math.min(radius, surface.tile * 0.45) });
    grids.push({ name, structure, storey, grid, offset: nodes, ceilings: surface.ceilings, highs: surface.highs });
    nodes += surface.cols * surface.rows;
  };
  const ground = siteTerrainSurface(site, options.grade);
  if (ground) add('terrain', -1, 0, ground);
  const storeyGrid = new Map<string, SiteNavGrid>();
  for (const s of site.structures) {
    const count = s.level.storeys?.length ?? 1;
    for (let k = 0; k < count; k++) {
      add(`${s.name}/${k}`, s.index, k, storeySurface(s, k, height));
      storeyGrid.set(`${s.index}/${k}`, grids[grids.length - 1]);
    }
  }
  const links: [number, number][] = [];
  /** The node of a structure's local tile (c, r) on storey k. */
  const nodeOf = (s: SiteStructure, k: number, c: number, r: number) => {
    const g = storeyGrid.get(`${s.index}/${k}`)!;
    const [x, z] = toWorld(s, (c + 0.5) * s.level.tile, (r + 0.5) * s.level.tile);
    const tile = g.grid.cellAt(x, z);
    return tile < 0 ? -1 : g.offset + tile;
  };
  const terrain = grids[0]?.name === 'terrain' ? grids[0] : null;
  for (const s of site.structures) {
    const { cols, rows } = s.level;
    const count = s.level.storeys?.length ?? 1;
    for (let k = 0; k + 1 < count; k++) {
      for (const [a, b] of storeyLinks(s.level, k)) {
        const [na, nb] = [
          nodeOf(s, k, a % cols, Math.floor(a / cols)),
          nodeOf(s, k + 1, b % cols, Math.floor(b / cols)),
        ];
        if (na >= 0 && nb >= 0) links.push([na, nb]);
      }
    }
    if (!terrain) continue;
    const level = s.level.storeys ? s.level.storeys.findIndex((storey) => storey.base === 0) : 0;
    if (level < 0) continue;
    const view = storeyView(s.level, level);
    for (let i = 0; i < cols * rows; i++) {
      if (!view.walkable[i]) continue;
      const [c, r] = [i % cols, Math.floor(i / cols)];
      for (const [dc, dr] of NAV_DIRECTIONS.slice(0, 4)) {
        const [nc, nr] = [c + dc, r + dr];
        if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) continue; // only off the map's edge
        const [x, z] = toWorld(s, (nc + 0.5) * s.level.tile, (nr + 0.5) * s.level.tile);
        const cell = terrain.grid.cellAt(x, z);
        const from = nodeOf(s, level, c, r);
        if (cell < 0 || !terrain.grid.open[cell] || from < 0) continue;
        if (Math.abs(terrain.grid.level.floor[cell] - (view.floor[i] + s.at[1])) <= climb) links.push([from, cell]);
      }
    }
  }
  return siteNavGraph(site, grids, links, nodes, { climb, radius, stand });
}

/** How far past a body's radius a clear point keeps it off a side it has no step through (m). */
const CLEAR = 0.04;
/** How much more than the hull, crouched or standing, a step needs clear by default (m): a body never fits a gap exactly. */
const HEAD_MARGIN = 0.05;

/** The graph's searches over `grids` and `links` (see the file comment). */
function siteNavGraph(
  site: Site,
  grids: SiteNavGrid[],
  links: [number, number][],
  nodes: number,
  { climb, radius, stand }: { climb: number; radius: number; stand: number },
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
  /** A node's clear point (see the file comment): its centre off each side it has no step through, by `push`. */
  const clearAt = (node: number, out = new Vector3()) => {
    const { grid, tile } = locate(node);
    grid.grid.center(tile, out);
    const push = Math.min(grid.grid.tile / 2, radius + CLEAR - grid.grid.tile / 2);
    for (let k = 0; k < 4 && push > 0; k++) {
      if (grid.grid.steps[tile] & (1 << k)) continue;
      const [dc, dr] = NAV_DIRECTIONS[k];
      out.set(out.x - dc * push, out.y, out.z - dr * push);
    }
    return out;
  };
  const [here, there] = [new Vector3(), new Vector3()];
  /** A step's clear height (m): the ceiling over `to` less the higher of the two floors; Infinity under the sky. */
  const headroom = (from: number, to: number) => {
    const [a, b] = [locate(from), locate(to)];
    const ceiling = b.grid.ceilings?.[b.tile] ?? Infinity;
    const high = ({ grid, tile }: typeof a) => grid.highs?.[tile] ?? grid.grid.level.floor[tile];
    return ceiling - Math.max(high(a), high(b));
  };
  /** Whether a body must crouch to step from `from` to `to`, or to stand on `from` at all. */
  const low = (from: number, to: number) => headroom(from, from) < stand || headroom(from, to) < stand;
  /** Each node a step or a link from `node`, with its cost (m: its length, `CROUCH_COST` times that crouched). */
  const next = (node: number, visit: (to: number, length: number) => void) => {
    const { grid, tile } = locate(node);
    const { cols, steps } = grid.grid;
    const cost = (to: number, length: number) => visit(to, low(node, to) ? length * CROUCH_COST : length);
    for (let k = 0; k < 8; k++) {
      if (!(steps[tile] & (1 << k))) continue;
      const [dc, dr] = NAV_DIRECTIONS[k];
      cost(node + dr * cols + dc, (dc && dr ? Math.SQRT2 : 1) * grid.grid.tile);
    }
    for (const to of jumps.get(node) ?? []) cost(to, center(node, here).distanceTo(center(to, there)));
  };
  /** Every node's steps and links into it, for a flood backwards from a goal. */
  let into: [number, number][][] | null = null;
  const incoming = () => {
    if (into) return into;
    const made: [number, number][][] = Array.from({ length: nodes }, () => []);
    for (let node = 0; node < nodes; node++) next(node, (to, length) => made[to].push([node, length]));
    return (into = made);
  };
  const heap = new TileHeap(nodes);
  /** Every node's walking distance to `goal` (m): Dijkstra backwards along the steps and links. */
  const flood = (goal: number): Float64Array => {
    const distance = new Float64Array(nodes).fill(Infinity);
    const edges = incoming();
    distance[goal] = 0;
    heap.start(distance);
    heap.push(goal);
    while (heap.size) {
      const node = heap.pop();
      for (const [from, length] of edges[node]) {
        if (!(distance[node] + length < distance[from])) continue;
        distance[from] = distance[node] + length;
        heap.push(from);
      }
    }
    return distance;
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
    flowField: (goal) => {
      const node = nodeAt(...goal);
      return node < 0 ? new Float64Array(nodes).fill(Infinity) : flood(node);
    },
    crouch(field, x, y, z) {
      const node = nodeAt(x, y, z);
      if (node < 0) return false;
      const to = downhill(field, node);
      // A link (a ladder, a flight's top) is crossed standing: crouching on a ladder lets go of it.
      const within = to >= 0 && locate(to).grid === locate(node).grid;
      return headroom(node, node) < stand || (within && headroom(node, to) < stand);
    },
    rise(field, x, y, z) {
      const node = nodeAt(x, y, z);
      if (node < 0) return 0;
      const to = downhill(field, node);
      return center(to < 0 ? node : to, here).y - y;
    },
    over(x, y, z) {
      const node = nodeAt(x, y, z);
      return node < 0 ? 0 : y - center(node, here).y;
    },
    direction(field, x, y, z, out = new Vector3()) {
      const node = nodeAt(x, y, z);
      if (node < 0 || !(field[node] < Infinity)) return null;
      const to = downhill(field, node);
      clearAt(to < 0 ? node : to, out);
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
