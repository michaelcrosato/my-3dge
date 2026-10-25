/**
 * @file Unit tests for the view's traversal poses (engine/anim/traversal/pose.ts, PLAN.md WP 13.11): each way's weight
 * eases in and out (two cross-fading make one, the foot plant whole on the ground), a teleport lets go of everything,
 * a low ledge is vaulted only from a run, a slide-jump is told from a jump, a climb's holds stay put as the body climbs
 * and slide down the wall as a caught fall slows, a zipline's and a ladder's hands go where the drawn feet say (on an
 * adult's hull when given none), a limb is on its contact only when one way lays it alone and fully, the body's reach
 * toward a lip follows what the hands need and eases back with bounded acceleration, and the pose keeps its own copy of
 * the sim's state.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { getBuild } from '../builds';
import { TRAVERSAL } from './contacts';
import { createLimbTargets, layTarget, TRAVERSAL_POSE, TraversalPose } from './pose';

const adult = getBuild('build:adult');
const hull = { radius: 0.41, skin: 0.01, hang: 2.032, rung: 0.3 };
const DT = 1 / 60;
const still = { vx: 0, vy: 0, vz: 0, yaw: 0 };

/** Steps `pose` `n` times with `view`, the feet at `feet` (or where `feet(k)` says), moving as `body`. */
function run(
  pose: TraversalPose,
  n: number,
  view: object | null,
  feet: Vector3 | ((k: number) => Vector3),
  body = still,
  ride: object | null = null,
) {
  // prettier-ignore
  for (let k = 0; k < n; k++) pose.update(view, ride, hull, adult, typeof feet === 'function' ? feet(k) : feet, body, DT);
  return pose;
}

describe('the traversal weights', () => {
  it('ease each way in and out, two cross-fading make one, and leave the foot plant whole on the ground', () => {
    const pose = new TraversalPose();
    const at = new Vector3();
    run(pose, 1, { mode: 'climb', wallX: 0, wallZ: -1, attachY: 0 }, at);
    expect(pose.weights.climb).toBeCloseTo(TRAVERSAL_POSE.ease * DT, 9);
    run(pose, 10, { mode: 'climb', wallX: 0, wallZ: -1, attachY: 0 }, at);
    expect([pose.weights.climb, pose.weight, pose.plantShare]).toEqual([1, 1, 0]);
    run(pose, 2, { mode: 'mantle', mantle: 'grab', mantleLeft: 20, mantleTotal: 27, lipY: 2, wallZ: -1 }, at);
    expect(pose.weight).toBeCloseTo(1, 9); // the climb going as the mantle comes
    run(pose, 1, { mode: 'ground' }, at);
    expect(pose.plantShare).toBe(1);
    run(pose, 10, { mode: 'ground' }, at);
    expect(pose.weight).toBe(0);
  });

  it('lets go of everything when the body is placed elsewhere', () => {
    const pose = run(new TraversalPose(), 20, { mode: 'zipline', rideDir: 1 }, new Vector3(0, 3, 0));
    expect(pose.weights.zipline).toBe(1);
    run(pose, 1, { mode: 'zipline', rideDir: 1 }, new Vector3(5, 3, 0));
    expect(pose.weights.zipline).toBeCloseTo(TRAVERSAL_POSE.cable * DT, 9); // from nothing again
  });

  it('vaults a low ledge only when the body came at it at a run, and tells a slide-jump from a jump', () => {
    const low = { mode: 'mantle', mantle: 'pull', mantleLeft: 18, mantleTotal: 18, lipY: 1, fromY: 0, wallZ: -1 };
    const vaulting = (speed: number, mode = 'ground') => {
      const pose = run(new TraversalPose(), 3, { mode }, new Vector3(), { ...still, vz: speed });
      return run(pose, 1, low, new Vector3()).vault;
    };
    expect([vaulting(5), vaulting(2), vaulting(5, 'climb')]).toEqual([true, false, false]);
    const pose = run(new TraversalPose(), 2, { mode: 'ground', sliding: true }, new Vector3(), { ...still, vz: 8 });
    run(pose, 3, { mode: 'air' }, new Vector3(), { ...still, vy: 6 });
    expect(pose.weights.slideJump).toBeGreaterThan(0.5);
    const jump = run(new TraversalPose(), 5, { mode: 'air' }, new Vector3(), { ...still, vy: 6 });
    expect(jump.weights.slideJump).toBe(0);
  });

  it('keeps its own copy of the sim’s state, which the sim changes in place', () => {
    const motion = { mode: 'mantle', mantle: 'grab', mantleLeft: 27, mantleTotal: 27, lipY: 2, wallZ: -1 };
    const pose = run(new TraversalPose(), 1, motion, new Vector3());
    motion.mode = 'ground';
    expect(pose.view?.mode).toBe('mantle');
  });
});

describe('the targets', () => {
  it('keeps a climb’s held hands where they took hold as the body climbs, then moves them on', () => {
    const pose = new TraversalPose();
    const out = createLimbTargets();
    const wall = { mode: 'climb', wallX: 0, wallZ: -1, attachY: 0 };
    const feet = (k: number) => new Vector3(0, k * 0.05, 0);
    const up = { ...still, vy: 3 };
    run(pose, 12, wall, feet, up); // fully on the wall
    const held = pose.targets(feet(11), out)[1]; // the right hand, 0.55 into its cycle: holding
    expect(held.held).toBe(true);
    const where = held.point.clone();
    run(pose, 1, wall, () => feet(12), up);
    expect(pose.targets(feet(12), out)[1].point.distanceTo(where)).toBeLessThan(1e-9); // it stays put
    for (let k = 13; k < 40; k++) run(pose, 1, wall, () => feet(k), up);
    expect(pose.targets(feet(39), out)[1].point.y).toBeGreaterThan(where.y + 0.5); // and moved on up
    run(pose, 1, wall, () => feet(39), { ...still, vy: -4 }); // a caught fall: it slides
    const sliding = pose.targets(feet(39), out)[1];
    expect(sliding.held).toBe(false);
    expect(sliding.point.y).toBeCloseTo(feet(39).y + pose.shoulder + TRAVERSAL.slide, 9);
  });

  it('holds a limb on its contact only when one way lays it alone and fully', () => {
    const [alone, crossed] = createLimbTargets();
    layTarget(alone, new Vector3(0, 2, 0), 1, true);
    expect([alone.held, alone.point.y]).toEqual([true, 2]);
    layTarget(crossed, new Vector3(0, 1, 0), 0.4, true); // a zipline easing out…
    layTarget(crossed, new Vector3(0, 2, 0), 1, true); // …under a climb in full
    expect([crossed.held, crossed.weight]).toEqual([false, 1]);
    expect(crossed.point.y).toBeCloseTo(1 + 1 / 1.4, 12); // between the two
  });

  it('puts a zipline’s hands on the cable over the drawn feet, and a ladder’s held limbs on its rungs', () => {
    const zip = run(new TraversalPose(), 20, { mode: 'zipline', rideDir: 1 }, new Vector3(0, 4, 2), still, { zipline: { from: [0, 6, 0], to: [0, 6, 10] } }); // prettier-ignore
    const [left, right] = zip.targets(new Vector3(0, 3.968, 2.1), createLimbTargets());
    expect([left.held, right.held]).toEqual([true, true]);
    expect(right.point.y).toBeCloseTo(3.968 + hull.hang, 9);
    expect(right.point.z - left.point.z).toBeCloseTo(2 * TRAVERSAL.cable, 9);
    const ladder = { ladder: { foot: [0, 0, 1], top: 4, normal: [0, -1], width: 0.6 } };
    const on = run(new TraversalPose(), 20, { mode: 'ladder', rideSpeed: 1 }, new Vector3(0, 1, 0.5), still, ladder);
    for (const limb of on.targets(new Vector3(0, 1, 0.5), createLimbTargets()))
      if (limb.held) expect(Math.abs(((limb.point.y + 1e-6) % hull.rung) - 1e-6)).toBeLessThan(0.021); // on a rung (a foot 2 cm up)
  });

  it('poses a body given no hull on an adult’s, the hull it starts with', () => {
    const ride = { ladder: { foot: [0, 0, 1], top: 4, normal: [0, -1], width: 0.6 } };
    const limbs = (given: typeof hull | null) => {
      const pose = new TraversalPose();
      for (let k = 0; k < 20; k++) pose.update({ mode: 'ladder', rideSpeed: 1 }, ride, given, adult, new Vector3(0, 1, 0.5), still, DT); // prettier-ignore
      return pose.targets(new Vector3(0, 1, 0.5), createLimbTargets()).map((limb) => limb.point.toArray());
    };
    expect(limbs(null)).toEqual(limbs(hull));
  });
});

describe('the reach toward a lip', () => {
  it('follows what the hands need at once and eases back with its speed changing smoothly', () => {
    const pose = new TraversalPose();
    const grab = (left: number) => ({ mode: 'mantle', mantle: 'grab', mantleLeft: left, mantleTotal: 27, lipX: 0, lipY: 1.6, lipZ: 0.43, wallZ: -1, fromY: 0 }); // prettier-ignore
    for (let k = 0; k < 27; k++) pose.update(grab(27 - k), null, hull, adult, new Vector3(0, k * 0.06, 0), still, DT);
    const top = pose.reach.length();
    expect(top).toBeGreaterThan(0.3); // the feet nearly at the lip: the body drawn down to the hands
    const steps: number[] = [];
    let last = pose.reach.clone();
    for (let k = 0; k < 30; k++) {
      pose.update({ mode: 'air' }, null, hull, adult, new Vector3(0, 1.6 + k * 0.1, 0), still, DT); // a hop: let go at once
      steps.push(pose.reach.distanceTo(last));
      last = pose.reach.clone();
    }
    expect(pose.reach.length()).toBeLessThan(1e-6); // eased all the way back
    for (let k = 1; k < steps.length; k++) expect(Math.abs(steps[k] - steps[k - 1])).toBeLessThan(TRAVERSAL_POSE.settle * DT * DT + 1e-9); // prettier-ignore
  });
});
