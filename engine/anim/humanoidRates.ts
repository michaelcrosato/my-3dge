/**
 * @file The procedural humanoid's rates (PLAN.md WP 3.6, §5.2; engine/anim/humanoid.ts steps by them): `STEP`, every
 * constant of its state update (how fast each weight eases in and out, the turn, the die pose's and a fall's timings,
 * the blinks, the breathing clock's spread, a move's body motion), and `KNOCKDOWN`, the rigid turn that lays the body
 * flat until reactions take it over (WP 6.2). Split from humanoid.ts at its line cap.
 *
 * Invariants: rates are per second, times in seconds, lengths in metres, pairs `[in, out]`; read-only (`as const`).
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1803-1871` (`update`'s numbers, lengths ÷ 16).
 *
 * @example
 * STEP.speed; // 7: the speed weight eases toward the speed share at 7 a second
 * KNOCKDOWN.turn; // ≈ 1.508: 0.96 of a quarter turn
 * @see engine/anim/humanoid.test.ts
 */
/** Every constant of the state update: rates are per second, times in seconds; pairs are [in, out]. */
export const STEP = {
  /** Rate the speed weight eases toward the speed share. */
  speed: 7,
  /** Top of the speed share (speed ÷ the build's `speedRef`): a sprint stretches the stride. */
  speedShareMax: 1.25,
  /** Slowest speed that turns the movement direction, m/s (3 source units/s). */
  turnSpeed: 0.1875,
  /** Share of the way the movement direction follows the velocity, per second (at most all of it per step). */
  turnRate: 10,
  /** Rates a dash eases in and out. */
  dash: [24, 8],
  /** Rate a flinch eases in and out. */
  hurt: 14,
  /** Rates a move's weight eases in and out. */
  attack: [30, 7],
  /** Rates the airborne tuck eases in and out (a landing is quick). */
  air: [10, 18],
  /** Rate a held pose eases in and out. */
  pose: 9,
  /** Rate a stance eases in and out. */
  stance: 10,
  /** Rate the climb eases in and out. */
  climb: 12,
  /** Share of the arm's length a hand climbs per half cycle, so the hands keep pace with the climb. */
  climbReach: 0.4,
  /** Rates pointing eases in and out. */
  point: [30, 8],
  /** Rate the aim turns, radians per second. */
  aim: 14,
  /** The die pose: a flinch until `hurt`, the knees giving over `kneel` at `kneelRate`, the topple from `down`. */
  die: { hurt: 0.25, kneel: [0.2, 0.6], kneelRate: 10, down: 0.45 },
  /** A fall's rate starts at `rate` and gains `gain` per unit fallen (faster and faster); it gets up at `rise`. */
  fall: { rate: 2.5, gain: 10, rise: 3.2 },
  /** Blinks: shut for `shut`, then open `gap` plus up to `spread` more, from the entity's stream. */
  blink: { shut: 0.12, gap: 2, spread: 3 },
  /** The breathing clock starts up to this far in, from the entity's stream. */
  clockSpread: 10,
  /** Share of the way each channel of a move's body motion eases, per second (at most all of it per step). */
  body: { lunge: 22, hop: 25, crouch: 20, lean: 25, twist: 25 },
} as const;

/** Every constant of the knockdown (a rigid turn of the whole body, until reactions take it over, WP 6.2). */
export const KNOCKDOWN = {
  /** The body's turn back at full weight, radians: 0.96 of a quarter turn. */
  turn: 0.96 * (Math.PI / 2),
  /** How far the body lifts, metres. */
  lift: 0.0875,
  /** Share of `hipHeight + torso` the body slides forward, to lie centred on its position. */
  shift: 0.5,
} as const;
