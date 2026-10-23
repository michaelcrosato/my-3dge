/**
 * @file Unit tests for the animation-measured reach (engine/anim/proc/reach.ts, PLAN.md WP 10.1): the farthest the
 * strike point goes and when, each moment asked once from 0 to exactly 1; the stand past the reach, or past the head
 * when the head leads; a finer measure finding a peak between the coarse moments.
 * @see engine/anim/proc/reach.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { measureReach } from './reach';

describe('the animation-measured reach', () => {
  it('finds the farthest the strike point goes, when, and where to stand', () => {
    const asked: number[] = [];
    const swing = (u: number) => (asked.push(u), { strike: new Vector3(0, 1.2, 0.4 + 0.6 * Math.sin(Math.PI * u)), head: new Vector3(0, 1.6, 0.1) }); // prettier-ignore
    expect(measureReach(swing)).toEqual({ reach: expect.closeTo(1, 12), at: 0.5, head: 0.1, stand: expect.closeTo(1.19, 12) }); // prettier-ignore
    expect(asked).toEqual(Array.from({ length: 11 }, (_, i) => i / 10)); // 0 to exactly 1
    const lunge = (u: number) => ({ strike: new Vector3(0, 1, 0.5 * u), head: new Vector3(0, 1.6, 0.9 * u) }); // the head leads
    expect(measureReach(lunge).stand).toBeCloseTo(0.9 + 0.53, 12);
    const sharp = (u: number) => ({ strike: new Vector3(0, 1, 1 - 40 * (u - 0.33) * (u - 0.33)) });
    expect(measureReach(sharp, { steps: 100 }).reach).toBeGreaterThan(measureReach(sharp).reach);
    expect(measureReach(sharp).head).toBe(0); // no head given
  });
});
