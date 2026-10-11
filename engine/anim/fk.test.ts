/**
 * @file Unit tests for forward kinematics (engine/anim/fk.ts): the rest pose's FK matches each build's proportions
 * (PLAN.md WP 3.4, Done when), every pose matches three.js's own `Bone` hierarchy, and the root transform (position,
 * rotation, the squash scale) and sockets land where they should.
 */
import { Bone, Euler, Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { getBuild } from './builds';
import {
  createWorldPose,
  forwardKinematics,
  jointMatrix,
  jointPosition,
  jointRotation,
  socketPosition,
  tipPosition,
} from './fk';
import { Pose } from './pose';
import { createSkeleton, JOINT_COUNT, JOINTS, PARENTS, type JointName, type SocketName } from './skeleton';

const BUILDS = ['build:chibi', 'build:heroic', 'build:bulky', 'build:skeleton'];

/** A joint's world position in `world`. */
const at = (world: ReturnType<typeof createWorldPose>, joint: JointName) => jointPosition(world, joint);
const dist = (a: Vector3, b: Vector3) => a.distanceTo(b);

describe('the rest pose matches the build proportions', () => {
  for (const id of BUILDS) {
    for (const size of [1, 0.5]) {
      it(`${id} at size ${size}`, () => {
        const b = { ...getBuild(id), size } as ReturnType<typeof getBuild>;
        const skeleton = createSkeleton(b);
        const world = forwardKinematics(skeleton, new Pose());
        const m = (value: number) => value * size;
        const pelvis = at(world, 'pelvis');
        expect(pelvis.toArray()).toEqual([0, m(b.legUpper + b.legLower), 0]);
        for (const [side, x] of [
          ['L', 1],
          ['R', -1],
        ] as const) {
          const hip = at(world, `thigh${side}`);
          expect(hip.x).toBeCloseTo(x * m(b.hipHalf), 12);
          expect(dist(hip, at(world, `shin${side}`))).toBeCloseTo(m(b.legUpper), 12);
          const sole = socketPosition(skeleton, world, `contact${side}`);
          expect(sole.y).toBeCloseTo(0, 12);
          expect(dist(at(world, `shin${side}`), at(world, `foot${side}`)) + m(b.ankleHeight)).toBeCloseTo(
            m(b.legLower),
            12,
          );
          expect(at(world, `foot${side}`).y).toBeCloseTo(m(b.ankleHeight), 12);
          const shoulder = at(world, `upperArm${side}`);
          expect(shoulder.x).toBeCloseTo(x * m(b.shoulderHalf), 12);
          expect(shoulder.y - pelvis.y).toBeCloseTo(m(b.torso), 12);
          expect(dist(shoulder, at(world, `forearm${side}`))).toBeCloseTo(m(b.armUpper), 12);
          expect(dist(at(world, `forearm${side}`), at(world, `hand${side}`))).toBeCloseTo(m(b.armLower), 12);
          expect(dist(at(world, `hand${side}`), tipPosition(skeleton, world, `hand${side}`))).toBeCloseTo(
            m(b.handLength),
            12,
          );
          const heelToToe = tipPosition(skeleton, world, `toe${side}`).z - at(world, `foot${side}`).z;
          expect(heelToToe + 0.25 * m(b.footLength)).toBeCloseTo(m(b.footLength), 12);
        }
        const neck = at(world, 'neck');
        expect(neck.y - pelvis.y).toBeCloseTo(m(b.torso), 12);
        expect(at(world, 'head').y - neck.y).toBeCloseTo(m(b.neck), 12);
        const top = socketPosition(skeleton, world, 'headTop');
        expect(top.y).toBeCloseTo(skeleton.height, 12);
        expect(skeleton.height).toBeCloseTo(m(b.legUpper + b.legLower + b.torso + b.neck + 2 * b.headRadius), 12);
      });
    }
  }

  it('is mirror-symmetric, left at +X, facing +Z', () => {
    const skeleton = createSkeleton('build:bulky');
    const world = forwardKinematics(skeleton, new Pose());
    for (const name of JOINTS.filter((joint) => joint.endsWith('L'))) {
      const left = at(world, name);
      const right = at(world, name.replace(/L$/, 'R') as JointName);
      expect(left.x).toBeGreaterThan(0);
      expect(right.toArray()).toEqual([-left.x, left.y, left.z]);
    }
    expect(at(world, 'toeL').z).toBeGreaterThan(at(world, 'footL').z);
    const eyes = ['eyeL', 'eyeR'].map((name) => socketPosition(skeleton, world, name as SocketName));
    expect(eyes[0].z).toBeGreaterThan(0);
    expect(eyes[0].x).toBeCloseTo(-eyes[1].x, 12);
    expect(socketPosition(skeleton, world, 'back').z).toBeLessThan(0);
  });

  it('gives every bone its skeleton length', () => {
    const skeleton = createSkeleton('build:heroic');
    const world = forwardKinematics(skeleton, new Pose());
    for (let j = 1; j < JOINT_COUNT; j++) {
      const length = dist(jointPosition(world, j), jointPosition(world, PARENTS[j]));
      expect(length).toBeCloseTo(skeleton.lengths[j], 12);
    }
  });
});

/** A pose with every joint and the root turned at random (seeded). */
function randomPose(seed: number): Pose {
  const rng = new Rng(seed);
  const pose = new Pose();
  const q = new Quaternion();
  for (let j = 0; j < JOINT_COUNT; j++) {
    pose.setRotation(j, q.setFromEuler(new Euler(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1))));
  }
  pose.rootPos.set(rng.range(-5, 5), rng.range(0, 1), rng.range(-5, 5));
  pose.rootRot.setFromEuler(new Euler(0.2, rng.range(-3, 3), -0.1));
  return pose;
}

describe('forwardKinematics', () => {
  it("matches three.js's Bone hierarchy for any pose", () => {
    const skeleton = createSkeleton('build:heroic');
    const pose = randomPose(7);
    pose.rootScale.set(1.1, 0.8, 1.1);
    const world = forwardKinematics(skeleton, pose);
    const root = new Bone();
    root.position.copy(pose.rootPos);
    root.quaternion.copy(pose.rootRot);
    root.scale.copy(pose.rootScale);
    const bones = JOINTS.map((_, j) => {
      const bone = new Bone();
      bone.position.fromArray(skeleton.offsets, j * 3);
      pose.getRotation(j, bone.quaternion as unknown as Quaternion);
      return bone;
    });
    bones.forEach((bone, j) => (PARENTS[j] < 0 ? root : bones[PARENTS[j]]).add(bone));
    root.updateMatrixWorld(true);
    for (let j = 0; j < JOINT_COUNT; j++) {
      const expected = bones[j].getWorldPosition(new ThreeVector3());
      expect(jointPosition(world, j).distanceTo(expected)).toBeLessThan(1e-9);
      const matrix = jointMatrix(world, j).elements;
      bones[j].matrixWorld.elements.forEach((value, i) => expect(matrix[i]).toBeCloseTo(value, 9));
    }
    // world rotations leave the scale out: rootRot times the local rotations down the chain (stored as float32, so
    // their norms are 1 to about 1e-7)
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    for (let j = 0; j < JOINT_COUNT; j++) {
      const expected = bones[j].getWorldQuaternion(new ThreeQuaternion());
      expect(Math.abs(jointRotation(world, j).dot(expected as unknown as Quaternion))).toBeCloseTo(1, 6);
    }
  });

  it('squashes about the root: the soles stay on the floor', () => {
    const skeleton = createSkeleton();
    const pose = new Pose();
    pose.rootScale.set(1.2, 0.7, 1.2);
    const world = forwardKinematics(skeleton, pose);
    expect(socketPosition(skeleton, world, 'contactL').y).toBeCloseTo(0, 12);
    expect(socketPosition(skeleton, world, 'headTop').y).toBeCloseTo(skeleton.height * 0.7, 12);
  });

  it('turns and places the body with the root', () => {
    const skeleton = createSkeleton();
    const pose = new Pose();
    pose.rootPos.set(3, 0, -2);
    pose.rootRot.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // yaw 90°: facing +X
    const world = forwardKinematics(skeleton, pose);
    const toe = jointPosition(world, 'toeL');
    const ankle = jointPosition(world, 'footL');
    expect(toe.x).toBeGreaterThan(ankle.x);
    expect(
      jointPosition(world, 'pelvis')
        .toArray()
        .map((v) => +v.toFixed(12)),
    ).toEqual([3, 0.75, -2]);
  });

  it('writes into the result it is given, without allocating a new one', () => {
    const skeleton = createSkeleton();
    const out = createWorldPose();
    expect(forwardKinematics(skeleton, randomPose(1), out)).toBe(out);
    const before = Array.from(out.positions);
    forwardKinematics(skeleton, randomPose(2), out);
    expect(Array.from(out.positions)).not.toEqual(before);
    expect(out.positions.every(Number.isFinite)).toBe(true);
  });

  it('bends the elbow about the local axis', () => {
    const skeleton = createSkeleton();
    const pose = new Pose();
    // the left forearm points along +X; turning it +90° about +Y swings it to −Z (behind), −90° to +Z (forward)
    pose.setRotation('forearmL', new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2));
    const world = forwardKinematics(skeleton, pose);
    const elbow = jointPosition(world, 'forearmL');
    const wrist = jointPosition(world, 'handL');
    expect(wrist.z - elbow.z).toBeCloseTo(skeleton.lengths[JOINTS.indexOf('handL')], 7); // float32 rotations
  });
});
