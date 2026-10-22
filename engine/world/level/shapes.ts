/**
 * @file Ramps and daises (PLAN.md WP 4.2, I-22): the floors that slope, found in a level's tiles and measured.
 * `findRamps` turns each block of a ramp glyph's tiles (stairs) into a ramp rising toward the one side whose
 * neighbours stand at its top (a gallery); `findDaises` turns each block of a dais glyph's tiles into an octagonal
 * frustum. Both also return the blocks they cannot use, which validate.ts reports (`LEVEL_BAD_RAMP`,
 * `LEVEL_BAD_DAIS`). `rampHeight` and `daisHeight` are their surfaces (engine/world/level/heights.ts takes the
 * highest at a point); `wedgePoints` and `frustumPoints` are the corners of their hull colliders (colliders.ts), so
 * the bodies stand exactly where the heights say.
 *
 * A ramp is a filled rectangle; a neighbour stands at its top when it is walkable, flat, nearer the ramp's top than
 * its bottom and within the climb limit of the top. Exactly one side may have such neighbours. A dais is a square
 * block (its tiles' bounding box); its base's faces stand half a tile outside that square, so the tiles drawn are
 * those whose centres the base covers, and its top's faces `edge` metres further in.
 *
 * Invariants: pure functions of the grid; ramps and daises come by glyph id, then in reading order of their first
 * tile. No trigonometry: the octagon's corners use tan(π/8) = √2 − 1, so the corners are the same bits whether or not
 * the sim's fdlibm swap is on.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:92-109` (`STAIRS`, `DAIS`, `octR`, the stairs and dais branches
 * of `floorH`) and `:181-199` (`octagon` and the hulls of `hallColliders`), in metres; the prototype's stairs always
 * rose north, these rise toward their gallery.
 *
 * @example
 * octagonRadius(3, 4); // 4.949…: (3 + 4) · √½, the diagonal face is nearest
 * rampHeight({ tiles: [0, 0, 0, 4], rises: 'north', bottom: 0, top: 1 }, 1, 0.5, 2.5); // 0.5: halfway up
 * @see engine/world/level/shapes.test.ts
 */
import type { Glyph } from './glyph';
import { glyphsOf, holds, type TileGrid } from './grid';
import { findBlocks } from './rects';
import type { DaisDescriptor, Point3, RampDescriptor, Side, TileRect } from './types';

/** A block of a ramp or dais glyph that makes no ramp or dais, and why, for validate.ts. */
export interface ShapeProblem {
  readonly shape: 'ramp' | 'dais';
  readonly glyph: Glyph;
  /** The block's first tile, in reading order: `[col, row]`. */
  readonly first: readonly [col: number, row: number];
  /** What is wrong, as a phrase after "this <char> block". */
  readonly why: string;
}

/** The four sides, in the order messages list them. */
export const SIDES: readonly Side[] = ['north', 'south', 'west', 'east'];

/** `x` held between `low` and `high`. */
const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));

/** The tiles just outside side `side` of `rect`, inside a `cols` × `rows` map. */
export function outside(rect: TileRect, side: Side, cols: number, rows: number): [number, number][] {
  const [c0, r0, c1, r1] = rect;
  const line: [number, number][] = [];
  if (side === 'north' || side === 'south') {
    const row = side === 'north' ? r0 - 1 : r1 + 1;
    if (row >= 0 && row < rows) for (let col = c0; col <= c1; col++) line.push([col, row]);
  } else {
    const col = side === 'west' ? c0 - 1 : c1 + 1;
    if (col >= 0 && col < cols) for (let row = r0; row <= r1; row++) line.push([col, row]);
  }
  return line;
}

/** `[col0, row0, col1, row1]` → `w × h tiles`. */
const sizeText = (rect: TileRect) => `${rect[2] - rect[0] + 1} × ${rect[3] - rect[1] + 1} tiles`;

/**
 * The ramps of `grid` and the ramp blocks that make none. `climb` (m) is how near a neighbour's floor must be to a
 * ramp's top to stand at it.
 */
export function findRamps(grid: TileGrid, climb: number): { ramps: RampDescriptor[]; problems: ShapeProblem[] } {
  const ramps: RampDescriptor[] = [];
  const problems: ShapeProblem[] = [];
  for (const glyph of glyphsOf(grid).filter((entry) => entry.floorShape === 'ramp')) {
    const [bottom, top] = [glyph.floor, glyph.top];
    const atTop = (col: number, row: number) => {
      const next = grid.tiles[row * grid.cols + col];
      const height = next.floor;
      const flat = next.floorShape === 'flat' && next.nav.walkable;
      return flat && Math.abs(height - top) <= climb && Math.abs(height - top) < Math.abs(height - bottom);
    };
    for (const { first, rect, tiles } of findBlocks(grid.cols, grid.rows, holds(grid, [glyph])).blocks) {
      const [w, h] = [rect[2] - rect[0] + 1, rect[3] - rect[1] + 1];
      if (tiles !== w * h) {
        const why = `is not a filled rectangle (${tiles} tiles in a ${w} × ${h} area)`;
        problems.push({ shape: 'ramp', glyph, first, why });
        continue;
      }
      const sides = SIDES.filter((side) => outside(rect, side, grid.cols, grid.rows).some(([c, r]) => atTop(c, r)));
      if (sides.length === 1) {
        ramps.push({ glyph: glyph.id, surface: glyph.surface, tiles: rect, rises: sides[0], bottom, top });
        continue;
      }
      const why = sides.length
        ? `meets floors at its top (${top} m) on ${sides.length} sides (${sides.join(', ')}), so it rises toward none`
        : `meets no floor at its top (${top} m) on any side, so it rises toward none`;
      problems.push({ shape: 'ramp', glyph, first, why });
    }
  }
  return { ramps, problems };
}

/** The daises of `grid` and the dais blocks that make none. */
export function findDaises(grid: TileGrid): { daises: DaisDescriptor[]; problems: ShapeProblem[] } {
  const daises: DaisDescriptor[] = [];
  const problems: ShapeProblem[] = [];
  const t = grid.tile;
  for (const glyph of glyphsOf(grid).filter((entry) => entry.floorShape === 'dais')) {
    for (const { first, rect } of findBlocks(grid.cols, grid.rows, holds(grid, [glyph])).blocks) {
      const [c0, r0, c1, r1] = rect;
      const size = c1 - c0 + 1;
      const baseRadius = ((size + 1) / 2) * t;
      const topRadius = baseRadius - glyph.edge;
      if (r1 - r0 + 1 !== size) {
        problems.push({ shape: 'dais', glyph, first, why: `spans ${sizeText(rect)}, not a square` });
      } else if (!(topRadius > 0)) {
        const why = `is too small for its ${glyph.edge} m edge: its base reaches ${baseRadius} m from its centre`;
        problems.push({ shape: 'dais', glyph, first, why });
      } else {
        const center = [((c0 + c1 + 1) / 2) * t, ((r0 + r1 + 1) / 2) * t] as const;
        const [bottom, top] = [glyph.floor, glyph.top];
        daises.push({
          glyph: glyph.id,
          surface: glyph.surface,
          tiles: rect,
          center,
          baseRadius,
          topRadius,
          bottom,
          top,
        });
      }
    }
  }
  return { daises, problems };
}

/** How far up its slope (0 at the low edge, 1 at the high one) a ramp is at (x, z), on tiles `tile` metres wide. */
function rampRise(ramp: Pick<RampDescriptor, 'tiles' | 'rises'>, tile: number, x: number, z: number): number {
  const [c0, r0, c1, r1] = ramp.tiles;
  const [x0, z0, x1, z1] = [c0 * tile, r0 * tile, (c1 + 1) * tile, (r1 + 1) * tile];
  const rise =
    ramp.rises === 'north'
      ? (z1 - z) / (z1 - z0)
      : ramp.rises === 'south'
        ? (z - z0) / (z1 - z0)
        : ramp.rises === 'west'
          ? (x1 - x) / (x1 - x0)
          : (x - x0) / (x1 - x0);
  return clamp(rise, 0, 1);
}

/** A ramp's surface height (m) at (x, z), on tiles `tile` metres wide; held to its edges' heights past them. */
export function rampHeight(
  ramp: Pick<RampDescriptor, 'tiles' | 'rises' | 'bottom' | 'top'>,
  tile: number,
  x: number,
  z: number,
): number {
  return ramp.bottom + (ramp.top - ramp.bottom) * rampRise(ramp, tile, x, z);
}

/** An octagon's "radius" at an offset from its centre: the distance to its nearest face (faces toward the axes and the diagonals). */
export function octagonRadius(dx: number, dz: number): number {
  const [ax, az] = [Math.abs(dx), Math.abs(dz)];
  return Math.max(ax, az, (ax + az) * Math.SQRT1_2);
}

/** A dais's surface height (m) at (x, z), or −Infinity off its base. */
export function daisHeight(dais: Omit<DaisDescriptor, 'glyph' | 'surface' | 'tiles'>, x: number, z: number): number {
  const r = octagonRadius(x - dais.center[0], z - dais.center[1]);
  if (!(r < dais.baseRadius)) return -Infinity;
  const up = clamp((dais.baseRadius - r) / (dais.baseRadius - dais.topRadius), 0, 1);
  return dais.bottom + (dais.top - dais.bottom) * up;
}

/** The corners of a ramp's hull (m): its rectangle on the ground, and over each corner its height there when above 0. */
export function wedgePoints(ramp: RampDescriptor, tile: number): Point3[] {
  const [c0, r0, c1, r1] = ramp.tiles;
  const corners: [number, number][] = [
    [c0 * tile, r0 * tile],
    [(c1 + 1) * tile, r0 * tile],
    [c0 * tile, (r1 + 1) * tile],
    [(c1 + 1) * tile, (r1 + 1) * tile],
  ];
  const raised = corners
    .map(([x, z]): Point3 => [x, ramp.bottom + (ramp.top - ramp.bottom) * rampRise(ramp, tile, x, z), z])
    .filter((point) => point[1] > 0);
  return [...corners.map(([x, z]): Point3 => [x, 0, z]), ...raised];
}

/** tan(π/8): an octagon of face distance r has its corners at (±r, ±r·k) and (±r·k, ±r). */
const TAN_EIGHTH = Math.SQRT2 - 1;

/** The 8 corners of an octagon of face distance `r` round (cx, cz), at height `y`, from the east face's south end. */
function octagon(cx: number, cz: number, r: number, y: number): Point3[] {
  const k = r * TAN_EIGHTH;
  const ring: [number, number][] = [
    [r, k],
    [k, r],
    [-k, r],
    [-r, k],
    [-r, -k],
    [-k, -r],
    [k, -r],
    [r, -k],
  ];
  return ring.map(([dx, dz]): Point3 => [cx + dx, y, cz + dz]);
}

/** The corners of a dais's hull (m): its base octagon on the ground (and at its bottom, when above 0) and its top. */
export function frustumPoints(dais: DaisDescriptor): Point3[] {
  const [cx, cz] = dais.center;
  const base = octagon(cx, cz, dais.baseRadius, 0);
  const rim = dais.bottom > 0 ? octagon(cx, cz, dais.baseRadius, dais.bottom) : [];
  return [...base, ...rim, ...octagon(cx, cz, dais.topRadius, dais.top)];
}
