/**
 * @file Unit tests for engine/gfx/level/roofs.ts (T1; WP 13.14): a roof's tops lie on its walkable surface, its
 * undersides its thickness lower, in two draw groups; a gable draws two planes, a hip four, a flat roof one; and a
 * chimney, a glyph whose top stands over the ridge, rises through it unclipped, drawn, collided and stood on.
 * @see engine/gfx/level/roofs.ts
 */
import { Box3, MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { compileLevel } from '../../world/level/compile';
import { defineGlyph } from '../../world/level/glyph';
import { floorBelow } from '../../world/level/heights';
import { makeRoof, roofHeight } from '../../world/level/roofs';
import { createLevelMeshes } from './meshes';
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

describe('a chimney', () => {
  it('rises through a gable unclipped, where the walls stop under it: drawn, collided and stood on 4 m up', () => {
    const registry = createRegistry();
    defineGlyph('glyph:chimney', { char: 'C', description: 'A chimney 4 m high.', top: 4, solid: true, collider: 'box', mesh: 'wall', nav: { walkable: false } }, registry); // prettier-ignore
    const text = '---\nstorey: attic\nbase: 0\nroof: gable\npitch: 45\n---\n##########\n##########\n#...C....#\n#........#\n##########\n##########\n'; // prettier-ignore
    const level = compileLevel(text, { file: 'chimney.txt', registry });
    expect(level.roofs![0].peak).toBeCloseTo(3, 12);
    const [chimney] = level.colliders.filter((part) => part.glyph === 'glyph:chimney');
    expect(chimney.shape === 'box' && [chimney.min[1], chimney.max[1]]).toEqual([0, 4]);
    expect(floorBelow(level, 4.5, 10, 2.5)).toBe(4); // its top, over the roof
    const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() } });
    const top = (name: string) => new Box3().setFromObject(meshes.parts.find((part) => part.name === `level:chimney/attic/${name}`)!.mesh).max.y; // prettier-ignore
    expect([top('wall'), top('wall#2'), top('roof')]).toEqual([expect.closeTo(2.8, 6), 4, expect.closeTo(3, 6)]);
  });
});
