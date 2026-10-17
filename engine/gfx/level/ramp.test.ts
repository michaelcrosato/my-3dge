/**
 * @file Unit tests for smooth ramps (engine/gfx/level/ramp.ts): a ramp's wedge is clean by the QA measures, fills
 * exactly its tiles, carries its slope exactly at `rampHeight` (so what slides on the collider is seen on the slope),
 * faces out on every side, shows a front only when it starts above the ground, and is what a glyph whose `mesh` is
 * `ramp` draws through the level meshes.
 * @see engine/gfx/level/ramp.ts
 */
import { MeshBasicMaterial, type BufferGeometry } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { compileLevel } from '../../world/level/compile';
import { defineGlyph } from '../../world/level/glyph';
import { rampHeight } from '../../world/level/shapes';
import type { RampDescriptor } from '../../world/level/types';
import { inspectGeometry } from '../geometry/inspect';
import { createLevelMeshes } from './meshes';
import { rampGeometry } from './ramp';

/** A ramp 4 m wide and 12 m long rising north to 2 m, its tiles 0.5 m. */
const RAMP: RampDescriptor = {
  glyph: 'glyph:slide',
  surface: 'stone',
  tiles: [0, 0, 7, 23],
  rises: 'north',
  bottom: 0,
  top: 2,
};

/** Every vertex of `geometry` as [x, y, z], with its normal. */
function vertices(geometry: BufferGeometry): { at: number[]; normal: number[] }[] {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  return Array.from({ length: p.count }, (_, i) => ({
    at: [p.getX(i), p.getY(i), p.getZ(i)],
    normal: [n.getX(i), n.getY(i), n.getZ(i)],
  }));
}

describe('rampGeometry', () => {
  it('is clean by the QA measures and fills exactly its tiles, from the ground to its top', () => {
    const report = inspectGeometry(rampGeometry(0.5, [RAMP], 0));
    expect(report.missing).toEqual([]);
    expect([report.badIndex, report.nonFinite, report.degenerate, report.badNormals, report.flipped]).toEqual([
      0, 0, 0, 0, 0,
    ]);
    expect(report.min).toEqual([0, 0, 0]);
    expect(report.max).toEqual([4, 2, 12]);
  });

  it('carries its slope exactly at rampHeight, facing up and down the ramp', () => {
    const geometry = rampGeometry(0.5, [RAMP], 0);
    const slope = vertices(geometry).filter(({ normal }) => normal[1] > 0.5);
    expect(slope).toHaveLength(4);
    for (const { at } of slope) expect(at[1]).toBeCloseTo(rampHeight(RAMP, 0.5, at[0], at[2]), 9);
    // rising north (−Z): the slope's normal leans south (+Z), by the slope's angle
    const angle = Math.atan2(2, 12);
    expect(slope[0].normal[2]).toBeCloseTo(Math.sin(angle), 6); // normals are float32
    expect(slope[0].normal[1]).toBeCloseTo(Math.cos(angle), 6);
  });

  it('faces out on every side: the back north, the sides east and west, the slope up; no front at the ground', () => {
    const geometry = rampGeometry(0.5, [RAMP], 0);
    const outward = vertices(geometry).map(({ normal }) => normal.map((v) => Math.round(v * 1000) / 1000).join());
    expect(new Set(outward).has('0,0,-1')).toBe(true); // the back, where it meets what it climbs to
    expect(new Set(outward).has('-1,0,0')).toBe(true); // the west side
    expect(new Set(outward).has('1,0,0')).toBe(true); // the east side
    expect(new Set(outward).has('0,0,1')).toBe(false); // it starts at the ground: no front
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
  });

  it('shows a front when it starts above the ground', () => {
    const raised = { ...RAMP, bottom: 0.5 };
    const outward = vertices(rampGeometry(0.5, [raised], 0)).map(({ normal }) => normal.map(Math.round).join());
    expect(outward).toContain('0,0,1');
    expect(inspectGeometry(rampGeometry(0.5, [raised], 0)).degenerate).toBe(0);
  });

  it("is what a glyph whose mesh is 'ramp' draws through the level meshes", () => {
    const registry = createRegistry();
    defineGlyph(
      'glyph:slide',
      { char: 'r', description: 'A slide ramp to 2 m.', top: 2, floorShape: 'ramp', collider: 'hull', mesh: 'ramp' },
      registry,
    );
    defineGlyph(
      'glyph:deck',
      { char: 'R', description: 'A deck 2 m up.', floor: 2, top: 2, collider: 'box', mesh: 'gallery' },
      registry,
    );
    const text = ['RRRR', 'rrrr', 'rrrr', 'rrrr', '....'].join('\n');
    const level = compileLevel(`${text}\n`, { file: 'ramp.txt', registry });
    const material = new MeshBasicMaterial();
    const meshes = createLevelMeshes(level, { materials: { get: () => material } });
    const part = meshes.parts.find((each) => each.recipe === 'ramp');
    expect(part?.shape).toBe('ramp');
    expect(inspectGeometry(part!.mesh.geometry).max).toEqual([4, 2, 4]);
  });
});
