/**
 * @file Unit tests for inverse kinematics (engine/anim/ik.ts), PLAN.md WP 3.5's Done when: `twoBone` gives `ik3`'s
 * bits; reach, poles and limits hold for `twoBoneRot`, `aim` and `handTo` (`footPlant`'s are engine/anim/footPlant.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { createWorldPose, forwardKinematics, jointPosition, jointRotation, jointToWorld, socketPosition } from './fk';
import { aim, AIM_CHAIN, handTo, LIMBS, twoBone, twoBoneRot, type LimbEnd } from './ik';
import { Pose } from './pose';
import { createSkeleton, jointIndex, type JointName, type Skeleton } from './skeleton';

type V = [number, number, number];
/** my-3d2dge's `V3` helpers and `ik3`, transcribed from `engine/my-3d2dge.js:117-140`: the reference. */
const V3 = {
  add: (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a: V) => Math.hypot(a[0], a[1], a[2]),
};
function ik3(a: V, b: V, L1: number, L2: number, hint: V): [V, V] {
  let d = V3.sub(b, a), dist = V3.len(d); // prettier-ignore
  const max = L1 + L2 - 0.01;
  if (dist > max) { d = V3.mul(d, max / dist); b = V3.add(a, d); dist = max; } // prettier-ignore
  dist = Math.max(dist, 0.01);
  const n = V3.mul(d, 1 / dist);
  let h = V3.sub(hint, V3.mul(n, V3.dot(hint, n)));
  const hl = V3.len(h);
  h = hl < 1e-4 ? [n[1], -n[0], 0] : V3.mul(h, 1 / hl);
  const x = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), y = Math.sqrt(Math.max(0, L1 * L1 - x * x)); // prettier-ignore
  return [V3.add(V3.add(a, V3.mul(n, x)), V3.mul(h, y)), b];
}
/** A my-3d2dge position in metres (Appendix C): (x, y, z) / 16 → (x, z, y). */
const point = (v: V) => new Vector3(v[0] / 16, v[2] / 16, v[1] / 16);

const BUILDS = ['build:chibi', 'build:heroic', 'build:bulky'];
const ENDS: LimbEnd[] = ['footL', 'footR', 'handL', 'handR'];
const randomUnit = (rng: Rng) => new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
/** A pose with the character moved and turned, and its FK. */
function placed(skeleton: Skeleton, yaw = 0.7) {
  const pose = new Pose();
  pose.rootPos.set(1.5, 0.25, -2);
  pose.rootRot.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return { pose, world: forwardKinematics(skeleton, pose) };
}
const at = (world: ReturnType<typeof createWorldPose>, joint: JointName) => jointPosition(world, joint);
/** The angle between two rotations (normalised first: FK's products of stored rotations drift from unit length). */
const between = (a: Quaternion, b: Quaternion) => a.clone().normalize().angleTo(b.clone().normalize());
/** How far a rotation turns, in radians. */
const turnOf = (r: Quaternion) => between(r, new Quaternion());

describe('twoBone is ik3, verbatim', () => {
  it("gives the source's bits after the unit conversion, in and out of reach", () => {
    const rng = new Rng(35);
    for (let i = 0; i < 2000; i++) {
      const a: V = [rng.range(-40, 40), rng.range(-40, 40), rng.range(0, 30)];
      const b: V = [a[0] + rng.range(-20, 20), a[1] + rng.range(-20, 20), a[2] + rng.range(-20, 20)];
      const [L1, L2] = [rng.range(3, 10), rng.range(3, 10)];
      const hint: V = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
      const [joint, end] = ik3(a, b, L1, L2, hint);
      const out = twoBone(point(a), point(b), L1 / 16, L2 / 16, new Vector3(hint[0], hint[2], hint[1]));
      expect([out[0].toArray(), out[1].toArray()]).toEqual([point(joint).toArray(), point(end).toArray()]);
    }
    const [joint] = twoBone(point([1, 2, 3]), point([1, 2, 3]), 0.5, 0.5, new Vector3(0, 0, 1));
    expect(joint.toArray()).toEqual(point(ik3([1, 2, 3], [1, 2, 3], 8, 8, [0, 1, 0])[0]).toArray());
  });

  it('keeps both bone lengths and bends toward the pole; out of reach it stops short on the line', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const a = new Vector3(rng.range(-1, 1), rng.range(0, 2), rng.range(-1, 1));
      const b = a.clone().add(randomUnit(rng).multiplyScalar(rng.range(0.05, 1.4)));
      const pole = randomUnit(rng);
      const [joint, end] = twoBone(a, b, 0.45, 0.4, pole);
      expect(joint.distanceTo(a)).toBeCloseTo(0.45, 12);
      expect(joint.distanceTo(end)).toBeCloseTo(0.4, 12);
      const line = end.clone().sub(a).normalize();
      const bend = joint.clone().sub(a).projectOnPlane(line);
      expect(bend.dot(pole.clone().projectOnPlane(line))).toBeGreaterThanOrEqual(0);
      if (a.distanceTo(b) < 0.85 - 0.01 / 16) expect(end.distanceTo(b)).toBe(0);
      else expect(end.distanceTo(a)).toBeCloseTo(0.85 - 0.01 / 16, 12);
      expect(line.dot(b.clone().sub(a).normalize())).toBeCloseTo(1, 12);
    }
  });

  it('a pole along the limb falls back to a unit horizontal, so the bones keep their lengths', () => {
    for (const target of [new Vector3(0.3, 0.2, 0.1), new Vector3(0, 0.3, 0)]) {
      const pole = target.clone();
      const [joint, end] = twoBone(new Vector3(), target, 0.3, 0.3, pole);
      expect(joint.length()).toBeCloseTo(0.3, 12);
      expect(joint.distanceTo(end)).toBeCloseTo(0.3, 12);
    }
  });
});

describe('twoBoneRot', () => {
  for (const id of BUILDS) {
    it(`${id}: each limb reaches targets in reach exactly, its middle joint where twoBone puts it`, () => {
      const skeleton = createSkeleton(id);
      const rng = new Rng(11);
      for (const end of ENDS) {
        const [upper, mid] = [LIMBS[end].upper, LIMBS[end].middle];
        const [L1, L2] = [skeleton.lengths[jointIndex(mid)], skeleton.lengths[jointIndex(end)]];
        for (let i = 0; i < 60; i++) {
          const { pose, world } = placed(skeleton, rng.range(-3, 3));
          const target = at(world, upper).add(
            randomUnit(rng).multiplyScalar(rng.range(Math.abs(L1 - L2) + 0.02, 0.98 * (L1 + L2))),
          );
          const pole = randomUnit(rng);
          const [joint] = twoBone(at(world, upper), target, L1, L2, pole);
          expect(twoBoneRot(skeleton, pose, world, end, target, { pole })).toBeLessThan(1e-6);
          expect(at(world, end).distanceTo(target)).toBeLessThan(1e-6);
          expect(at(world, mid).distanceTo(joint)).toBeLessThan(1e-6);
          // the middle joint is a hinge, bent 0 to π about its axis, never backwards
          const q = pose.getRotation(mid);
          const axis = new Vector3().fromArray(LIMBS[end].hinge);
          expect(new Vector3(q.x, q.y, q.z).cross(axis).length()).toBeLessThan(1e-6);
          expect(q.x * axis.x + q.y * axis.y + q.z * axis.z).toBeGreaterThanOrEqual(-1e-7);
        }
      }
    });
  }

  it('out of reach, the limb straightens toward the target and returns how far short it stops', () => {
    const skeleton = createSkeleton('build:heroic');
    const { pose, world } = placed(skeleton);
    const hip = at(world, 'thighR');
    const target = hip.clone().add(new Vector3(0.3, -2, 0.4));
    const reach = skeleton.lengths[jointIndex('shinR')] + skeleton.lengths[jointIndex('footR')];
    const short = twoBoneRot(skeleton, pose, world, 'footR', target);
    expect(short).toBeCloseTo(target.distanceTo(hip) - reach + 0.01 / 16, 6);
    expect(at(world, 'footR').distanceTo(hip)).toBeCloseTo(reach - 0.01 / 16, 6);
  });

  it('without a pole the knee keeps the way it pointed; the end keeps its world rotation unless given one', () => {
    const skeleton = createSkeleton('build:chibi');
    const { pose, world } = placed(skeleton, 0);
    const left = new Vector3(1, 0, 0.2);
    twoBoneRot(skeleton, pose, world, 'footL', at(world, 'thighL').add(new Vector3(0, -0.5, 0.1)), { pole: left });
    const before = jointRotation(world, 'footL');
    twoBoneRot(skeleton, pose, world, 'footL', at(world, 'thighL').add(new Vector3(0.1, -0.55, 0.15)));
    const knee = at(world, 'shinL')
      .sub(at(world, 'thighL'))
      .projectOnPlane(new Vector3(0, 1, 0));
    expect(knee.x).toBeGreaterThan(0.1);
    expect(between(jointRotation(world, 'footL'), before)).toBeLessThan(1e-6);
    const turned = new Quaternion().setFromEuler(new Euler(0.3, 0.5, -0.2));
    twoBoneRot(skeleton, pose, world, 'footL', at(world, 'footL'), { rotation: turned });
    expect(between(jointRotation(world, 'footL'), turned)).toBeLessThan(1e-6);
  });

  it('holds under the squash scale, and brings an offset point (a socket) to the target instead of the joint', () => {
    const skeleton = createSkeleton('build:bulky');
    const { pose, world } = placed(skeleton);
    pose.rootScale.set(1.1, 0.85, 1.1);
    forwardKinematics(skeleton, pose, world);
    const target = at(world, 'upperArmR').add(new Vector3(-0.2, 0.1, 0.35));
    expect(twoBoneRot(skeleton, pose, world, 'handR', target)).toBeLessThan(1e-6);
    expect(at(world, 'handR').distanceTo(target)).toBeLessThan(1e-6);
    const offset = new Vector3(0, -0.08, 0.05);
    const sole = at(world, 'thighL').add(new Vector3(0.1, -0.5, 0.2));
    expect(twoBoneRot(skeleton, pose, world, 'footL', sole, { offset })).toBeLessThan(1e-6);
    expect(jointToWorld(world, 'footL', offset).distanceTo(sole)).toBeLessThan(1e-6);
  });

  it('refuses a joint that does not end a limb, and a target that is not finite', () => {
    const skeleton = createSkeleton();
    const { pose, world } = placed(skeleton);
    expect(() => twoBoneRot(skeleton, pose, world, 'head' as LimbEnd, new Vector3())).toThrow(/ANIM_UNKNOWN_JOINT/);
    expect(() => twoBoneRot(skeleton, pose, world, 'footL', new Vector3(0, NaN, 0))).toThrow(/ANIM_BAD_TARGET/);
  });
});

describe('aim', () => {
  /** The gaze: from between the eyes along the head's +Z. */
  const gaze = (skeleton: Skeleton, world: ReturnType<typeof createWorldPose>) => {
    const eyes = socketPosition(skeleton, world, 'eyeL')
      .add(socketPosition(skeleton, world, 'eyeR'))
      .multiplyScalar(0.5);
    return { eyes, forward: new Vector3(0, 0, 1).applyQuaternion(jointRotation(world, 'head')) };
  };

  it('spreads the turn over chest, neck and head and puts the gaze on a target within the limits', () => {
    const skeleton = createSkeleton('build:heroic');
    for (const offset of [new Vector3(1, 0.4, 2), new Vector3(-1.5, -0.6, 1.2), new Vector3(0.2, 0.9, 1)]) {
      const { pose, world } = placed(skeleton);
      const target = gaze(skeleton, world).eyes.add(offset.applyQuaternion(pose.rootRot));
      expect(aim(skeleton, pose, world, target)).toBeLessThan(1e-4);
      const { eyes, forward } = gaze(skeleton, world);
      expect(forward.angleTo(target.clone().sub(eyes))).toBeLessThan(1e-4);
      const turns = AIM_CHAIN.map((link) => turnOf(pose.getRotation(link.joint)));
      for (const angle of turns) expect(angle).toBeGreaterThan(0.02);
      expect(turns[0]).toBeLessThan(turns[2]);
    }
  });

  it('stops each joint at its limits and returns the angle the gaze still misses by', () => {
    const skeleton = createSkeleton('build:chibi');
    const cases = [
      [new Vector3(Math.sin(2.6), 0, Math.cos(2.6)), 'yaw'],
      [new Vector3(0, 5, 0.1), 'pitch'],
    ] as const;
    for (const [offset, limit] of cases) {
      const { pose, world } = placed(skeleton, 0);
      const target = gaze(skeleton, world).eyes.add(offset.clone().multiplyScalar(3));
      const miss = aim(skeleton, pose, world, target);
      const { eyes, forward } = gaze(skeleton, world);
      expect(miss).toBeCloseTo(forward.angleTo(target.clone().sub(eyes)), 9);
      expect(miss).toBeGreaterThan(0.2);
      for (const link of AIM_CHAIN) expect(turnOf(pose.getRotation(link.joint))).toBeCloseTo(link[limit], 5);
    }
  });
});

describe('handTo', () => {
  it("brings the hand's weapon socket to the grip, turned as asked", () => {
    const skeleton = createSkeleton('build:heroic');
    const rng = new Rng(3);
    for (const hand of ['handL', 'handR'] as const) {
      for (let i = 0; i < 30; i++) {
        const { pose, world } = placed(skeleton, rng.range(-3, 3));
        const grip = at(world, LIMBS[hand].upper).add(randomUnit(rng).multiplyScalar(rng.range(0.2, 0.6)));
        const rotation = new Quaternion().setFromEuler(new Euler(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)));
        expect(handTo(skeleton, pose, world, hand, grip, { rotation })).toBeLessThan(1e-6);
        expect(socketPosition(skeleton, world, hand === 'handL' ? 'weaponL' : 'weaponR').distanceTo(grip)).toBeLessThan(
          1e-6,
        );
        expect(between(jointRotation(world, hand), rotation)).toBeLessThan(1e-6);
      }
    }
  });
});
