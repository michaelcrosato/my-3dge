/**
 * @file Unit tests for a town's daily round (engine/world/aiRoutes.ts, PLAN.md WP 13.21): a route's stops reached,
 * stayed at and left in turn, round to the first again, a stay of nothing passed through, a route of no stops refused;
 * someone ahead stepped round to the right, someone on the right to the left, and nobody behind, far ahead or off to
 * the side stepped round at all, at any heading.
 * @see engine/world/aiRoutes.ts
 */
import { describe, expect, it } from 'vitest';
import { followRoute, stepAside, type RouteStop } from './aiRoutes';

const at = (x: number, z: number) => ({ x, y: 0, z });

describe('a town’s daily round', () => {
  it('reaches, stays at and leaves each stop in turn, round to the first again', () => {
    const stops: RouteStop[] = [
      { at: [0, 0, 0], stay: 2, doing: 'sit' },
      { at: [10, 0, 0], stay: 0 },
      { at: [10, 0, 5], stay: 1 },
    ];
    const place = { stop: 0, since: -1 };
    expect(followRoute(stops, place, at(3, 0), 0)).toEqual({ stop: stops[0], staying: false }); // on its way
    expect(followRoute(stops, place, at(0.3, 0.3), 1)).toEqual({ stop: stops[0], staying: true }); // there: it sits
    expect(followRoute(stops, place, at(0.3, 0.3), 2.9).staying).toBe(true);
    expect(followRoute(stops, place, at(0.3, 0.3), 3)).toEqual({ stop: stops[1], staying: false }); // 2 s on: off
    expect(followRoute(stops, place, at(9.8, 0), 9).stop).toBe(stops[2]); // no stay: on through it at once
    expect(followRoute(stops, place, at(10, 4.9), 12).staying).toBe(true);
    expect(followRoute(stops, place, at(10, 4.9), 13).stop).toBe(stops[0]); // round to the first
    expect(() => followRoute([], place, at(0, 0), 0)).toThrow(/give at least a stop/);
  });

  it('steps round someone in its way, to its right, or to its left when they stand on its right', () => {
    for (const heading of [0, 1, -2.5]) {
      const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
      const [lx, lz] = [Math.cos(heading), -Math.sin(heading)]; // its left
      const ahead = (along: number, left: number) => at(fx * along + lx * left, fz * along + lz * left);
      const close = (v: [number, number] | null, w: [number, number]) => v !== null && Math.hypot(v[0] - w[0], v[1] - w[1]) < 1e-12; // prettier-ignore
      expect(close(stepAside(at(0, 0), heading, ahead(1, 0)), [-lx, -lz])).toBe(true); // dead ahead: to its right
      expect(close(stepAside(at(0, 0), heading, ahead(1, 0.3)), [-lx, -lz])).toBe(true); // ahead on its left: right
      expect(close(stepAside(at(0, 0), heading, ahead(1, -0.3)), [lx, lz])).toBe(true); // on its right: to its left
      expect(stepAside(at(0, 0), heading, ahead(-0.5, 0))).toBeNull(); // behind it
      expect(stepAside(at(0, 0), heading, ahead(2, 0))).toBeNull(); // farther than its reach
      expect(stepAside(at(0, 0), heading, ahead(1, 0.9))).toBeNull(); // off to the side
    }
  });
});
