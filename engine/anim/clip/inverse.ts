/**
 * @file The encode's own frame math (PLAN.md §10.2, WP 8.5; ADR-0010 amendment 4): the inverses of frames.ts's, which
 * the decode and the encode share. Frames from a right or an up and a forward direction, a vector or a frame in
 * another frame's coordinates, `[turn, lean, tilt]` back from a frame, a limb's bend back from its reach, its twist
 * back from where its middle joint lies, and the pelvis, chest and head frames of a set of body points. encode.ts
 * writes key poses with it, spine.ts the spine override.
 *
 * Invariants: every operation is written as `my-3d2dge:src/mocap/readable.js` writes it, in its order, on the
 * standard `Math`, for its bits (encode.test.ts encodes as the source does). Internal to engine/anim/clip/.
 *
 * @example
 * euler(fromEuler([30, -10, 5])); // ≈ [30, -10, 5]
 * bendOf(reachOf(40, 300, 250), 300, 250); // ≈ 40
 * @see engine/anim/clip/encode.test.ts
 */
import { cross, DG, dot, mul, norm, sub, type Frame, type V } from './frames';
import { POINT_INDEX } from './readable';

/** A frame `[F, R, U]` from a right and a forward direction (f × r = u). */
export function frameFR(right: V, fwd: V): Frame {
  const R = norm(right);
  const F = norm(sub(fwd, mul(R, dot(fwd, R))));
  return [F, R, cross(F, R)];
}
/** A frame `[F, R, U]` from an up and a forward direction. */
export function frameUF(up: V, fwd: V): Frame {
  const U = norm(up);
  const F = norm(sub(fwd, mul(U, dot(fwd, U))));
  return [F, cross(U, F), U];
}
/** `v` in frame `M`'s own coordinates (the inverse of `wld`). */
export const loc = (M: Frame, v: V): V => [dot(v, M[0]), dot(v, M[1]), dot(v, M[2])];
/** Frame `child` relative to frame `parent` (the inverse of `compose`). */
export const rel = (parent: Frame, child: Frame): Frame => child.map((axis) => loc(parent, axis));
/** `[turn, lean, tilt]` degrees of a frame: yaw about up, then pitch about right (+ forward), then roll. */
export function euler(M: Frame): V {
  const [F, , U] = M;
  const yaw = Math.atan2(F[1], F[0]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -F[2])));
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)];
  const u1 = [U[0] * cy + U[1] * sy, -U[0] * sy + U[1] * cy, U[2]];
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)];
  const u2 = [u1[0] * cp - u1[2] * sp, u1[1], u1[0] * sp + u1[2] * cp];
  return [yaw / DG, pitch / DG, -Math.atan2(-u2[1], u2[2]) / DG];
}
/** The bend at a two-bone limb's middle joint (degrees, 0 = straight) for a root-to-end distance (`reachOf` back). */
export const bendOf = (dist: number, L1: number, L2: number) =>
  180 - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2)))) / DG;
/** An angle moved by whole turns to continue from the one before (none: unchanged). */
export const unwrap = (v: number, prev: number | undefined) =>
  prev === undefined ? v : v + 360 * Math.round((prev - v) / 360);
/** The signed angle (degrees) round axis `d` from hint `h` to the bend direction `b`. */
export function poleOf(d: V, h: V, b: V): number {
  const hn = norm(sub(h, mul(d, dot(h, d))));
  const bn = norm(sub(b, mul(d, dot(b, d))));
  return Math.atan2(dot(cross(hn, bn), d), dot(hn, bn)) / DG;
}
/** Body point `name` of the decoded or captured points `X`. */
export const pt = (X: ArrayLike<number>, name: string): V => {
  const i = POINT_INDEX[name] * 3;
  return [X[i], X[i + 1], X[i + 2]];
};
/** The pelvis, chest and head frames `[F, R, U]` of the body points `p` reads. */
export const bodyFrames = (p: (name: string) => V): Frame[] => [
  frameFR(sub(p('hipR'), p('hipL')), sub(p('pelvisF'), p('pelvis'))),
  frameUF(sub(p('neck'), p('chest')), sub(p('chestF'), p('chest'))),
  frameUF(sub(p('headTop'), p('head')), sub(p('faceF'), p('head'))),
];
