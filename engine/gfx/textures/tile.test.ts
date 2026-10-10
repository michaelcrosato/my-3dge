/**
 * @file Unit tests for the tiling helpers (engine/gfx/textures/tile.ts): `wrapIndex` folds into a period, `cellHash`
 * is seeded and spread over [0, 1), `runningBond` lays out courses with odd ones shifted and repeats at the texture's
 * size, `tileNoise` stays in [0, 1], repeats bit for bit at the size on both axes (stretched or not), and `palette`
 * refuses an empty list with its code.
 * @see engine/gfx/textures/tile.ts
 */
import { describe, expect, it } from 'vitest';
import { cellHash, palette, pickTone, runningBond, tileNoise, wrapIndex } from './tile';

describe('wrapIndex and cellHash', () => {
  it('folds any integer into [0, n)', () => {
    expect([-17, -1, 0, 15, 16, 33].map((i) => wrapIndex(i, 16))).toEqual([15, 15, 0, 15, 0, 1]);
  });

  it('hashes integer points under a seed and salt, spread over [0, 1)', () => {
    const values = Array.from({ length: 4096 }, (_, i) => cellHash(i % 64, Math.floor(i / 64), 1));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeCloseTo(0.5, 1);
    expect(cellHash(3, 4, 1)).toBe(cellHash(3, 4, 1));
    expect(cellHash(3, 4, 1)).not.toBe(cellHash(3, 4, 2));
    expect(cellHash(3, 4, 1, 0)).not.toBe(cellHash(3, 4, 1, 1));
  });
});

describe('runningBond', () => {
  it('shifts every other course by half a cell and moves the layout by its phase', () => {
    expect(runningBond(0, 0, [8, 4], [64, 64])).toEqual({ col: 0, row: 0, lx: 0, ly: 0 });
    expect(runningBond(0, 4, [8, 4], [64, 64])).toEqual({ col: 0, row: 1, lx: 4, ly: 0 });
    expect(runningBond(5, 9, [8, 4], [64, 64], [2, 2])).toEqual({ col: 0, row: 2, lx: 7, ly: 3 });
  });

  it('repeats at the texture size, cells wrapped', () => {
    for (let y = -8; y < 72; y += 3) {
      for (let x = -8; x < 72; x += 5) {
        const here = runningBond(x, y, [8, 4], [64, 32], [2, 2]);
        expect(runningBond(x + 64, y, [8, 4], [64, 32], [2, 2])).toEqual(here);
        expect(runningBond(x, y + 32, [8, 4], [64, 32], [2, 2])).toEqual(here);
        expect(here.col).toBeLessThan(8);
        expect(here.row).toBeLessThan(8);
      }
    }
  });
});

describe('tileNoise', () => {
  it('stays in [0, 1] and repeats bit for bit at the size on both axes, stretched or not', () => {
    for (const cells of [
      [4, 4],
      [2, 16],
    ] as const) {
      const noise = tileNoise([48, 32], { cells, seed: 9, octaves: 3 });
      for (let y = 0; y < 32; y += 1.5) {
        for (let x = 0; x < 48; x += 2.5) {
          const v = noise(x, y);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          expect(noise(x + 48, y)).toBe(v);
          expect(noise(x - 96, y + 64)).toBe(v);
        }
      }
    }
  });

  it('varies faster across the axis with more cells', () => {
    const noise = tileNoise([64, 64], { cells: [2, 32], seed: 3 });
    let alongX = 0;
    let alongY = 0;
    for (let i = 0; i < 64; i++) {
      alongX += Math.abs(noise(i + 1, 10) - noise(i, 10));
      alongY += Math.abs(noise(10, i + 1) - noise(10, i));
    }
    expect(alongY).toBeGreaterThan(alongX * 4);
  });

  it('refuses cell counts that are not positive whole numbers', () => {
    expect(() => tileNoise([64, 64], { cells: [2.5, 4] })).toThrow(/whole numbers/);
  });
});

describe('palette and pickTone', () => {
  it('turns hex lists into bytes and picks by a value in [0, 1)', () => {
    const tones = palette(['#ff0000', '#00ff00'], 'a test');
    expect(tones).toEqual([
      [255, 0, 0],
      [0, 255, 0],
    ]);
    expect([pickTone(tones, 0), pickTone(tones, 0.49), pickTone(tones, 0.5), pickTone(tones, 0.999)]).toEqual([
      tones[0],
      tones[0],
      tones[1],
      tones[1],
    ]);
  });

  it('refuses an empty palette with GFX_EMPTY_PALETTE', () => {
    expect(() => palette([], 'texture:x stones')).toThrow(expect.objectContaining({ code: 'GFX_EMPTY_PALETTE' }));
  });
});
