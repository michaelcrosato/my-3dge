/**
 * @file Queries over a site (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3), in world metres: the terrain where it is not
 * cut and every structure, each asked in its own frame (engine/world/site.ts's `toLocal`).
 *
 * - `siteFloorBelow(site, x, y, z)`: the highest surface at or under the point (the terrain, a structure's floor, a
 *   solid's top or its roof: engine/world/level/heights.ts's `floorBelow` in its frame), null where nothing is;
 *   `siteSurfaceBelow` its tag.
 * - `siteStructureAt(site, x, y, z)`: the structure whose box holds the point, its storey there (of the surface under
 *   it, as `storeyBelow` reads it, else by height) and its room.
 * - `siteSolidAt(site, x, y, z)`: whether the point is in something solid: under the terrain, in a structure's wall or
 *   solid (up to its top), in the head over an opening or a low ceiling, in a floor slab, in a roof's slab or in its
 *   ground slab.
 * - `siteClearSight(site, from, to)`: whether the straight line between two points meets nothing solid, sampled every
 *   `step` metres (0.1 by default) and at both ends: what an agent sees, and the cameras' sight of the player.
 * - `siteRescueGrid(site)`: the grid the lost-body rescue reads (engine/physics/bodies.ts `rescueLost`): a 1 m tile
 *   over the site, walkable where any floor is, its floor the ground there (the terrain, or a structure's lowest
 *   floor where the terrain is cut).
 *
 * Invariants: pure functions of the site and the points, the same in Node and Chromium (no trigonometry); a point on a
 * structure's footprint's edge belongs to the structure east or south of it, as a tile's edge does.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineLevel } from './level/level';
 * import { defineSite, getSite } from './site';
 * const reg = createRegistry();
 * defineLevel('level:hut', { text: '#####\n#...#\n#####\n', file: 'hut.txt' }, reg);
 * defineSite('site:yard', { structures: [{ level: 'level:hut', at: [10, 0.5, 4] }] }, reg);
 * const yard = getSite('site:yard', reg);
 * [siteFloorBelow(yard, 11.5, 2, 5.5), siteSolidAt(yard, 10.5, 1, 4.5), siteClearSight(yard, [11.2, 1, 5.5], [13.8, 1, 5.5])]; // [0.5, true, true]
 * @see engine/world/siteQueries.test.ts
 */
import { floorBelow, roomAt, storeyAt, storeyBelow, surfaceBelow } from './level/heights';
import { onRoof, roofHeight } from './level/roofs';
import type { Point3, RoomDescriptor } from './level/types';
import { toLocal, type Site, type SiteStructure } from './site';
import { terrainHeight, terrainSurface } from './terrain';

/** How far above a point a surface still counts (m), as heights.ts's `floorBelow` counts it. */
const REACH = 1e-6;

/** Whether world (x, z) is over a cut cell of the site's terrain. */
function cutAt(site: Site, x: number, z: number): boolean {
  const { terrain, cut } = site;
  if (!terrain || !cut) return false;
  const [c, r] = [
    Math.floor((x - terrain.origin[0]) / terrain.cell),
    Math.floor((z - terrain.origin[2]) / terrain.cell),
  ];
  return c >= 0 && r >= 0 && c < terrain.cols && r < terrain.rows && cut[r * terrain.cols + c] === 1;
}

/** The terrain's height at world (x, z), where it stands and is not cut; null elsewhere. */
function groundAt(site: Site, x: number, z: number): number | null {
  return site.terrain && !cutAt(site, x, z) ? terrainHeight(site.terrain, x, z) : null;
}

/** Whether structure `s`'s box, widened by `pad`, holds world (x, z): its west and north edges, not its east and south. */
const over = (s: SiteStructure, x: number, z: number, pad = 0) =>
  x >= s.bounds.min[0] - pad && x < s.bounds.max[0] + pad && z >= s.bounds.min[2] - pad && z < s.bounds.max[2] + pad;

/** The highest surface under (x, y, z) and its tag (see the file comment), or null. */
function underfoot(site: Site, x: number, y: number, z: number): { height: number; surface: string } | null {
  let best: { height: number; surface: string } | null = null;
  const ground = groundAt(site, x, z);
  if (ground !== null && ground <= y + REACH) best = { height: ground, surface: terrainSurface(site.terrain!, x, z) };
  for (const s of site.structures) {
    if (!over(s, x, z, s.level.tile)) continue; // its ground slab reaches a tile past its map
    const [lx, lz] = toLocal(s, x, z);
    const local = floorBelow(s.level, lx, y - s.at[1], lz);
    if (local === null || (best && local + s.at[1] <= best.height)) continue;
    best = { height: local + s.at[1], surface: surfaceBelow(s.level, lx, y - s.at[1], lz) || best?.surface || '' };
  }
  return best;
}

/** The height (m) of the highest surface at or under (x, y, z) on the site; null where nothing is. */
export function siteFloorBelow(site: Site, x: number, y: number, z: number): number | null {
  return underfoot(site, x, y, z)?.height ?? null;
}

/** The surface tag of `siteFloorBelow`'s surface at (x, y, z): '' where nothing is. */
export function siteSurfaceBelow(site: Site, x: number, y: number, z: number): string {
  return underfoot(site, x, y, z)?.surface ?? '';
}

/** Where (x, y, z) is in a structure: the first whose box holds it, its storey there and its room; null outside them. */
export function siteStructureAt(
  site: Site,
  x: number,
  y: number,
  z: number,
): { structure: SiteStructure; storey: number; room: RoomDescriptor | null } | null {
  for (const structure of site.structures) {
    if (!over(structure, x, z) || y < structure.bounds.min[1] || y > structure.bounds.max[1]) continue;
    const [lx, lz] = toLocal(structure, x, z);
    const ly = y - structure.at[1];
    const below = storeyBelow(structure.level, lx, ly, lz);
    return { structure, storey: below >= 0 ? below : storeyAt(structure.level, ly), room: roomAt(structure.level, lx, ly, lz) }; // prettier-ignore
  }
  return null;
}

/** Whether local (lx, ly, lz) is in something solid of structure `s` (see the file comment). */
function solidIn(s: SiteStructure, lx: number, ly: number, lz: number): boolean {
  const { level } = s;
  const { tile, cols, rows, ground } = level;
  for (const roof of level.roofs ?? []) {
    if (onRoof(roof, lx, lz) && ly <= roofHeight(roof, lx, lz) && ly >= roofHeight(roof, lx, lz) - roof.thickness) return true; // prettier-ignore
  }
  const [c, r] = [Math.floor(lx / tile), Math.floor(lz / tile)];
  if (c < -1 || r < -1 || c > cols || r > rows) return false;
  if (ly < ground.max[1] && ly >= ground.min[1]) return true; // the ground slab, a tile past the map all round
  if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
  const i = r * cols + c;
  const storeys = level.storeys;
  if (!storeys) return level.solid[i] && ly < level.top[i];
  const storey = storeys[storeyAt(level, ly)];
  if (ly < storey.base) return storey.floored[i]; // in its floor slab
  const head = level.legend[storey.tiles[i]].head ?? 0;
  if (head > 0 && ly >= storey.base + head && ly < storey.fullTop) return true; // over an opening or a low ceiling
  return storey.solid[i] && ly < storey.top[i];
}

/** Whether (x, y, z) is in something solid on the site (see the file comment). */
export function siteSolidAt(site: Site, x: number, y: number, z: number): boolean {
  const ground = groundAt(site, x, z);
  if (ground !== null && y < ground - REACH) return true;
  for (const s of site.structures) {
    if (!over(s, x, z, s.level.tile)) continue;
    const [lx, lz] = toLocal(s, x, z);
    if (solidIn(s, lx, y - s.at[1], lz)) return true;
  }
  return false;
}

/** Whether the straight line from `from` to `to` (m) meets nothing solid, sampled every `step` metres and at both ends. */
export function siteClearSight(site: Site, from: Point3, to: Point3, step = 0.1): boolean {
  const [dx, dy, dz] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / step));
  for (let k = 0; k <= n; k++) {
    if (siteSolidAt(site, from[0] + (dx * k) / n, from[1] + (dy * k) / n, from[2] + (dz * k) / n)) return false;
  }
  return true;
}

/** The lost-body rescue's grid (engine/physics/bodies.ts's `RescueLevel`): see the file comment. */
export interface SiteRescueGrid {
  readonly tile: number;
  readonly cols: number;
  readonly rows: number;
  readonly origin: readonly [number, number];
  readonly walkable: readonly boolean[];
  readonly floor: readonly number[];
}

/** The site's rescue grid, `tile` metres a tile, over its terrain and its structures (see the file comment). */
export function siteRescueGrid(site: Site, tile = 1): SiteRescueGrid {
  const boxes = site.structures.map((s) => s.footprint);
  if (site.terrain) {
    const { origin, cols, rows, cell } = site.terrain;
    boxes.push([origin[0], origin[2], origin[0] + cols * cell, origin[2] + rows * cell]);
  }
  const [x0, z0] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  const [x1, z1] = [Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const [cols, rows] = [Math.max(1, Math.ceil((x1 - x0) / tile)), Math.max(1, Math.ceil((z1 - z0) / tile))];
  const walkable: boolean[] = [];
  const floor: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, z] = [x0 + (c + 0.5) * tile, z0 + (r + 0.5) * tile];
      let height = groundAt(site, x, z);
      for (const s of site.structures) {
        if (height !== null || !over(s, x, z)) continue;
        const [lx, lz] = toLocal(s, x, z);
        const lowest = floorBelow(s.level, lx, (s.level.storeys?.[0]?.base ?? 0) + 1, lz);
        if (lowest !== null) height = lowest + s.at[1];
      }
      walkable.push(height !== null);
      floor.push(height ?? 0);
    }
  }
  return { tile, cols, rows, origin: [x0, z0], walkable, floor };
}
