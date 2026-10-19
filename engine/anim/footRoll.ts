/**
 * @file A held foot's roll, for the foot plant (PLAN.md WP 13.10, ADR-0025 amendment 10; engine/anim/footPlant.ts runs
 * it, with locks): a held foot lies flat on its ground and rolls as the animation's ankle lets it (authoring.ts
 * `solveLeg`, `ankleLimit`): its heel lifts off the ball as the shin leans forward over it past the ankle's bend up, and
 * its toes rise off the heel past its bend down (`pitchHeel`, from the animation's own roll; `liftHeel` settles it on
 * the plant's leg), the toes lying flat on the ground as the heel lifts (`layToes`). With them, the knee bends the way
 * the animation bends it (`kneePole`), a held foot keeps its heading (`heading`), and `heelPosition` finds a sole's
 * points. Split from footPlant.ts so that file stays under 400 lines.
 *
 * Invariants: each writes only the plan or the pose it is given (and the pose's FK where it says so); nothing reads a
 * clock or a random stream; the scratch objects are this module's own, so nothing allocates.
 *
 * @example
 * import { Quaternion } from '../core/math';
 * heading(new Quaternion()); // 0: a foot along +Z
 * @see engine/anim/footPlant.test.ts
 */
import { MathUtils, Quaternion, Vector3 } from '../core/math';
import { ankleLimit, B, SOLVE } from './authoring';
import { forwardKinematics, jointPosition, jointToWorld, type WorldPose } from './fk';
import { twoBoneRot } from './ik';
import type { Pose } from './pose';
import { jointIndex, PROPORTIONS, type Skeleton } from './skeleton';

/** Scratch objects. */
const v = Array.from({ length: 6 }, () => new Vector3());
const q = [new Quaternion(), new Quaternion()];
const UP = new Vector3(0, 1, 0);
const LEGS = (['L', 'R'] as const).map((s) => [`thigh${s}`, `shin${s}`, `toe${s}`] as const);

/**
 * What the roll reads and writes of a foot's plan in footPlant.ts: its foot joint, the ankle's target, its world
 * rotation and the knee's pole, how far it is held (1 held), and its roll: its rotation lying flat, its pitch (rad: +
 * the heel up about the ball, − the toes up about the heel), and the ball's and the heel's places on the ground.
 */
export interface FootRoll {
  readonly foot: 'footL' | 'footR';
  readonly ankle: Vector3;
  readonly rotation: Quaternion;
  pole?: Vector3;
  held: number;
  readonly flat: Quaternion;
  pitch: number;
  readonly ball: Vector3;
  readonly heel: Vector3;
}

/** Where a foot turned by `rotation` points, about the vertical (rad; 0 along +Z). */
export function heading(rotation: Quaternion): number {
  const ahead = v[0].set(0, 0, 1).applyQuaternion(rotation);
  return Math.atan2(ahead.x, ahead.z);
}

/**
 * Where the back of a foot's sole is (world, m), as the anim checks read it: under the ankle, behind it; or the sole
 * `along` of the foot from its heel (`PROPORTIONS.ball`: under the ball).
 */
export function heelPosition(skeleton: Skeleton, world: WorldPose, side: number, out: Vector3, along = 0): Vector3 {
  const b = skeleton.build;
  out.set(0, -b.ankleHeight * b.size, (along - PROPORTIONS.heel) * b.footLength * b.size);
  return jointToWorld(world, side === 0 ? 'footL' : 'footR', out, out);
}

/**
 * The knee's pole for the foot `foot` on the ground on `side`: the way the animation bends it, off the line from the
 * hip to the ankle, leaning toward the leg solve's pole (authoring.ts `SOLVE.legPole`) by `bend` metres as the leg
 * straightens. The IK's own default, the thigh's forward, turns down as a deep crouch levels the thigh and folds the
 * knee under; a lifted foot (a kick) keeps it.
 */
export function kneePole(
  skeleton: Skeleton,
  pose: Pose,
  world: WorldPose,
  side: number,
  foot: 'footL' | 'footR',
  bend: number,
  out: Vector3,
): Vector3 {
  const [thigh, shin] = LEGS[side];
  const [hip, knee, line] = [v[1], v[2], v[3]];
  jointPosition(world, thigh, hip);
  jointPosition(world, shin, knee).sub(hip);
  jointPosition(world, foot, line).sub(hip).normalize();
  knee.addScaledVector(line, -knee.dot(line)); // the knee off the line
  const L = SOLVE.legPole;
  B(L[0], (side === 0 ? -1 : 1) * L[1], L[2], out)
    .applyQuaternion(pose.rootRot)
    .normalize();
  return out
    .multiplyScalar(bend * skeleton.build.size)
    .add(knee)
    .normalize();
}

/** Turns the plan's foot and ankle target `angle` radians: + the heel up about the ball, − the toes up about the heel. */
export function pitchHeel(plan: FootRoll, angle: number): void {
  const [footUp, ahead] = [v[4].copy(UP).applyQuaternion(plan.rotation), v[5].set(0, 0, 1).applyQuaternion(plan.rotation)]; // prettier-ignore
  const turn = q[0].setFromAxisAngle(footUp.cross(ahead), angle); // about the foot's side: the toes down, the heel up
  const pivot = plan.pitch + angle >= 0 ? plan.ball : plan.heel;
  plan.ankle.sub(pivot).applyQuaternion(turn).add(pivot);
  plan.rotation.premultiply(turn);
  plan.pitch += angle;
}

/**
 * A held foot's roll settled on the plant's leg after its solve, by the animation's ankle (authoring.ts `ankleLimit`,
 * `SOLVE`, loosened by the knee as far as the body is in its `stride`): past its bend up (the shin leaning forward over
 * the foot) its heel lifts further off the ball, past its bend down its toes further off the heel, the leg solving again
 * after each turn (the shin moves as the ankle does: a few turns settle it). Runs FK.
 */
export function liftHeel(
  skeleton: Skeleton,
  pose: Pose,
  world: WorldPose,
  side: number,
  plan: FootRoll,
  stride: number,
): void {
  const [thigh, shin] = LEGS[side];
  const [shinUp, knee, hip, ankle] = [v[1], v[2], v[3], v[0]];
  for (let i = 0; i < 4; i++) {
    shinUp.subVectors(jointPosition(world, shin, knee), jointPosition(world, plan.foot, ankle));
    const bent = knee.sub(jointPosition(world, thigh, hip)).angleTo(shinUp.negate()); // the knee's bend
    const up = MathUtils.lerp(SOLVE.dorsiflexion, ankleLimit(bent), stride);
    shinUp.negate().normalize();
    const [footUp, ahead] = [v[4].copy(UP).applyQuaternion(plan.rotation), v[5].set(0, 0, 1).applyQuaternion(plan.rotation)]; // prettier-ignore
    const bend = Math.atan2(shinUp.dot(ahead), shinUp.dot(footUp));
    const heel = plan.pitch >= 0 ? Math.max(0, bend - up) : 0;
    const toes = plan.pitch <= 0 ? Math.min(0, bend + SOLVE.plantarflexion) : 0;
    if (!(Math.abs(heel + toes) > 1e-4)) break;
    pitchHeel(plan, heel + toes);
    twoBoneRot(skeleton, pose, world, plan.foot, plan.ankle, plan);
  }
}

/** A held foot's toes lie flat on the ground as its heel lifts, their tips on it. Runs FK. */
export function layToes(skeleton: Skeleton, pose: Pose, world: WorldPose, side: number, plan: FootRoll): void {
  const lying = plan.pitch > 0 ? q[1].copy(plan.rotation).invert().multiply(plan.flat) : q[1].identity(); // flat
  pose.setRotation(jointIndex(LEGS[side][2]), lying);
  forwardKinematics(skeleton, pose, world);
}
