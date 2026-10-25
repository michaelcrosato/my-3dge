/**
 * @file The acceptance of the eval task box-prop (evals/box-prop/prompt.md), run by `node x evals` in the attempt's
 * copy: `prop:waystone` (labs/box/props/waystone.ts, its unit test beside it) stands 1.4 m tall on clean parts, a
 * stone pillar 0.4 m wide at its foot narrowing to 0.3 m under a glowing cap; its body is fixed and as tall as its
 * parts; a steady cold light shines from just above its cap; a level places it on the spawn `waystone`.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPropPart, getProp, inspectGeometry, partMatrix, propBody } from '../../engine';
import '../../labs/box/props/waystone';

const prop = getProp('prop:waystone');

/** Every vertex of the prop's parts where they stand in it, `[x, y, z]`, with the part's material. */
function vertices(): { at: number[]; material: string }[] {
  return prop.parts.flatMap((part) => {
    const array = buildPropPart(part).applyMatrix4(partMatrix(part)).getAttribute('position').array;
    return Array.from({ length: array.length / 3 }, (_, i) => ({ at: [array[3 * i], array[3 * i + 1], array[3 * i + 2]], material: part.material })); // prettier-ignore
  });
}

/** The widest a set of vertices reaches across x or z from the prop's axis, doubled: its width, m. */
const width = (points: { at: number[] }[]) => 2 * Math.max(...points.flatMap(({ at }) => [Math.abs(at[0]), Math.abs(at[2])])); // prettier-ignore

describe('prop:waystone', () => {
  it('stands 1.4 m tall on clean parts, stone under a glowing cap', () => {
    let top = 0;
    for (const part of prop.parts) {
      const report = inspectGeometry(buildPropPart(part).applyMatrix4(partMatrix(part)));
      expect([report.missing, report.degenerate, report.flipped, report.badNormals], part.name).toEqual([[], 0, 0, 0]);
      expect(report.min[1], part.name).toBeGreaterThanOrEqual(-1e-6);
      top = Math.max(top, report.max[1]);
    }
    expect(top).toBeGreaterThan(1.35);
    expect(top).toBeLessThan(1.45);
    expect(prop.parts.map((part) => part.material)).toEqual(expect.arrayContaining(['material:stone', 'material:glow'])); // prettier-ignore
  });

  it('is a stone pillar 0.4 m wide at its foot, 0.3 m at its top', () => {
    const stone = vertices().filter((vertex) => vertex.material === 'material:stone');
    const high = Math.max(...stone.map(({ at }) => at[1]));
    expect(width(stone.filter(({ at }) => at[1] < 0.01))).toBeCloseTo(0.4, 1);
    expect(width(stone.filter(({ at }) => at[1] > high - 0.01))).toBeCloseTo(0.3, 1);
  });

  it('is fixed, its body standing on its base as tall as its parts', () => {
    expect(prop.body.type).toBe('fixed');
    const body = propBody({ prop: prop.id, at: [2, 0, 3], yaw: 0 });
    expect(body?.position[0]).toBeCloseTo(2, 5);
    expect(body?.position[1]).toBeCloseTo(0.7, 1);
    expect(body?.position[2]).toBeCloseTo(3, 5);
  });

  it('lights the floor round it with a steady cold light from just above its cap', () => {
    const { tag, color, intensity, distance, flicker, position } = prop.light;
    expect([tag === '', color.toLowerCase(), intensity, distance, flicker]).toEqual([false, '#7fd4ff', 2, 5, false]);
    expect(position[1]).toBeGreaterThan(1.35);
    expect(position[1]).toBeLessThan(1.8);
  });

  it('is placed on the spawn waystone, its unit test beside it', () => {
    expect(prop.place.spawn).toBe('waystone');
    expect(existsSync('labs/box/props/waystone.test.ts')).toBe(true);
  });
});
