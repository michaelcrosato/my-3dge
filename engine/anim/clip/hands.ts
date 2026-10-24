/**
 * @file Format 2's hands (PLAN.md §10.2, WP 8.8; ADR-0010 amendment 7): `handL`/`handR` `[flex, side, roll]` turn the
 * hand at the wrist, and `gripL`/`gripR` (0–100) close it. Format 1 draws every hand straight along the forearm, its
 * knuckles round the fist; format 2 writes what the source's finger bones show, so a hand on a ledge or a rung lies
 * on it. Both halves live here: `placeHand` for the decode (engine/anim/clip/readable.ts) and `encodeHand` for the
 * importer (engine/anim/clip/encode.ts), so a key encodes against exactly the frame its decode rebuilds.
 *
 * The frame: from the wrist, the forearm's direction F; the thumb's side T0, opposite where the elbow's pole points
 * (the decode's own hint, so it turns with the arm as the elbow does); the palm's side N0 = ±(F × T0), its sign the
 * side's, so a left hand mirrors a right one. Three turns, each a vector turned toward another by an angle: `roll`
 * turns the thumb toward the palm (+ pronates: from thumb forward, palm in, to palm down or back), `flex` the hand
 * toward the palm, `side` the hand toward the thumb. The knuckles sit `HALF_SPAN` either side of the middle knuckle
 * along the turned thumb axis; the fist point (the middle finger's second joint) lies a finger's length beyond the
 * knuckle, curled toward the palm by `grip` × 0.9°. Every turn is a turn toward a vector of the same side, so the
 * same numbers on the other side draw the mirror image: mirroring a clip swaps them (engine/anim/clip/mirror.ts).
 *
 * Invariants: a key without `hand` and `grip` decodes as format 1 does (readable.ts); angles in degrees, grip 0–100;
 * the arm of a key with a hand reaches the fist a straight hand would hold, on the forearm's line (encode.ts), so the
 * elbow and the wrist decode where the capture had them.
 *
 * @example
 * const [F, hint] = [[0, 1, 0], [-1, 0, 0]]; // a right forearm pointing right, its elbow pointing back
 * const hand = placeHand({ knuck: 85, fist: 120 }, [0, 0, 0], F, hint, 'R', [0, 0, 0], 0);
 * hand.knuck; // [0, 85, 0]: straight on, 85 mm from the wrist
 * hand.index; // [20, 85, 0]: the thumb forward, opposite the elbow
 * const back = encodeHand({ knuck: 85, fist: 120 }, [0, 0, 0], F, hint, 'R', hand);
 * [back.hand, back.grip]; // [[0, 0, 0], 0]
 * @see engine/anim/clip/hands.test.ts
 */
import { add, cross, DG, dot, len, mul, norm, SG, sub, type V } from './frames';

/** Half the knuckles' span: the index and pinky knuckles either side of the middle one, mm (format 1's 20). */
export const HALF_SPAN = 20;

/** A hand's turn at the wrist, degrees: toward the palm, toward the thumb, the thumb toward the palm. */
export type HandPose = [flex: number, side: number, roll: number];

/** The rest body's hand lengths: wrist to middle knuckle, and wrist to the fist point with the fingers straight. */
export interface HandSizes {
  knuck: number;
  fist: number;
}

/** The hand's points: the middle knuckle, the fist point, and the index and pinky knuckles. */
export interface HandPoints {
  knuck: V;
  fist: V;
  index: V;
  pinky: V;
}

/** `a` turned toward `b` (both unit, at right angles) by `deg` degrees, and `b` turned on with it. */
function turn(a: V, b: V, deg: number): [V, V] {
  const [c, s] = [Math.cos(deg * DG), Math.sin(deg * DG)];
  return [add(mul(a, c), mul(b, s)), sub(mul(b, c), mul(a, s))];
}

/** The hand's base frame at the wrist: the thumb's side `T0` and the palm's `N0` (see the file comment). */
export function handBase(F: V, hint: V, s: 'L' | 'R'): { T0: V; N0: V } {
  let away = sub(hint, mul(F, dot(hint, F)));
  if (len(away) < 1e-6) away = Math.abs(F[2]) < 0.9 ? [0, 0, -1] : [-1, 0, 0];
  const T0 = mul(norm(away), -1);
  return { T0, N0: mul(cross(F, T0), SG[s]) };
}

/** The hand's direction `H`, thumb axis `T` and palm normal `N` after `pose`'s three turns. */
export function handFrame(F: V, hint: V, s: 'L' | 'R', pose: HandPose = [0, 0, 0]): { H: V; T: V; N: V } {
  const { T0, N0 } = handBase(F, hint, s);
  const [T1, N1] = turn(T0, N0, pose[2]);
  const [F2, N2] = turn(F, N1, pose[0]);
  const [H, T] = turn(F2, T1, pose[1]);
  return { H, T, N: N2 };
}

/** The hand's points from the wrist `wr` and the forearm `F` (unit), as `pose` turns it and `grip` closes it. */
export function placeHand(R: HandSizes, wr: V, F: V, hint: V, s: 'L' | 'R', pose?: HandPose, grip = 0): HandPoints {
  const { H, T, N } = handFrame(F, hint, s, pose);
  const knuck = add(wr, mul(H, R.knuck));
  const [G] = turn(H, N, grip * 0.9);
  return {
    knuck,
    fist: add(knuck, mul(G, R.fist - R.knuck)),
    index: add(knuck, mul(T, HALF_SPAN)),
    pinky: add(knuck, mul(T, -HALF_SPAN)),
  };
}

/**
 * The hand pose and grip that put a hand at the wrist `wr`, forearm `F` and pole `hint` (the decode's) on the
 * captured `points`, to the degree and to the whole grip. Its hand direction is the middle knuckle's; its thumb axis,
 * from the pinky's knuckle to the index's, square to it; its grip, the fist point's curl toward the palm.
 */
export function encodeHand(
  R: HandSizes,
  wr: V,
  F: V,
  hint: V,
  s: 'L' | 'R',
  points: HandPoints,
): { hand: HandPose; grip: number } {
  const { T0, N0 } = handBase(F, hint, s);
  const H = norm(sub(points.knuck, wr));
  const across = sub(points.index, points.pinky);
  let T = sub(across, mul(H, dot(across, H)));
  T = len(T) < 1e-6 ? T0 : norm(T);
  const N = mul(cross(H, T), SG[s]);
  const flex = Math.asin(Math.max(-1, Math.min(1, -dot(N, F)))) / DG;
  const roll = Math.atan2(-dot(N, T0), dot(N, N0)) / DG;
  const side = Math.atan2(-dot(T, F), dot(H, F)) / DG;
  const finger = sub(points.fist, points.knuck);
  const curl = Math.atan2(dot(finger, N), dot(finger, H)) / DG;
  const grip = Math.round(Math.max(0, Math.min(100, curl / 0.9)));
  const whole = (deg: number) => Math.round(deg) + 0; // + 0: no -0 in a stored key
  return { hand: [whole(flex), whole(side), whole(roll)], grip };
}
