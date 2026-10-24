/**
 * @file Unit tests for the blends (engine/anim/proc/blend.ts, PLAN.md WP 10.1): weights easing linearly toward their
 * targets at their own rates up and down, stopping there, clamped and settled at once; the pose stack's later layers
 * winning by their weight without wrapping; angles averaged the short way round; a pitch and a yaw as a direction.
 * @see engine/anim/proc/blend.ts
 */
import { describe, expect, it } from 'vitest';
import { aimDirection, blendAngles, layerPose, StateWeights } from './blend';

describe('the blends', () => {
  it('ease each weight toward its target at its rates up and down, never past it', () => {
    const body = new StateWeights({ run: 5, low: [14, 7], hurt: [16, 7] }, { hurt: 1 });
    body.aim({ run: 1, low: 2 }); // clamped to 1
    body.step(0.05);
    expect(body.weights).toEqual({ run: expect.closeTo(0.25, 12), low: expect.closeTo(0.7, 12), hurt: 1 });
    body.aim({ low: 0, hurt: 0 }).step(0.05);
    expect([body.get('low'), body.get('hurt')]).toEqual([expect.closeTo(0.35, 12), expect.closeTo(0.65, 12)]); // 7 a second down
    for (let i = 0; i < 20; i++) body.step(0.05);
    expect(body.weights).toEqual({ run: 1, low: 0, hurt: 0 }); // on their targets, not past them
    const rate = (dt: number, n: number) => {
      const w = new StateWeights({ air: [9, 7] }).aim({ air: 1 });
      for (let i = 0; i < n; i++) w.step(dt);
      return w.get('air');
    };
    expect(rate(1 / 60, 6)).toBeCloseTo(rate(1 / 120, 12), 12); // any step: linear ramps
    expect(new StateWeights({ a: 1 }).aim({ a: 0.4 }).settle().get('a')).toBe(0.4);
  });

  it('layer poses in order, later layers winning by their weight, angles lerped as their numbers say', () => {
    const ready = { values: [3.2, -65, 17], weight: 0.7 };
    const swing = { values: [5, 171, 40], weight: 0.5 };
    expect(layerPose([0, 0, 0], [ready])).toEqual([3.2 * 0.7, -65 * 0.7, 17 * 0.7].map((v) => expect.closeTo(v, 12)));
    const stacked = layerPose([0, -70, 0], [ready, swing]);
    expect(stacked[1]).toBeCloseTo((-70 + (-65 + 70) * 0.7) * 0.5 + 171 * 0.5, 9); // through the numbers, not round
    expect(
      layerPose(
        [1, 2],
        [
          { values: [9, 9], weight: 0 },
          { values: [5], weight: 1 },
        ],
      ),
    ).toEqual([5, 2]); // a short layer keeps the rest
  });

  it('average angles the short way round, and turn a pitch and a yaw into a direction', () => {
    expect(Math.abs(blendAngles([Math.PI - 0.1, -Math.PI + 0.1], [1, 1]))).toBeCloseTo(Math.PI, 12);
    expect(blendAngles([0, Math.PI / 2], [3, 1])).toBeCloseTo(Math.atan2(1, 3), 12);
    expect(blendAngles([0, Math.PI], [1, 1], 0.5)).toBe(0.5); // cancelled out
    const d = aimDirection(Math.PI / 6, -Math.PI / 4); // up 30°, 45° to the right (−X facing +Z)
    expect([d.x, d.y, d.z, d.length()]).toEqual([-Math.cos(Math.PI / 6) * Math.SQRT1_2, 0.5, Math.cos(Math.PI / 6) * Math.SQRT1_2, 1].map((v) => expect.closeTo(v, 12))); // prettier-ignore
  });
});
