/**
 * @file Seeded noise for the sim and for procedural content (PLAN.md WP 1.1): my-3d2dge's `hash2` and `noise2`,
 * bit-exact, and value, gradient and cell noise in 2D and 3D, each optionally tiling and summed in fbm octaves.
 * `createNoise2D(kind, options)` and `createNoise3D` return a plain `(x, y) => number`, as simplex-noise's factories
 * do. Presentation code that wants Perlin or simplex noise as such may use three.js's `ImprovedNoise` and
 * `SimplexNoise` addons; sim-side code cannot import addons (Appendix B), so it uses these.
 *
 * Ranges: `value` in [0, 1]; `gradient` (Perlin's, with a quintic fade) in [-1, 1] to 1e-9, its measured bound
 * (√2/2 in 2D, 1.0363538 in 3D) scaled to 1; `cell` is the distance to the nearest feature point (Worley's F1) in
 * lattice units: 0 at a point, under √2 in 2D (√3 in 3D), rarely above 1. Its search is exact: the cells within
 * reach of the nearest point so far, never a fixed 3×3 that misses some points. fbm keeps the base range: octave i has
 * frequency lacunarity^i and amplitude gain^i, the sum is divided by the total amplitude, and octaves after the first
 * get their own seed and offset, so they never share lattice points.
 *
 * Invariants: everything is a pure function of its inputs and seed (int32 hashing; floats only in interpolation),
 * the same in Node and Chromium. With `period: p` (a positive integer) a noise repeats every p units on every axis,
 * so a texture tiles; fbm then needs an integer lacunarity, and octave i repeats every p·lacunarity^i. One octave
 * of `value` noise with seed 0 and no period is `noise2`, bit for bit.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:85` (`hash2`, `noise2`).
 *
 * @example
 * hash2(3, -2); // 0.9343226293567568, my-3d2dge's value
 * const ground = createNoise2D('gradient', { seed: 7, octaves: 4 });
 * const tile = createNoise3D('cell', { seed: 1, period: 8 }); // tile(x + 8, y, z) === tile(x, y, z), to rounding
 * ground(1.5, 2.25) + tile(0.5, 0.5, 0.5);
 * @see engine/core/noise.test.ts
 */
import { mix32 } from './hash';
import { defineCodes } from './log';
import { derive, Rng } from './rng';

/** The codes this module raises, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const NOISE_CODES = defineCodes('core', {
  CORE_BAD_NOISE: {
    template: 'noise option {option} must be {rule}, got {value}',
    fix: 'pass createNoise2D/createNoise3D a kind of value, gradient or cell, octaves from 1 to 16, a finite gain, a positive lacunarity (an integer when period is set) and a period that is a positive integer, or none',
    doc: 'Raised when a noise is created (engine/core/noise.ts), never while it is sampled, so a bad option fails at once instead of giving a noise that silently stops tiling.',
  },
});

/** The kinds of noise: value (lattice values), gradient (Perlin's) and cell (Worley's F1 distance). */
export type NoiseKind = 'value' | 'gradient' | 'cell';

/** How a noise is made; every field is optional. */
export interface NoiseOptions {
  /** Any number (used as an int32); 0 by default. */
  seed?: number;
  /** Repeat every `period` units on every axis (a positive integer); no repeat by default. */
  period?: number;
  /** fbm octaves summed, 1 to 16; 1 by default (plain noise). */
  octaves?: number;
  /** The frequency ratio between octaves; 2 by default. */
  lacunarity?: number;
  /** The amplitude ratio between octaves; 0.5 by default. */
  gain?: number;
}

/** A 2D noise: a pure function of the point. */
export type Noise2D = (x: number, y: number) => number;
/** A 3D noise: a pure function of the point. */
export type Noise3D = (x: number, y: number, z: number) => number;

const TWO_32 = 4294967296;
/** xxHash's 32-bit primes; the first two are my-3d2dge's `hash2` constants. */
const PX = 374761393;
const PY = 668265263;
const PZ = 3266489917;
const PS = 2246822519;

/** The lattice hash of an integer point and seed, unsigned 32-bit; `hash2`'s with seed 0 and z = 0. */
function lattice(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, PX) + Math.imul(y | 0, PY) + Math.imul(z | 0, PZ) + Math.imul(seed, PS)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/** my-3d2dge's integer hash of a lattice point: a number in [0, 1), bit-exact. Coordinates are used as int32s. */
export function hash2(x: number, y: number): number {
  return lattice(x, y, 0, 0) / TWO_32;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** `i` wrapped into [0, p) when p > 0. */
const wrap = (i: number, p: number) => (p > 0 ? ((i % p) + p) % p : i);

/** my-3d2dge's value noise: smoothstep between `hash2` lattice values, in [0, 1], bit-exact. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi,
    u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}

/** A kernel: one octave of a noise at a point, given its seed and period (0: none). */
type Kernel = (p: readonly number[], seed: number, period: number) => number;

/** The lattice cell holding point `p` (z = 0 for a 2D point). */
const cellOf = (p: readonly number[]) => [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2] ?? 0)];

/** Value noise in `dims` dimensions: lattice values in [0, 1), blended with smoothstep (as `noise2`). */
function valueKernel(dims: 2 | 3): Kernel {
  return (p, seed, period) => {
    const [xi, yi, zi] = cellOf(p);
    const [u, v, w] = [smooth(p[0] - xi), smooth(p[1] - yi), smooth((p[2] ?? 0) - zi)];
    const [x0, x1] = [wrap(xi, period), wrap(xi + 1, period)];
    const [y0, y1] = [wrap(yi, period), wrap(yi + 1, period)];
    const at = (x: number, y: number, z: number) => lattice(x, y, z, seed) / TWO_32;
    const layer = (z: number) => lerp(lerp(at(x0, y0, z), at(x1, y0, z), u), lerp(at(x0, y1, z), at(x1, y1, z), u), v);
    if (dims === 2) return layer(0);
    return lerp(layer(wrap(zi, period)), layer(wrap(zi + 1, period)), w);
  };
}

const S = Math.SQRT1_2;
/** 2D gradients: eight unit vectors, 45° apart. */
const G2 = [1, 0, S, S, 0, 1, -S, S, -1, 0, -S, -S, 0, -1, S, -S];
/** 3D gradients: Perlin's twelve cube edges, padded to sixteen as in his improved noise. */
const G3 = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1,
  -1, 1, 1, 0, -1, 1, 0, 0, -1, 1, 0, -1, -1,
];
/** The largest |gradient noise| over every gradient choice (measured: maximised numerically to 1e-9). */
const GRADIENT_SCALE = { 2: Math.SQRT2, 3: 1 / 1.0363538112118025 };

/** Gradient (Perlin) noise in `dims` dimensions, with a quintic fade, scaled to [-1, 1]. */
function gradientKernel(dims: 2 | 3): Kernel {
  const scale = GRADIENT_SCALE[dims];
  return (p, seed, period) => {
    const [xi, yi, zi] = cellOf(p);
    const [xf, yf, zf] = [p[0] - xi, p[1] - yi, (p[2] ?? 0) - zi];
    const [u, v, w] = [quintic(xf), quintic(yf), quintic(zf)];
    const corner = (dx: number, dy: number, dz: number) => {
      const h = lattice(wrap(xi + dx, period), wrap(yi + dy, period), dims === 2 ? 0 : wrap(zi + dz, period), seed);
      if (dims === 2) {
        const g = (h >>> 29) * 2;
        return G2[g] * (xf - dx) + G2[g + 1] * (yf - dy);
      }
      const g = (h >>> 28) * 3;
      return G3[g] * (xf - dx) + G3[g + 1] * (yf - dy) + G3[g + 2] * (zf - dz);
    };
    const layer = (dz: number) =>
      lerp(lerp(corner(0, 0, dz), corner(1, 0, dz), u), lerp(corner(0, 1, dz), corner(1, 1, dz), u), v);
    return scale * (dims === 2 ? layer(0) : lerp(layer(0), layer(1), w));
  };
}

/** Cell offsets out to Chebyshev distance 2, nearest rings first, so pruning skips most of the outer ring. */
function offsets(dims: 2 | 3): number[][] {
  const out: number[][] = [];
  const span = [-2, -1, 0, 1, 2];
  for (const a of span) for (const b of span) for (const c of dims === 2 ? [0] : span) out.push([a, b, c]);
  const ring = (o: number[]) => Math.max(...o.map(Math.abs));
  return out.sort((a, b) => ring(a) - ring(b));
}

/**
 * Cell (Worley F1) noise in `dims` dimensions: one feature point per cell, the distance to the nearest. Exact: the
 * nearest point is never more than 2 cells away (the own cell's point is closer than √3 < 2), and a cell is skipped
 * only when its box is farther than the best point so far.
 */
function cellKernel(dims: 2 | 3): Kernel {
  const near = offsets(dims);
  return (p, seed, period) => {
    const [x, y, z = 0] = p;
    const [xi, yi, zi] = cellOf(p);
    /** How far `q` is from the cell [c, c + 1) along one axis. */
    const gap = (q: number, c: number) => Math.max(c - q, 0, q - c - 1);
    let best = Infinity;
    for (const [dx, dy, dz] of near) {
      const [cx, cy, cz] = [xi + dx, yi + dy, zi + dz];
      const [bx, by, bz] = [gap(x, cx), gap(y, cy), gap(z, cz)];
      if (bx * bx + by * by + bz * bz >= best) continue;
      const h1 = lattice(wrap(cx, period), wrap(cy, period), dims === 2 ? 0 : wrap(cz, period), seed);
      const h2 = mix32(h1);
      const ex = cx + h1 / TWO_32 - x;
      const ey = cy + h2 / TWO_32 - y;
      const ez = dims === 2 ? 0 : cz + mix32(h2) / TWO_32 - z;
      best = Math.min(best, ex * ex + ey * ey + ez * ez);
    }
    return Math.sqrt(best);
  };
}

const KERNELS: Record<NoiseKind, (dims: 2 | 3) => Kernel> = {
  value: valueKernel,
  gradient: gradientKernel,
  cell: cellKernel,
};

/** Throws `CORE_BAD_NOISE` unless `ok`. */
function check(ok: boolean, option: string, rule: string, value: unknown): void {
  if (ok) return;
  const { template, fix } = NOISE_CODES.CORE_BAD_NOISE;
  const message = template.replace('{option}', option).replace('{rule}', rule).replace('{value}', String(value));
  throw new RangeError(`[CORE_BAD_NOISE] ${message}: ${fix}`);
}

/** Builds the octave sum of `kind` in `dims` dimensions; one octave is the kernel itself, at the given seed. */
function build(kind: NoiseKind, dims: 2 | 3, options: NoiseOptions): (p: number[]) => number {
  const { seed = 0, period = 0, octaves = 1, lacunarity = 2, gain = 0.5 } = options;
  check(Object.hasOwn(KERNELS, kind), 'kind', 'value, gradient or cell', kind);
  check(Number.isFinite(seed), 'seed', 'a finite number', seed);
  check(period === 0 || (Number.isInteger(period) && period > 0), 'period', 'a positive integer', period);
  check(Number.isInteger(octaves) && octaves >= 1 && octaves <= 16, 'octaves', 'an integer from 1 to 16', octaves);
  check(Number.isFinite(gain), 'gain', 'a finite number', gain);
  check(lacunarity > 0 && Number.isFinite(lacunarity), 'lacunarity', 'a positive number', lacunarity);
  check(!period || Number.isInteger(lacunarity), 'lacunarity', 'an integer when period is set', lacunarity);
  const kernel = KERNELS[kind](dims);
  const s = seed | 0;
  if (octaves === 1) return (p) => kernel(p, s, period);
  // Powers by repeated multiplication, never Math.pow or **: a layer is then the same inside withSimMath and out.
  let [frequency, amplitude] = [1, 1];
  const layers = Array.from({ length: octaves }, (_, i) => {
    const offset = new Rng(derive(s, 'noise-offset', i));
    const layer = {
      seed: i === 0 ? s : derive(s, 'noise-octave', i) | 0,
      frequency,
      amplitude,
      period: period * frequency,
      offset: Array.from({ length: dims }, () => (i === 0 ? 0 : offset.range(0, 256))),
    };
    [frequency, amplitude] = [frequency * lacunarity, amplitude * gain];
    return layer;
  });
  const total = layers.reduce((sum, layer) => sum + layer.amplitude, 0);
  const q = [0, 0, 0];
  return (p) => {
    let sum = 0;
    for (const layer of layers) {
      for (let d = 0; d < dims; d++) q[d] = p[d] * layer.frequency + layer.offset[d];
      sum += layer.amplitude * kernel(q, layer.seed, layer.period);
    }
    return sum / total;
  };
}

/** A seeded 2D noise of `kind` (gradient by default); see the file comment for ranges, tiling and octaves. */
export function createNoise2D(kind: NoiseKind = 'gradient', options: NoiseOptions = {}): Noise2D {
  const noise = build(kind, 2, options);
  const p = [0, 0];
  return (x, y) => {
    p[0] = x;
    p[1] = y;
    return noise(p);
  };
}

/** A seeded 3D noise of `kind` (gradient by default); see the file comment for ranges, tiling and octaves. */
export function createNoise3D(kind: NoiseKind = 'gradient', options: NoiseOptions = {}): Noise3D {
  const noise = build(kind, 3, options);
  const p = [0, 0, 0];
  return (x, y, z) => {
    p[0] = x;
    p[1] = y;
    p[2] = z;
    return noise(p);
  };
}
