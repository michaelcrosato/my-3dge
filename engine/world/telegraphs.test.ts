/**
 * @file Unit tests for telegraphs (engine/world/telegraphs.ts), in Node: the kind's four shapes, filled; specs with
 * problems refused naming each; the gaps of each shape at known points, turned with the yaw and scaled with the size,
 * exact against a brute-force distance to the shape's outline at random points; heights; hits and near misses; the
 * fill a view draws; a cone from a measured hit shape.
 * @see engine/world/telegraphs.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { Rng } from '../core/rng';
import {
  coneOf,
  defineTelegraph,
  floorGap,
  getTelegraph,
  inTelegraph,
  nearMiss,
  telegraphFill,
  telegraphGap,
  type Telegraph,
  type TelegraphPlace,
} from './telegraphs';

/** A place at the origin facing +Z, fully wound. */
const AT: TelegraphPlace = { telegraph: '', position: [0, 0, 0], yaw: 0, u: 1 };

/** The telegraph `spec` on a registry of its own. */
const make = (spec: Parameters<typeof defineTelegraph>[1]) => defineTelegraph('telegraph:test', spec, createRegistry());

/** The shape's outline on the floor (f forward, s to the side), as points every 2 mm, and whether (f, s) is inside. */
function outline(t: Telegraph): { points: [number, number][]; inside(f: number, s: number): boolean } {
  const points: [number, number][] = [];
  const step = 0.002;
  if (t.shape === 'line') {
    const [l, w] = [t.length, t.width / 2];
    for (let f = 0; f <= l; f += step) points.push([f, -w], [f, w]);
    for (let s = -w; s <= w; s += step) points.push([0, s], [l, s]);
    return { points, inside: (f, s) => f >= 0 && f <= l && Math.abs(s) <= w };
  }
  const [r0, r1] = [t.shape === 'cone' ? 0 : t.inner, t.radius];
  const half = t.shape === 'ring' ? Math.PI : t.halfAngle;
  for (const r of [r0, r1]) {
    if (r === 0) continue;
    for (let a = -half; a <= half; a += step / r) points.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  if (half < Math.PI) {
    for (const a of [-half, half]) {
      for (let r = r0; r <= r1; r += step) points.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  const inside = (f: number, s: number) => {
    const rho = Math.hypot(f, s);
    return rho >= r0 && rho <= r1 && Math.abs(Math.atan2(s, f)) <= half;
  };
  return { points, inside };
}

describe('the telegraph kind', () => {
  it('has the four shapes, filled with their defaults', () => {
    const reg = createRegistry();
    const arc = getTelegraph('telegraph:arc', reg);
    expect(reg.describe('telegraph').ids).toEqual([
      'telegraph:arc',
      'telegraph:cone',
      'telegraph:line',
      'telegraph:ring',
    ]);
    expect(arc).toMatchObject({ shape: 'arc', inner: 0.3, radius: 1.5, halfAngle: 0.8, near: 1, color: '#ff4a3a' });
    expect(arc.alpha).toEqual([0.25, 0.7]);
    expect(getTelegraph('telegraph:line', reg)).toMatchObject({ shape: 'line', length: 4, width: 1 });
  });

  it('refuses a spec with problems, naming each', () => {
    expect(() => make({ shape: 'ring', inner: 2, radius: 1, color: 'red' })).toThrow(
      /inner 2 is not below radius 1.*color "red" is not a hex colour/s,
    );
    expect(() => make({ shape: 'line', width: 0 })).toThrow(/a line needs a length and a width above 0/);
    expect(() => make({ yMin: 2, yMax: 1 })).toThrow(/yMin 2 is not below yMax 1/);
    expect(() => make({ alpha: [0.5] })).toThrow(/alpha has 1 numbers/);
  });
});

describe('telegraphGap', () => {
  const reg = createRegistry();
  const arc = defineTelegraph('telegraph:sweep', { shape: 'arc', inner: 0.3, radius: 2, halfAngle: 1 }, reg);
  const ring = defineTelegraph('telegraph:slam', { shape: 'ring', inner: 1, radius: 2 }, reg);
  const line = getTelegraph('telegraph:line', reg);
  const cone = defineTelegraph('telegraph:stab', { shape: 'cone', radius: 2, halfAngle: 0.5 }, reg);

  it('measures each shape at known points', () => {
    expect(telegraphGap(arc, AT, [0, 0, 1.5])).toBeCloseTo(-0.5, 12); // inside, half a metre from the rim
    expect(telegraphGap(arc, AT, [0, 0, 0.1])).toBeCloseTo(0.2, 12); // in the safe middle
    expect(telegraphGap(arc, AT, [0, 0, -1])).toBeCloseTo(Math.hypot(1 + 0.3 * Math.cos(1), 0.3 * Math.sin(1)), 12);
    expect(telegraphGap(ring, AT, [1.5, 0, 0])).toBeCloseTo(-0.5, 12);
    expect(telegraphGap(ring, AT, [0, 0, 0])).toBeCloseTo(1, 12); // the hole
    expect(telegraphGap(line, AT, [0, 0, 2])).toBeCloseTo(-0.5, 12);
    expect(telegraphGap(line, AT, [1, 0, 2])).toBeCloseTo(0.5, 12);
    expect(telegraphGap(line, AT, [0, 0, -1])).toBeCloseTo(1, 12); // behind the attacker
    expect(telegraphGap(cone, AT, [0, 0, 1])).toBeCloseTo(-Math.sin(0.5), 12);
  });

  it('is exact: the distance to the outline, signed, at random points', () => {
    const rng = new Rng(7);
    for (const t of [arc, ring, line, cone]) {
      const { points, inside } = outline(t);
      for (let i = 0; i < 200; i++) {
        const [f, s] = [rng.range(-3, 5), rng.range(-3, 3)];
        const nearest = Math.min(...points.map(([pf, ps]) => Math.hypot(f - pf, s - ps)));
        const gap = floorGap(t, f, s);
        expect(Math.abs(Math.abs(gap) - nearest), `${t.id} at ${f}, ${s}`).toBeLessThan(2e-3);
        if (nearest > 2e-3) expect(gap < 0, `${t.id} at ${f}, ${s}`).toBe(inside(f, s));
      }
    }
  });

  it('turns with the yaw, moves with the place and scales with the size', () => {
    const east: TelegraphPlace = { ...AT, position: { x: 3, y: 0, z: -1 }, yaw: Math.PI / 2 };
    expect(telegraphGap(arc, east, [4.5, 0, -1])).toBeCloseTo(-0.5, 12);
    expect(telegraphGap(line, east, [5, 0, -1])).toBeCloseTo(-0.5, 12);
    expect(telegraphGap(arc, { ...AT, size: 2 }, [0, 0, 3.5])).toBeCloseTo(-0.5, 12);
  });

  it('reaches only between its heights, and takes the body’s radius off', () => {
    const high = defineTelegraph('telegraph:high', { shape: 'cone', radius: 2, yMin: 0.5, yMax: 1.5 }, reg);
    expect(telegraphGap(high, AT, [0, 0, 1])).toBeCloseTo(0.5, 12); // under it
    expect(telegraphGap(high, AT, [0, 1, 1])).toBeCloseTo(-Math.sin(0.8), 12); // inside: the floor's distance
    expect(telegraphGap(high, AT, [0, 2, 3])).toBeCloseTo(Math.hypot(0.5, 1), 12);
    expect(inTelegraph(high, AT, [0, 0, 1], 0.5)).toBe(true); // a body half a metre round reaches up into it
    expect(telegraphGap(arc, { ...AT, position: [0, 4, 0] }, [0, 4, 1.5], 0.25)).toBeCloseTo(-0.75, 12);
  });
});

describe('hits and near misses', () => {
  const arc = getTelegraph('telegraph:arc', createRegistry());

  it('hits inside, counts a near miss within near metres outside, and nothing farther', () => {
    expect([inTelegraph(arc, AT, [0, 0, 1]), nearMiss(arc, AT, [0, 0, 1])]).toEqual([true, false]);
    expect([inTelegraph(arc, AT, [0, 0, 2.3]), nearMiss(arc, AT, [0, 0, 2.3])]).toEqual([false, true]);
    expect([inTelegraph(arc, AT, [0, 0, 2.6]), nearMiss(arc, AT, [0, 0, 2.6])]).toEqual([false, false]);
    expect(nearMiss(arc, AT, [0, 0, 2.6], 0.2)).toBe(true); // a wider body
    expect(nearMiss(arc, { ...AT, size: 2 }, [0, 0, 4.9])).toBe(true); // near scales with the size
  });
});

describe('telegraphFill', () => {
  const reg = createRegistry();

  it('grows from the inner edge to the reach as the wind-up runs', () => {
    const arc = getTelegraph('telegraph:arc', reg);
    [0.3, 0.9, 1.5, 1.5].forEach((reach, i) => expect(telegraphFill(arc, [0, 0.5, 1, 2][i])).toBeCloseTo(reach, 12));
    expect(telegraphFill(getTelegraph('telegraph:line', reg), 0.25)).toBe(1);
    expect(telegraphFill(getTelegraph('telegraph:cone', reg), 0.5)).toBe(1);
  });
});

describe('coneOf', () => {
  it("makes a cone of a measured hit shape's reach, angle and heights", () => {
    const spec = coneOf({ range: 1.69, halfAngle: 0.4, yMin: 0.6, yMax: 1.2 });
    const cone = defineTelegraph('telegraph:thrust', spec, createRegistry());
    expect(cone).toMatchObject({ shape: 'cone', radius: 1.69, halfAngle: 0.4, yMin: 0.6, yMax: 1.2 });
    expect(inTelegraph(cone, AT, [0, 0.8, 1.5])).toBe(true);
    expect(inTelegraph(cone, AT, [0, 0, 1.5])).toBe(false); // under the thrust
  });
});
