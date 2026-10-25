/**
 * @file Tests for `footPlant` called straight, with its locks and options (WP 12.2; the rest of the foot plant is in
 * footPlant.test.ts): it rolls only with locks; locks without a stance hold as with neither foot in it; a foot it finds
 * no ground under keeps its animation, whatever it planted before; a leg stretched out level past its reach asks no
 * drop and stays finite; a held foot turns toward its lock's heading the shorter way round, across ±π, by the lock's
 * weight; and whether a foot whose heel is up was taken up is read from its ball when it rolls (in its stride, held
 * fully, or in stance with its heel clearly up), else from its sole.
 * @see engine/anim/footPlant.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { forwardKinematics, jointPosition, jointRotation, socketPosition } from './fk';
import { footPlant, type FootPlantOptions } from './footPlant';
import { heading } from './footRoll';
import type { GroundProbe } from './ik';
import { createFootPlantState, FOOT_LOCK } from './locomotion/locks';
import { Pose } from './pose';
import { createSkeleton, PROPORTIONS } from './skeleton';

const UP = new Vector3(0, 1, 0);
const skeleton = createSkeleton('build:adult');
/** Flat ground at y = 0. */
const flat: GroundProbe = (origin, distance, hit) => {
  hit.point.set(origin.x, 0, origin.z);
  hit.normal.set(0, 1, 0);
  return origin.y >= 0 && origin.y <= distance;
};

/** The adult at the origin facing `yaw`, its root `y` over the floor at 0, its left foot pitched `pitch` rad toes-down. */
function stood(yaw = 0, y = 0, pitch = 0) {
  const pose = new Pose();
  pose.rootPos.set(0, y, 0);
  pose.rootRot.setFromAxisAngle(UP, yaw);
  pose.setRotation('footL', new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
  return { pose, world: forwardKinematics(skeleton, pose) };
}

describe('footPlant’s locks and options', () => {
  it('rolls only with locks: given no state, rolls plants as no options do', () => {
    const plant = (options: FootPlantOptions) => {
      const { pose, world } = stood(0.4, 0.03, 0.4);
      footPlant(skeleton, pose, world, flat, { floor: 0, ...options });
      return Array.from(world.positions);
    };
    expect(plant({ rolls: true })).toEqual(plant({}));
  });

  it('locks without a stance as with neither foot in it', () => {
    const plant = (stance?: readonly [boolean, boolean]) => {
      const { pose, world } = stood(0.4, 0.003, 0.4);
      const state = createFootPlantState();
      footPlant(skeleton, pose, world, flat, { floor: 0, state, rolls: true, ...(stance ? { stance } : {}) });
      return [Array.from(world.positions), state.feet.map((lock) => lock.weight)];
    };
    expect(plant()).toEqual(plant([false, false]));
  });

  it('leaves a foot it finds no ground under as its animation has it, whatever it planted before', () => {
    const below: GroundProbe = (origin, distance, hit) => {
      hit.point.set(origin.x, -0.1, origin.z);
      hit.normal.set(0, 1, 0);
      return origin.y + 0.1 <= distance;
    };
    const before = stood();
    expect(footPlant(skeleton, before.pose, before.world, below, { floor: 0 })).toBeGreaterThan(0.09); // 10 cm down
    const { pose, world } = stood();
    expect(footPlant(skeleton, pose, world, () => false, { floor: 0 })).toBe(0);
    expect(Array.from(world.positions)).toEqual(Array.from(stood().world.positions));
  });

  it('drops the pelvis nothing for a leg stretched out level past its reach, and keeps the pose finite', () => {
    const straight = stood();
    const standing = footPlant(skeleton, straight.pose, straight.world, flat, { floor: 0 }); // a hair, to bend the legs
    const { pose, world } = stood();
    pose.setRotation('thighL', new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)); // kicked level
    forwardKinematics(skeleton, pose, world);
    expect(footPlant(skeleton, pose, world, flat, { floor: 0 })).toBe(standing); // the standing leg's, alone
    expect(world.positions.every(Number.isFinite)).toBe(true);
  });

  it('turns a held foot toward its lock’s heading the shorter way round, across ±π, by the lock’s weight', () => {
    const { pose, world } = stood(-3, 0.01); // facing −3 rad, its soles 1 cm up: letting go, not touching down
    const state = createFootPlantState();
    const lock = state.feet[0];
    const foot = jointRotation(world, 'footL');
    const before = heading(foot);
    lock.turn.setFromAxisAngle(UP, -0.3).multiply(foot); // taken 0.3 rad the other way: its heading past −π, so +π − …
    lock.point.copy(socketPosition(skeleton, world, 'contactL')).setY(0);
    lock.weight = 0.5;
    expect(heading(lock.turn) - before).toBeCloseTo(2 * Math.PI - 0.3, 9);
    footPlant(skeleton, pose, world, flat, { floor: 0, state, stance: [false, true] });
    expect(lock.weight).toBeCloseTo(0.5 - 1 / 60 / FOOT_LOCK.release, 9);
    const turned = heading(jointRotation(world, 'footL')) - before;
    expect(turned - 2 * Math.PI * Math.round(turned / (2 * Math.PI))).toBeCloseTo(-0.3 * lock.weight, 4);
  });
});

describe('a foot whose heel is up, taken up or not', () => {
  const [UP_CLEARLY, UP_A_LITTLE] = [0.45, 0.16]; // rad toes-down: its toes' dip past FOOT_PLANT.heelUp's 10°, and under
  /** The left foot pitched `pitch` toes-down, its ball 12 mm over the floor: the pose, and its sole's, ball's and dip. */
  const drawn = (pitch: number) => {
    const b = skeleton.build;
    const ballOf = (world: ReturnType<typeof forwardKinematics>) => jointPosition(world, 'toeL').y - PROPORTIONS.ballHeight * b.ankleHeight * b.size; // prettier-ignore
    const { pose, world } = stood(0, 0.012 - ballOf(stood(0, 0, pitch).world), pitch);
    const toes = new Vector3(0, 0, 1).applyQuaternion(jointRotation(world, 'footL'));
    return { pose, world, sole: socketPosition(skeleton, world, 'contactL').y, ball: ballOf(world), down: -toes.y };
  };
  /** The left lock's weight after one plant of `drawn(pitch)`, the lock at `weight` before, in stance or not. */
  const after = (pitch: number, weight: number, stance: boolean, options: FootPlantOptions) => {
    const { pose, world } = drawn(pitch);
    const state = createFootPlantState();
    const lock = state.feet[0];
    lock.point.copy(socketPosition(skeleton, world, 'contactL')).setY(0);
    lock.turn.copy(jointRotation(world, 'footL'));
    lock.weight = weight;
    footPlant(skeleton, pose, world, flat, { floor: 0, state, stance: [stance, true], ...options });
    return lock.weight;
  };
  const tick = 1 / 60 / FOOT_LOCK.release; // the share of its weight a lock lets go in a tick

  it('draws its feet as the cases need: the sole over FOOT_LOCK.lifted, the ball under it, the heel up past 10° or less', () => {
    const tenDegrees = Math.sin((10 * Math.PI) / 180);
    for (const [pitch, low, high] of [
      [UP_CLEARLY, tenDegrees, 1],
      [UP_A_LITTLE, 0.02, tenDegrees],
    ] as const) {
      const { sole, ball, down } = drawn(pitch);
      expect([down > low, down < high, sole > FOOT_LOCK.lifted, ball < FOOT_LOCK.lifted]).toEqual([true, true, true, true]); // prettier-ignore
    }
  });

  it('reads it from the ball when it rolls in its stride, held fully, or in stance with its heel clearly up', () => {
    const [stride, standing] = [{ rolls: true }, { rolls: true, steps: true, stride: 0 }];
    expect(after(UP_CLEARLY, 1, true, stride)).toBe(1); // in its stride, held in stance: on its ball, it stays
    expect(after(UP_A_LITTLE, 0, true, stride)).toBe(1); // …and locks as it lands so
    expect(after(UP_CLEARLY, 1, false, standing)).toBeCloseTo(1 - tick, 9); // held fully: on its ball, it eases out
    expect(after(UP_CLEARLY, 0.5, false, standing)).toBe(0); // half held, out of stance: its sole is up, it goes
    expect(after(UP_A_LITTLE, 0.5, false, { ...standing, stride: 0.6 })).toBeCloseTo(0.5 - tick, 9); // easing out of a stride: on its ball
  });

  it('reads it from the sole without rolls: a heel up takes a held foot up at once', () => {
    expect(after(UP_CLEARLY, 1, true, {})).toBe(0);
  });
});
