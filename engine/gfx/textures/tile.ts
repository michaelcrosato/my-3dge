/**
 * @file Tiling helpers for texture generators (PLAN.md WP 2.3, I-20): what a generator uses so its texels are a
 * periodic function of the integer texel position, and its texture tiles without a seam. `wrapIndex` folds an index
 * into a period; `palette` and `pickTone` turn hex lists into bytes and choose among them; `cellHash` gives a seeded
 * value per integer point (hash wrapped coordinates, never raw ones); `runningBond` lays out bricks, stones and
 * boards in courses with every other course shifted half a cell; and `tileNoise` is value noise with a whole number
 * of cells on each axis, so it repeats exactly at the texture's size, and may be stretched (wood grain: few cells
 * along a board, many across).
 *
 * Coordinates are texels: x right (u), y up (v), texel (0, 0) at the bottom left, as a `DataTexture` lays them out.
 * `phase` shifts a layout so the wrap edge runs through the middle of cells, never along a joint: a joint on the
 * edge would sit on a seam, and the tileability check (engine/gfx/textures/seams.ts) compares the edge with its
 * neighbours.
 *
 * Invariants: everything is a pure function of its arguments (int32 hashing, smoothstep blending; no `Math.random`,
 * clocks or trigonometry), the same in Node and Chromium. `runningBond` needs the width to be a multiple of the cell
 * width and the height a multiple of two cell heights (an even count of courses), which each generator's `tile`
 * states; `tileNoise` repeats every `width` × `height` texels for whole cell counts.
 *
 * @example
 * wrapIndex(-1, 16); // 15
 * cellHash(3, 4, 1) === cellHash(3 + 64, 4, 1); // false: hash wrapped coordinates (wrapIndex(x, width)), not raw ones
 * const cell = runningBond(5, 9, [8, 4], [64, 64], [2, 2]); // { col: 0, row: 2, lx: 7, ly: 3 }
 * const grain = tileNoise([64, 64], { cells: [4, 32], seed: 7 });
 * grain(10, 3) === grain(10 + 64, 3 - 64); // true
 * @see engine/gfx/textures/tile.test.ts
 */
import { hex, type Rgb } from '../../core/color';
import { mix32 } from '../../core/hash';
import { codeError } from '../../core/log';
import './codes';

const TWO_32 = 4294967296;

/** `i` folded into [0, n) (n a positive integer): -1 → n − 1. */
export function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/**
 * A seeded value in [0, 1) for the integer point (x, y), with `salt` telling apart uses of one seed (a stone's tone,
 * its crack). Coordinates are used as int32s: give wrapped ones (`wrapIndex(col, cols)`) so the value tiles.
 */
export function cellHash(x: number, y: number, seed: number, salt = 0): number {
  const h =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 1274126177) +
      Math.imul(salt | 0, 2246822519)) |
    0;
  return mix32(h) / TWO_32;
}

/** A palette's hex colours as sRGB bytes; throws `GFX_EMPTY_PALETTE` naming `what` when it has none. */
export function palette(colors: readonly string[], what: string): Rgb[] {
  if (colors.length === 0) throw codeError('GFX_EMPTY_PALETTE', { what });
  return colors.map((color) => hex(color));
}

/** One of `colors`, picked by `value` in [0, 1). */
export function pickTone<T>(colors: readonly T[], value: number): T {
  return colors[Math.min(colors.length - 1, Math.floor(value * colors.length))];
}

/** One texel's place in a running bond: its cell's column and row (wrapped) and its position inside the cell. */
export interface BondCell {
  col: number;
  row: number;
  /** Texels from the cell's left edge, 0 to cell width − 1. */
  lx: number;
  /** Texels from the cell's bottom edge, 0 to cell height − 1. */
  ly: number;
}

/**
 * Where texel (x, y) falls in a running bond of `cell` = [width, height] texels over a texture of `size`: courses
 * (rows) of cells, odd courses shifted half a cell, the whole layout moved by `phase` texels. The size must be a
 * whole number of cells across and an even number of courses up, so the bond tiles.
 */
export function runningBond(
  x: number,
  y: number,
  cell: readonly [number, number],
  size: readonly [number, number],
  phase: readonly [number, number] = [0, 0],
): BondCell {
  const [cw, ch] = cell;
  const rows = size[1] / ch;
  const yy = y + phase[1];
  const course = Math.floor(yy / ch);
  const row = wrapIndex(course, rows);
  const xx = x + phase[0] + (row & 1 ? Math.floor(cw / 2) : 0);
  const column = Math.floor(xx / cw);
  return { col: wrapIndex(column, size[0] / cw), row, lx: xx - column * cw, ly: yy - course * ch };
}

/** How `tileNoise` is made. */
export interface TileNoiseOptions {
  /** Noise cells across the texture on each axis, whole numbers: [4, 32] is long along x, short along y. */
  cells: readonly [number, number];
  seed?: number;
  /** Octaves summed, each with twice the cells and `gain` times the weight; 1 by default. */
  octaves?: number;
  gain?: number;
  /** Tells apart two noises of one seed. */
  salt?: number;
}

/** Smoothstep. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise in [0, 1] over a texture of `size` texels, repeating exactly every `size`: lattice values from
 * `cellHash`, blended with smoothstep, `cells` lattice cells across on each axis (stretched when they differ), summed
 * over octaves and divided by the total weight.
 */
export function tileNoise(
  size: readonly [number, number],
  options: TileNoiseOptions,
): (x: number, y: number) => number {
  const { seed = 0, octaves = 1, gain = 0.5, salt = 0 } = options;
  const [cx, cy] = options.cells;
  if (!(Number.isInteger(cx) && Number.isInteger(cy) && cx > 0 && cy > 0)) {
    throw new RangeError(`tileNoise cells must be positive whole numbers, got [${cx}, ${cy}]`);
  }
  // Weights by repeated multiplication, never Math.pow or **: the same bits in every engine.
  let weight = 1;
  const layers = Array.from({ length: octaves }, (_, i) => {
    const layer = { nx: cx << i, ny: cy << i, weight, salt: salt * 31 + i };
    weight *= gain;
    return layer;
  });
  const total = layers.reduce((sum, layer) => sum + layer.weight, 0);
  const [width, height] = size;
  return (x, y) => {
    // Folded into the texture first, so the noise repeats bit for bit, not just to rounding.
    const px = wrapIndex(x, width) / width;
    const py = wrapIndex(y, height) / height;
    let sum = 0;
    for (const { nx, ny, weight: w, salt: layerSalt } of layers) {
      const u = px * nx;
      const v = py * ny;
      const iu = Math.floor(u);
      const iv = Math.floor(v);
      const fu = smooth(u - iu);
      const fv = smooth(v - iv);
      const [x0, x1, y0, y1] = [wrapIndex(iu, nx), wrapIndex(iu + 1, nx), wrapIndex(iv, ny), wrapIndex(iv + 1, ny)];
      const a = cellHash(x0, y0, seed, layerSalt);
      const b = cellHash(x1, y0, seed, layerSalt);
      const c = cellHash(x0, y1, seed, layerSalt);
      const d = cellHash(x1, y1, seed, layerSalt);
      const bottom = a + (b - a) * fu;
      sum += w * (bottom + (c + (d - c) * fu - bottom) * fv);
    }
    return sum / total;
  };
}
