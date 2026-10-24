/**
 * @file The digitigrade leg (PLAN.md WP 10.1, §5.6's reverse-knee IK): a leg of three bones, the thigh, the shin and
 * the long foot (the metatarsus a bird or a raptor stands up on), from the hip to the toe. `digitigrade(hip, toe,
 * leg, frame, angle)` holds the long foot `angle` rad back from upright in the leg's frame (its forward and its up),
 * so the hock stands behind and above the toe, then solves the thigh and the shin to the hock by two-bone IK
 * (engine/anim/ik.ts `twoBone`) with the knee bent toward `pole` (forward and a little up, by default), so the hock
 * bends back: the reverse knee. Out of reach, the hock stops on the line to where it should be and the toe comes up
 * with it, so the long foot keeps its length rather than the leg stretching. A rig eases `angle` with how low it
 * crouches (the source's 33° standing, 55° low).
 *
 * Invariants: pure, world space, metres and radians; the bones keep their lengths (the IK's `SLACK` aside); the
 * frame's forward and up are unit and square to each other.
 *
 * Carried from `my-3d2dge:src/emberdeep/22-char-dan.js:90-100` (the reverse-knee legs: the metatarsal held 33° + 22° ×
 * low from vertical, `ik3` to the hock with the knee's hint forward, the foot moved with the hock when out of reach),
 * as a mechanism.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const leg = { thigh: 0.32, shin: 0.36, foot: 0.22 };
 * const step = digitigrade(new Vector3(0, 0.75, 0), new Vector3(0, 0, 0.1), leg, { forward: new Vector3(0, 0, 1) }, 0.6); // prettier-ignore
 * step.hock.z < 0.1 && step.hock.y > 0; // true: the hock behind the toe and up off the floor
 * step.knee.z > 0; // true: the knee forward, the hock bent back
 * @see engine/anim/proc/digitigrade.test.ts
 */
import { Vector3 } from '../../core/math';
import { twoBone } from '../ik';

/** A digitigrade leg's bones, metres: the thigh, the shin and the long foot. */
export interface DigitigradeLeg {
  readonly thigh: number;
  readonly shin: number;
  readonly foot: number;
}

/** The leg's frame: its forward and its up (world +Y by default), and where the knee bends (forward, a little up). */
export interface DigitigradeFrame {
  readonly forward: Vector3;
  readonly up?: Vector3;
  readonly pole?: Vector3;
}

/** A solved leg: its knee, its hock and its toe (lifted when out of reach), world metres. */
export interface DigitigradeSolve {
  readonly knee: Vector3;
  readonly hock: Vector3;
  readonly toe: Vector3;
}

const [UP, pole, hockAt] = [new Vector3(0, 1, 0), new Vector3(), new Vector3()];

/** Solves the leg `leg` from `hip` to `toe` in `frame`, its long foot `angle` rad back from upright (see the file comment). */ // prettier-ignore
export function digitigrade(
  hip: Vector3,
  toe: Vector3,
  leg: DigitigradeLeg,
  frame: DigitigradeFrame,
  angle: number,
  out: DigitigradeSolve = { knee: new Vector3(), hock: new Vector3(), toe: new Vector3() },
): DigitigradeSolve {
  const up = frame.up ?? UP;
  hockAt.copy(toe).addScaledVector(frame.forward, -leg.foot * Math.sin(angle)).addScaledVector(up, leg.foot * Math.cos(angle)); // prettier-ignore
  if (frame.pole) pole.copy(frame.pole);
  else pole.copy(frame.forward).addScaledVector(up, 0.3);
  twoBone(hip, hockAt, leg.thigh, leg.shin, pole, [out.knee, out.hock]);
  out.toe.copy(out.hock).add(toe).sub(hockAt); // the toe with the hock: lifted when the hock fell short
  return out;
}
