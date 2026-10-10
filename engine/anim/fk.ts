/**
 * @file Forward kinematics (PLAN.md WP 3.4, I-08): `forwardKinematics(skeleton, pose)` turns a pose's local rotations
 * into each joint's world matrix, position and rotation, and the helpers read a joint, a socket or a leaf bone's tip
 * out of the result as three.js math objects.
 *
 * Invariants:
 * - The same composition as three.js's `Bone` hierarchy (fk.test.ts proves it): the root's matrix is
 *   T(rootPos) · R(rootRot) · S(rootScale), and each joint's is its parent's · T(offset) · R(local rotation).
 * - `matrices` are column-major 4 × 4, as `Matrix4.elements`, so `new Matrix4().fromArray(world.matrices, j * 16)`
 *   reads one; `rotations` are rootRot times the local rotations down the chain, without the root's scale.
 * - Arithmetic only (+, −, ×; no trigonometry), in doubles: identical bits in Node and Chromium. The result is
 *   overwritten in place, so a caller keeps one per character and FK allocates nothing.
 *
 * @example
 * import { Pose } from './pose';
 * import { createSkeleton } from './skeleton';
 * const skeleton = createSkeleton('build:chibi');
 * const world = forwardKinematics(skeleton, new Pose());
 * jointPosition(world, 'pelvis').y; // 0.75: chibi's legs, 0.375 + 0.375
 * socketPosition(skeleton, world, 'contactL').y; // ≈ 0 (1e-17): the soles on the floor
 * @see engine/anim/fk.test.ts
 */
import { Matrix4, Quaternion, Vector3 } from '../core/math';
import type { Pose } from './pose';
import {
  jointIndex,
  JOINT_COUNT,
  PARENTS,
  socketIndex,
  type JointName,
  type Skeleton,
  type SocketName,
} from './skeleton';

/** A pose in world space: each joint's matrix (16 numbers), position (3) and rotation (4), in `JOINTS` order. */
export interface WorldPose {
  /** Each joint's world matrix, column-major, as three.js's `Matrix4.elements`. */
  readonly matrices: Float64Array;
  /** Each joint's world position, in metres. */
  readonly positions: Float64Array;
  /** Each joint's world rotation (x, y, z, w), without the root's scale. */
  readonly rotations: Float64Array;
}

/** An empty `WorldPose` for `forwardKinematics` to fill. */
export function createWorldPose(): WorldPose {
  return {
    matrices: new Float64Array(JOINT_COUNT * 16),
    positions: new Float64Array(JOINT_COUNT * 3),
    rotations: new Float64Array(JOINT_COUNT * 4),
  };
}

/** The root's matrix and rotation, the parent of the pelvis. */
const rootMatrix = new Float64Array(16);
const rootRotation = new Float64Array(4);

/** Writes T(p) · R(q) · S(s) into `m` (column-major), as three.js's `Matrix4.compose`. */
function compose(m: Float64Array, p: Vector3, q: Quaternion, s: Vector3): void {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z; // prettier-ignore
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2; // prettier-ignore
  const wx = w * x2, wy = w * y2, wz = w * z2; // prettier-ignore
  m[0] = (1 - (yy + zz)) * s.x;
  m[1] = (xy + wz) * s.x;
  m[2] = (xz - wy) * s.x;
  m[4] = (xy - wz) * s.y;
  m[5] = (1 - (xx + zz)) * s.y;
  m[6] = (yz + wx) * s.y;
  m[8] = (xz + wy) * s.z;
  m[9] = (yz - wx) * s.z;
  m[10] = (1 - (xx + yy)) * s.z;
  m[12] = p.x;
  m[13] = p.y;
  m[14] = p.z;
  m[15] = 1;
}

/**
 * Each joint's world matrix, position and rotation for `pose` on `skeleton`, written into `out` (a new `WorldPose`
 * by default) and returned.
 */
export function forwardKinematics(skeleton: Skeleton, pose: Pose, out: WorldPose = createWorldPose()): WorldPose {
  const { matrices: M, positions: P, rotations: R } = out;
  const { offsets: O } = skeleton;
  const L = pose.local;
  compose(rootMatrix, pose.rootPos, pose.rootRot, pose.rootScale);
  pose.rootRot.toArray(rootRotation);
  for (let j = 0; j < JOINT_COUNT; j++) {
    const parent = PARENTS[j];
    const pm = parent < 0 ? rootMatrix : M;
    const p = parent < 0 ? 0 : parent * 16;
    const pr = parent < 0 ? rootRotation : R;
    const r = parent < 0 ? 0 : parent * 4;
    const x = L[j * 4], y = L[j * 4 + 1], z = L[j * 4 + 2], w = L[j * 4 + 3]; // prettier-ignore
    // the local rotation's matrix, column-major, as Matrix4.makeRotationFromQuaternion
    const x2 = x + x, y2 = y + y, z2 = z + z; // prettier-ignore
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2; // prettier-ignore
    const wx = w * x2, wy = w * y2, wz = w * z2; // prettier-ignore
    const l0 = 1 - (yy + zz), l1 = xy + wz, l2 = xz - wy; // prettier-ignore
    const l4 = xy - wz, l5 = 1 - (xx + zz), l6 = yz + wx; // prettier-ignore
    const l8 = xz + wy, l9 = yz - wx, l10 = 1 - (xx + yy); // prettier-ignore
    const ox = O[j * 3], oy = O[j * 3 + 1], oz = O[j * 3 + 2]; // prettier-ignore
    const m = j * 16;
    for (let row = 0; row < 3; row++) {
      const a = pm[p + row], b = pm[p + 4 + row], c = pm[p + 8 + row]; // prettier-ignore
      M[m + row] = a * l0 + b * l1 + c * l2;
      M[m + 4 + row] = a * l4 + b * l5 + c * l6;
      M[m + 8 + row] = a * l8 + b * l9 + c * l10;
      M[m + 12 + row] = a * ox + b * oy + c * oz + pm[p + 12 + row];
      P[j * 3 + row] = M[m + 12 + row];
    }
    M[m + 3] = 0;
    M[m + 7] = 0;
    M[m + 11] = 0;
    M[m + 15] = 1;
    // the world rotation: the parent's times the local one (the Hamilton product, as Quaternion.multiply)
    const qx = pr[r], qy = pr[r + 1], qz = pr[r + 2], qw = pr[r + 3]; // prettier-ignore
    R[j * 4] = qx * w + qw * x + qy * z - qz * y;
    R[j * 4 + 1] = qy * w + qw * y + qz * x - qx * z;
    R[j * 4 + 2] = qz * w + qw * z + qx * y - qy * x;
    R[j * 4 + 3] = qw * w - qx * x - qy * y - qz * z;
  }
  return out;
}

/** The world position of `joint` (a name or an index) in `world`. Throws `ANIM_UNKNOWN_JOINT`. */
export function jointPosition(world: WorldPose, joint: JointName | number, out: Vector3 = new Vector3()): Vector3 {
  return out.fromArray(world.positions, jointIndex(joint) * 3);
}

/** The world rotation of `joint` in `world`. Throws `ANIM_UNKNOWN_JOINT`. */
export function jointRotation(
  world: WorldPose,
  joint: JointName | number,
  out: Quaternion = new Quaternion(),
): Quaternion {
  return out.fromArray(world.rotations, jointIndex(joint) * 4);
}

/** The world matrix of `joint` in `world`. Throws `ANIM_UNKNOWN_JOINT`. */
export function jointMatrix(world: WorldPose, joint: JointName | number, out: Matrix4 = new Matrix4()): Matrix4 {
  return out.fromArray(world.matrices, jointIndex(joint) * 16);
}

/** `point`, given in the frame of joint `j`, in world space. */
function transform(world: WorldPose, j: number, x: number, y: number, z: number, out: Vector3): Vector3 {
  const M = world.matrices;
  const m = j * 16;
  return out.set(
    M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12],
    M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13],
    M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14],
  );
}

/** A point given in `joint`'s own frame, in world space (`localToWorld` for a joint). Throws `ANIM_UNKNOWN_JOINT`. */
export function jointToWorld(
  world: WorldPose,
  joint: JointName | number,
  point: Vector3,
  out = new Vector3(),
): Vector3 {
  return transform(world, jointIndex(joint), point.x, point.y, point.z, out);
}

/** The world position of `socket`: it rides its joint, so it turns with it. Throws `ANIM_UNKNOWN_JOINT`. */
export function socketPosition(skeleton: Skeleton, world: WorldPose, socket: SocketName, out = new Vector3()): Vector3 {
  const s = socketIndex(socket);
  const o = skeleton.socketOffsets;
  return transform(world, skeleton.socketJoints[s], o[s * 3], o[s * 3 + 1], o[s * 3 + 2], out);
}

/**
 * The world position of the far end of `joint`'s bone: a leaf's tip (the top of the head, a fingertip, a toe tip), or
 * the joint itself for the others, whose bones end at their children. Throws `ANIM_UNKNOWN_JOINT`.
 */
export function tipPosition(
  skeleton: Skeleton,
  world: WorldPose,
  joint: JointName | number,
  out = new Vector3(),
): Vector3 {
  const j = jointIndex(joint);
  const t = skeleton.tips;
  return transform(world, j, t[j * 3], t[j * 3 + 1], t[j * 3 + 2], out);
}
