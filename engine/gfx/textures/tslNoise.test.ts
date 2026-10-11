/**
 * @file Unit tests for the TSL noise (engine/gfx/textures/tslNoise.ts), on its CPU twin in Node: the lattice hash is
 * murmur3's finaliser over three odd multiplies (its golden values), seeded and spread evenly; value noise is in
 * [0, 1], takes the lattice values at whole points and is continuous across cell edges; the fractal sum stays in
 * [0, 1]; the variation swings ±amount around 1 with a mean near 1, changes slowly over a metre, varies over tens of
 * metres and does not repeat at a texture's 4 m period (what it is for); and the node builders give TSL nodes and
 * refuse bad options. That the WGSL they compile to matches the twin on the GPU was measured once in Chromium 141 on
 * SwiftShader (a compute pass over 4,096 points: at most 1e-7 apart); the standing proof is the look that first uses
 * it (deferred proof: WP 7.8).
 * @see engine/gfx/textures/tslNoise.ts
 */
import { vec2, vec3 } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import { mix32 } from '../../core/hash';
import { fractalNode, fractalNoise, latticeHash, noiseNode, valueNoise, variationAt, variationNode } from './tslNoise';

describe('latticeHash', () => {
  it('is murmur3’s finaliser over x·0x8da6b343 ^ y·0xd8163841 ^ seed·0xcb1ab31f, its top 24 bits', () => {
    expect(latticeHash(0, 0, 0)).toBe(0);
    const h = Math.imul(3, 0x8da6b343) ^ Math.imul(-7, 0xd8163841) ^ Math.imul(2, 0xcb1ab31f);
    expect(latticeHash(3, -7, 2)).toBe((mix32(h) >>> 8) / 16777216);
    expect(latticeHash(3, -7, 2)).not.toBe(latticeHash(3, -7, 3));
  });

  it('spreads evenly over [0, 1)', () => {
    const bins = new Array(10).fill(0);
    for (let y = -50; y < 50; y++) for (let x = -50; x < 50; x++) bins[Math.floor(latticeHash(x, y, 1) * 10)]++;
    for (const count of bins) expect(Math.abs(count - 1000)).toBeLessThan(120);
  });
});

describe('valueNoise and fractalNoise', () => {
  it('takes the lattice value at whole points, stays in [0, 1] and is continuous across cell edges', () => {
    expect(valueNoise(4, -2, 5)).toBe(latticeHash(4, -2, 5));
    for (let k = 0; k < 2000; k++) {
      const [x, y] = [k * 0.731 - 700, k * 0.377 - 300];
      const v = valueNoise(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const f = fractalNoise(x, y, { octaves: 4 });
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    for (const edge of [-3, 0, 1, 17]) {
      expect(Math.abs(valueNoise(edge - 1e-9, 0.4) - valueNoise(edge + 1e-9, 0.4))).toBeLessThan(1e-6);
      expect(Math.abs(valueNoise(0.4, edge - 1e-9) - valueNoise(0.4, edge + 1e-9))).toBeLessThan(1e-6);
    }
  });
});

describe('variationAt', () => {
  /** The factor over a grid of world points `step` metres apart, `n` × `n`, from `origin`. */
  const grid = (n: number, step: number, origin = 0, options = {}) =>
    Array.from({ length: n * n }, (_, k) =>
      variationAt(origin + (k % n) * step, origin + Math.floor(k / n) * step, options),
    );

  it('swings within ±amount around 1, its mean near 1', () => {
    const values = grid(100, 0.71);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...values)).toBeLessThanOrEqual(1.15);
    expect(values.reduce((sum, v) => sum + v, 0) / values.length).toBeCloseTo(1, 1);
    const strong = grid(30, 1.3, 0, { amount: 0.3 });
    expect(Math.max(...strong) - Math.min(...strong)).toBeGreaterThan(0.2);
  });

  it('changes slowly over a metre and varies over tens of metres, without a texture’s 4 m repeat', () => {
    let step = 0;
    let repeat = 0;
    for (let k = 0; k < 400; k++) {
      const [x, z] = [k * 1.37, k * 0.61];
      step = Math.max(step, Math.abs(variationAt(x + 0.25, z) - variationAt(x, z)));
      repeat += Math.abs(variationAt(x + 4, z) - variationAt(x, z));
    }
    expect(step).toBeLessThan(0.05);
    expect(repeat / 400).toBeGreaterThan(0.02);
    const wide = grid(20, 3);
    expect(Math.max(...wide) - Math.min(...wide)).toBeGreaterThan(0.12);
  });

  it('is the same for the same point and options, and differs by seed', () => {
    expect(variationAt(12.5, -3.25)).toBe(variationAt(12.5, -3.25));
    expect(variationAt(12.5, -3.25, { seed: 2 })).not.toBe(variationAt(12.5, -3.25));
  });
});

describe('the nodes', () => {
  it('build TSL nodes, and refuse a scale, octave count or seed they cannot use', () => {
    expect(noiseNode(vec2(1.5, 2.5)).isNode).toBe(true);
    expect(fractalNode(vec2(1.5, 2.5), { octaves: 2 }).isNode).toBe(true);
    expect(variationNode().isNode).toBe(true);
    expect(variationNode({ scale: 4, amount: 0.1 }, vec3(1, 0, 2)).isNode).toBe(true);
    expect(() => variationNode({ scale: 0 })).toThrow(/positive scale/);
    expect(() => variationAt(0, 0, { octaves: 1.5 })).toThrow(/whole number of octaves/);
    expect(() => fractalNoise(0, 0, { seed: 0.5 })).toThrow(/whole seed/);
  });
});
