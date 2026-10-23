/**
 * @file Unit tests for the springs (engine/anim/proc/springs.ts, PLAN.md WP 10.1): the oscillator's exact step against
 * its closed forms, so 60 and 120 steps a second agree; a critical spring settling without overshoot and an
 * underdamped one bouncing, a kick jolting it and a limit bounding it; a vector spring axis by axis; a turn's spring
 * the short way round, kicked about an axis, its value a unit quaternion.
 * @see engine/anim/proc/springs.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { oscillate, quatExp, quatLog, Spring1, Spring3, SpringQuat } from './springs';

const UP = new Vector3(0, 1, 0);

describe('the springs', () => {
  it('step the oscillator exactly: its closed forms, one long step as many short ones', () => {
    const [y, v] = oscillate(-1, 0, 30, 1, 0.1); // critical: −(1 + ωt)e^(−ωt)
    expect(y).toBeCloseTo(-(1 + 3) * Math.exp(-3), 12);
    expect(v).toBeCloseTo(-1 * -900 * 0.1 * Math.exp(-3), 12);
    for (const zeta of [0.3, 1, 2.5]) {
      let [a, b] = [0.4, -2];
      for (let i = 0; i < 120; i++) [a, b] = oscillate(a, b, 12, zeta, 1 / 120);
      const [c, d] = oscillate(0.4, -2, 12, zeta, 1);
      expect([a - c, b - d].map((x) => Math.abs(x) < 1e-12)).toEqual([true, true]); // 120 steps, or one
    }
    expect(oscillate(0.5, 1, 30, 1, 0)).toEqual([0.5, 1]); // no time, no change
  });

  it('settle a critical spring without overshoot, bounce an underdamped one, kick it and bound it', () => {
    const scythe = new Spring1({ frequency: 30, target: 1 });
    let most = 0;
    for (let i = 0; i < 60; i++) most = Math.max(most, scythe.step(1 / 60));
    expect(most).toBeLessThanOrEqual(1); // never past it
    expect(scythe.value).toBeCloseTo(1, 9);
    const squash = new Spring1({ frequency: 15.5, damping: 0.45, limit: 0.35 });
    squash.kick(3);
    const path = Array.from({ length: 60 }, () => squash.step(1 / 60));
    expect(Math.max(...path)).toBeGreaterThan(0.1);
    expect(Math.min(...path)).toBeLessThan(-0.02); // back past its rest: a bounce
    squash.reset(0).kick(40);
    for (let i = 0; i < 3; i++) squash.step(1 / 60);
    expect(squash.value).toBe(0.35); // bounded, its velocity running on
    expect(squash.velocity).toBeGreaterThan(0);
  });

  it('spring a vector axis by axis, bounded by its distance from the target', () => {
    const lag = new Spring3({ frequency: 9, damping: 0.6, limit: 0.5 });
    const axes = [new Spring1({ frequency: 9, damping: 0.6 }), new Spring1({ frequency: 9, damping: 0.6 })];
    const target = new Vector3(0.2, -0.1, 0);
    lag.kick(new Vector3(0, 1, 0));
    axes[1].kick(1);
    for (let i = 0; i < 30; i++) {
      lag.step(1 / 60, target);
      axes[0].step(1 / 60, 0.2);
      axes[1].step(1 / 60, -0.1);
    }
    expect([lag.value.x, lag.value.y]).toEqual([axes[0].value, axes[1].value].map((x) => expect.closeTo(x, 12)));
    lag.reset(new Vector3()).kick(new Vector3(80, 0, 0)); // a jolt it would fly 1.2 m on in a step
    lag.step(1 / 60, new Vector3());
    expect(lag.value.length()).toBeCloseTo(0.5, 12);
  });

  it('turn a quaternion spring the short way, kick it about an axis, and keep it a unit turn', () => {
    const turn = (angle: number) => new Quaternion().setFromAxisAngle(UP, angle);
    const head = new SpringQuat({ frequency: 12, target: turn(Math.PI / 2) });
    for (let i = 0; i < 120; i++) head.step(1 / 60);
    expect(head.value.angleTo(head.target)).toBeLessThan(1e-6);
    const far = new SpringQuat({ value: turn(0.1), target: turn(-0.1) });
    far.target.set(-far.target.x, -far.target.y, -far.target.z, -far.target.w); // the same turn, the other sign
    far.step(0.02);
    const y = quatLog(far.value, new Vector3()).y;
    expect(y).toBeGreaterThan(-0.1); // straight toward −0.1 about +Y, not the long way round
    expect(y).toBeLessThan(0.1);
    const spun = new SpringQuat({ frequency: 6, damping: 0.5 }).kick(new Vector3(0, 4, 0));
    spun.step(1 / 60);
    expect(quatLog(spun.value, new Vector3()).y).toBeGreaterThan(0.05); // about +Y, as kicked
    for (let i = 0; i < 200; i++) expect(Math.abs(spun.step(1 / 60).length() - 1)).toBeLessThan(1e-12);
    expect(quatExp(quatLog(turn(2.5), new Vector3()), new Quaternion()).angleTo(turn(2.5))).toBeLessThan(1e-9);
  });
});
