/**
 * @file The `anim` QA family's motion metrics (PLAN.md §8.6, WP 6.6): what tools/qa/anim.ts and tools/qa/anim/clips.ts
 * measure on a run, as a `Track` (points per step, world and measured from the body), each returning the worst case
 * (`Found`, larger is worse) and the sentence naming where it happened. Thresholds are `ANIM_QA`'s, for a body of
 * `size` 1; lengths scale with the size.
 * - `pops` and `footSlide`, with the `Track` and `ANIM_QA`: engine/anim/motionMetrics.ts's (WP 13.4 moved them there,
 *   so the feel kit reads motion by the same rules), re-exported here.
 * - `closure` (metres): the last pose, back at rest, is farther than `ANIM_QA.closure` from a body that rested all
 *   along.
 * - `limbs` (radians): a knee or an elbow (ik.ts `LIMBS`) turns off its hinge or bends the wrong way (`limit`); a bone
 *   of a limb folded past `ANIM_QA.twist.fold` rolls more than `jump` about itself in one step (`twist`, my-3d2dge's
 *   v1 pop).
 *
 * Split from tools/qa/anim.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * @example
 * import { Vector3 } from '../../../engine/core/math';
 * const still = motionTrack({ where: 'test', names: ['p'], world: [[new Vector3()], [new Vector3()]], positions: [new Vector3(), new Vector3()] }); // prettier-ignore
 * pops(still); // undefined: nothing moved
 * @see tools/qa/anim.test.ts
 */
import { Quaternion, Vector3 } from '../../../engine/core/math';
import { ANIM_QA, m, worse, type Found, type Track } from '../../../engine/anim/motionMetrics';
import type { MatrixRun } from '../../../engine/anim/stateMatrix';
import { jointIndex, JOINTS } from '../../../engine/anim/skeleton';
import { createWorldPose, forwardKinematics, jointPosition } from '../../../engine/anim/fk';
import { LIMBS } from '../../../engine/anim/ik';

export {
  ANIM_QA,
  footSlide,
  m,
  motionTrack,
  pops,
  worse,
  type Found,
  type Track,
} from '../../../engine/anim/motionMetrics';

/** Loop closure: the last pose against a body that rested all along, at the same step (the first `count` points). */
export function closure(t: Track, rest: Track, count = t.names.length): Found {
  const last = t.local.length - 1;
  let found: Found;
  t.local[last].slice(0, count).forEach((p, k) => {
    const off = p.distanceTo(rest.local[last][k]);
    if (off <= ANIM_QA.closure * t.size) return;
    const message = `${t.where}: back at rest, ${t.names[k]} is ${m(off)} m from where a resting body holds it; let every weight ease back`;
    found = worse(found, { value: off, message });
  });
  return found;
}

/** The angle of `q`'s turn about the unit `axis`, radians in [−π, π]. */
function turnAbout(q: Quaternion, axis: Vector3): number {
  const angle = 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);
  return angle > Math.PI ? angle - 2 * Math.PI : angle < -Math.PI ? angle + 2 * Math.PI : angle;
}

/** Joint limits and twist jumps of the limbs (ik.ts `LIMBS`): hinges kept, folded bones never flipping about themselves. */
export function limbs(run: MatrixRun, where: string): { limit: Found; twist: Found } {
  let [limit, twist]: Found[] = [undefined, undefined];
  const pose = createWorldPose();
  const [hinge, q, r, delta] = [new Vector3(), new Quaternion(), new Quaternion(), new Quaternion()];
  let before: Float64Array | undefined;
  run.poses.forEach((p, i) => {
    forwardKinematics(run.skeleton, p, pose);
    for (const [end, limb] of Object.entries(LIMBS)) {
      const [u, mid, e] = [jointIndex(limb.upper), jointIndex(limb.middle), jointIndex(end as never)];
      hinge.fromArray(limb.hinge);
      p.getRotation(mid, q);
      const bend = turnAbout(q, hinge);
      const off = 2 * Math.acos(Math.min(1, Math.abs(r.setFromAxisAngle(hinge, -bend).premultiply(q).w)));
      const bad = Math.max(off, -bend);
      if (bad > ANIM_QA.hinge) {
        const message = `${where}: at frame ${i}, ${limb.middle} turns ${m(off)} rad off its hinge and bends ${m(bend)} rad (0 to π); solve the limb with twoBoneRot`;
        limit = worse(limit, { value: bad, message });
      }
      const [a, b, c] = [jointPosition(pose, u), jointPosition(pose, mid), jointPosition(pose, e)];
      const fold = b.clone().sub(a).angleTo(c.clone().sub(b));
      if (before && fold > ANIM_QA.twist.fold) {
        for (const [j, child] of [
          [u, b],
          [mid, c],
        ] as const) {
          const axis = child.clone().sub(jointPosition(pose, j)).normalize();
          const now = new Quaternion().fromArray(pose.rotations, j * 4);
          delta.multiplyQuaternions(now, new Quaternion().fromArray(before, j * 4).invert());
          const roll = Math.abs(turnAbout(delta, axis));
          if (roll <= ANIM_QA.twist.jump) continue;
          const message = `${where}: at frame ${i}, ${JOINTS[j]} rolls ${m(roll)} rad about itself in one step, folded ${m(fold)} rad; keep its pole steady`;
          twist = worse(twist, { value: roll, message });
        }
      }
    }
    before = pose.rotations.slice();
  });
  return { limit, twist };
}
