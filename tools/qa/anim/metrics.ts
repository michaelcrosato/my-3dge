/**
 * @file The `anim` QA family's motion metrics (PLAN.md §8.6, WP 6.6): what tools/qa/anim.ts and tools/qa/anim/clips.ts
 * measure on a run, as a `Track` (points per step, world and measured from the body), each returning the worst case
 * (`Found`, larger is worse) and the sentence naming where it happened. Thresholds are `ANIM_QA`'s, for a body of
 * `size` 1; lengths scale with the size.
 * - `pops` (metres in a step): a point, measured from the body's position, jumps more than `ANIM_QA.pop.min` in one
 *   step and more than `ratio` times the steps either side (a fast, steady sweep is motion, not a pop).
 * - `footSlide` (metres): a sole within `ANIM_QA.slide.contact` of the floor in consecutive steps moves over the
 *   ground (a treadmill's ground moves too) more than `limit` in one contact.
 * - `closure` (metres): the last pose, back at rest, is farther than `ANIM_QA.closure` from a body that rested all
 *   along.
 * - `limbs` (radians): a knee or an elbow (ik.ts `LIMBS`) turns off its hinge or bends the wrong way (`limit`); a bone
 *   of a limb folded past `ANIM_QA.twist.fold` rolls more than `jump` about itself in one step (`twist`, my-3d2dge's
 *   v1 pop).
 *
 * Carried from `my-3d2dge:tools/ed-sheet.mjs:100-131`: the pops relative to the neighbouring steps (9 units a step and
 * 2.5 times the neighbours, the neighbours counted as at least 0.5 units, here in metres), the foot slide (there over
 * the idle hold, here per contact in every state). Split from tools/qa/anim.ts to keep each under 400 lines (ADR-0014
 * amendment 16).
 *
 * @example
 * import { Vector3 } from '../../../engine/core/math';
 * const still = motionTrack({ where: 'test', names: ['p'], world: [[new Vector3()], [new Vector3()]], positions: [new Vector3(), new Vector3()] }); // prettier-ignore
 * pops(still); // undefined: nothing moved
 * @see tools/qa/anim.test.ts
 */
import { Quaternion, Vector3 } from '../../../engine/core/math';
import { SIM_DT } from '../../../engine/core/time';
import type { MatrixRun } from '../../../engine/anim/stateMatrix';
import { jointIndex, JOINTS } from '../../../engine/anim/skeleton';
import { createWorldPose, forwardKinematics, jointPosition } from '../../../engine/anim/fk';
import { LIMBS } from '../../../engine/anim/ik';

/** The thresholds, in metres and radians for a body of `size` 1. */
export const ANIM_QA = {
  pop: { min: 9 / 16, ratio: 2.5, floor: 0.5 / 16 },
  slide: { contact: 0.005, limit: 0.05 },
  closure: 0.02,
  twist: { fold: (140 * Math.PI) / 180, jump: (120 * Math.PI) / 180 },
  hinge: 0.02,
  angle: 3 * Math.PI,
} as const;
/** One run as the metrics read it: points per step, world and measured from the body, and what they need besides. */
export interface Track {
  /** Where it ran, for messages: the build, the state, the facing. */
  where: string;
  /** The body's scale: thresholds grow with it. */
  size: number;
  dt: number;
  names: readonly string[];
  world: Vector3[][];
  /** The points measured from the body's position. */
  local: Vector3[][];
  /** The indices of the soles. */
  feet: readonly number[];
  /** The ground's velocity under the body while it holds the state, and the steps that hold it. */
  treadmill: Vector3;
  held: readonly [number, number];
}

/** What a metric found: the worst value and its sentence. */
export type Found = { value: number; message: string } | undefined;

const ZERO = new Vector3();
/** A metre (or radian) value for messages: up to 4 decimals. */
export const m = (value: number): string => String(Math.round(value * 1e4) / 1e4);
/** The worse of two findings. */
export const worse = (a: Found, b: Found): Found => (!a || (b && b.value > a.value) ? b : a);

/** A track from its points (world metres) and the body's position at each step. */
export function motionTrack(
  spec: Pick<Track, 'where' | 'names' | 'world'> & Partial<Track> & { positions: readonly Vector3[] },
): Track {
  const local = spec.world.map((points, i) => points.map((p) => p.clone().sub(spec.positions[i])));
  return { size: 1, dt: SIM_DT, feet: [], treadmill: ZERO, held: [0, 0], local, ...spec };
}

/** Pops: a point that jumps in one step while the steps either side are much shorter (ed-sheet.mjs:122-125). */
export function pops(t: Track): Found {
  const { min, ratio, floor } = ANIM_QA.pop;
  let found: Found;
  t.names.forEach((name, k) => {
    const d = t.local.slice(1).map((points, i) => points[k].distanceTo(t.local[i][k]));
    for (let i = 1; i < d.length - 1; i++) {
      if (d[i] <= min * t.size || d[i] <= ratio * Math.max(d[i - 1], d[i + 1], floor * t.size)) continue;
      const message = `${t.where}: ${name} jumps ${m(d[i])} m in one step at frame ${i + 1} (${m(d[i - 1])} and ${m(d[i + 1])} m either side); ease into the pose`;
      found = worse(found, { value: d[i], message });
    }
  });
  return found;
}

/** Foot slide: a sole on the floor moving over the ground, the most in one contact. */
export function footSlide(t: Track): Found {
  const { contact, limit } = ANIM_QA.slide;
  let found: Found;
  for (const k of t.feet) {
    let slide = -1;
    for (let i = 1; i < t.world.length; i++) {
      const [a, b] = [t.world[i - 1][k], t.world[i][k]];
      if (Math.max(a.y, b.y) > contact * t.size) {
        slide = -1;
        continue;
      }
      const ground = i >= t.held[0] && i < t.held[1] ? t.treadmill : ZERO;
      slide = Math.max(0, slide) + Math.hypot(b.x - a.x - ground.x * t.dt, b.z - a.z - ground.z * t.dt);
      if (slide <= limit * t.size) continue;
      const message = `${t.where}: ${t.names[k]} slides ${m(slide)} m on the floor by frame ${i} in one contact; plant it, or lift it to move it`;
      found = worse(found, { value: slide, message });
    }
  }
  return found;
}

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
