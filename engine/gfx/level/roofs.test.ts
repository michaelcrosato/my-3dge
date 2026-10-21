/**
 * @file Unit tests for engine/gfx/level/roofs.ts (T1; WP 13.14): a roof's tops lie on its walkable surface, its
 * undersides its thickness lower, in two draw groups; a gable draws two planes, a hip four, a flat roof one.
 * @see engine/gfx/level/roofs.ts
 */
import { describe, expect, it } from 'vitest';
import { makeRoof, roofHeight } from '../../world/level/roofs';
import { roofGeometry } from './roofs';

const SITE = { storey: 0, base: 0, ceiling: 3, footprint: [0, 0, 8, 6] as const, surface: 'shingle' };

describe('roofGeometry', () => {
  it.each([
    ['gable', 2],
    ['hip', 4],
    ['flat', 1],
  ] as const)('draws a %s roof’s %i planes, tops on its surface and undersides under them', (kind, planes) => {
    const roof = makeRoof({ roof: kind, pitch: 35, eaves: 0.5 }, SITE);
    const geometry = roofGeometry(roof);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    const top = geometry.groups[0];
    let [tops, unders] = [0, 0];
    for (let t = top.start; t < top.start + top.count; t++) {
      const i = index.getX(t);
      expect(position.getY(i)).toBeCloseTo(roofHeight(roof, position.getX(i), position.getZ(i)), 6);
      tops++;
    }
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const surface = roofHeight(roof, position.getX(i), position.getZ(i));
      if (Math.abs(y - (surface - roof.thickness)) < 1e-6) unders++;
    }
    expect(tops).toBeGreaterThanOrEqual(planes * 3);
    expect(unders).toBeGreaterThan(0);
  });
});
