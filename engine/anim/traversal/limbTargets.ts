/**
 * @file Where a traversing body's hands and feet go (PLAN.md WP 13.11; engine/anim/traversal/pose.ts lays them,
 * plant.ts solves the limbs onto them): a `LimbTarget` a limb, its world point, its weight and whether it is on its
 * contact; `layTarget` lays a point into one beside what it holds already, and `createLimbTargets` makes the four
 * (the hands, then the feet) at weight 0. Split from pose.ts at its line cap.
 *
 * Invariants: the weights laid into a target add up to at most 1; a target is on its contact (`held`) only when one
 * point alone holds it fully, nothing blended in.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const [hand] = createLimbTargets();
 * layTarget(hand, new Vector3(0, 2, 0), 1, true);
 * [hand.weight, hand.held]; // [1, true]: on its contact
 * @see engine/anim/traversal/pose.test.ts
 */
import { Vector3 } from '../../core/math';

/** Where one hand or foot goes now: a world point, how much (0 to 1), and whether it is on its contact. */
export interface LimbTarget {
  readonly point: Vector3;
  weight: number;
  held: boolean;
}

/**
 * Lays `point` into `target` at `weight` (0 to 1) beside what it holds: the points blend by their weights, which add
 * up to at most 1; it is on its contact (`held`) only when this point alone holds it fully, nothing blended in (a way
 * easing out under another easing in holds nothing).
 */
export function layTarget(target: LimbTarget, point: Vector3, weight: number, held: boolean): void {
  if (!(weight > 0)) return;
  const total = target.weight + weight;
  const alone = !(target.weight > 0);
  if (alone) target.point.copy(point);
  else target.point.lerp(point, weight / total);
  [target.weight, target.held] = [Math.min(1, total), held && alone && weight >= 1 - 1e-9];
}

/** Four limb targets at weight 0, for `TraversalPose.targets`. */
export function createLimbTargets(): [LimbTarget, LimbTarget, LimbTarget, LimbTarget] {
  return [0, 1, 2, 3].map(() => ({ point: new Vector3(), weight: 0, held: false })) as [LimbTarget, LimbTarget, LimbTarget, LimbTarget]; // prettier-ignore
}
