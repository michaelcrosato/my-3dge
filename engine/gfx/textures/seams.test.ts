/**
 * @file Unit tests for the texture quality measures (engine/gfx/textures/seams.ts) on generators made to fail: a
 * ramp and a noise that does not wrap show seams far above 2%, a tiling noise none; a hash of raw coordinates fails
 * the period check while its seam may hide in its own noise; values out of range are counted with the first named;
 * a broken mip chain is described level by level.
 * @see engine/gfx/textures/seams.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry, type Registry } from '../../core/registry';
import { bakeTexture, textureSampler } from './bake';
import { mipChain } from './mips';
import { measureSeam, mipProblems, periodMismatch, rangeProblems, SEAM_LIMIT } from './seams';
import { defineTexture } from './texture';
import { cellHash, tileNoise, wrapIndex } from './tile';
import type { TexelFn } from './types';

/** A registry with one generator `texture:test`, 32 × 32, whose texel colour is `grey(x, y)` and height `relief`. */
function generator(grey: (x: number, y: number) => number, relief?: (x: number, y: number) => number): Registry {
  const reg = createRegistry();
  const write: TexelFn = (x, y, texel) => {
    texel.color.fill(grey(x, y));
    if (relief) texel.height = relief(x, y);
  };
  defineTexture('texture:test', { description: 'A test.', size: [32, 32], create: () => write }, reg);
  return reg;
}

describe('measureSeam', () => {
  it('finds a ramp’s seam: its edge jumps the whole range', () => {
    const seam = measureSeam(
      bakeTexture(
        'texture:test',
        generator((x) => x * 8),
      ),
    );
    expect(seam).toMatchObject({ channel: 'map.r', axis: 'x', edge: 248, inside: 8 });
    expect(seam.delta).toBeCloseTo(240 / 255, 5);
  });

  it('finds the seam of a noise that does not wrap, and none in one that does', () => {
    const tiling = tileNoise([32, 32], { cells: [4, 4], seed: 5 });
    const broken = (x: number, y: number) => tiling(x * 1.37, y);
    expect(
      measureSeam(
        bakeTexture(
          'texture:test',
          generator((x, y) => broken(x, y) * 255),
        ),
      ).delta,
    ).toBeGreaterThan(SEAM_LIMIT);
    expect(
      measureSeam(
        bakeTexture(
          'texture:test',
          generator(() => 100, broken),
        ),
      ).channel,
    ).toBe('heightMap');
    expect(
      measureSeam(
        bakeTexture(
          'texture:test',
          generator((x, y) => tiling(x, y) * 255),
        ),
      ).delta,
    ).toBeLessThan(0.005);
  });

  it('reports 0 for a flat texture', () => {
    expect(
      measureSeam(
        bakeTexture(
          'texture:test',
          generator(() => 77),
        ),
      ).delta,
    ).toBe(0);
  });
});

describe('periodMismatch', () => {
  it('is 0 for a generator that hashes wrapped coordinates, and near 1 for one that hashes raw ones', () => {
    const wrapped = generator((x, y) => cellHash(wrapIndex(x, 32), wrapIndex(y, 32), 1) * 255);
    const raw = generator((x, y) => cellHash(x, y, 1) * 255);
    expect(periodMismatch(textureSampler('texture:test', wrapped))).toBe(0);
    expect(periodMismatch(textureSampler('texture:test', raw))).toBeGreaterThan(0.95);
  });
});

describe('rangeProblems', () => {
  it('counts texels out of range or not a number, naming the first', () => {
    const reg = generator(
      (x) => (x === 3 ? 300 : 10),
      (x, y) => (y === 5 ? Number.NaN : 0.5),
    );
    const report = rangeProblems(textureSampler('texture:test', reg));
    expect(report.count).toBe(32 + 31);
    expect(report.first).toBe('texel (3, 0) has color [300, 300, 300]');
  });
});

describe('mipProblems', () => {
  it('passes a whole chain and describes a broken one level by level', () => {
    const bake = bakeTexture('texture:brick');
    const chain = mipChain(bake.map, 64, 64, 'srgb');
    expect(mipProblems(chain, 'srgb')).toEqual([]);
    const darkened = chain.map((level, i) => (i === 2 ? { ...level, data: level.data.map((b) => b >> 1) } : level));
    expect(mipProblems(darkened, 'srgb')).toEqual([expect.stringMatching(/^level 2's mean drifts/)]);
    expect(mipProblems(chain.slice(0, 4), 'srgb')).toEqual([
      '4 levels; a 64 × 64 map has 7',
      'the last level is 8 × 8, not 1 × 1',
    ]);
    const squashed = chain.map((level, i) => (i === 1 ? { ...level, width: 16 } : level));
    expect(mipProblems(squashed, 'srgb')[0]).toMatch(/^level 1 is 16 × 32 .* it must be 32 × 32$/);
    const normals = mipChain(bake.normalMap, 64, 64, 'normal');
    const shortened = normals.map((level, i) =>
      i === 3 ? { ...level, data: level.data.map((b, k) => ((k & 3) === 2 ? 128 : b)) } : level,
    );
    expect(mipProblems(normals, 'normal')).toEqual([]);
    expect(mipProblems(shortened, 'normal')[0]).toMatch(/^level 3 texel \d+ has a normal of length/);
  });
});
