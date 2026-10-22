/**
 * @file Unit tests for engine/world/level/roofs.ts (T1; WP 13.13): a gable's, a hip's and a flat roof's heights over
 * their footprints and eaves, the ridge along the longer side unless a gable gives it; their slabs as convex hulls on
 * the top and their thickness under it; a wall under a pitched roof clipped to its underside at the corners and where
 * the creases cross it, and none where the roof is too low.
 * @see engine/world/level/roofs.ts
 */
import { describe, expect, it } from 'vitest';
import { makeRoof, ROOF_THICKNESS, roofColliders, roofHeight, roofUnder, wallUnder } from './roofs';

const SITE = { storey: 0, base: 0, ceiling: 3, footprint: [0, 0, 8, 6] as const, surface: 'shingle' };
const tan = (degrees: number) => Math.tan((degrees * Math.PI) / 180);

describe('makeRoof and roofHeight', () => {
  it('rises a gable from the long sides to a ridge along x, its eaves on the ceiling, falling on past the walls', () => {
    const roof = makeRoof({ roof: 'gable', pitch: 30, eaves: 0.5 }, SITE);
    expect([roof.ridge, roof.eave, roof.eaves, roof.thickness]).toEqual(['x', 3, 0.5, ROOF_THICKNESS]);
    expect(roof.peak).toBeCloseTo(3 + 3 * tan(30), 12);
    expect(roofHeight(roof, 4, 3)).toBeCloseTo(roof.peak, 12);
    expect(roofHeight(roof, 0.1, 3)).toBeCloseTo(roof.peak, 12); // a gable is as high at its ends
    expect(roofHeight(roof, 4, 0)).toBe(3);
    expect(roofHeight(roof, 4, -0.5)).toBeCloseTo(3 - 0.5 * tan(30), 12);
    expect([roofHeight(roof, 4, -0.6), roofHeight(roof, 8.6, 3)]).toEqual([-Infinity, -Infinity]);
    expect(roofUnder(roof, 4, 3)).toBeCloseTo(roof.peak - 0.2, 12);
  });

  it('takes a gable’s ridge across when given, and a hip’s along the longer side', () => {
    const across = makeRoof({ roof: 'gable', pitch: 30, ridge: 'z' }, SITE);
    expect([across.ridge, roofHeight(across, 4, 0.5)]).toEqual(['z', across.peak]);
    expect(across.peak).toBeCloseTo(3 + 4 * tan(30), 12);
    const hip = makeRoof({ roof: 'hip', pitch: 30 }, SITE);
    expect(hip.ridge).toBe('x');
    expect(roofHeight(hip, 4, 3)).toBeCloseTo(3 + 3 * tan(30), 12);
    expect(roofHeight(hip, 1, 3)).toBeCloseTo(3 + 1 * tan(30), 12); // a hip falls toward its ends too
    expect(makeRoof({ roof: 'hip', pitch: 30 }, { ...SITE, footprint: [0, 0, 4, 10] }).ridge).toBe('z');
  });

  it('lays a flat roof on the ceiling, its top its thickness up, everywhere over its area', () => {
    const roof = makeRoof({ roof: 'flat', eaves: 0.25 }, SITE);
    expect([roof.pitch, roof.slope, roof.eave, roof.peak]).toEqual([0, 0, 3.2, 3.2]);
    expect([roofHeight(roof, 4, 3), roofHeight(roof, -0.25, 6.25), roofHeight(roof, -0.3, 3)]).toEqual([3.2, 3.2, -Infinity]); // prettier-ignore
  });
});

describe('roofColliders', () => {
  it('makes a gable two planes, a hip four and a flat roof one, each its top and its thickness under it', () => {
    for (const [kind, planes] of [
      ['gable', 2],
      ['hip', 4],
      ['flat', 1],
    ] as const) {
      const roof = makeRoof({ roof: kind, pitch: 35, eaves: 0.5 }, SITE);
      const hulls = roofColliders(roof);
      expect(hulls.length).toBe(planes);
      for (const points of hulls) {
        const top = points.slice(0, points.length / 2);
        const under = points.slice(points.length / 2);
        top.forEach(([x, y, z], i) => {
          expect(y).toBeCloseTo(roofHeight(roof, x, z), 12);
          expect(under[i]).toEqual([x, y - roof.thickness, z]);
        });
      }
    }
  });
});

describe('wallUnder', () => {
  it('clips a gable’s end wall to the underside, through the ridge where it crosses, and off where it is under the floor', () => {
    const roof = makeRoof({ roof: 'gable', pitch: 35 }, { ...SITE, ceiling: 0.2 });
    const points = wallUnder(roof, [0, 0, 0.5, 6], 0.2)!;
    // 6 on the floor (the ridge's 2 and where the underside meets the floor on each long edge) and 8 under the roof:
    // the 4 corners' underside lies below the floor (it starts 0.2 m down at the eaves), so they are clipped away.
    expect(points.length).toBe(12);
    const floor = points.filter(([, y]) => y === 0.2);
    for (const [x, y, z] of points.filter((p) => !floor.includes(p))) expect(y).toBeCloseTo(roofUnder(roof, x, z), 12);
    for (const [x, y, z] of points) expect(y).toBeLessThanOrEqual(Math.max(0.2, roofUnder(roof, x, z)) + 1e-12);
    const edge = ROOF_THICKNESS / tan(35); // where the underside rises through the floor, in from each eave
    expect(Math.min(...points.map(([, , z]) => z))).toBeCloseTo(edge, 12);
    expect(Math.max(...points.map(([, , z]) => z))).toBeCloseTo(6 - edge, 12);
    expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(roof.peak - roof.thickness, 12);
  });

  it('adds a hip’s crease ends and crossings, and gives null where the underside never clears the floor', () => {
    const hip = makeRoof({ roof: 'hip', pitch: 30 }, SITE);
    const points = wallUnder(hip, [2, 2, 6, 4], 3)!;
    for (const [x, y, z] of points.slice(4)) expect(y).toBeCloseTo(roofUnder(hip, x, z), 12);
    expect(points.some(([x, , z]) => x === 2.5 + 0.5 && z === 3)).toBe(true); // the ridge's west end, inside
    const low = makeRoof({ roof: 'gable', pitch: 10 }, { ...SITE, ceiling: 0 });
    expect(wallUnder(low, [0, 0, 8, 0.25], 0)).toBeNull();
  });
});
