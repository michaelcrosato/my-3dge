/**
 * @file Unit tests for the arm path (engine/anim/strike.ts), PLAN.md WP 6.1: the arm's weight eases in and out at
 * my-3d2dge's rates, a swing starts from rest or, while the arm is still raised, from the last path (a chain), and
 * the body motion it asks for. The differential tests of the paths themselves are in moves.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { getBuild } from './builds';
import { restContext } from './locomotion';
import { moveAt } from './moves';
import { createEffectors } from './poses';
import { armBlade, createArmState, layArm, stepArm } from './strike';
import { Vector3 } from '../core/math';

/** Effectors holding hands and a blade where `stepArm` captures them from. */
const effectorsAt = (x: number) => {
  const E = createEffectors();
  E.hands.L.set(x, 1, 0);
  E.hands.R.set(-x, 1, 0);
  E.blade.set(0, 0, 1);
  return E;
};
const ARMED = { armed: true, armLength: 0.575 };

describe('the arm path', () => {
  it('eases its weight in at 30 and out at 12 per second, and asks the body to move', () => {
    const arm = createArmState();
    const motion = stepArm(arm, moveAt('slash', 0.5), ARMED, () => effectorsAt(0), 1 / 60);
    expect(arm.weight).toBeCloseTo(0.5, 12);
    expect(motion).toMatchObject({ lean: 0.3, lead: 'L' });
    expect(stepArm(arm, undefined, ARMED, () => effectorsAt(0), 1 / 60)).toBeUndefined();
    expect(arm.weight).toBeCloseTo(0.3, 12);
    expect(stepArm(arm, moveAt('jab', 0.5), ARMED, () => effectorsAt(0), 1 / 60)?.lead).toBe('R');
  });

  it('starts a swing from rest, or from the last path while the arm is still raised (a chain)', () => {
    const arm = createArmState();
    const E = effectorsAt(0.2);
    let asked = 0;
    stepArm(arm, moveAt('slash', 0, 'wind'), ARMED, () => (asked++, E), 1);
    expect([arm.theta0, arm.from.slice(0, 3), asked]).toEqual([1.1, [0.2, 1, 0], 1]);
    stepArm(arm, moveAt('slash', 0.5, 'wind'), ARMED, () => (asked++, E), 1);
    expect(asked).toBe(1); // asked for the effectors only as the swing began
    stepArm(arm, moveAt('slash', 0.5, 'recover'), ARMED, () => E, 1);
    const theta = arm.theta;
    stepArm(arm, moveAt('backslash', 0, 'wind'), ARMED, () => effectorsAt(0.3), 1);
    expect([arm.theta0, arm.from[0]]).toEqual([theta, 0.3]);
    stepArm(arm, undefined, ARMED, () => E, 1);
    stepArm(arm, moveAt('overhead', 0, 'wind'), ARMED, () => E, 1);
    expect(arm.theta0).toBe(-0.9); // the vertical plane's rest
  });

  it('starts a swing again when the move changes during the wind (a feint), as my-3d2dge did', () => {
    const arm = createArmState();
    stepArm(arm, moveAt('slash', 0.5, 'wind'), ARMED, () => effectorsAt(0.2), 1);
    expect([arm.theta0, arm.from[0]]).toEqual([1.1, 0.2]);
    const theta = arm.theta; // 0.75 of the way from the ground rest (1.1) to the slash's 1.7
    stepArm(arm, moveAt('overhead', 0.25, 'wind'), ARMED, () => effectorsAt(0.3), 1);
    expect([arm.theta0, arm.from[0], arm.vertical]).toEqual([theta, 0.3, 1]); // chained from the slash's wind
    stepArm(arm, moveAt('overhead', 0.5, 'wind'), ARMED, () => effectorsAt(0.4), 1);
    expect([arm.theta0, arm.from[0]]).toEqual([theta, 0.3]); // the same move winds on

    const spec = (a0: number) => ({ move: { arc: [a0, 0] as [number, number] }, phase: 'wind', u: 0.5 }) as const;
    stepArm(arm, spec(0.5), ARMED, () => effectorsAt(0.5), 1); // a move made from a spec: move:custom
    expect(arm.from[0]).toBe(0.5);
    stepArm(arm, spec(0.5), ARMED, () => effectorsAt(0.6), 1); // the same spec, made anew: winds on
    expect(arm.from[0]).toBe(0.5);
    stepArm(arm, spec(-0.5), ARMED, () => effectorsAt(0.7), 1); // another spec, also move:custom: starts again
    expect(arm.from[0]).toBe(0.7);
  });

  it('lays nothing at rest, and the strike over the hands and the blade once it plays', () => {
    const ctx = restContext(getBuild('build:chibi'));
    const arm = createArmState();
    const E = createEffectors();
    const rest = new Vector3(0, 0, 1);
    expect(layArm(arm, ctx, E).hands.R.length()).toBe(0);
    expect(armBlade(arm, rest, E, new Vector3()).toArray()).toEqual([0, 0, 1]);
    stepArm(arm, moveAt('thrust', 1), ARMED, () => E, 1);
    layArm(arm, ctx, E);
    expect(E.hands.R.z).toBeGreaterThan(0.5); // the thrust's hand reaches 0.625 m ahead of the shoulders
    expect(armBlade(arm, rest, E, new Vector3()).z).toBeGreaterThan(0.9);
  });
});
