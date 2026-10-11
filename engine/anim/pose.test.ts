/**
 * @file Unit tests for poses (engine/anim/pose.ts): reading and writing rotations as three.js quaternions, blending
 * (slerp and nlerp) under bone masks, additive layers, and the pose hash (PLAN.md WP 3.4, Done when).
 */
import { describe, expect, it } from 'vitest';
import { hashNumbers, hashValue } from '../core/hash';
import { Euler, Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { addPose, blendPoses, hashPose, makeAdditive, Pose, POSE_LENGTH } from './pose';
import { boneMask, JOINT_COUNT, jointIndex, JOINTS } from './skeleton';

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
/** A rotation of `angle` radians about `axis`. */
const turn = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle);
/**
 * About the angle between two rotations, in radians, for small angles: 2 × the distance between the quaternions, the
 * nearer of q and −q (well conditioned, unlike `angleTo`'s acos near 1).
 */
const between = (a: Quaternion, b: Quaternion) =>
  2 *
  Math.min(
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w),
    Math.hypot(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w),
  );

/** A pose with every joint and the root turned at random (seeded). */
function randomPose(seed: number): Pose {
  const rng = new Rng(seed);
  const pose = new Pose();
  for (let j = 0; j < JOINT_COUNT; j++) {
    const euler = new Euler(rng.range(-1.5, 1.5), rng.range(-1.5, 1.5), rng.range(-1.5, 1.5));
    pose.setRotation(j, new Quaternion().setFromEuler(euler));
  }
  pose.rootPos.set(rng.range(-2, 2), rng.range(-0.3, 0.3), rng.range(-2, 2));
  pose.rootRot.setFromEuler(new Euler(0, rng.range(-3, 3), 0));
  pose.rootScale.set(rng.range(0.8, 1.2), rng.range(0.8, 1.2), rng.range(0.8, 1.2));
  return pose;
}

/** Every joint's rotation of `pose`. */
const rotations = (pose: Pose) => JOINTS.map((name) => pose.getRotation(name));

describe('Pose', () => {
  it('starts at rest: identities, the root at the origin, unscaled', () => {
    const pose = new Pose();
    expect(pose.local.length).toBe(JOINT_COUNT * 4);
    for (const q of rotations(pose)) expect(q.toArray()).toEqual([0, 0, 0, 1]);
    expect(pose.rootScale.toArray()).toEqual([1, 1, 1]);
    expect(randomPose(3).reset().equals(new Pose())).toBe(true);
  });

  it('reads and writes rotations as three.js quaternions, stored as float32', () => {
    const pose = new Pose().setRotation('head', turn(Y, 0.4));
    expect(pose.local).toBeInstanceOf(Float32Array);
    expect(between(pose.getRotation('head'), turn(Y, 0.4))).toBeLessThan(1e-6);
    expect(pose.getRotation(jointIndex('head')).equals(pose.getRotation('head'))).toBe(true);
    expect(() => pose.getRotation('hed' as never)).toThrow(/ANIM_UNKNOWN_JOINT.*did you mean "head"/);
    expect(() => pose.setRotation(23, turn(Y, 1))).toThrow(/ANIM_UNKNOWN_JOINT/);
  });

  it('copies, clones and round-trips through toArray', () => {
    const pose = randomPose(1);
    const array = pose.toArray();
    expect(array).toHaveLength(POSE_LENGTH);
    expect(new Pose().fromArray(array).equals(pose)).toBe(true);
    const clone = pose.clone();
    expect(clone.equals(pose)).toBe(true);
    clone.rootPos.x += 1;
    expect(clone.equals(pose)).toBe(false);
  });
});

describe('blendPoses', () => {
  it('gives the inputs exactly at t = 0 and 1', () => {
    const [a, b] = [randomPose(1), randomPose(2)];
    for (const method of ['slerp', 'nlerp'] as const) {
      expect(blendPoses(a, b, 0, new Pose(), { method }).equals(a)).toBe(true);
      expect(blendPoses(a, b, 1, new Pose(), { method }).equals(b)).toBe(true);
    }
  });

  it('slerps each joint at constant angular speed, the short way round', () => {
    const a = new Pose().setRotation('chest', turn(Y, 0.2));
    const b = new Pose().setRotation('chest', turn(Y, 1.4));
    for (const t of [0.25, 0.5, 0.75]) {
      const q = blendPoses(a, b, t).getRotation('chest');
      expect(between(q, turn(Y, 0.2 + 1.2 * t))).toBeLessThan(1e-6);
    }
    // −q is the same rotation: the blend still goes the short way
    const q = turn(Y, 1.4);
    const flipped = new Pose().setRotation('chest', new Quaternion(-q.x, -q.y, -q.z, -q.w));
    expect(between(blendPoses(a, flipped, 0.5).getRotation('chest'), turn(Y, 0.8))).toBeLessThan(1e-6);
  });

  it('nlerps to the same ends, unit length, close to slerp in between', () => {
    const [a, b] = [randomPose(4), randomPose(5)];
    for (const t of [0.1, 0.5, 0.9]) {
      const slerped = blendPoses(a, b, t);
      const nlerped = blendPoses(a, b, t, new Pose(), { method: 'nlerp' });
      for (let j = 0; j < JOINT_COUNT; j++) {
        const q = nlerped.getRotation(j);
        expect(q.length()).toBeCloseTo(1, 6);
        expect(between(q, slerped.getRotation(j))).toBeLessThan(0.25);
      }
    }
  });

  it('blends the root: position and scale linearly, rotation by slerp', () => {
    const a = new Pose();
    const b = new Pose();
    b.rootPos.set(2, 0, -4);
    b.rootScale.set(1, 0.5, 1);
    b.rootRot.copy(turn(Y, 1));
    const half = blendPoses(a, b, 0.5);
    expect(half.rootPos.toArray()).toEqual([1, 0, -2]);
    expect(half.rootScale.toArray()).toEqual([1, 0.75, 1]);
    expect(between(half.rootRot, turn(Y, 0.5))).toBeLessThan(1e-12);
  });

  it('may write into one of its inputs', () => {
    const [a, b] = [randomPose(6), randomPose(7)];
    const expected = blendPoses(a, b, 0.3);
    expect(blendPoses(a, b, 0.3, a).equals(expected)).toBe(true);
    const [c, d] = [randomPose(6), randomPose(7)];
    expect(blendPoses(c, d, 0.3, d).equals(expected)).toBe(true);
  });
});

describe('bone masks', () => {
  /** The joints a mask holds fully. */
  const held = (mask: ReturnType<typeof boneMask>) => JOINTS.filter((_, j) => mask.weights[j] === 1);

  it('presets hold their branches; upper leaves the root and pelvis, lower takes them', () => {
    expect(held(boneMask('full'))).toEqual([...JOINTS]);
    expect(held(boneMask('upper'))).toEqual(JOINTS.filter((name) => !/pelvis|thigh|shin|foot|toe/.test(name)));
    expect(held(boneMask('lower'))).toEqual([
      'pelvis',
      'thighL',
      'shinL',
      'footL',
      'toeL',
      'thighR',
      'shinR',
      'footR',
      'toeR',
    ]);
    expect(held(boneMask('arms'))).toEqual(JOINTS.filter((name) => /clavicle|Arm|forearm|hand/.test(name)));
    expect(held(boneMask('legR'))).toEqual(['thighR', 'shinR', 'footR', 'toeR']);
    expect(held(boneMask('head'))).toEqual(['neck', 'head']);
    expect([boneMask('upper').root, boneMask('lower').root, boneMask('full').root, boneMask('arms').root]).toEqual([
      0, 1, 1, 0,
    ]);
  });

  it('lists hold each joint alone, and weights hold shares', () => {
    expect(held(boneMask(['chest', 'armL']))).toEqual(['chest', 'clavicleL', 'upperArmL', 'forearmL', 'handL']);
    expect(boneMask(['root']).root).toBe(1);
    const partial = boneMask({ spine1: 0.25, chest: 0.5, root: 0.5 });
    expect(partial.weights[jointIndex('chest')]).toBe(0.5);
    expect(partial.root).toBe(0.5);
    expect(() => boneMask(['uper' as never])).toThrow(/ANIM_UNKNOWN_JOINT.*did you mean "upper"/);
    expect(() => boneMask({ chest: 2 })).toThrow(/ANIM_BAD_MASK/);
  });

  it('confine a blend: upper-body attack over lower-body run', () => {
    const run = randomPose(8);
    const attack = randomPose(9);
    const mixed = blendPoses(run, attack, 1, new Pose(), { mask: boneMask('upper') });
    for (let j = 0; j < JOINT_COUNT; j++) {
      const from = boneMask('upper').weights[j] ? attack : run;
      expect(mixed.getRotation(j).equals(from.getRotation(j))).toBe(true);
    }
    expect(mixed.rootPos.equals(run.rootPos) && mixed.rootRot.equals(run.rootRot)).toBe(true);
    const shared = blendPoses(run, attack, 1, new Pose(), { mask: boneMask({ chest: 0.5 }) });
    const expectedChest = blendPoses(run, attack, 0.5).getRotation('chest');
    expect(shared.getRotation('chest').equals(expectedChest)).toBe(true);
  });
});

describe('additive layers', () => {
  it('makeAdditive then addPose gives the pose back', () => {
    const reference = randomPose(10);
    const pose = randomPose(11);
    const layer = makeAdditive(pose, reference);
    const back = addPose(reference, layer);
    for (let j = 0; j < JOINT_COUNT; j++) expect(between(back.getRotation(j), pose.getRotation(j))).toBeLessThan(1e-6);
    expect(back.rootPos.distanceTo(pose.rootPos)).toBeLessThan(1e-12);
    expect(back.rootScale.distanceTo(pose.rootScale)).toBeLessThan(1e-12);
    expect(between(back.rootRot, pose.rootRot)).toBeLessThan(1e-7);
  });

  it('adds a delta on top of any base, scaled by weight and mask', () => {
    const reference = new Pose();
    const nod = new Pose().setRotation('head', turn(X, 0.3));
    nod.rootPos.set(0, -0.1, 0);
    const layer = makeAdditive(nod, reference);
    const base = new Pose().setRotation('head', turn(Y, 0.5));
    const full = addPose(base, layer);
    expect(between(full.getRotation('head'), turn(Y, 0.5).multiply(turn(X, 0.3)))).toBeLessThan(1e-6);
    expect(full.rootPos.y).toBeCloseTo(-0.1, 12);
    const half = addPose(base, layer, 0.5);
    expect(between(half.getRotation('head'), turn(Y, 0.5).multiply(turn(X, 0.15)))).toBeLessThan(1e-6);
    expect(half.rootPos.y).toBeCloseTo(-0.05, 12);
    const masked = addPose(base, layer, 1, new Pose(), boneMask('legs'));
    expect(masked.equals(base)).toBe(true);
    expect(addPose(base, layer, 0).equals(base)).toBe(true);
  });

  it('layers stack, and may write into the base', () => {
    const reference = new Pose();
    const lean = makeAdditive(new Pose().setRotation('spine1', turn(X, 0.2)), reference);
    const pose = new Pose();
    addPose(pose, lean, 1, pose);
    addPose(pose, lean, 1, pose);
    expect(between(pose.getRotation('spine1'), turn(X, 0.4))).toBeLessThan(1e-6);
  });

  it('makeAdditive may write into its inputs', () => {
    const [pose, reference] = [randomPose(12), randomPose(13)];
    const expected = makeAdditive(pose, reference);
    expect(makeAdditive(pose, reference, pose.clone()).equals(expected)).toBe(true);
    expect(makeAdditive(pose, reference, pose).equals(expected)).toBe(true);
    const [pose2, reference2] = [randomPose(12), randomPose(13)];
    expect(makeAdditive(pose2, reference2, reference2).equals(expected)).toBe(true);
  });
});

describe('hashPose', () => {
  it('is the FNV-1a digest of toArray(), so equal numbers hash alike', () => {
    const pose = randomPose(14);
    expect(hashPose(pose)).toBe(hashNumbers(pose.toArray()));
    expect(hashPose(pose.clone())).toBe(hashPose(pose));
    expect(hashValue(pose as never)).toBe(hashValue(pose.toArray()));
  });

  it('changes with any number', () => {
    const pose = randomPose(15);
    const seen = new Set([hashPose(pose)]);
    pose.local[40] = Math.fround(pose.local[40] + 1e-6);
    seen.add(hashPose(pose));
    pose.rootScale.y += 1e-9;
    seen.add(hashPose(pose));
    expect(seen.size).toBe(3);
  });

  it('pins the rest pose (a golden: it changes only with the storage layout or the hash)', () => {
    expect(hashPose(new Pose())).toBe('64a7ef7aa78b9398');
  });
});
