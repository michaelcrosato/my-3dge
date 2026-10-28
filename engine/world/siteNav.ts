/**
 * @file Navigation over a site (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): one graph over a grid per walkable
 * surface, for the bot and the neighbours. The grids (engine/world/siteNavGrids.ts): the terrain's cells, closed where
 * the terrain is cut and over every structure's footprint; and each storey of each structure, in the world's
 * orientation, a step only where a body `height` tall fits under what is above it. Links join them both ways where a
 * body passes from one to another: a flight of stairs' top edge to the floor above it, a ladder's tile to the open
 * floor beside it on the storey above, and a ground storey's open tile on its map's edge to the terrain cell outside
 * it, when their floors meet within the climb limit (a doorway, a porch's step). Tiles a block stands on (`blocked`:
 * a scene's props, which no level knows) are closed.
 *
 * A node is a grid's tile, numbered after the grids before it (`grids[g].offset`); the searches over the graph (the
 * node under a point, a way, a flow field, the way down it, a crouch or a rise ahead) are engine/world/siteNavGraph.ts's.
 * `createSiteNav` keeps the last few navigations of a site it made, by their options (the blocks' numbers too), and
 * gives one again for the same options: a world remade with its props where they were, the bot's and the cast's, share
 * one.
 *
 * Invariants: derived data, a pure function of the site and the options.
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
import type { Vector3 } from '../core/math';
import { storeyView } from './level/storeys';
import type { Point3 } from './level/types';
import { LEVEL_BODY, NAV_CLIMB } from './level/validate';
import { NAV_DIRECTIONS, NavGrid, type NavSurface } from './nav';
import { toWorld, type Site, type SiteStructure } from './site';
import { siteNavGraph } from './siteNavGraph';
import { blockedSurface, siteTerrainSurface, storeyLinks, storeySurface, type NavBlock } from './siteNavGrids';

export type { NavBlock } from './siteNavGrids';
export { CROUCH_COST } from './siteNavGraph';

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
  /** Boxes nothing walks through (m): the props a scene stands, which the level's own tiles know nothing of. */
  blocked?: readonly NavBlock[];
}

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
  /** Every node's walking distance (m) to the node under `goal`; Infinity where none leads. `lazy`: flooded only as far as `direction`, `crouch` and `rise` read it, which answer as on the full field (engine/world/siteNavGraph.ts). */ // prettier-ignore
  flowField(goal: Point3, options?: { lazy?: boolean }): Float64Array;
  /** The unit way across the ground to walk from (x, y, z) down `field`, toward the next clear point not reached nor behind; null at the goal or off it. */ // prettier-ignore
  direction(field: Float64Array, x: number, y: number, z: number, out?: Vector3): Vector3 | null;
  /** Whether a body at (x, y, z) on its way down `field` must crouch: under a ceiling, or for a step lower than it stands within `ahead` m along its way (its next step at 0) in the same grid, never past a link. */ // prettier-ignore
  crouch(field: Float64Array, x: number, y: number, z: number, ahead?: number): boolean;
  /** How far the highest floor of the next `LOOK` nodes down `field` from (x, y, z) stands over `y` (m; below it, negative): on a ladder up, its top's. */ // prettier-ignore
  rise(field: Float64Array, x: number, y: number, z: number): number;
  /** How far `y` stands over the floor of the node under (x, y, z) (m; 0 where none is). */
  over(x: number, y: number, z: number): number;
}

/** How many navigations of a site `createSiteNav` keeps, the last asked for. */
const KEPT = 4;
const kept = new WeakMap<Site, Map<string, SiteNav>>();

/** `site`'s navigation (see the file comment): one made before for the same options when kept, else a new one. */
export function createSiteNav(site: Site, options: SiteNavOptions = {}): SiteNav {
  const { climb, grade, radius, height, stand, blocked } = options;
  const key = JSON.stringify([climb, grade, radius, height, stand, blocked ?? []], (_, v) => (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)) ? `${Object.is(v, -0) ? '-0' : v}` : v)); // prettier-ignore
  const navs = kept.get(site) ?? new Map<string, SiteNav>();
  kept.set(site, navs);
  const nav = navs.get(key) ?? buildSiteNav(site, options);
  navs.delete(key); // the newest now
  navs.set(key, nav);
  if (navs.size > KEPT) navs.delete(navs.keys().next().value!);
  return nav;
}

/** Builds `site`'s navigation for `options`. */
function buildSiteNav(site: Site, options: SiteNavOptions): SiteNav {
  const climb = options.climb ?? NAV_CLIMB;
  const grids: SiteNavGrid[] = [];
  const owns: ArrayLike<boolean>[] = []; // each grid's tiles open in its own surface, before the blocks closed any
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
    const grid = new NavGrid(blockedSurface(surface, options.blocked ?? [], stand, radius), { climb, radius: Math.min(radius, surface.tile * 0.45) });
    grids.push({ name, structure, storey, grid, offset: nodes, ceilings: surface.ceilings, highs: surface.highs });
    owns.push(surface.walkable);
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
  return siteNavGraph(site, grids, links, nodes, { climb, radius, stand, owns, blocked: options.blocked ?? [] });
}

/** How much more than the hull, crouched or standing, a step needs clear by default (m): a body never fits a gap exactly. */
const HEAD_MARGIN = 0.05;
