/**
 * @file Unit tests for terrain (engine/world/terrain.ts): a spec makes its grid (cells from its size, heights at the
 * corners in float32, its bounds), its problems named; hills add domes, terraces round, flats pull their footprint to
 * their height and blend back over their margin, noise stays within its range and the same seed gives the same
 * heights; `terrainHeight` interpolates each cell's two triangles split as Rapier splits them, null outside; the
 * gradient, normal, grade and surface come from the triangle under the point; scatter places by the cells' hashes, the
 * same places every run, none on steep ground or near a flat; the registry kind defines and makes terrains.
 * @see engine/world/terrain.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import {
  defineTerrain,
  getTerrain,
  makeTerrain,
  scatterTerrain,
  terrainGrade,
  terrainGradient,
  terrainHeight,
  terrainNormal,
  terrainProblems,
  terrainSurface,
  type TerrainSpec,
} from './terrain';

describe('makeTerrain', () => {
  it('makes a grid of cells from its size, a float32 height at every corner, and its bounds', () => {
    const ground = makeTerrain({ size: [6, 4], cell: 0.5, origin: [10, 2, -3] }, 'flat');
    expect([ground.name, ground.cols, ground.rows, ground.cell]).toEqual(['flat', 12, 8, 0.5]);
    expect(ground.heights).toBeInstanceOf(Float32Array);
    expect(ground.heights.length).toBe(13 * 9);
    expect(new Set(ground.heights)).toEqual(new Set([2]));
    expect(ground.bounds).toEqual({ min: [10, 2, -3], max: [16, 2, 1] });
    expect(ground.materials).toEqual(['material:default']);
  });

  it('names every problem with a spec, and refuses to make it', () => {
    expect(terrainProblems({ size: [5, 4], cell: 2 })).toEqual(['size along x, 5 m, is no whole number of 2 m cells']);
    expect(terrainProblems({ size: [0, 4] })).toEqual(['size must be [x, z], two positive numbers of metres']);
    expect(
      terrainProblems({
        size: [4, 4],
        hills: [{ at: [1, 1], radius: 0, height: 1 }],
        flats: [{ rect: [2, 2, 1, 3], height: 0, margin: 1 }],
        materials: [],
      }),
    ).toEqual([
      // prettier-ignore
      'hills[0] must be { at: [x, z], radius (above 0), height } (m)',
      'flats[0] must be { rect: [x0, z0, x1, z1] (x1 > x0, z1 > z0), height, margin (0 or more) } (m)',
      'materials must name 1 to 3 materials: the ground, the steep, the high',
    ]);
    expect(() => makeTerrain({ size: [5, 4], cell: 2 }, 'odd')).toThrow(/CORE_BAD_SPEC.*terrain odd.*no whole number/);
  });

  it('adds hills as smooth domes: their height at the middle, nothing past their radius', () => {
    const ground = makeTerrain({ size: [20, 20], hills: [{ at: [10, 10], radius: 6, height: 3 }, { at: [10, 10], radius: 2, height: -1 }] }); // prettier-ignore
    expect(terrainHeight(ground, 10, 10)).toBe(2); // a hollow dug in the dome's top
    expect(terrainHeight(ground, 10, 13)).toBeCloseTo(1.5, 6); // halfway out: smoothstep's half
    expect(terrainHeight(ground, 10, 17)).toBe(0);
    expect(terrainHeight(ground, 0, 0)).toBe(0);
  });

  it('rounds heights to its terraces', () => {
    const ground = makeTerrain({ size: [20, 20], terrace: 0.5, hills: [{ at: [10, 10], radius: 8, height: 3 }] });
    for (const h of ground.heights) expect(Math.abs(h / 0.5 - Math.round(h / 0.5))).toBeLessThan(1e-6);
    expect(new Set(ground.heights).size).toBeGreaterThan(4);
  });

  it('flattens a footprint to its height, blending back over its margin', () => {
    const spec: TerrainSpec = { size: [40, 40], seed: 3, height: 4, scale: 10 };
    const flat = { rect: [10, 10, 20, 20] as const, height: 1.25, margin: 8 };
    const rough = makeTerrain(spec);
    const ground = makeTerrain({ ...spec, flats: [flat] });
    for (const [x, z] of [
      [10, 10],
      [15, 15],
      [20, 12],
      [21, 15],
    ])
      expect(terrainHeight(ground, x, z)).toBe(1.25); // within a quarter of the margin // prettier-ignore
    expect(terrainHeight(ground, 30, 15)).toBe(terrainHeight(rough, 30, 15)); // 10 m out: past the margin
    const between = terrainHeight(ground, 24, 15)!; // 4 m out: blending
    const [lo, hi] = [Math.min(1.25, terrainHeight(rough, 24, 15)!), Math.max(1.25, terrainHeight(rough, 24, 15)!)];
    expect(between).toBeGreaterThanOrEqual(lo);
    expect(between).toBeLessThanOrEqual(hi);
    expect(ground.flats).toEqual([flat]);
  });

  it('keeps its noise within its range, the same for the same seed and another for another', () => {
    const spec: TerrainSpec = { size: [64, 64], seed: 9, height: 2, scale: 16 };
    const a = makeTerrain(spec);
    expect(makeTerrain(spec).heights).toEqual(a.heights);
    expect(makeTerrain({ ...spec, seed: 10 }).heights).not.toEqual(a.heights);
    const [low, high] = [Math.min(...a.heights), Math.max(...a.heights)];
    expect(low).toBeGreaterThanOrEqual(-0.9 * 2 - 1e-9); // (0 − 0.45) · 2 · 2
    expect(high).toBeLessThanOrEqual(1.1 * 2 + 0.6 * 2 * 0.5 + 1e-9); // the rolling part's top and half the ridges'
    expect(high - low).toBeGreaterThan(0.5);
  });
});

describe('terrain queries', () => {
  // One cell 2 m across, 0 at three corners and 4 at its south-east one: its two triangles tell the split apart.
  const cell = makeTerrain({ size: [2, 2], cell: 2, origin: [1, 0, 1], hills: [] });
  const corner = makeTerrain({ size: [2, 2], cell: 2, origin: [1, 0, 1] });
  (corner.heights as Float32Array)[3] = 4;

  it('interpolates the triangle Rapier splits a cell into: north-east to south-west', () => {
    expect(terrainHeight(cell, 2, 2)).toBe(0);
    // u + v ≤ 1: the north-west triangle, all 0; past it, the south-east one rising to 4 at its corner.
    expect(terrainHeight(corner, 1.5, 1.5)).toBe(0);
    expect(terrainHeight(corner, 2, 2)).toBe(0);
    expect(terrainHeight(corner, 2.5, 2.5)).toBe(2);
    expect(terrainHeight(corner, 2.8, 2.2)).toBeCloseTo(2, 12);
    expect(terrainHeight(corner, 3, 3)).toBe(4);
    expect([terrainHeight(corner, 0.9, 2), terrainHeight(corner, 2, 3.1)]).toEqual([null, null]);
  });

  it('gives the triangle’s gradient, normal, grade and surface', () => {
    expect(terrainGradient(corner, 1.5, 1.5)).toEqual([0, 0]);
    expect(terrainGradient(corner, 2.5, 2.5)).toEqual([2, 2]);
    const normal = terrainNormal(corner, 2.5, 2.5)!;
    expect(normal.toArray().map((v) => +v.toFixed(6))).toEqual([-2 / 3, 1 / 3, -2 / 3].map((v) => +v.toFixed(6)));
    expect(terrainGrade(corner, 2.5, 2.5)).toBeCloseTo(Math.SQRT2 * 2, 12);
    expect([terrainSurface(corner, 1.5, 1.5), terrainSurface(corner, 2.5, 2.5), terrainSurface(corner, 0, 0)]).toEqual(['grass', 'rock', '']); // prettier-ignore
    expect(terrainNormal(corner, 9, 9)).toBeNull();
    expect(terrainGrade(corner, 9, 9)).toBeNull();
  });
});

describe('scatterTerrain', () => {
  const hill = makeTerrain({ size: [40, 40], seed: 4, hills: [{ at: [30, 20], radius: 10, height: 12 }], flats: [{ rect: [4, 4, 10, 10], height: 0, margin: 2 }] }); // prettier-ignore

  it('places by the cells’ hashes: the same places every run, another set for another salt', () => {
    const rule = { density: 0.1, scale: [0.5, 1.5] as const };
    const places = scatterTerrain(hill, rule);
    expect(scatterTerrain(hill, rule)).toEqual(places);
    expect(scatterTerrain(hill, { ...rule, salt: 1 })).not.toEqual(places);
    expect(places.length).toBeGreaterThan(80);
    expect(places.length).toBeLessThan(160);
    for (const {
      position: [x, y, z],
      yaw,
      scale,
    } of places) {
      expect(y).toBe(terrainHeight(hill, x, z));
      expect(yaw).toBeGreaterThanOrEqual(0);
      expect(yaw).toBeLessThan(2 * Math.PI);
      expect(scale).toBeGreaterThanOrEqual(0.5);
      expect(scale).toBeLessThan(1.5);
    }
  });

  it('keeps off steep ground and clear of the flats', () => {
    const places = scatterTerrain(hill, { density: 1, grade: 0.3, clear: 1 });
    for (const {
      position: [x, , z],
    } of places) {
      expect(terrainGrade(hill, x, z)).toBeLessThanOrEqual(0.3);
      expect(x > 3 && x < 11 && z > 3 && z < 11).toBe(false);
    }
    expect(places.length).toBeLessThan(40 * 40 - 36);
  });
});

describe('the terrain kind', () => {
  it('defines a spec once and makes it afresh, named by its id', () => {
    const reg = createRegistry();
    defineTerrain('terrain:knoll', { size: [16, 16], hills: [{ at: [8, 8], radius: 8, height: 2 }] }, reg);
    const knoll = getTerrain('terrain:knoll', reg);
    expect([knoll.name, terrainHeight(knoll, 8, 8)]).toEqual(['knoll', 2]);
    expect(getTerrain('terrain:knoll', reg).heights).toEqual(knoll.heights);
    expect(reg.describe('terrain').ids).toEqual(['terrain:knoll']);
    expect(() => defineTerrain('terrain:odd', { size: [5, 5], cell: 2 }, reg)).toThrow(/CORE_BAD_SPEC/);
    expect(() => getTerrain('terrain:knol', reg)).toThrow(/terrain:knoll/);
  });
});
