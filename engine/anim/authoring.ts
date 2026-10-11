/**
 * @file Effector-space authoring (PLAN.md WP 3.6, ADR-0009, Appendix C): a pose is written as targets in the
 * character's own terms and solved onto the rotation skeleton. `B(f, r, u)` writes a point or a direction as metres
 * forward, right and up (a three.js `Vector3` in the model frame), `Sided` holds one value per side, `turnRight`
 * turns toward the right hand. The solvers place a `Rig`'s joints on such targets: `solveSpine` (lean, twist, head,
 * level shoulders), `solveArm`, `solveLeg` (the sole on its target, the foot flat within the ankle's range, the toes
 * on the floor) and `holdAlong` (a held weapon's blade). Effector tables (poses.ts, locomotion.ts) are written with
 * `B`, so each number reads as my-3d2dge wrote it; humanoid.ts runs the solvers.
 *
 * Invariants:
 * - The model frame is skeleton.ts's: +Y up, the character faces +Z, its left is +X and its right −X. So
 *   `B(f, r, u)` is `(−r, u, f)`: Appendix C's rig-local (f, r, z) → (−r, z, f), already in metres.
 * - `sideSign` is my-3d2dge's `s`: +1 for the right side, −1 for the left, the sign of `r` on that side.
 * - my-3d2dge's angles turn toward the right hand when positive (its frame was left-handed): `turnRight(a)` is a
 *   turn about +Y by −a, so `B(0, r, 0)` turned by `a` is my-3d2dge's `rz([0, r, 0], a)` in metres.
 * - Targets given to the solvers are rig-local metres before `size`, the floor at y = 0: `rigToWorld` places them
 *   through the pose's root and the rig's `rootOffset`. The solvers write local rotations of a pose cleared before
 *   (the spine first), run FK, and read nothing but their arguments: no clock, no random stream.
 *
 * @example
 * B(1, 0, 0); // (0, 0, 1): forward is +Z
 * B(0, 1, 0); // (-1, 0, 0): the right hand is at −X
 * fru(B(0.25, 0.1375, 0.09375)); // [0.25, 0.1375, 0.09375]
 * B(0, 1, 0).applyQuaternion(turnRight(Math.PI / 2)); // ≈ (0, 0, -1): a quarter turn right takes right to back
 * @see engine/anim/authoring.test.ts
 */
import { MathUtils, Matrix4, Quaternion, Vector3 } from '../core/math';
import { forwardKinematics, jointPosition, jointRotation, type WorldPose } from './fk';
import { twoBone, twoBoneRot } from './ik';
import type { Pose } from './pose';
import { jointIndex, socketIndex, type Skeleton } from './skeleton';

/** A side of the body. */
export type LimbSide = 'L' | 'R';

/** Both sides, left first (my-3d2dge's loops ran `s` over −1, then 1). */
export const SIDES: readonly LimbSide[] = ['L', 'R'];

/** One value for each side. */
export type Sided<T> = Readonly<Record<LimbSide, T>>;

/** A rig-local point or direction: metres (or a direction's parts) forward, right and up. */
export type FRU = readonly [f: number, r: number, u: number];

/** +1 for the right side, −1 for the left: the sign of `r` on that side (my-3d2dge's `s`). */
export function sideSign(side: LimbSide): 1 | -1 {
  return side === 'R' ? 1 : -1;
}

/** `f` metres forward, `r` right and `u` up, in the model frame (+Z forward, −X right, +Y up). Writes into `out`. */
export function B(f: number, r: number, u: number, out: Vector3 = new Vector3()): Vector3 {
  return out.set(-r, u, f);
}

/** `B` of an `FRU` tuple, written into `out`. */
export function fromFRU(p: FRU, out: Vector3 = new Vector3()): Vector3 {
  return out.set(-p[1], p[2], p[0]);
}

/** A model-frame vector back in rig-local terms: [forward, right, up]. */
export function fru(v: Vector3): [f: number, r: number, u: number] {
  return [v.z, -v.x, v.y];
}

const [UP, DOWN] = [new Vector3(0, 1, 0), new Vector3(0, -1, 0)];
const [X_AXIS, Z_AXIS] = [new Vector3(1, 0, 0), new Vector3(0, 0, 1)];

/** A turn of `angle` radians about the up axis toward the right hand (my-3d2dge's `rz`), written into `out`. */
export function turnRight(angle: number, out: Quaternion = new Quaternion()): Quaternion {
  return out.setFromAxisAngle(UP, -angle);
}

/** Every constant of the solvers. */
export const SOLVE = {
  /** Where each knee bends, `[forward, right, up]` for the right leg (my-3d2dge's hint; the left's `right` negated). */
  legPole: [1, 0.15, 0.1],
  /** Where each elbow bends: back, out and down, for the right arm (my-3d2dge's hint; the left's `right` negated). */
  armPole: [-1, 0.7, -0.2],
  /** The most a planted foot bends up from its shin before the heel lifts, radians (15°). */
  dorsiflexion: (15 * Math.PI) / 180,
  /** The most a planted foot bends down from its shin before the toes rise, radians (15°). */
  plantarflexion: (15 * Math.PI) / 180,
  /** A sole this high above the floor or more is lifted, metres: its foot follows the shin; lower, it eases flat. */
  liftHeight: 0.0625,
  /** The most the toes bend up against the floor, radians (60°). */
  toeBend: (60 * Math.PI) / 180,
} as const;

/** What the solvers work on: a skeleton, a pose and its FK, and where the root sits in the rig frame. */
export interface Rig {
  readonly skeleton: Skeleton;
  readonly pose: Pose;
  readonly world: WorldPose;
  /** The root's position in the rig frame, metres after `size`: the pelvis's target less its rest offset. */
  readonly rootOffset: Vector3;
}

/** Scratch objects, so a solve allocates little. */
const v = Array.from({ length: 10 }, () => new Vector3());
const q = Array.from({ length: 8 }, () => new Quaternion());
const basis = new Matrix4();
const pair: [Vector3, Vector3] = [new Vector3(), new Vector3()];

/** Joint indexes by side. */
const J = {
  clavicle: { L: jointIndex('clavicleL'), R: jointIndex('clavicleR') },
  upperArm: { L: jointIndex('upperArmL'), R: jointIndex('upperArmR') },
  thigh: { L: jointIndex('thighL'), R: jointIndex('thighR') },
  toe: { L: jointIndex('toeL'), R: jointIndex('toeR') },
};

/** A rig-local point (metres before `size`, the floor at y = 0) in world space, through the root. */
export function rigToWorld(rig: Rig, p: Vector3, out: Vector3): Vector3 {
  const { pose } = rig;
  const scaled = out.copy(p).multiplyScalar(rig.skeleton.build.size).sub(rig.rootOffset);
  return scaled.applyQuaternion(pose.rootRot).add(pose.rootPos);
}

/** A world point in the rig frame, metres after `size`: `rigToWorld`'s inverse, but for the scale. */
export function rigFromWorld(rig: Rig, p: Vector3, out: Vector3): Vector3 {
  const inverse = q[7].copy(rig.pose.rootRot).invert();
  return out.copy(p).sub(rig.pose.rootPos).applyQuaternion(inverse).add(rig.rootOffset);
}

/** Where a spine points: rig-frame directions and rig-local shoulder points (`solveSpine`). */
export interface SpineTargets {
  /** The spine's direction, pelvis to the shoulder centre (the neck joint). */
  readonly spine: Vector3;
  /** The head's direction from the shoulder centre. */
  readonly head: Vector3;
  /** The shoulder joints, rig-local metres before `size`. */
  readonly shoulders: Sided<Vector3>;
}

/**
 * The spine of a cleared pose: the pelvis turns `hips` toward the right hand; spine0 takes the lean, up to
 * `spine`; spine1, spine2 and the chest spread a turn of `twist` (the shoulder line as near level as the lean
 * allows); the neck points the head along `head`, facing forward; the clavicles lift the shoulder joints onto
 * `shoulders` as near as their length allows. Runs FK.
 */
export function solveSpine(rig: Rig, to: SpineTargets, hips: number, twist: number): void {
  const { pose: P, world: W } = rig;
  const [pelvis, spine0, chest, local] = [q[2], q[3], q[4], q[5]];
  P.setRotation('pelvis', turnRight(hips, pelvis));
  spine0.setFromUnitVectors(UP, to.spine).multiply(pelvis);
  P.setRotation('spine0', local.copy(pelvis).invert().multiply(spine0));
  const across = v[0].copy(X_AXIS).applyQuaternion(turnRight(twist, local));
  across.addScaledVector(to.spine, -across.dot(to.spine)).normalize();
  chest.setFromRotationMatrix(basis.makeBasis(across, to.spine, v[1].crossVectors(across, to.spine)));
  local.copy(spine0).invert().multiply(chest);
  local.setFromAxisAngle(UP, (2 * Math.atan2(local.y, local.w)) / 3);
  for (const joint of ['spine1', 'spine2', 'chest'] as const) P.setRotation(joint, local);
  const forward = v[2].copy(Z_AXIS).addScaledVector(to.head, -to.head.z);
  if (forward.lengthSq() < 1e-12) forward.copy(DOWN);
  forward.normalize();
  const neck = q[6].setFromRotationMatrix(basis.makeBasis(v[3].crossVectors(to.head, forward), to.head, forward));
  P.setRotation('neck', local.copy(chest).invert().multiply(neck));
  forwardKinematics(rig.skeleton, P, W);
  const chestWorld = jointRotation(W, 'chest', q[2]);
  for (const side of SIDES) {
    const clavicle = jointPosition(W, J.clavicle[side], v[0]);
    const from = jointPosition(W, J.upperArm[side], v[1]).sub(clavicle).normalize();
    const goal = rigToWorld(rig, to.shoulders[side], v[2]).sub(clavicle).normalize();
    const lift = q[3].setFromUnitVectors(from, goal).premultiply(local.copy(chestWorld).invert()).multiply(chestWorld);
    P.setRotation(J.clavicle[side], lift);
  }
  forwardKinematics(rig.skeleton, P, W);
}

/** One arm: the wrist onto `hand` (rig-local, before `size`), the elbow bent toward `SOLVE.armPole`. Runs FK. */
export function solveArm(rig: Rig, side: LimbSide, hand: Vector3): void {
  const a = SOLVE.armPole;
  const pole = B(a[0], sideSign(side) * a[1], a[2], v[0]).applyQuaternion(rig.pose.rootRot);
  twoBoneRot(rig.skeleton, rig.pose, rig.world, `hand${side}`, rigToWorld(rig, hand, v[1]), { pole });
}

/**
 * One leg, the sole under its ankle onto `sole` (rig-local, before `size`). my-3d2dge's leg (hip to sole, no ankle)
 * gives the shin's direction; a planted foot lies flat while the ankle allows (`SOLVE.dorsiflexion`,
 * `plantarflexion`) and tips with the shin past that, pivoting on its contact socket, and a lifted one follows the
 * shin; the toes bend up so their tips rest on the floor, as far as the ball's height allows. Runs FK.
 */
export function solveLeg(rig: Rig, side: LimbSide, sole: Vector3): void {
  const { pose: P, world: W, skeleton } = rig;
  const b = skeleton.build;
  const s = b.size;
  const L = SOLVE.legPole;
  const pole = B(L[0], sideSign(side) * L[1], L[2], v[0]);
  const hip = rigFromWorld(rig, jointPosition(W, J.thigh[side], v[1]), v[1]);
  twoBone(hip, v[2].copy(sole).multiplyScalar(s), b.legUpper * s, b.legLower * s, pole, pair);
  const shin = v[3].subVectors(pair[1], pair[0]).normalize();
  const tilt = Math.atan2(-shin.z, -shin.y);
  const pitch = tilt - MathUtils.clamp(tilt, -SOLVE.plantarflexion, SOLVE.dorsiflexion);
  const planted = 1 - MathUtils.clamp(sole.y / SOLVE.liftHeight, 0, 1);
  const flat = q[2].setFromAxisAngle(X_AXIS, pitch);
  const foot = q[3].setFromUnitVectors(DOWN, shin).slerp(flat, planted);
  // a heel lifting pivots on the contact socket, not under the ankle: the sole rises by what the socket would sink
  const contact = v[4].set(0, 0, skeleton.socketOffsets[socketIndex(`contact${side}`) * 3 + 2]).applyQuaternion(foot);
  const raised = v[9].set(0, (Math.max(0, -contact.y) * planted) / s, 0).add(sole);
  twoBoneRot(skeleton, P, W, `foot${side}`, rigToWorld(rig, raised, v[9]), {
    pole: pole.applyQuaternion(P.rootRot),
    rotation: q[4].copy(P.rootRot).multiply(foot),
    offset: v[5].set(0, -b.ankleHeight * s, 0),
  });
  // the toes bend up against the floor, so their tips rest on it, as far as the ball's height allows
  const toe = J.toe[side];
  const tip = v[6].fromArray(skeleton.tips, toe * 3);
  const [reach, rest] = [Math.hypot(tip.y, tip.z), Math.atan2(-tip.y, tip.z)];
  const ball = rigFromWorld(rig, jointPosition(W, toe, v[7]), v[7]).y;
  const toesDown = Math.asin(MathUtils.clamp(-v[8].copy(Z_AXIS).applyQuaternion(foot).y, -1, 1));
  const lie = Math.asin(MathUtils.clamp(ball / reach, -1, 1)) - rest;
  const bend = MathUtils.clamp(toesDown - lie, 0, SOLVE.toeBend);
  if (bend > 0) {
    P.setRotation(toe, q[5].setFromAxisAngle(X_AXIS, -bend));
    forwardKinematics(skeleton, P, W);
  }
}

/**
 * The right hand turned so its weapon socket's +Z runs along `blade` (a rig-frame direction), its length along the
 * forearm as near as that allows; unchanged when the blade lies along the forearm. Runs FK.
 */
export function holdAlong(rig: Rig, blade: Vector3): void {
  const { pose: P, world: W } = rig;
  const dir = v[0].copy(blade).applyQuaternion(P.rootRot);
  const forearm = jointPosition(W, 'handR', v[1]).sub(jointPosition(W, 'forearmR', v[2]));
  const along = v[3].copy(forearm).addScaledVector(dir, -forearm.dot(dir)).negate();
  if (along.lengthSq() < 1e-12) return;
  along.normalize();
  const hand = q[0].setFromRotationMatrix(basis.makeBasis(along, v[4].crossVectors(dir, along), dir));
  P.setRotation('handR', hand.premultiply(jointRotation(W, 'forearmR', q[1]).invert()));
  forwardKinematics(rig.skeleton, P, W);
}
