/**
 * @file TSL noise for large-scale variation (PLAN.md WP 7.3, I-20): value noise and its fractal sum as TSL nodes,
 * evaluated per pixel on the GPU in world space, so a tiled texture (a 4 m flagstone repeat) can be broken up over
 * tens of metres without a bigger bake: `variationNode(options)` is a factor around 1 to multiply a material's colour
 * by, slowly varying across the ground (`positionWorld.xz`, metres). Each function has a CPU twin built from the very
 * same arithmetic (`valueNoise`, `fractalNoise`, `variationAt`), which the unit tests measure and which CPU bakes may
 * use to agree with what the GPU draws.
 *
 * How it agrees: the lattice hash is integer-only (three multiplies by odd constants, then murmur3's 32-bit finaliser,
 * engine/core/hash.ts `mix32`), wrapping modulo 2^32 in WGSL's u32 as in `Math.imul`; its top 24 bits become a float,
 * exact in f32. The blend (smoothstep, two lerps per octave) runs in f32 on the GPU and f64 here, so the twin matches
 * within about 1e-6, far below a colour byte. No trigonometry and no texture lookups: it compiles to plain WGSL.
 *
 * Nodes stay inside engine/gfx (game code never sees them, doctrine: Common ground); a material compiler multiplies
 * its colour by `variationNode` where a material asks for variation. Options are constants of the shader: a material
 * that changes them compiles a new one, so they belong in its data, not in a per-frame update.
 *
 * Invariants: `valueNoise` is in [0, 1], continuous, 1 lattice cell per unit; `fractalNoise` is its weighted mean over
 * octaves (each twice the frequency, `gain` times the weight, its own seed), so also in [0, 1]; `variationAt` is in
 * [1 − amount, 1 + amount]; nothing tiles (the hash takes raw lattice coordinates, which is the point).
 *
 * @example
 * variationAt(10, 3) === variationAt(10, 3); // true, and within 0.15 of 1 (the default amount)
 * // material.colorNode = materialColor.mul(variationNode({ scale: 12, amount: 0.1 }));
 * @see engine/gfx/textures/tslNoise.test.ts
 */
import { float, positionWorld, uint, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { mix32 } from '../../core/hash';

/** The odd constants the lattice hash multiplies x, y and the seed by (from the xxHash32 primes' family). */
const KX = 0x8da6b343;
const KY = 0xd8163841;
const KS = 0xcb1ab31f;
/** 2^24: the hash's top 24 bits over it give a float in [0, 1), exact in f32. */
const TWO_24 = 16777216;

/** How the large-scale variation is made. */
export interface VariationOptions {
  /** The size of its largest features, in metres (one lattice cell of the first octave); 8 by default. */
  scale?: number;
  /** How far the factor swings either side of 1; 0.15 by default (±15%). */
  amount?: number;
  /** Octaves summed, each twice as fine; 3 by default. */
  octaves?: number;
  /** Each octave's weight relative to the one before; 0.5 by default. */
  gain?: number;
  /** Tells apart two variations; 1 by default. */
  seed?: number;
}

/** The options filled with their defaults. */
function filled(options: VariationOptions): Required<VariationOptions> {
  const { scale = 8, amount = 0.15, octaves = 3, gain = 0.5, seed = 1 } = options;
  if (!(scale > 0) || !(octaves >= 1) || !Number.isInteger(octaves) || !Number.isInteger(seed)) {
    throw new RangeError(
      `variation needs a positive scale, a whole number of octaves (1 or more) and a whole seed, got ${scale}, ${octaves}, ${seed}`,
    );
  }
  return { scale, amount, octaves, gain, seed };
}

/** The lattice value at integer point (x, y) for `seed`, in [0, 1): the CPU twin of the shader's hash. */
export function latticeHash(x: number, y: number, seed: number): number {
  const h = Math.imul(x | 0, KX) ^ Math.imul(y | 0, KY) ^ Math.imul(seed | 0, KS);
  return (mix32(h) >>> 8) / TWO_24;
}

/** Smoothstep's polynomial, t²(3 − 2t). */
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1] at (x, y), one lattice cell per unit: the CPU twin of `noiseNode`. */
export function valueNoise(x: number, y: number, seed = 1): number {
  const [ix, iy] = [Math.floor(x), Math.floor(y)];
  const [u, v] = [smooth(x - ix), smooth(y - iy)];
  const a = latticeHash(ix, iy, seed);
  const b = latticeHash(ix + 1, iy, seed);
  const c = latticeHash(ix, iy + 1, seed);
  const d = latticeHash(ix + 1, iy + 1, seed);
  const bottom = a + (b - a) * u;
  return bottom + (c + (d - c) * u - bottom) * v;
}

/** The weights of `octaves` octaves at `gain`, by repeated multiplication (never `**`), and their sum. */
function weights(octaves: number, gain: number): { each: number[]; total: number } {
  const each: number[] = [];
  let w = 1;
  for (let o = 0; o < octaves; o++) {
    each.push(w);
    w *= gain;
  }
  return { each, total: each.reduce((sum, value) => sum + value, 0) };
}

/** Fractal value noise in [0, 1] at (x, y): the weighted mean of `octaves` octaves. The CPU twin of `fractalNode`. */
export function fractalNoise(x: number, y: number, options: VariationOptions = {}): number {
  const { octaves, gain, seed } = filled(options);
  const { each, total } = weights(octaves, gain);
  let sum = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += each[o] * valueNoise(x * f, y * f, seed + o);
    f *= 2;
  }
  return sum / total;
}

/** The variation factor at world (x, z) metres: 1 + amount (2 · fractal noise at (x, z) / scale − 1). */
export function variationAt(x: number, z: number, options: VariationOptions = {}): number {
  const { scale, amount } = filled(options);
  return 1 + amount * (2 * fractalNoise(x / scale, z / scale, options) - 1);
}

/** The shader's lattice hash of the integer point `cell` (an ivec2 node) for `seed`, as a float in [0, 1). */
function hashNode(ix: Node, iy: Node, seed: number): Node {
  let h = ix
    .toUint()
    .mul(uint(KX))
    .bitXor(iy.toUint().mul(uint(KY)))
    .bitXor(uint(Math.imul(seed | 0, KS) >>> 0));
  h = h.bitXor(h.shiftRight(uint(16))).mul(uint(0x85ebca6b));
  h = h.bitXor(h.shiftRight(uint(13))).mul(uint(0xc2b2ae35));
  h = h.bitXor(h.shiftRight(uint(16)));
  return float(h.shiftRight(uint(8))).div(TWO_24);
}

/** Value noise in [0, 1] at the vec2 node `p`, one lattice cell per unit (`valueNoise` on the GPU). */
export function noiseNode(p: Node, seed = 1): Node {
  const cell = p.floor();
  const [ix, iy] = [cell.x.toInt(), cell.y.toInt()];
  const f = p.sub(cell);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hashNode(ix, iy, seed);
  const b = hashNode(ix.add(1), iy, seed);
  const c = hashNode(ix, iy.add(1), seed);
  const d = hashNode(ix.add(1), iy.add(1), seed);
  const bottom = a.add(b.sub(a).mul(u.x));
  return bottom.add(c.add(d.sub(c).mul(u.x)).sub(bottom).mul(u.y));
}

/** Fractal value noise in [0, 1] at the vec2 node `p` (`fractalNoise` on the GPU). */
export function fractalNode(p: Node, options: VariationOptions = {}): Node {
  const { octaves, gain, seed } = filled(options);
  const { each, total } = weights(octaves, gain);
  let sum: Node = float(0);
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum = sum.add(noiseNode(p.mul(f), seed + o).mul(each[o]));
    f *= 2;
  }
  return sum.div(total);
}

/**
 * The large-scale variation factor as a float node around 1 (`variationAt` on the GPU), sampled at `position`'s x
 * and z (world space by default, so it runs on across meshes and instances): multiply a colour by it.
 */
export function variationNode(options: VariationOptions = {}, position: Node = positionWorld): Node {
  const { scale, amount } = filled(options);
  const p = vec2(position.x, position.z).div(scale);
  return float(1).add(fractalNode(p, options).mul(2).sub(1).mul(amount));
}
