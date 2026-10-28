/**
 * @file Unit tests for the planted stride (engine/anim/locomotion/planted.ts, WP 13.10): the duty runs from the walk's
 * to the sprint's, each foot lands where the animator's footsteps say, the step is continuous over the cycle and lifts
 * only in the swing, early (the heel kick), the knee bends through the swing's first part as far as the gait's kick,
 * the ease trades the stand for the stride, the stride shortens crouched and sideways, and a `plantedStride` build's
 * sole stays put through its stance at any speed and way: its gait foot travels back exactly as far as the body goes.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { getBuild } from '../builds';
import { gaitFoot, restContext, strideShare, type EffectorContext } from '../locomotion';
import { GAIT } from './gait';
import { footCycle, PLANTED, plantedDuty, plantedEase, plantedKnee, plantedStep } from './planted';

describe('the planted stride', () => {
  it('stands a crouched foot a walk’s share of its cycle at any pace', () => {
    for (const share of [0.4, 0.53, 1, 1.25]) expect(plantedDuty(share, 1)).toBeCloseTo(PLANTED.dutyWalk, 12);
    expect(plantedDuty(1, 0.5)).toBeCloseTo((PLANTED.dutyWalk + PLANTED.dutyRun) / 2, 12);
  });

  it('stands a walk’s foot 0.62 of its cycle, a run’s 0.3 and a sprint’s 0.24, eased between', () => {
    expect(plantedDuty(0)).toBe(PLANTED.dutyWalk);
    expect(plantedDuty(PLANTED.walkShare)).toBe(PLANTED.dutyWalk);
    expect(plantedDuty(1)).toBeCloseTo(PLANTED.dutyRun, 12);
    expect(plantedDuty(PLANTED.sprintShare)).toBeCloseTo(PLANTED.dutySprint, 12);
    expect(plantedDuty(9)).toBeCloseTo(PLANTED.dutySprint, 12);
    const duties = [0.4, 0.6, 0.8, 1, 1.1, 1.25].map((share) => plantedDuty(share));
    expect(duties.every((d, i) => i === 0 || d < duties[i - 1])).toBe(true);
  });

  it('lands the left foot at phase π/2 and the right at 3π/2, as the footsteps fall', () => {
    expect(footCycle(Math.PI / 2, false)).toBeCloseTo(0, 12);
    expect(footCycle((3 * Math.PI) / 2, true)).toBeCloseTo(0, 12);
    expect(footCycle(Math.PI, false)).toBeCloseTo(0.25, 12);
    expect(footCycle(Math.PI / 2 - 1e-9, false)).toBeGreaterThan(0.99);
  });

  it('steps continuously: from a reach ahead back through the stance, then up and forward through the swing', () => {
    for (const d of [PLANTED.dutyWalk, PLANTED.dutyRun, PLANTED.dutySprint]) {
      expect(plantedStep(0, d)).toEqual([1, 0]);
      const [end, lift] = plantedStep(d, d);
      expect(end).toBeCloseTo(-1, 12);
      expect(lift).toBeCloseTo(0, 12);
      const [back, up] = plantedStep(1 - 1e-9, d);
      expect(back).toBeCloseTo(1, 6);
      expect(up).toBeCloseTo(0, 6);
      for (let c = 0; c < d; c += 0.01) expect(plantedStep(c, d)[1]).toBe(0);
      const k = PLANTED.kick;
      const top = (1 + k - Math.sqrt((1 + k) * (1 + k) - 2 * k)) / (2 * k); // where u + k·u(1 − u) is a half
      expect(top).toBeLessThan(0.4); // the heel kicked up early, behind the hip
      expect(plantedStep(d + (1 - d) * top, d)[1]).toBeCloseTo(1, 12);
    }
  });

  it('bends a swing’s knee at least as far as its heel kick, none in the stance or at the touchdown, more the faster', () => {
    const P = PLANTED;
    const d = P.dutyRun;
    expect(plantedKnee(d / 2, d, 1)).toBe(0); // standing
    expect(plantedKnee(d + (1 - d) * (P.kneeSwing + 0.01), d, 1)).toBe(0); // reaching for the touchdown
    const swing = (share: number) => Math.max(...Array.from({ length: 101 }, (_, i) => plantedKnee(d + ((1 - d) * i) / 100, d, share))); // prettier-ignore
    expect(swing(P.walkShare)).toBeCloseTo(P.kneeWalk, 3);
    expect(swing(1)).toBeCloseTo(P.kneeRun, 3);
    expect(swing(P.sprintShare)).toBeCloseTo(P.kneeSprint, 3);
    expect(plantedKnee(d + 1e-6, d, 1)).toBeGreaterThan(P.kneeRun * 0.3); // from about a push-off's bend
  });

  it('eases from the stand into the stride over PLANTED.start of the speed share', () => {
    expect(plantedEase(0)).toBe(0);
    expect(plantedEase(PLANTED.start / 2)).toBeCloseTo(0.5, 12);
    expect(plantedEase(PLANTED.start)).toBe(1);
    expect(plantedEase(2)).toBe(1);
  });

  it('keeps a stance sole still on the ground: its foot travels back as far as the body goes, at any speed and way', () => {
    const build = getBuild('build:adult');
    for (const [moveF, moveR] of [
      [1, 0],
      [0, 1],
    ]) {
      for (const share of [0.5, 1, 1.25]) {
        const speed = share * build.speedRef;
        const rate = speed / (build.stride * build.size * strideShare(share, true, 0, moveR)); // the phase per second
        const at = (phase: number): EffectorContext => {
          const ctx = restContext(build);
          return { ...ctx, phase, moveF, moveR, sp: Math.min(1, share), w: { ...ctx.w, speed: share } };
        };
        const duty = plantedDuty(share);
        const land = Math.PI / 2; // the left foot's touchdown
        const dt = 1 / 600;
        for (let t = 0; t < (duty * 2 * Math.PI) / rate - dt; t += dt) {
          const [a, b] = [gaitFoot(at(land + rate * t), 'L', new Vector3()), gaitFoot(at(land + rate * (t + dt)), 'L', new Vector3())]; // prettier-ignore
          expect(a.z - b.z).toBeCloseTo(moveF * speed * dt, 9); // back as fast as the body goes
          expect(b.x - a.x).toBeCloseTo(moveR * speed * dt, 9); // right is −x: a sole left behind moves +x
          expect(a.y).toBe(0);
        }
      }
    }
  });

  it('shortens a planted stride as it crouches and as it steps sideways, not a source build’s', () => {
    expect(strideShare(1, true, 1)).toBeCloseTo(1 - GAIT.crouchStride, 12);
    expect(strideShare(1, true, 0, -1)).toBeCloseTo(1 - GAIT.sideStride, 12);
    expect(strideShare(1, true, 0, Math.SQRT1_2)).toBeCloseTo(1 - GAIT.sideStride / 2, 12); // a diagonal, half as much
    expect(strideShare(1, false, 1)).toBe(1);
  });
});
