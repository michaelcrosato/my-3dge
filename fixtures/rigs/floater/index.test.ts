/**
 * @file Unit tests for the floater (fixtures/rigs/floater/index.ts, PLAN.md WP 10.1): its rig passes the check in every
 * state; it banks into a drift and leans back into a glide; folded, its hands come in; its motes spin up and spread at
 * a spin; it turns to a heading on a spring; it blinks.
 * @see fixtures/rigs/floater/index.ts
 */
import { describe, expect, it } from 'vitest';
import { rigCheck, Vector3 } from '../../../engine/sim-api';
import { FLOATER, FloaterRig } from './index';

const run = (ghost: FloaterRig, steps: number, input: Parameters<FloaterRig['step']>[0] = {}) => {
  for (let i = 0; i < steps; i++) ghost.step(input);
  return ghost;
};

describe('the floater', () => {
  it('passes the rig check in every state', () => {
    expect(rigCheck(FLOATER).problems.map((p) => p.message)).toEqual([]);
  });

  it('banks, leans, folds its hands in, spins its motes up, turns on a spring and blinks', () => {
    expect(run(new FloaterRig(), 60, { velocity: new Vector3(-2, 0, 0) }).hover.bank).toBeGreaterThan(0.1);
    expect(run(new FloaterRig(), 60, { velocity: new Vector3(0, 0, 4) }).hover.lean).toBeGreaterThan(0.05);
    const spread = (ghost: FloaterRig) => ghost.points()[5].distanceTo(ghost.points()[6]);
    const open = spread(run(new FloaterRig(), 90));
    expect(spread(run(new FloaterRig(), 90, { fold: 1 }))).toBeLessThan(open * 0.6);
    const [slow, fast] = [run(new FloaterRig(), 60), run(new FloaterRig(), 60, { spin: 9, flare: 1 })];
    expect(fast.motes.angle).toBeGreaterThan(slow.motes.angle * 5);
    expect(fast.motes.radius).toBeGreaterThan(slow.motes.radius + 0.1);
    const turner = new FloaterRig();
    turner.step({ yaw: 1 });
    const early = new Vector3(0, 0, 1).applyQuaternion(turner.heading.value);
    expect(Math.atan2(early.x, early.z)).toBeLessThan(0.1); // a spring: not at once
    run(turner, 120, { yaw: 1 });
    const late = new Vector3(0, 0, 1).applyQuaternion(turner.heading.value);
    expect(Math.atan2(late.x, late.z)).toBeCloseTo(1, 3);
    const blinker = new FloaterRig({ seed: 5 });
    expect(Math.min(...Array.from({ length: 300 }, () => blinker.step().blink.open))).toBeLessThan(0.1);
  });
});
