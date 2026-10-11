/**
 * @file Unit tests for engine/world/spatial.ts (T1; PLAN.md WP 4.3): queries give exactly the points a brute-force
 * search finds, in the fixed order (by cell, then as added), on both sides of the origin and with many cells sharing
 * buckets; `nearest` skips and breaks ties as documented; the hash grows past its capacity and then, step after step,
 * reuses what it has.
 * @see engine/world/spatial.ts
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { SpatialHash } from './spatial';

/** Random points in a square of `side` metres round the origin, as [id, x, z]. */
function points(seed: number, count: number, side: number): [number, number, number][] {
  const rng = new Rng(seed);
  return Array.from({ length: count }, (_, i) => [
    i * 3 + 1,
    rng.range(-side / 2, side / 2),
    rng.range(-side / 2, side / 2),
  ]);
}

/** What a query must give: the points within `radius`, by cell (rows, then columns), then as added. */
function brute(all: [number, number, number][], cell: number, x: number, z: number, radius: number): number[] {
  const inside = all.filter(([, px, pz]) => (px - x) * (px - x) + (pz - z) * (pz - z) <= radius * radius);
  const key = ([, px, pz]: [number, number, number]) => [Math.floor(pz / cell), Math.floor(px / cell)];
  return inside
    .map((p, order) => ({ p, order, k: key(p) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.order - b.order)
    .map(({ p }) => p[0]);
}

describe('SpatialHash', () => {
  it('finds exactly the points within the radius, in the fixed order', () => {
    const all = points(7, 600, 60);
    const hash = new SpatialHash({ cell: 1.5, capacity: 8 });
    for (const [id, x, z] of all) hash.add(id, x, z);
    const rng = new Rng(11);
    const out = new Int32Array(600);
    for (let q = 0; q < 300; q++) {
      const [x, z, radius] = [rng.range(-35, 35), rng.range(-35, 35), rng.range(0, 6)];
      const found = hash.query(x, z, radius, out);
      expect([...out.subarray(0, found)]).toEqual(brute(all, 1.5, x, z, radius));
    }
  });

  it('counts a point on the circle, and reports how many when the output is short', () => {
    const hash = new SpatialHash({ cell: 1 }).add(1, 0, 0).add(2, 3, 4).add(3, 0.5, 0);
    const out = new Int32Array(1);
    expect(hash.query(0, 0, 5, out)).toBe(3);
    expect(out[0]).toBe(1);
    expect(hash.query(0, 0, 4.999, new Int32Array(4))).toBe(2);
    expect(hash.query(0, 0, -1, out)).toBe(0);
  });

  it('names the nearest point, skipping one, ties to the first in order', () => {
    const hash = new SpatialHash({ cell: 2 }).add(5, 1, 0).add(6, -1, 0).add(7, 0, 3);
    expect(hash.nearest(0, 0, 10)).toBe(6); // both 1 m away: (−1, 0) is in the cell row and column before (1, 0)
    expect(hash.nearest(0, 0, 10, 6)).toBe(5);
    expect(hash.nearest(0, 2.9, 10)).toBe(7);
    expect(hash.nearest(0, 0, 0.5)).toBe(-1);
  });

  it('grows past its capacity, then clears and refills without growing again', () => {
    const hash = new SpatialHash({ cell: 1, capacity: 4 });
    const all = points(3, 1000, 40);
    const out = new Int32Array(64);
    for (let step = 0; step < 5; step++) {
      hash.clear();
      for (const [id, x, z] of all) hash.add(id, x + step * 0.01, z);
      expect(hash.count).toBe(1000);
      expect(hash.capacity).toBe(1024);
      hash.query(0, 0, 3, out);
    }
    expect(hash.query(all[0][1] + 0.04, all[0][2], 0, out)).toBe(1);
    expect(out[0]).toBe(all[0][0]);
  });

  it('refuses a cell that is no width, naming the fix', () => {
    expect(() => new SpatialHash({ cell: 0 })).toThrow(/CORE_BAD_SPEC.*cell 0 is no width: give metres above 0/);
    expect(() => new SpatialHash({ capacity: 0.5 })).toThrow(/CORE_BAD_SPEC/);
  });
});
