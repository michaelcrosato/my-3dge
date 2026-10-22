/**
 * @file Unit tests for engine/gfx/level/walls.ts (T1; WP 13.14): a wall under a pitched roof rises from its floor to
 * the roof's underside, as its collider's hull; each face's UV axes lie in its plane, u × v its normal.
 * @see engine/gfx/level/walls.ts
 */
import { describe, expect, it } from 'vitest';
import { makeRoof, roofUnder } from '../../world/level/roofs';
import { cross, dot, type Vec3 } from '../geometry/writer';
import { axesOf, underRoofGeometry } from './walls';

const GABLE = makeRoof({ roof: 'gable', pitch: 35 }, { storey: 3, base: 6, ceiling: 6, footprint: [0, 0, 8, 6], surface: 'shingle' }); // prettier-ignore

describe('underRoofGeometry', () => {
  it("rises a gable's end wall from the attic's floor to the underside, highest under the ridge", () => {
    const geometry = underRoofGeometry(GABLE, [[0, 0, 0.5, 6]], 6)!;
    const position = geometry.getAttribute('position');
    let top = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      top = Math.max(top, y);
      expect(y).toBeLessThanOrEqual(Math.max(6, roofUnder(GABLE, x, z)) + 1e-6);
    }
    expect(top).toBeCloseTo(GABLE.peak - GABLE.thickness, 6);
  });

  it('draws nothing where the underside never clears the floor', () => {
    const low = makeRoof({ roof: 'gable', pitch: 10 }, { storey: 0, base: 0, ceiling: 0, footprint: [0, 0, 8, 6], surface: 'shingle' }); // prettier-ignore
    expect(underRoofGeometry(low, [[0, 0, 8, 0.25]], 0)).toBeNull();
  });
});

describe('axesOf', () => {
  it('gives every face unit axes in its plane, u × v its normal; upright faces v up, level ones u along X', () => {
    const normals: Vec3[] = [[1, 0, 0], [0, 0, -1], [0, 1, 0], [0, -1, 0], [0, Math.cos(0.6), -Math.sin(0.6)], [0.48, 0.6, 0.64]]; // prettier-ignore
    for (const normal of normals) {
      const [u, v] = axesOf(normal);
      const n = cross(u, v);
      for (let k = 0; k < 3; k++) expect(n[k]).toBeCloseTo(normal[k], 9);
      expect([dot(u, u), dot(v, v), dot(u, normal)].map((value) => Math.round(value * 1e9) / 1e9)).toEqual([1, 1, 0]);
    }
    expect(axesOf([1, 0, 0])[1]).toEqual([0, 1, 0]);
    expect(axesOf([0, 1, 0])[0]).toEqual([1, 0, 0]);
  });
});
