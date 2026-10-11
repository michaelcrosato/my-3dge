/**
 * @file The readable codec's frame math (PLAN.md §10.2, WP 8.2 and WP 8.5; ADR-0010 amendment 4): vectors, frames
 * `[F, R, U]` (forward, right and up as columns), quaternions `[x, y, z, w]`, `[turn, lean, tilt]` degrees, the hint
 * a limb's twist is measured from, and `torso`, which places a key pose's spine, neck, head, shoulders and hips on a
 * rest body. The decode (readable.ts) and the encode (encode.ts) both use this one copy, so a key encodes against
 * exactly the torso its decode rebuilds, and a change to it (format 2's spine, roll and yaw, WP 8.8) reaches both.
 *
 * Invariants: every operation is written as `my-3d2dge:src/mocap/readable.js` writes it, in its order, on the
 * standard `Math`, for its bits (readable.test.ts decodes every curated clip bit-identical to the source, and
 * encode.test.ts encodes as the source does). Points are millimetres in the rig frame: f forward, r right, z up.
 * Internal to engine/anim/clip/.
 *
 * @example
 * fromEuler([90, 0, 0])[0]; // ≈ [0, 1, 0]: a quarter turn brings forward round to the right
 * wld(fromEuler([90, 0, 0]), [0, 1, 0]); // ≈ [-1, 0, 0]: and the right round to the back
 * reachOf(0, 300, 250); // 550: a straight limb reaches its two bones' length
 * qrot(qFromTo(fromEuler([0, 0, 0]), fromEuler([90, 0, 0])), [1, 0, 0]); // ≈ [0, 1, 0]
 * @see engine/anim/clip/readable.test.ts
 * @see engine/anim/clip/encode.test.ts
 */
import type { KeyPose } from './readable';
import type { RestBody } from './validate';

/** A vector `[f, r, z]` (mm, or a direction), or a quaternion `[x, y, z, w]`. */
export type V = number[];
/** A frame: its forward, right and up axes `[F, R, U]`, each in the parent's coordinates. */
export type Frame = V[];
/** `a − b`. */
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** `a + b`. */
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** `a` scaled by `k`. */
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
/** The dot product of `a` and `b`. */
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The length of `a`. */
export const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
/** The cross product `a × b`. */
export const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** `a` at length 1 (a zero vector stays zero). */
export function norm(a: V): V {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** A local vector `l` of frame `M` (axes F, R, U as columns) in the parent's coordinates. */
export const wld = (M: Frame, l: V): V => [
  M[0][0] * l[0] + M[1][0] * l[1] + M[2][0] * l[2],
  M[0][1] * l[0] + M[1][1] * l[1] + M[2][1] * l[2],
  M[0][2] * l[0] + M[1][2] * l[1] + M[2][2] * l[2],
];
/** Parent frame, then a frame relative to it: the child in the grandparent's coordinates. */
export const compose = (parent: Frame, relative: Frame): Frame => relative.map((axis) => wld(parent, axis));
/** Radians in a degree. */
export const DG = Math.PI / 180;

/** A frame `[F, R, U]` as a quaternion `[x, y, z, w]`. */
function quatOf(M: Frame): V {
  const [[m00, m10, m20], [m01, m11, m21], [m02, m12, m22]] = M;
  const tr = m00 + m11 + m22;
  let q: V;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}
const qmul = (a: V, b: V): V => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q: V): V => [-q[0], -q[1], -q[2], q[3]];
/** `v` turned by quaternion `q`. */
export const qrot = (q: V, v: V): V => qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)).slice(0, 3);
/** The quaternion a fraction `t` of the shortest way from `a` to `b`. */
export function qslerp(a: V, b: V, t: number): V {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = b.map((v) => -v);
  }
  if (d > 0.9995) {
    const o = a.map((v, i) => v + (bb[i] - v) * t);
    const l = Math.hypot(...o);
    return o.map((v) => v / l);
  }
  const th = Math.acos(d);
  const k0 = Math.sin((1 - t) * th) / Math.sin(th);
  const k1 = Math.sin(t * th) / Math.sin(th);
  return a.map((v, i) => v * k0 + bb[i] * k1);
}
/** The rotation that takes rest frame A to frame B, as a quaternion. */
export const qFromTo = (A: Frame, B: Frame): V => qmul(quatOf(B), qconj(quatOf(A)));
/** The frame of `[turn, lean, tilt]` degrees: yaw about up, then pitch about right, then roll. */
export function fromEuler(a: V): Frame {
  const [y, p, r] = [a[0] * DG, a[1] * DG, -a[2] * DG];
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p), Math.cos(r), Math.sin(r)];
  const rot = (v: V): V => {
    let [x, yy, z] = v;
    [yy, z] = [yy * cr - z * sr, yy * sr + z * cr];
    [x, z] = [x * cp + z * sp, -x * sp + z * cp];
    return [x * cy - yy * sy, x * sy + yy * cy, z];
  };
  return [rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1])];
}
/** A two-bone limb's root-to-end distance for a bend (degrees, 0 = straight). */
export const reachOf = (bend: number, L1: number, L2: number) =>
  Math.sqrt(Math.max(0, L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(bend * DG)));

/*
 * A twist is measured round the limb from the way its middle joint naturally bends. That direction is known for one
 * limb direction (REST: an arm hanging forward, out and down, its elbow bending back; a leg down, its knee forward)
 * and carried to the limb's actual direction by the shortest turn (the source's comment has the history).
 */
/** A limb kind: an arm (shoulder, elbow, fist) or a leg (hip, knee, ankle). */
export type Limb = 'arm' | 'leg';
const REST = { arm: (s: number): V => [0.5, s * 0.5, -0.7], leg: (_s: number): V => [0.3, 0, -1] };
const BEND = { arm: (s: number): V => [-1, s * 0.5, -0.3], leg: (s: number): V => [1, s * 0.1, 0] };
const across = (h: V, d: V) => norm(sub(h, mul(d, dot(h, d))));
/** The direction limb `limb` of side `s` (−1 left, 1 right) bends toward at twist 0, pointing `dLocal` in `M`. */
export function hintFor(limb: Limb, s: number, M: Frame, dLocal: V): V {
  const d = norm(dLocal);
  const r = norm(REST[limb](s));
  const n0 = across(norm(BEND[limb](s)), r);
  const ax = cross(r, d);
  const sn = len(ax);
  const cs = dot(r, d);
  let n = n0;
  if (sn > 1e-9) {
    // turn n0 by the angle between r and d, round their common normal (Rodrigues)
    const k = mul(ax, 1 / sn);
    const a = Math.atan2(sn, cs);
    const [c, si] = [Math.cos(a), Math.sin(a)];
    n = add(add(mul(n0, c), mul(cross(k, n0), si)), mul(k, dot(k, n0) * (1 - c)));
  }
  return wld(M, across(n, d));
}
/** Each side's sign across the body: left −1, right 1. */
export const SG = { L: -1, R: 1 } as const;
/** Where a limb from `root` ends: direction `v` in frame `M` (mirrored for side `s`) at distance `l`. */
export const limbEnd = (root: V, M: Frame, v: V, s: 'L' | 'R', l: number) =>
  add(root, wld(M, [v[0] * l, v[1] * SG[s] * l, v[2] * l]));

/** The torso and head frames of key pose `k` on rest body `R`, and the joints placed from them. */
export function torso(R: RestBody, k: KeyPose) {
  const p = mul(k.hips as V, R.H0 / 100);
  const RP = fromEuler(k.body as V);
  const RC = compose(RP, fromEuler(k.chest as V));
  const RH = compose(RC, fromEuler(k.head as V));
  const [qP, qC, qH] = [qFromTo(R.Pr, RP), qFromTo(R.Cr, RC), qFromTo(R.Hr, RH)];
  const sp = [p];
  R.spineW.forEach((w, i) => sp.push(add(sp[i], qrot(qslerp(qP, qC, w), R.spine[i]))));
  const neck = sp[4];
  const head = add(neck, qrot(qslerp(qC, qH, R.neckW), R.neckSeg));
  const sh = (s: 'L' | 'R') => {
    const sv = k[`sh${s}`] ?? [0, 0];
    const v0 = R.cv[s];
    const L = len(v0);
    const az = Math.atan2(v0[0], v0[1] * SG[s]) + sv[0] * DG;
    const el = Math.asin(v0[2] / L) + sv[1] * DG;
    const swing = [L * Math.cos(el) * Math.sin(az), SG[s] * L * Math.cos(el) * Math.cos(az), L * Math.sin(el)];
    return add(add(neck, wld(RC, R.clav[s])), wld(RC, swing));
  };
  const hip = (s: 'L' | 'R') => add(p, wld(RP, R.hip[s]));
  return { p, RP, RC, RH, spine1: sp[1], spine2: sp[2], chest: sp[3], neck, head, sh, hip };
}
