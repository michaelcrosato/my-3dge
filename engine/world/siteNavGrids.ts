/**
 * @file The grids a site's navigation walks (PLAN.md WP 13.15; engine/world/siteNav.ts). `siteTerrainSurface`: the
 * terrain's cells (engine/world/terrainNav.ts), closed where the terrain is cut and over every structure's footprint.
 * `storeySurface`: a structure's storey turned with its structure into the world's orientation (a quarter turn keeps
 * a grid square to the axes), its floors at the structure's height, its steps the storey's own
 * (engine/world/level/walk.ts) where a body `height` metres tall fits under what is above the higher of a step's two
 * floors (each tile's highest, `tileHighs`: a flight's at its upper edge, where a body crossing it stands). `storeyCeilings`
 * gives what is above each tile: its head, the slab of the next storey floored over it, the roof's underside, as
 * validation reads headroom (engine/world/level/validate.ts). `storeyLinks` gives the pairs of
 * tiles a body passes between two storeys: a flight's top edge to the floor above it, and a ladder's tile to the open
 * floor beside it on the storey above (as validation links them).
 *
 * Invariants: pure functions of the site; a structure's tiles are its own, row-major in its own frame, its heights in
 * its frame too (storeyView's floors) until `storeySurface` lifts them to the structure's height.
 *
 * @example
 * import { compileLevel } from './level/compile';
 * const level = compileLevel('---\nstorey: ground\nbase: 0\nheight: 2.7\n---\n#####\n#<..#\n#####\n---\nstorey: upper\nbase: 3\nheight: 2.7\n---\n#####\n#~..#\n#####\n');
 * [storeyCeilings(level, 0)[6], storeyCeilings(level, 0)[7], storeyLinks(level, 0)]; // [Infinity, 2.7, [[6, 7]]]: open over the flight, its top to the floor east of it
 * @see engine/world/siteNav.test.ts
 */
import { floorHeight } from './level/heights';
import { roofUnder } from './level/roofs';
import { storeyView } from './level/storeys';
import type { CompiledLevel } from './level/types';
import { canStep as levelStep } from './level/walk';
import type { NavSurface } from './nav';
import { toLocal, type Site, type SiteStructure } from './site';
import { terrainNavSurface } from './terrainNav';

/** The terrain's cells as a surface, closed where the terrain is cut and over every structure's footprint (see the file comment). */ // prettier-ignore
export function siteTerrainSurface(site: Site, grade?: number): NavSurface | null {
  if (!site.terrain) return null;
  const surface = terrainNavSurface(site.terrain, grade);
  const { cols, cell, origin } = site.terrain;
  const walkable = Array.from(surface.walkable, (open, i) => {
    if (!open || site.cut?.[i]) return false;
    const [x, z] = [origin[0] + ((i % cols) + 0.5) * cell, origin[2] + (Math.floor(i / cols) + 0.5) * cell];
    return !site.structures.some(({ footprint: [x0, z0, x1, z1] }) => x >= x0 && x < x1 && z >= z0 && z < z1);
  });
  // Bounds first (the terrain's own step), then neither tile closed by a cut or a footprint.
  return { ...surface, walkable, canStep: (c, r, dc, dr, up) => surface.canStep(c, r, dc, dr, up) && walkable[r * cols + c] && walkable[(r + dr) * cols + c + dc] }; // prettier-ignore
}

/** Each tile's highest floor (m): a ramp's or a flight's at its high edge, where a body crossing it may stand. */
export function tileHighs(view: CompiledLevel): Float64Array {
  const [t, inset] = [view.tile, view.tile * 0.01];
  return Float64Array.from(view.floor, (floor, i) => {
    const [x0, z0] = [(i % view.cols) * t, Math.floor(i / view.cols) * t];
    const corners = [[x0 + inset, z0 + inset], [x0 + t - inset, z0 + inset], [x0 + inset, z0 + t - inset], [x0 + t - inset, z0 + t - inset]]; // prettier-ignore
    return Math.max(floor, ...corners.map(([x, z]) => floorHeight(view, x, z)));
  });
}

/** What is above each tile of storey `k` (m, in the structure's frame; see the file comment); Infinity under the sky. */
export function storeyCeilings(level: CompiledLevel, k: number): Float64Array {
  const storeys = level.storeys ?? [];
  const s = storeys[k];
  if (!s) return new Float64Array(level.cols * level.rows).fill(Infinity);
  const roofs = (level.roofs ?? []).filter((roof) => roof.storey === k);
  return Float64Array.from(s.tiles, (char, i) => {
    const head = level.legend[char].head ?? 0;
    let ceiling = head > 0 ? s.base + head : Infinity;
    const over = storeys.slice(k + 1).find((up) => up.floored[i]);
    if (over) ceiling = Math.min(ceiling, over.base - over.slab);
    const [x, z] = [((i % level.cols) + 0.5) * level.tile, (Math.floor(i / level.cols) + 0.5) * level.tile];
    for (const roof of roofs) ceiling = Math.min(ceiling, roofUnder(roof, x, z));
    return ceiling;
  });
}

/**
 * Storey `k` of structure `s` as a surface in the world's orientation (see the file comment), with each tile's ceiling
 * at the structure's height: a step needs `height` metres clear over the higher of its two floors under the ceiling it
 * goes to (storeyCeilings's), and a diagonal under its corners' too.
 */
export function storeySurface(
  s: SiteStructure,
  k: number,
  height: number,
): NavSurface & { ceilings: number[]; highs: number[] } {
  // prettier-ignore
  const view = storeyView(s.level, k);
  const ceilings = storeyCeilings(s.level, k);
  const highs = tileHighs(view);
  const t = view.tile;
  const [x0, z0] = [s.footprint[0], s.footprint[1]];
  const [cols, rows] = s.turn % 2 ? [view.rows, view.cols] : [view.cols, view.rows];
  /** The local tile under world tile (c, r)'s centre. */
  const local = (c: number, r: number) => {
    const [lx, lz] = toLocal(s, x0 + (c + 0.5) * t, z0 + (r + 0.5) * t);
    return [Math.floor(lx / t), Math.floor(lz / t)] as const;
  };
  const [walkable, floor, over, high]: [boolean[], number[], number[], number[]] = [[], [], [], []];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [lc, lr] = local(c, r);
      walkable.push(view.walkable[lr * view.cols + lc]);
      floor.push(view.floor[lr * view.cols + lc] + s.at[1]);
      over.push(ceilings[lr * view.cols + lc] + s.at[1]);
      high.push(highs[lr * view.cols + lc] + s.at[1]);
    }
  }
  // A world step (dc, dr) as the structure's own: its direction turned back.
  const turned = (dc: number, dr: number) =>
    [
      [dc, dr],
      [-dr, dc],
      [-dc, -dr],
      [dr, -dc],
    ][s.turn];
  return {
    cols,
    rows,
    tile: t,
    origin: [x0, z0],
    walkable,
    floor,
    ceilings: over,
    highs: high,
    canStep(c, r, dc, dr, climb) {
      const [lc, lr] = local(c, r);
      const [ldc, ldr] = turned(dc, dr);
      if (!levelStep(view, lc, lr, ldc, ldr, climb)) return false;
      const [from, cols] = [lr * view.cols + lc, view.cols];
      const low = (i: number) => ceilings[i] - Math.max(highs[from], highs[i]) < height;
      return !(low(from + ldr * cols + ldc) || (ldc && ldr && (low(from + ldc) || low(from + ldr * cols))));
    },
  };
}

/** The pairs of a structure's local tiles a body passes between storeys k and k + 1: flights' tops and ladders. */
export function storeyLinks(level: CompiledLevel, k: number): [number, number][] {
  const [low, high] = [storeyView(level, k), storeyView(level, k + 1)];
  const { cols, rows } = level;
  const open = (i: number) => high.walkable[i];
  const links: [number, number][] = [];
  for (const ramp of low.ramps) {
    const [c0, r0, c1, r1] = ramp.tiles;
    if (low.legend[low.tiles[r0 * cols + c0]].floorShape !== 'flight') continue;
    const edge: [number, number, number, number][] =
      ramp.rises === 'north' || ramp.rises === 'south'
        ? Array.from({ length: c1 - c0 + 1 }, (_, j) => (ramp.rises === 'north' ? [c0 + j, r0, c0 + j, r0 - 1] : [c0 + j, r1, c0 + j, r1 + 1])) // prettier-ignore
        : Array.from({ length: r1 - r0 + 1 }, (_, j) => (ramp.rises === 'west' ? [c0, r0 + j, c0 - 1, r0 + j] : [c1, r0 + j, c1 + 1, r0 + j])); // prettier-ignore
    for (const [c, r, oc, or] of edge) if (oc >= 0 && or >= 0 && oc < cols && or < rows && open(or * cols + oc)) links.push([r * cols + c, or * cols + oc]); // prettier-ignore
  }
  low.tiles.forEach((char, i) => {
    if (!low.legend[char].ladder) return;
    const [c, r] = [i % cols, Math.floor(i / cols)];
    for (const [dc, dr] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      // prettier-ignore
      const [nc, nr] = [c + dc, r + dr];
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && open(nr * cols + nc)) links.push([i, nr * cols + nc]);
    }
  });
  return links;
}
