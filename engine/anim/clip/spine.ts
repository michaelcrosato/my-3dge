/**
 * @file Format 2's spine override, encoded (PLAN.md §10.2, WP 8.8; ADR-0010 amendment 7): `spine [turn, lean, tilt]`
 * turns the spine's two middle bones together, relative to the body, in place of the library's shares, which turn each
 * bone a measured fraction of the way from the pelvis to the chest (validate.ts `RestBody.spineW`). The decode is
 * frames.ts `torso`'s, which both halves share. A curled or arched back (a bow, a crawl, a stealthy run) bends where
 * the shares cannot: Mesh2Motion's `Bow` misses its neck by 129 mm on them.
 *
 * Invariants: the importer writes the override on every key of a clip or on none (`keyAt` holds a field the next key
 * lacks), when `spineMiss` passes `SPINE_MISS` and the override brings the clip's worst frame closer (a long neck's
 * own miss, CMU's, can show once the chest is right); its twist about the spine is the shares' (the two bones lie
 * almost in line, so they say little about it), its bend takes the decoded `spine1` to the captured chest.
 *
 * @example
 * import { busy, clipOf, REST } from '../../../tests/unit/anim/clip-fixtures';
 * import { samplePose } from './readable';
 * const data = samplePose(REST, clipOf([{ ...busy(0), spine: [0, 40, 0] }]), 0); // a back curled 40° forward
 * const capture = { name: 'Curl', n: 1, dur: 0, loop: false, fps: 30, data, move: null };
 * spineMiss(REST, capture) > SPINE_MISS; // true: the shares cannot curl it so
 * @see engine/anim/clip/spine.test.ts
 */
import type { Capture } from './encode';
import {
  add,
  compose,
  cross,
  dot,
  fromEuler,
  len,
  MIDDLE,
  mul,
  norm,
  qFromTo,
  qmul,
  qrot,
  qslerp,
  sub,
  type V,
} from './frames';
import { bodyFrames, euler, pt, rel } from './inverse';
import { POINT_COUNT } from './readable';
import type { RestBody } from './validate';

/**
 * How far (mm) the spine's shares may miss a capture's neck before format 2 writes the `spine` override: half the
 * importer's 30 mm tolerance, past which the shares alone spend most of a key's error.
 */
export const SPINE_MISS = 15;

/** The shortest turn taking direction `a` to direction `b`, a quaternion. */
function qBetween(a: V, b: V): V {
  const [u, v] = [norm(a), norm(b)];
  const c = dot(u, v);
  if (c < -1 + 1e-9) {
    const axis = norm(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    return [...axis, 0];
  }
  const x = cross(u, v);
  const q = [x[0], x[1], x[2], 1 + c];
  const l = Math.hypot(...q);
  return q.map((t) => t / l);
}

/**
 * Format 2's `spine` for key `k` (its hips, body and chest written) on the body points `p` reads: the turn of the
 * spine's middle bones, relative to the body, that takes the decoded `spine1` toward the captured chest, its twist
 * about the spine the shares' own (two bones lying almost in line say little about it).
 */
export function spineOf(R: RestBody, k: Record<string, V>, p: (name: string) => V): V {
  const RP = fromEuler(k.body);
  const [qP, qC] = [qFromTo(R.Pr, RP), qFromTo(R.Cr, compose(RP, fromEuler(k.chest)))];
  const spine1 = add(mul(k.hips, R.H0 / 100), qrot(qslerp(qP, qC, R.spineW[0]), R.spine[0]));
  const middle = R.spine.filter((_, i) => MIDDLE[i]).reduce((a: V, b: V) => add(a, b), [0, 0, 0]);
  const shares = R.spineW.filter((_, i) => MIDDLE[i]);
  const qM = qslerp(qP, qC, shares.reduce((a, b) => a + b) / shares.length);
  const qS = qmul(qBetween(qrot(qM, middle), sub(p('chest'), spine1)), qM);
  return euler(
    rel(
      RP,
      R.Pr.map((axis) => qrot(qS, axis)),
    ),
  );
}

/**
 * The worst miss (mm) over a capture's frames between its neck and the neck the spine's shares rebuild from its
 * pelvis point and its pelvis and chest frames: past `SPINE_MISS`, the importer writes format 2's `spine` override.
 */
export function spineMiss(R: RestBody, cap: Capture): number {
  const size = POINT_COUNT * 3;
  let worst = 0;
  for (let f = 0; f < cap.n; f++) {
    const X = cap.data.subarray(f * size, (f + 1) * size);
    const p = (name: string) => pt(X, name);
    const [P, C] = bodyFrames(p);
    const [qP, qC] = [qFromTo(R.Pr, P), qFromTo(R.Cr, C)];
    const neck = R.spine.reduce((at: V, bone, i) => add(at, qrot(qslerp(qP, qC, R.spineW[i]), bone)), p('pelvis'));
    worst = Math.max(worst, len(sub(neck, p('neck'))));
  }
  return worst;
}
