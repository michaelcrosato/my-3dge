/**
 * @file The view's movement poses (PLAN.md WP 13.10, docs/PLAYGROUND.md §5.1): what the body shows of its movement
 * beyond the sim's state (`ShownMovement`, `Humanoid.shown`, eased by engine/anim/locomotion/motion.ts
 * `MovementPose`), as effector layers the pose tables take in (engine/anim/poses.ts: `SHOWN_FOOT_LAYERS` after the
 * crouch, `SHOWN_HAND_LAYERS` after the flinch) and as the pelvis's and the spine's share (`SHOWN`, read by
 * engine/anim/locomotion.ts):
 * - the slide: the right leg out ahead, the left folded under, both soles a few centimetres off the floor; the left
 *   hand trailing behind, its fingertips just over the ground, the right forward for balance; the pelvis low and leaned
 *   back, the spine tilted toward the slope it slides on (`pitch`);
 * - the air by the vertical speed: rising, the legs tuck tighter; falling, they reach down for the ground and the arms
 *   rise out for balance (the apex between: the humanoid's own tuck);
 * - the landing's dip (`land`): the pelvis drops, a soft one a little, a hard one (`hard`) deep, leaning forward with
 *   the right hand down on the floor ahead (a three-point landing);
 * - the lean into the acceleration and the bank into a turn (`lean`, `bank`: the spine).
 *
 * Invariants: presentation only: nothing here is stepped or saved; a body that shows nothing (`createShown()`) poses
 * exactly as before WP 13.10.
 *
 * @example
 * const shown = createShown();
 * shown.slide = 1; // the next pose slides
 * SHOWN_FOOT_LAYERS.map((layer) => layer.name); // ['slide', 'rise', 'fall']
 * @see engine/anim/locomotion/shown.test.ts
 */
import { B, fromFRU, sideSign, type FRU, type Sided } from '../authoring';
import type { EffectorLayer, Placement } from '../poses';

/** What the view shows of a body's movement now (see the file comment): weights 0 to 1, angles in radians. */
export interface ShownMovement {
  crouch: number;
  slide: number;
  /** The vertical speed's share: −1 rising fast, 0 at the apex, 1 falling fast. */
  fall: number;
  /** The landing's dip now, and how hard the landing was. */
  land: number;
  hard: number;
  /** The body tilted forward toward the slope it slides on, + downhill ahead. */
  pitch: number;
  /** The spine leaned forward into the acceleration, and banked toward the turn (+ right). */
  lean: number;
  bank: number;
}

/** A body that shows nothing beyond the sim's state. */
export function createShown(): ShownMovement {
  return { crouch: 0, slide: 0, fall: 0, land: 0, hard: 0, pitch: 0, lean: 0, bank: 0 };
}

/** The pelvis's and the spine's share: drops as shares of the stance height, the hard landing's lean in radians. */
export const SHOWN = {
  slideDrop: 0.7, // a full slide's seat: the pelvis a hand's span off the floor
  slideLean: 0.8, // a full slide's backward lean
  softDrop: 0.12, // a soft landing's dip, and a hard one's
  hardDrop: 0.5,
  hardLean: 0.9,
} as const;

/** A fixed rig-local target per side. */
const fixed =
  (t: Sided<FRU>): Placement =>
  (_ctx, side, _cur, out) =>
    fromFRU(t[side], out);

/** The soles' movement layers, in priority order (poses.ts lays them after the crouch). */
export const SHOWN_FOOT_LAYERS: readonly EffectorLayer[] = [
  {
    name: 'slide',
    weight: (c) => c.slide,
    at: (c, side, _cur, out) =>
      B(side === 'R' ? 0.85 : -0.12, sideSign(side) * (c.build.footSpread + 0.02), side === 'R' ? 0.05 : 0.07, out),
  },
  {
    name: 'rise',
    weight: (c) => c.w.air * Math.max(0, -c.shown.fall) * 0.5,
    at: fixed({ L: [-0.12, -0.11, 0.32], R: [0.18, 0.11, 0.42] }),
  },
  {
    name: 'fall',
    weight: (c) => c.w.air * Math.max(0, c.shown.fall) * 0.7,
    at: fixed({ L: [-0.06, -0.12, 0.06], R: [0.12, 0.12, 0.1] }),
  },
];

/** The wrists' movement layers, in priority order (poses.ts lays them after the flinch). */
export const SHOWN_HAND_LAYERS: readonly EffectorLayer[] = [
  {
    name: 'slide',
    weight: (c) => c.slide,
    at: (c, side, _cur, out) => (side === 'L' ? B(-0.35, -0.35, 0.19, out) : fromFRU([0.35, 0.05, -0.1], out).add(c.shoulders[side])), // prettier-ignore
  },
  {
    name: 'fall',
    weight: (c) => c.w.air * Math.max(0, c.shown.fall) * 0.6,
    at: (c, side, _cur, out) => fromFRU(side === 'L' ? [0.05, -0.32, 0.12] : [0.05, 0.32, 0.12], out).add(c.shoulders[side]), // prettier-ignore
  },
  {
    name: 'land',
    weight: (c, side) => c.shown.land * c.shown.hard * (side === 'R' ? 1 : 0.6),
    at: (c, side, _cur, out) => (side === 'R' ? B(0.42, 0.2, 0.02, out) : fromFRU([-0.25, -0.25, -0.2], out).add(c.shoulders[side])), // prettier-ignore
  },
];
