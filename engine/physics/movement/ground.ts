/**
 * @file The shooter model on the ground (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2): when it sprints, how fast its gait
 * goes, and one tick of the velocity across the ground, as Apex's WalkMove does it: the stick curve, the deceleration
 * of only the part of the velocity the input does not push for (`decelerate`), then the acceleration toward the wished
 * speed, never past the larger of the old speed and the wished one (`accelerate`), at a rate set by the speed at the
 * tick's start (`groundAccel`); a slide (WP 13.5) only steers, at `slide.accel`, and brakes by its own friction, then
 * decays. Ported from er-apex's reconstruction of Apex's code (`umiiii/er-apex`, `deps/er-apex-move/src/controller.rs`:
 * `update_sprint` 1077-1130, `acceleration` 1247-1265, `decelerate` 1267-1323, `walk_move` 1325-1354, `accelerate`
 * 1690-1702; MIT, engine/physics/movement/NOTICE), in metres and seconds.
 *
 * The sprint: it holds while the button is held, or after a press while the move stays within `sprint.keep` of the
 * view (the sticky sprint, which a duck ends but a slide keeps; none with `hold`, the player's choice of a held sprint,
 * WP 13.9), and only on the ground (or within `sprint.air` of leaving it without a jump), not ducking, moving on, the
 * move at least `sprint.input` long and within `sprint.angle` of the view, and not stunned below `land.sprint`. With no
 * view (the cameras that move relative to the screen) the view is the move itself, so it
 * sprints in every direction. Ours: walking blocks the sprint, as Apex's aiming does; the sprint dips toward
 * `gaits.sprintSide` as the move turns 45° off the view. Every other gait goes at `gaits.side` and `gaits.back` of its
 * speed across and back from the view (`directionShare`; both 1 in Apex).
 *
 * Invariants: pure functions of their arguments, but `updateSprint`, which writes only the motion state it is given;
 * velocities are `[x, z]` in m/s; `scale` is the move scale (the stun times the holstered bonus).
 *
 * @example
 * import { parse } from '../../core/schema';
 * import { MODEL_FIELDS } from './model';
 * const v: [number, number] = [0, 0];
 * walkMove(parse(MODEL_FIELDS, {}), v, [1, 0], 4.4069, 'stand', 1, 1 / 60);
 * v[0]; // 1.0583…: 63.5 m/s² for one tick, from rest
 * @see engine/physics/movement/ground.test.ts
 */
import type { MotionState, MovementModel } from './model';

/** One Apex unit per second, in m/s: the margin below the run where the sprint's acceleration starts. */
const UNIT = 0.0254;

/** `v`'s length. */
const len = (v: readonly [number, number]) => Math.hypot(v[0], v[1]);

/** Apex's GetAccel: the acceleration at horizontal speed `speed`, by the speed at the tick's start (m/s²). */
export function groundAccel(m: MovementModel, speed: number, stance: MotionState['stance'], scale: number): number {
  if (stance === 'crouch') return m.accel.crouch * scale;
  if (speed > scale * m.gaits.run - UNIT) return m.accel.sprint * scale;
  return (speed >= scale * m.accel.lowSpeed ? m.accel.run : m.accel.low) * scale;
}

/** How a slide brakes: hard (`slide.brake`) with crouch let go or the move against it, else `slide.decel`. */
export interface SlideBrake {
  braking: boolean;
}

/**
 * Apex's Decelerate: brakes `h` in place, all but the part along `dir` the input pushes for (up to `wishSpeed`), at
 * the standing rate (the sprint's above the run, the crouch's crouched; a slide's own, then its decay), never below 0.
 */
export function decelerate(
  m: MovementModel,
  h: [number, number],
  dir: readonly [number, number],
  wishSpeed: number,
  stance: MotionState['stance'],
  scale: number,
  dt: number,
  slide?: SlideBrake,
): void {
  const total = h[0] * h[0] + h[1] * h[1];
  if (total === 0) return;
  const along = dir[0] * h[0] + dir[1] * h[1];
  const share = along > 0 ? Math.min((along * wishSpeed) / total, 1) * along : 0;
  const keep = [dir[0] * share, dir[1] * share];
  const rest = [h[0] - keep[0], h[1] - keep[1]];
  const speed = Math.hypot(rest[0], rest[1]);
  const ground =
    stance === 'crouch' ? m.decel.crouch : Math.sqrt(total) > scale * m.gaits.run ? m.decel.sprint : m.decel.stand;
  const rate = slide ? (slide.braking ? m.slide.brake : m.slide.decel) : ground;
  const reduced = Math.max(speed - rate * dt, 0) * (slide ? Math.pow(m.slide.decay, dt) : 1);
  if (reduced >= speed) return;
  h[0] = keep[0] + rest[0] * (reduced / speed);
  h[1] = keep[1] + rest[1] * (reduced / speed);
}

/** Apex's Accelerate: adds along `dir` up to `wishSpeed`, at most `rate × dt`, never past max(old speed, wished). */
export function accelerate(
  h: [number, number],
  dir: readonly [number, number],
  wishSpeed: number,
  rate: number,
  dt: number,
): void {
  const cap = Math.max(h[0] * h[0] + h[1] * h[1], wishSpeed * wishSpeed);
  const add = wishSpeed - (h[0] * dir[0] + h[1] * dir[1]);
  if (add <= 0) return;
  const step = Math.min(add, rate * dt);
  h[0] += dir[0] * step;
  h[1] += dir[1] * step;
  const now = h[0] * h[0] + h[1] * h[1];
  if (now > cap) {
    const k = Math.sqrt(cap / now);
    h[0] *= k;
    h[1] *= k;
  }
}

/**
 * Apex's WalkMove: one tick of `h` across the ground toward `wish` (at most length 1) at `maxSpeed`: the stick curve
 * (a move shorter than 1 counts as length × (2 − length), a sprinting move 1.25 times longer, capped at 1), then
 * `decelerate`, then `accelerate` at `groundAccel` of the speed it started with. A `slide` only steers: the move's
 * part along the velocity is dropped, and it accelerates at `slide.accel` (times the move scale).
 */
export function walkMove(
  m: MovementModel,
  h: [number, number],
  wish: readonly [number, number],
  maxSpeed: number,
  stance: MotionState['stance'],
  scale: number,
  dt: number,
  sprinting = false,
  slide?: SlideBrake,
): void {
  let w: [number, number] = sprinting ? [wish[0] * 1.25, wish[1] * 1.25] : [wish[0], wish[1]];
  const length = len(w);
  if (length > 1) w = [w[0] / length, w[1] / length];
  else if (length > 0) w = [w[0] * (2 - length), w[1] * (2 - length)];
  const ahead = h[0] * w[0] + h[1] * w[1];
  const square = h[0] * h[0] + h[1] * h[1];
  if (slide && ahead > 0) w = [w[0] - (h[0] * ahead) / square, w[1] - (h[1] * ahead) / square];
  const curved = len(w);
  const dir: [number, number] = curved > 1e-6 ? [w[0] / curved, w[1] / curved] : [0, 0];
  const wishSpeed = Math.min(curved, 1) * maxSpeed;
  const rate = slide ? m.slide.accel * scale : groundAccel(m, len(h), stance, scale);
  decelerate(m, h, dir, wishSpeed, stance, scale, dt, slide);
  accelerate(h, dir, wishSpeed, rate, dt);
}

/** What `updateSprint` reads beside the model and the state. */
export interface SprintInput {
  /** The move, `[x, z]`, at most length 1. */
  wish: readonly [number, number];
  /** The view's horizontal direction, a unit `[x, z]`; null: the move's own. */
  view: readonly [number, number] | null;
  /** The horizontal velocity at the tick's start (m/s). */
  velocity: readonly [number, number];
  held: boolean;
  pressed: boolean;
  /** The sprint lasts only while held: no press keeps it on (the setting `input.sprint` at `hold`). */
  hold?: boolean;
  /** It walks (blocks the sprint, ours) or anything else blocks it. */
  blocked: boolean;
  /** It may sprint off the ground: on it, or within `sprint.air` of leaving it without a jump. */
  footing: boolean;
  /** The stun's share of speed (`landSlowdown`). */
  slowdown: number;
  dt: number;
}

/** Apex's sticky sprint (see the file comment): updates `motion.sticky`, `stickyLeft` and `sprinting`. */
export function updateSprint(m: MovementModel, motion: MotionState, input: SprintInput): boolean {
  const { wish, view, velocity, dt } = input;
  const ticks = (seconds: number) => Math.round(seconds / dt);
  if (input.blocked || input.hold) Object.assign(motion, { sticky: false, stickyLeft: 0 });
  else if (input.pressed) motion.stickyLeft = Math.max(motion.stickyLeft, ticks(m.sprint.sticky));
  else if (input.held) motion.stickyLeft = Math.max(motion.stickyLeft, ticks(m.sprint.hold));
  const length = len(wish);
  const along = view ? wish[0] * view[0] + wish[1] * view[1] : length;
  const pushed = length >= m.sprint.input;
  const ducked = motion.duck === 'ducking' || motion.duck === 'ducked';
  const canKeep = pushed && (length === 0 || along / length >= Math.cos(m.sprint.keep)) && (!ducked || motion.sliding);
  if (motion.sticky && !canKeep) Object.assign(motion, { sticky: false, stickyLeft: 0 });
  else if (!motion.sticky && motion.stickyLeft > 0 && canKeep && !input.blocked) motion.sticky = true;
  const movingOn = (view ? velocity[0] * view[0] + velocity[1] * view[1] : len(velocity)) > 0;
  const can =
    !input.blocked &&
    input.footing &&
    pushed &&
    along / length >= Math.cos(m.sprint.angle) - 1e-9 &&
    !ducked &&
    input.slowdown >= m.land.sprint &&
    movingOn;
  motion.sprinting = (input.held || motion.sticky) && can;
  return motion.sprinting;
}

/**
 * The share of its gait's speed a move gets by its direction from the view: `gaits.side` straight across it,
 * `gaits.back` straight back, blended by the squares of the move's parts across and back (so exactly 1 when both
 * are 1, as in Apex); 1 with no view.
 */
export function directionShare(
  m: MovementModel,
  wish: readonly [number, number],
  view: readonly [number, number] | null,
): number {
  const length = len(wish);
  if (!view || length === 0) return 1;
  const ahead = (wish[0] * view[0] + wish[1] * view[1]) / length;
  const across = (wish[0] * view[1] - wish[1] * view[0]) / length;
  return 1 + (m.gaits.side - 1) * across * across + (ahead < 0 ? (m.gaits.back - 1) * ahead * ahead : 0);
}

/**
 * The speed its gait goes at, before the move scale: the crouch-walk crouched, the walk walking, the sprint sprinting
 * (dipping toward `gaits.sprintSide` as the move turns 45° off the view), else the run; every gait but the sprint
 * times its `directionShare`.
 */
export function gaitSpeed(
  m: MovementModel,
  motion: MotionState,
  walking: boolean,
  wish: readonly [number, number],
  view: readonly [number, number] | null,
): number {
  if (motion.sprinting && motion.stance !== 'crouch') {
    const length = len(wish);
    const along = view && length > 0 ? (wish[0] * view[0] + wish[1] * view[1]) / length : 1;
    const off = Math.min(Math.acos(Math.min(Math.max(along, -1), 1)) / (Math.PI / 4), 1);
    return m.gaits.sprint + (m.gaits.sprintSide - m.gaits.sprint) * off;
  }
  const gait = motion.stance === 'crouch' ? m.gaits.crouch : walking ? m.gaits.walk : m.gaits.run;
  return gait * directionShare(m, wish, view);
}
