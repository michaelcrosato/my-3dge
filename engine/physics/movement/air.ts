/**
 * @file The shooter model off the ground (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2): air control, the lurch, the jump
 * and the landing. Ported from er-apex's reconstruction of Apex's code (`umiiii/er-apex`,
 * `deps/er-apex-move/src/controller.rs`: `air_move` 1369-1395, `check_jump` 1132-1228, `land_slowdown` 812-828 and
 * `land` 1397-1425), in metres and seconds; the lurch from the Apex Movement Wiki's measurements (Apex added it after
 * the season er-apex reconstructs).
 *
 * - `airMove`: Quake's air acceleration. Along the input it accelerates toward a capped wished speed (`air.speed`), so
 *   a move across the velocity turns it and adds a little speed each tick (air strafing); past the cap, `air.extra`
 *   still pushes along the input without making it faster. No air friction.
 * - `lurch`: within `lurch.window` of the take-off, a new move key (the move turning by `lurch.turn` or more in a
 *   tick, ours, since a stick turns smoothly) turns the velocity toward the same speed in the new direction, by
 *   `lurch.strength` until `lurch.full`, then less, to nothing at the window's end; never by more than `lurch.max`.
 * - `jumpScale` and `hopSpeed`: a jump within `fatigue.to` of landing from a jump goes lower (`fatigue.height` of the
 *   height until `fatigue.from`, then linearly more); one within `hop.window` of any landing, faster than `hop.floor`
 *   (times the move scale), loses `hop.cost`, never below the floor.
 * - `landSlowdown` and `land`: a landing counts the fall height of its impact speed along the floor's normal (v²/2g,
 *   so a slope cancels it), at least what is left of the last one's; above `land.from` the speed's share drops, to
 *   `land.floor` from `land.full`, and recovers over `land.recover` along `(t / recover) ^ power`.
 *
 * Invariants: pure functions of their arguments; velocities `[x, z]` in m/s; times in seconds.
 *
 * @example
 * import { parse } from '../../core/schema';
 * import { MODEL_FIELDS } from './model';
 * jumpScale(parse(MODEL_FIELDS, {}), 0.15, true); // 0.3: a jump 0.15 s after a jump's landing goes 0.3 as high
 * @see engine/physics/movement/air.test.ts
 */
import type { MotionState, MovementModel } from './model';

/** Quake's air acceleration (see the file comment): one tick of `h` toward `wish`, at most length 1. */
export function airMove(
  m: MovementModel,
  h: [number, number],
  wish: readonly [number, number],
  scale: number,
  dt: number,
): void {
  const length = Math.hypot(wish[0], wish[1]);
  if (length <= 1e-6) return;
  const dir = [wish[0] / length, wish[1] / length];
  const wishSpeed = m.air.speed * scale * Math.min(length, 1);
  const add = wishSpeed - (dir[0] * h[0] + dir[1] * h[1]);
  if (add > 0) {
    const step = Math.min(add, m.air.accel * scale * dt);
    h[0] += dir[0] * step;
    h[1] += dir[1] * step;
    return;
  }
  const cap = Math.max(h[0] * h[0] + h[1] * h[1], wishSpeed * wishSpeed);
  h[0] += dir[0] * dt * m.air.extra;
  h[1] += dir[1] * dt * m.air.extra;
  const now = h[0] * h[0] + h[1] * h[1];
  if (now > cap) {
    const k = Math.sqrt(cap / now);
    h[0] *= k;
    h[1] *= k;
  }
}

/** The lurch's strength `t` seconds after the take-off (see the file comment). */
export function lurchStrength(m: MovementModel, t: number): number {
  const { window, full, strength } = m.lurch;
  if (t > window) return 0;
  if (t <= full) return strength;
  return (strength * (window - t)) / (window - full);
}

/**
 * The lurch: when the move `wish` turned from `before` by `lurch.turn` or more, `t` seconds after the take-off, turns
 * `h` toward the same speed along the new move. Returns the change it made (m/s), 0 when none.
 */
export function lurch(
  m: MovementModel,
  h: [number, number],
  wish: readonly [number, number],
  before: readonly [number, number],
  t: number,
): number {
  const length = Math.hypot(wish[0], wish[1]);
  const strength = lurchStrength(m, t);
  if (length <= 1e-6 || strength <= 0) return 0;
  const was = Math.hypot(before[0], before[1]);
  const turned =
    was <= 1e-6 || (wish[0] * before[0] + wish[1] * before[1]) / (length * was) <= Math.cos(m.lurch.turn) + 1e-9;
  if (!turned) return 0;
  const speed = Math.hypot(h[0], h[1]);
  const [dx, dz] = [(wish[0] / length) * speed - h[0], (wish[1] / length) * speed - h[1]];
  const change = Math.min(Math.hypot(dx, dz) * strength, m.lurch.max);
  if (change <= 1e-9) return 0;
  const k = change / Math.hypot(dx, dz);
  h[0] += dx * k;
  h[1] += dz * k;
  return change;
}

/** The share of the jump's height a jump `sinceLand` seconds after landing gets (`fatigued`: that flight began with a jump). */ // prettier-ignore
export function jumpScale(m: MovementModel, sinceLand: number, fatigued: boolean): number {
  const { height, from, to } = m.fatigue;
  if (!fatigued || sinceLand < 0 || sinceLand >= to) return 1;
  const k = sinceLand <= from ? 1 : (sinceLand - to) / (from - to);
  return 1 - (1 - height) * k;
}

/** The speed a jump `sinceLand` seconds after landing leaves of `speed` (m/s): the bunny-hop cost (see the file comment). */ // prettier-ignore
export function hopSpeed(m: MovementModel, speed: number, sinceLand: number, scale: number): number {
  const floor = m.hop.floor * scale;
  if (sinceLand < 0 || sinceLand >= m.hop.window || speed <= floor) return speed;
  return Math.max(floor, speed - m.hop.cost);
}

/** The stun's share of speed `t` seconds after a landing that counted `fall` metres (see the file comment). */
export function landSlowdown(m: MovementModel, fall: number, t: number): number {
  const { from, full, floor, recover, power } = m.land;
  if (t < 0 || t >= recover || fall <= from) return 1;
  const k = Math.min((fall - from) / (full - from), 1);
  return 1 - (1 - Math.pow(t / recover, power)) * k * (1 - floor);
}

/**
 * A landing: the fall height it counts (the impact `velocity`'s speed along the floor's unit `normal`, as v²/2g, at
 * least what is left of the last landing's), written to `motion` with the landing's age reset; returns the share of
 * speed the stun leaves at once, which the caller applies to the velocity across the ground.
 */
export function land(
  m: MovementModel,
  motion: MotionState,
  velocity: readonly [number, number, number],
  normal: readonly [number, number, number],
  g: number,
  dt: number,
): number {
  const since = motion.landAge < 0 ? Infinity : motion.landAge * dt;
  const fade = 1 - Math.min(Math.max(since / m.land.recover, 0), 1);
  const into = velocity[0] * normal[0] + velocity[1] * normal[1] + velocity[2] * normal[2];
  motion.fall = Math.max(fade * motion.fall, (into * into * 0.5) / g);
  motion.landAge = 0;
  return landSlowdown(m, motion.fall, 0);
}
