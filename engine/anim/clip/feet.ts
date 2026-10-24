/**
 * @file Format 2's foot roll (PLAN.md §10.2, WP 8.8; ADR-0010 amendment 7): `rollL`/`rollR` turn each foot about its
 * ankle-to-ball line, + turning the sole inward. Format 1 keeps the toes in the foot's upright plane (the plane of the
 * ankle-to-ball line and the pelvis's up), so a foot that rolls in a stride, a crouch or a kneel misses its toes:
 * Mesh2Motion's `Land_Three_Point` by 101 mm. The ankle, the ball and the toe are not in line (the toes lie about 30°
 * off the ankle-to-ball line at rest), so their plane shows the roll, and the 36 body points encode it with no more
 * data. Both halves live here: `rolledToe` for the decode (engine/anim/clip/readable.ts) and `encodeRoll` for the
 * importer (engine/anim/clip/encode.ts); the baker turns the foot joint by the same roll (bake.ts).
 *
 * Invariants: a key without `roll` places its toes as format 1 does; the roll turns the toes' plane about the decoded
 * ankle-to-ball line, so the ball stays put; the same roll on either side draws the mirror image (the sign is the
 * side's), so mirroring swaps `rollL` and `rollR`. Angles in degrees.
 *
 * @example
 * const [d, down] = [[1, 0, 0], [0, 0, -1]]; // a right foot pointing forward, its upright plane's down
 * rolledToe(d, down, 30, 10, 'R'); // the toes 30° off the line, turned 10° toward the left (inward)
 * encodeRoll(d, down, rolledToe(d, down, 30, 10, 'R'), 'R'); // { roll: 10, delta: 30 }
 * @see engine/anim/clip/feet.test.ts
 */
import { add, cross, DG, dot, len, mul, norm, SG, sub, wld, type Frame, type V } from './frames';

/**
 * A key's ankle-to-ball line and its upright plane's `down`, as the decode builds them from the pelvis frame `RP`
 * and the foot's `[down, out]` (degrees; `abPitch`, the rest body's ankle-to-ball pitch).
 */
export function footLine(RP: Frame, foot: V, abPitch: number, s: 'L' | 'R'): { d: V; down: V } {
  const [pa, yw] = [(foot[0] + abPitch) * DG, foot[1] * DG];
  const dir = (q: number) => wld(RP, [Math.cos(q) * Math.cos(yw), SG[s] * Math.cos(q) * Math.sin(yw), -Math.sin(q)]);
  return { d: dir(pa), down: dir(pa + Math.PI / 2) };
}

/** `n` turned about the unit line `d` (square to it) by `deg` degrees, the right-hand way. */
const about = (d: V, n: V, deg: number): V => add(mul(n, Math.cos(deg * DG)), mul(cross(d, n), Math.sin(deg * DG)));

/**
 * The toes' direction, unit: `delta` degrees from the ankle-to-ball line `d` toward `down`, the foot's upright plane's
 * normal to `d` on the sole's side (format 1's toe plane), that plane turned about `d` by side `s`'s `roll`.
 */
export function rolledToe(d: V, down: V, delta: number, roll: number, s: 'L' | 'R'): V {
  const n = about(d, down, -SG[s] * roll);
  return add(mul(d, Math.cos(delta * DG)), mul(n, Math.sin(delta * DG)));
}

/**
 * The roll and the toes' angle off the ankle-to-ball line `d` (both degrees) that point the toes along `toe`, in the
 * foot's upright plane with normal `down` (format 1's). Of the two readings (a roll past a quarter turn reads as the
 * opposite bend), the one nearer `prev`'s roll, else the one within a quarter turn. Toes in line with `d` keep `prev`.
 */
export function encodeRoll(d: V, down: V, toe: V, s: 'L' | 'R', prev?: number): { roll: number; delta: number } {
  const off = sub(toe, mul(d, dot(toe, d)));
  const along = dot(toe, d);
  if (len(off) < 1e-6) return { roll: prev ?? 0, delta: along < 0 ? 180 : 0 };
  const m = norm(off);
  const angle = Math.atan2(len(off), along) / DG;
  const rollOf = (n: V) => (-SG[s] * Math.atan2(dot(cross(down, n), d), dot(down, n))) / DG;
  const [a, b] = [
    { roll: rollOf(m), delta: angle },
    { roll: rollOf(mul(m, -1)), delta: -angle },
  ];
  const turn = (r: number) => Math.abs(prev === undefined ? r : ((((r - prev) % 360) + 540) % 360) - 180);
  return turn(a.roll) <= turn(b.roll) ? a : b;
}
