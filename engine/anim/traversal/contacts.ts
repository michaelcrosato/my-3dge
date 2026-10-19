/**
 * @file Where a traversing body's hands and feet touch (PLAN.md WP 13.11, docs/PLAYGROUND.md §5.1): the contacts the
 * view's traversal poses put them on (engine/anim/traversal/pose.ts), from the shooter model's state as plain data
 * (`TraversalView`, the component `motion`: engine/physics/movement/model.ts), the ride it is on (`RideView`, the
 * component `zipline` or `ladder`: engine/world/traverse.ts) and its hull (`HullView`), all read on the view's side.
 * - A mantle (`mantleGrips`): both hands on the ledge's lip, `TRAVERSAL.apart` times the shoulders' width apart along
 *   the edge, a palm's thickness over its top (as engine/physics/movement/mantle.ts `handsOf` places them); a low
 *   ledge taken at a run is vaulted, the left hand alone on its top (a fence's top under one hand at a sprint), and
 *   one under half the shoulders' height is hurdled, no hand on it.
 *   `mantleHold` says how much each hand holds through the phase: the whole grab and hang, the pull's start (they let
 *   go as the body passes over them), a vault's middle.
 * - A ladder (`ladderLimb`): hands and feet on its rungs (a rung every `rung` metres over its foot, as the stage draws
 *   them), each limb climbing `TRAVERSAL.ladderStep` rungs at a move, the right hand with the left foot and the left
 *   hand with the right foot, the cycle locked to the feet's height on it, so it climbs, stops and climbs down with
 *   the body; a moving limb arcs out from the rungs.
 * - A wall-climb (`climbCycle`, `wallPoint`): hand over hand on the wall a skin off the hull, the feet pushing below,
 *   the cycle locked to the height climbed since the catch; a climb not rising (one that caught a fall) slides its
 *   hands and feet down the wall with the body.
 * - A zipline (`cableGrips`): both hands on the cable over the feet, one before the other along it.
 *
 * Invariants: pure functions of their arguments; points are world metres, written into the caller's vectors.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const grips: [Vector3, Vector3] = [new Vector3(), new Vector3()];
 * mantleGrips({ mode: 'mantle', lipX: 0, lipY: 2, lipZ: 1, wallX: 0, wallZ: -1 }, 0.4, grips);
 * grips[1].toArray(); // [-0.2, 2.03, 1]: the right hand facing the wall (+Z), on its top
 * @see engine/anim/traversal/contacts.test.ts
 */
import { MathUtils, Vector3 } from '../../core/math';
import type { MotionView } from '../locomotion/motion';

/** The part of the shooter model's state traversal reads beyond the movement's (`MotionState`'s fields of the name). */
export interface TraversalView extends MotionView {
  /** Its mantle's phase: none, the grab, the hang, the pull. */
  readonly mantle?: string;
  /** Ticks left of the phase, of `mantleTotal`. */
  readonly mantleLeft?: number;
  readonly mantleTotal?: number;
  /** Where the feet were as the phase began: under the lip for a low ledge's pull, on its top after a grab. */
  readonly fromY?: number;
  /** The ledge's lip (m) and the wall's normal across the ground, out toward the body. */
  readonly lipX?: number;
  readonly lipY?: number;
  readonly lipZ?: number;
  readonly wallX?: number;
  readonly wallZ?: number;
  /** Where its climb caught, the feet's height (m); ticks since (−1: not climbing). */
  readonly attachY?: number;
  readonly climbAge?: number;
  /** Which way along a zipline it rides: 1 toward its second anchor, −1 toward its first. */
  readonly rideDir?: number;
  /** Its speed along the ride (m/s): up a ladder above 0. */
  readonly rideSpeed?: number;
  /** A skydive's landing pose has taken over. */
  readonly landing?: boolean;
}

/** The ride a body is on, as the view reads its entity's component (engine/world/traverse.ts's fields). */
export interface RideView {
  readonly zipline?: { readonly from: readonly number[]; readonly to: readonly number[] };
  readonly ladder?: {
    readonly foot: readonly number[];
    readonly top: number;
    readonly normal: readonly number[];
    readonly width: number;
  };
}

/** The body's hull and its rides' numbers: the capsule's radius and skin, a zipline's hang, a ladder's rung spacing (m). */ // prettier-ignore
export interface HullView {
  readonly radius: number;
  readonly skin: number;
  /** How far the hands hang over the feet on a zipline (the model's `zipline.hang`). */
  readonly hang: number;
  /** A rung every this many metres up a ladder (the stage's `RUNG`). */
  readonly rung: number;
}

/** A character's settings as the view reads them (engine/physics/character.ts's `Character`, as plain data). */
interface CharacterView {
  readonly capsule?: { readonly radius?: number };
  readonly offset?: number;
  readonly movement?: { readonly zipline?: { readonly hang?: number } };
}

/** The hull traversal reads from a character's settings, a ladder's rungs `rung` metres apart. */
export function hullOf(character: CharacterView | null | undefined, rung: number): HullView {
  const hang = character?.movement?.zipline?.hang ?? 2.032;
  return { radius: character?.capsule?.radius ?? 0.41, skin: character?.offset ?? 0.01, hang, rung };
}

/** The ride an entity's components describe (its `zipline` or its `ladder`), or null for another entity or none. */
export function rideOf(components: Readonly<Record<string, unknown>> | null | undefined): RideView | null {
  if (components?.zipline) return { zipline: components.zipline as RideView['zipline'] };
  if (components?.ladder) return { ladder: components.ladder as RideView['ladder'] };
  return null;
}

/** The contacts' numbers: shares of a phase or a cycle, metres, m/s. */
export const TRAVERSAL = {
  palm: 0.03, // a grip pressed flat on a top or a wall stands this far off it: the palm's thickness
  apart: 1.15, // the hands on a lip: this times the shoulders' width apart
  pull: [0.1, 0.85], // the pull after a grab: the hands hold to this share of it and have let go by the second
  vault: [0.12, 0.3, 0.55], // a low ledge's hands: on its top by the first share, held to the second, off by the third (the feet rise to it until 0.75)
  vaultSpeed: 3, // a low ledge taken faster than this across the ground is vaulted, one hand on its top
  hurdle: 0.5, // a low ledge lower than this share of the shoulders' height over where the feet began: no hands
  swing: 0.4, // a ladder's or a climb's limb: the share of its cycle it moves between holds
  ladderStep: 2, // rungs a limb climbs at a move
  ladderHand: 0.3, // a hand takes its rung this far over its shoulder, a foot this far over the feet
  ladderFoot: 0.3,
  ladderGrip: [0.15, 0.1], // each hand, and each foot, this far off the ladder's middle
  ladderArc: [0.06, 0.12], // a moving hand, and a moving foot, arcs this far out from the rungs
  climbStep: 1, // a wall-climb's cycle: the height the body climbs while each hand moves once
  climbHand: 0.45, // a hand takes its hold this far over its shoulder, a foot this far over the feet
  climbFoot: 0.5,
  climbGrip: [0.2, 0.12], // each hand, and each foot, this far off the body's middle
  rising: 0.254, // a climb rising slower than this (m/s, the model's `climb.rising`) slides its hands down the wall
  slide: 0.3, // sliding, each hand this far over its shoulder
  cable: 0.07, // the hands on a cable, each this far from the point over the feet, the right one ahead
  hang: [0.3, 0.95], // hanging from a lip: the shoulders over the feet this far out from it (a crouch leans them in), the arms this share of their reach
} as const;

/** The limbs a cycle moves, in order: left hand, right hand, left foot, right foot. */
export type Limb = 0 | 1 | 2 | 3;

/** Each limb's place in a ladder's or a climb's cycle: the right hand with the left foot, then the others. */
const OFFSET = [0.5, 0, 0, 0.5] as const;

/** How far through its mantle phase the body is, 0 to 1. */
export function mantleShare(view: TraversalView): number {
  const total = Math.max(view.mantleTotal ?? 1, 1);
  return MathUtils.clamp((total - (view.mantleLeft ?? total)) / total, 0, 1);
}

/** Whether a mantle's pull is a low ledge's (only the pull, from under the lip) rather than the end of a grab. */
export function lowPull(view: TraversalView): boolean {
  return view.mantle === 'pull' && (view.fromY ?? 0) < (view.lipY ?? 0) - 0.25;
}

/** Where the hands go on the lip: left then right as the body faces the wall, `width` metres apart along the edge. */
export function mantleGrips(view: TraversalView, width: number, out: [Vector3, Vector3]): [Vector3, Vector3] {
  const [nx, nz] = [view.wallX ?? 0, view.wallZ ?? 0];
  const [rx, rz] = [nz * (width / 2), -nx * (width / 2)]; // its right, facing the wall
  const [x, y, z] = [view.lipX ?? 0, (view.lipY ?? 0) + TRAVERSAL.palm, view.lipZ ?? 0];
  out[0].set(x - rx, y, z - rz);
  out[1].set(x + rx, y, z + rz);
  return out;
}

/**
 * How much each hand holds the lip now, left then right: 0 to 1 (see the file comment); `vault` for a vaulted ledge,
 * the shoulders `shoulder` metres over the feet. A low ledge under half that over where the feet began is hurdled.
 */
export function mantleHold(view: TraversalView, vault: boolean, shoulder: number): [number, number] {
  const u = mantleShare(view);
  if (view.mantle === 'grab' || view.mantle === 'hang') return [1, 1];
  if (view.mantle !== 'pull') return [0, 0];
  if (lowPull(view) && (view.lipY ?? 0) - (view.fromY ?? 0) < TRAVERSAL.hurdle * shoulder) return [0, 0];
  if (lowPull(view)) {
    const [on, held, off] = TRAVERSAL.vault;
    const hold = u < held ? MathUtils.smoothstep(u, 0, on) : 1 - MathUtils.smoothstep(u, held, off);
    return [hold, vault ? 0 : hold];
  }
  const hold = 1 - MathUtils.smoothstep(u, TRAVERSAL.pull[0], TRAVERSAL.pull[1]);
  return [hold, hold];
}

/** A limb's place in a cycle of `step` metres at `height` climbed: the cycle's index and the share through it. */
function cycleOf(limb: Limb, height: number, step: number): { n: number; u: number } {
  const t = height / step - OFFSET[limb];
  const n = Math.floor(t);
  return { n, u: t - n };
}

/**
 * Where `limb` is on `ladder` with the body's feet at `feet` and the shoulders `shoulder` over them, written into
 * `out`: on its rung (true) or moving between two (false, arcing out from them). Rungs stand every `rung` metres from
 * the foot; rung 0 is the ground under the body, where it stands to climb and steps off. Hands never take a rung over
 * the top one.
 */
export function ladderLimb(
  ladder: NonNullable<RideView['ladder']>,
  rung: number,
  limb: Limb,
  feet: Vector3,
  shoulder: number,
  out: Vector3,
): boolean {
  const T = TRAVERSAL;
  const height = feet.y - ladder.foot[1];
  const hand = limb < 2;
  const C = T.ladderStep * rung;
  const { n, u } = cycleOf(limb, height, C);
  const top = Math.max(1, Math.ceil((ladder.top - ladder.foot[1] + 0.2) / rung) - 1);
  const over = hand ? shoulder + T.ladderHand : T.ladderFoot;
  const rungOf = (k: number) => {
    const r = Math.round(((k + OFFSET[limb] + T.swing) * C + over) / rung);
    return hand ? MathUtils.clamp(r, 1, top) : MathUtils.clamp(r, 0, top - 3);
  };
  const [nx, nz] = [ladder.normal[0], ladder.normal[1]];
  const side = (limb % 2 === 0 ? -1 : 1) * T.ladderGrip[hand ? 0 : 1];
  /** Rung `r`'s hold for this limb: a hand's grip on it, a foot's sole on it (its arch out from the rung), the ground. */
  const at = (r: number, v: Vector3) => {
    if (!hand && r === 0) return v.set(feet.x + nz * side, ladder.foot[1], feet.z - nx * side);
    const [lift, back] = hand ? [0, 0] : [0.02, 0.07];
    return v.set(ladder.foot[0] + nz * side + nx * back, ladder.foot[1] + r * rung + lift, ladder.foot[2] - nx * side + nz * back); // prettier-ignore
  };
  if (u >= T.swing) {
    at(rungOf(n), out);
    return true;
  }
  const s = MathUtils.smoothstep(u / T.swing, 0, 1);
  const from = at(rungOf(n - 1), scratch);
  at(rungOf(n), out).sub(from).multiplyScalar(s).add(from);
  const arc = Math.sin(Math.PI * s) * T.ladderArc[hand ? 0 : 1];
  out.x += nx * arc;
  out.z += nz * arc;
  return false;
}

const scratch = new Vector3();

/**
 * A wall-climb's hold for `limb` (see the file comment): the cycle `n` it holds in (a new one every
 * `TRAVERSAL.climbStep` metres climbed), whether it holds now (else it moves to the next), and how far it is through
 * its move (0 to 1, 1 holding). A hold is taken at the height the body reaches as its move ends.
 */
export function climbCycle(limb: Limb, climbed: number): { n: number; held: boolean; s: number } {
  const { n, u } = cycleOf(limb, climbed, TRAVERSAL.climbStep);
  return u >= TRAVERSAL.swing ? { n, held: true, s: 1 } : { n, held: false, s: MathUtils.smoothstep(u / TRAVERSAL.swing, 0, 1) }; // prettier-ignore
}

/** The height over the catch at which `limb`'s hold of cycle `n` is taken, and so how high on the wall it is (m). */
export function climbHoldHeight(limb: Limb, n: number, shoulder: number): number {
  const T = TRAVERSAL;
  return (n + OFFSET[limb] + T.swing) * T.climbStep + (limb < 2 ? shoulder + T.climbHand : T.climbFoot);
}

/**
 * The point on the wall for `limb` at `height` (world, m), the body's feet at `feet` and the wall's normal `wall`
 * (across the ground, out toward the body): a skin off the hull's front, out by a palm, to the limb's side; a foot out
 * by its toes' reach too (`toes`, ahead of its contact socket), so its toes, not its sole, rest on the face.
 */
export function wallPoint(
  feet: Vector3,
  wall: readonly [number, number],
  hull: HullView,
  limb: Limb,
  height: number,
  out: Vector3,
  toes = 0,
): Vector3 {
  // prettier-ignore
  const [nx, nz] = wall;
  const off = hull.radius + hull.skin - TRAVERSAL.palm - (limb < 2 ? 0 : toes);
  const side = (limb % 2 === 0 ? -1 : 1) * TRAVERSAL.climbGrip[limb < 2 ? 0 : 1]; // its right, facing the wall
  return out.set(feet.x - nx * off + nz * side, height, feet.z - nz * off - nx * side);
}

/**
 * Where the hands go on a zipline's cable over the feet at `feet`, left then right: `hull.hang` over them, the right
 * one `TRAVERSAL.cable` ahead along the ride, the left as far behind.
 */
export function cableGrips(
  view: TraversalView,
  ride: RideView,
  hull: HullView,
  feet: Vector3,
  out: [Vector3, Vector3],
): [Vector3, Vector3] {
  // prettier-ignore
  const line = ride.zipline;
  const along = line ? scratch.set(line.to[0] - line.from[0], line.to[1] - line.from[1], line.to[2] - line.from[2]) : scratch.set(0, 0, 0); // prettier-ignore
  if (along.lengthSq() > 1e-9) along.normalize().multiplyScalar((view.rideDir ?? 1) < 0 ? -1 : 1);
  out[0].set(feet.x, feet.y + hull.hang, feet.z).addScaledVector(along, -TRAVERSAL.cable);
  out[1].set(feet.x, feet.y + hull.hang, feet.z).addScaledVector(along, TRAVERSAL.cable);
  return out;
}
