/**
 * @file The shooter model's crouch and slide (PLAN.md WP 13.5, docs/PLAYGROUND.md §3.2): the duck, and the slide a
 * crouch at speed starts. Ported from er-apex's reconstruction of Apex's code (`umiiii/er-apex`,
 * `deps/er-apex-move/src/controller.rs`: `update_duck` 830-934, `try_start_slide` 1007-1064, `end_slide` 1066,
 * `slope_gravity` 1356-1366; MIT, engine/physics/movement/NOTICE), in metres and seconds.
 *
 * - `updateDuck`: crouch held or toggled (a change of the held button ends the toggle) wants the duck; sliding faster
 *   than `slide.hold` keeps wanting it, and so does a crouched hull that cannot stand where it is (it waits for
 *   headroom). The duck counts its milliseconds whole, 16 a tick at 60 Hz, as Apex does: `crouch.down` (400 ms) to
 *   go down, `crouch.fast` (200 ms) when it slides or cannot stand, `crouch.up` (200 ms) to get up, a reversal starting
 *   from where the other left off, so crouch spam never finishes a duck. The hull (`stance`) shrinks as the duck ends
 *   and stands as getting up starts; a duck that began in the air (`airDuck`) shrinks about the middle, the feet tucked
 *   up (engine/physics/hull.ts makes the body match). A duck starting tries a slide.
 * - `tryStartSlide`: on walkable ground (`slide.slope`), at least `slide.speed` across it (`slide.air` on a landing
 *   falling at least `slide.fall`), the move along the view at least `slide.angle`'s cosine on the ground (a landing
 *   skips it); the hull crouches at once; unless within `slide.cooldown` of the last slide's start (every slide starts
 *   it again), it boosts the speed by `slide.boost`, never past `slide.cap` (both times the move scale), and makes the
 *   long jump ready. Ours: a slide without a boost has none for a dead slide to take back (er-apex keeps the last
 *   boost's). engine/physics/movement/ground.ts brakes and steers it; it ends below `slide.end`, by getting up
 *   or by a jump (engine/physics/movement/steer.ts).
 * - `slopePull`: half the slide's pull along the ground, g · n_y along the floor, applied before the walk and after.
 *
 * Invariants: they change only the states and velocity they are given; same inputs, same result.
 *
 * @example
 * import { parse } from '../../core/schema';
 * import { createMotionState, MODEL_FIELDS } from './model';
 * const motion = createMotionState();
 * const h: [number, number] = [7.59, 0]; // a holstered sprint, east
 * tryStartSlide(parse(MODEL_FIELDS, {}), motion, { h, normal: [0, 1, 0], air: false, vertical: 0, wish: [1, 0], view: [1, 0], scale: 1.15, dt: 1 / 60 }); // prettier-ignore
 * [motion.sliding, h[0]]; // [true, 11.684]: boosted, capped at 10.16 × 1.15 m/s
 * @see engine/physics/movement/crouch.test.ts
 */
import type { Character } from '../character';
import type { MotionState, MovementModel } from './model';

/** A floor's normal, `[x, y, z]`, unit. */
export type FloorNormal = readonly [number, number, number];

/** Whether the duck is down or going down (Apex's `ducking()`). */
export const ducking = (motion: MotionState) => motion.duck === 'ducking' || motion.duck === 'ducked';

/** The straight middle of the hull its stance has (m): the character's capsule standing, the model's crouched. */
export function hullFor(character: Character, motion: MotionState): number {
  const { radius, height } = character.capsule;
  return motion.stance === 'crouch' ? Math.max(character.movement!.crouch.height - 2 * radius, 0) : height;
}

/** Ends the slide (Apex's EndSlide). */
export function endSlide(motion: MotionState): void {
  motion.sliding = false;
}

/** What `tryStartSlide` reads beside the model and the state. */
export interface SlideStart {
  /** The velocity across the ground, `[x, z]` (m/s): the boost changes it in place. */
  h: [number, number];
  /** The ground under it; null in the air. */
  normal: FloorNormal | null;
  /** It lands this tick: the view check is skipped and a fast fall lowers the speed needed. */
  air: boolean;
  /** The velocity up (m/s): on a landing, the impact's. */
  vertical: number;
  /** The move, `[x, z]`, at most length 1. */
  wish: readonly [number, number];
  /** The view's direction, a unit `[x, z]`; null: the move's own. */
  view: readonly [number, number] | null;
  /** The move scale (the stun times the holstered bonus). */
  scale: number;
  dt: number;
}

/** Apex's TryStartSlide (see the file comment). Starts the slide in `motion`, its boost in `start.h`. */
export function tryStartSlide(m: MovementModel, motion: MotionState, start: SlideStart): void {
  const { h, normal, wish, scale, dt } = start;
  if (!normal || normal[1] < Math.cos(m.slide.slope) - 1e-9) return;
  const speed = Math.hypot(h[0], h[1]);
  const least = start.air && start.vertical <= -m.slide.fall ? m.slide.air : m.slide.speed;
  if (speed < least) return;
  if (!start.air) {
    const length = Math.hypot(wish[0], wish[1]);
    const facing = start.view ?? (length > 1e-6 ? [wish[0] / length, wish[1] / length] : null);
    const along = facing ? wish[0] * facing[0] + wish[1] * facing[1] : 0;
    if (along < Math.cos(m.slide.angle) - 1e-9) return;
  }
  Object.assign(motion, { sliding: true, stance: 'crouch', slideBoost: 0 });
  if (motion.slideAge < 0 || motion.slideAge >= Math.round(m.slide.cooldown / dt)) {
    const target = Math.min(speed + scale * m.slide.boost, scale * m.slide.cap);
    motion.slideBoost = Math.max(target - speed, 0);
    if (target > speed) [h[0], h[1]] = [(h[0] * target) / speed, (h[1] * target) / speed];
    motion.longJump = true;
  }
  motion.slideAge = 0;
}

/** What `updateDuck` reads beside the model and the state: the crouch buttons, and the slide's start. */
export interface DuckInput extends Omit<SlideStart, 'air' | 'normal'> {
  /** The crouch button is held. */
  held: boolean;
  /** The crouch toggle went down this tick. */
  toggled: boolean;
  /** It stood on the ground at the tick's start: its floor's normal; null in the air. */
  floor: FloorNormal | null;
  /** Whether the standing hull fits where it is, its feet kept (asked only when it would stand). */
  canStand(): boolean;
}

/** Whole milliseconds of `seconds`. */
const ms = (seconds: number) => Math.round(seconds * 1000);

/** Apex's update_duck (see the file comment): updates the duck, the stance and the slide in `motion`. */
export function updateDuck(m: MovementModel, motion: MotionState, input: DuckInput): void {
  if (motion.duckLeft > 0) motion.duckLeft = Math.max(motion.duckLeft - Math.trunc(input.dt * 1000), 0);
  const was = ducking(motion);
  if (input.held !== motion.crouchHeld) motion.crouchToggle = false;
  else if (input.toggled) motion.crouchToggle = !motion.crouchToggle;
  motion.crouchHeld = input.held;
  let want = input.held || motion.crouchToggle || (motion.sliding && Math.hypot(...input.h) > m.slide.hold);
  let fast = false;
  if (!want && motion.stance === 'crouch' && !input.canStand()) [want, fast] = [true, true];
  const up = ms(m.crouch.up);
  if (want) {
    if (!was) tryStartSlide(m, motion, { ...input, normal: input.floor, air: false });
    const total = ms(fast || motion.sliding ? m.crouch.fast : m.crouch.down);
    if (motion.duck === 'standing') {
      Object.assign(motion, { duck: 'ducking', duckLeft: total, duckTotal: total, airDuck: !input.floor });
    } else if (motion.duck === 'unducking') {
      const done = Math.min(Math.max((up - motion.duckLeft) / up, 0), 1);
      Object.assign(motion, { duck: 'ducking', duckLeft: Math.trunc(total * done), duckTotal: total });
    }
    if (motion.duck === 'ducking' && motion.duckLeft <= 0) Object.assign(motion, { duck: 'ducked', stance: 'crouch' });
  } else {
    if (motion.duck === 'ducked') Object.assign(motion, { duck: 'unducking', duckLeft: up, stance: 'stand' });
    else if (motion.duck === 'ducking') {
      const done = Math.min(Math.max(motion.duckLeft / ms(motion.sliding ? m.crouch.fast : m.crouch.down), 0), 1);
      Object.assign(motion, { duck: 'unducking', duckLeft: Math.trunc((1 - done) * up), stance: 'stand' });
    }
    motion.duckTotal = up;
    if (motion.duck === 'unducking' && motion.duckLeft <= 0) motion.duck = 'standing';
  }
  if (was && !ducking(motion)) endSlide(motion);
}

/**
 * Whether its crouch keeps a jump from happening this tick (Apex's CheckJumpButton): a toggled crouch stands up
 * instead (and ends, unless `crouch.jump`), and getting up never jumps; out of a slide, both jump. A held crouch jumps.
 */
export function crouchBlocks(m: MovementModel, motion: MotionState, near: boolean): boolean {
  const free = motion.sliding || m.crouch.jump;
  if (motion.crouchToggle) {
    if (!m.crouch.jump) motion.crouchToggle = false;
    if (near && !free) return true;
  }
  return motion.duck === 'unducking' && !free;
}

/**
 * A boosted slide's jump (Apex's CheckJumpButton): jumped while its duck still goes, within `slide.dead` of its
 * start, the boost comes back off (a dead slide); between `slide.longFrom` of `slide.long` and `slide.long`, the speed
 * jumps at `slide.long` (the long jump). Changes `h` in place; the long jump is used either way.
 */
export function slideJump(m: MovementModel, motion: MotionState, h: [number, number], dt: number): void {
  const speed = Math.hypot(h[0], h[1]);
  if (!motion.longJump || speed <= 0) return;
  const set = (from: number, to: number) => {
    if (from > 0) [h[0], h[1]] = [(h[0] * to) / from, (h[1] * to) / from];
  };
  let current = speed;
  if (motion.duck !== 'ducked' && motion.slideAge < Math.round(m.slide.dead / dt)) {
    current = Math.max(speed - motion.slideBoost, 0);
    set(speed, current);
  }
  if (speed > m.slide.longFrom * m.slide.long && speed < m.slide.long) set(current, m.slide.long);
  motion.longJump = false;
}

/** Part of the slide's pull along the floor (see the file comment): `h` gains `share · g · dt · n_y` of its slant. */
export function slopePull(h: [number, number], normal: FloorNormal, share: number, g: number, dt: number): void {
  const pull = share * g * dt * normal[1];
  h[0] += pull * normal[0];
  h[1] += pull * normal[2];
}
