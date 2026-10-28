/**
 * @file A hand swung to a grip (PLAN.md WP 13.11, WP 13.20: engine/anim/traversal/plant.ts swings a hand onto its
 * hold, hold.ts the gun's hands onto the gun): `swingGrip` moves hand `side`'s grip socket `k` of the way to a point about the shoulder, its direction turned
 * and its distance eased, rather than straight across, so a reach overhead or across the body never folds the arm
 * through the shoulder; a turn of nearly half a circle goes through the body's front. Split from
 * engine/anim/traversal/plant.ts at its line cap.
 *
 * Invariants: reads the animator's last pose only; `k` at 1 (or a grip at the shoulder) lands on the point exactly.
 *
 * @example
 * // const grip = swingGrip(animator, 'R', target, 0.5, new Vector3()); // halfway, swung about the right shoulder
 * @see engine/anim/traversal/hold.test.ts
 */
import { MathUtils, Quaternion, Vector3 } from '../../core/math';
import type { LimbSide } from '../authoring';
import type { Animator } from '../character';
import { jointPosition, socketPosition } from '../fk';

/**
 * Where hand `side`'s grip is `k` (0 to 1) of the way from where it is to `point`, written into `out`: swung about
 * the shoulder (its direction turned and its distance eased) rather than straight across, so a reach overhead or across
 * the body never folds the arm through the shoulder; a turn of nearly half a circle goes through the body's front.
 */
export function swingGrip(animator: Animator, side: LimbSide, point: Vector3, k: number, out: Vector3): Vector3 {
  const { skeleton, world, pose } = animator.body;
  const shoulder = jointPosition(world, `upperArm${side}`, w[0]);
  const from = socketPosition(skeleton, world, `weapon${side}`, out).sub(shoulder);
  const to = w[1].subVectors(point, shoulder);
  const [a, b] = [from.length(), to.length()];
  if (a < 1e-6 || b < 1e-6 || k >= 1) return out.copy(point);
  from.divideScalar(a);
  to.divideScalar(b);
  const axis = w[2].crossVectors(from, to);
  if (axis.length() < 0.3) axis.crossVectors(from, w[3].set(0, 0, 1).applyQuaternion(pose.rootRot)); // through the front
  const angle = Math.atan2(w[3].crossVectors(from, to).length(), from.dot(to));
  const turn = sq.setFromAxisAngle(axis.normalize(), angle * k);
  return from
    .applyQuaternion(turn)
    .multiplyScalar(MathUtils.lerp(a, b, k))
    .add(shoulder);
}
const w = Array.from({ length: 4 }, () => new Vector3());
const sq = new Quaternion();
