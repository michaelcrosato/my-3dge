/**
 * @file Steering (PLAN.md WP 5.2; doctrines: Common ground, Reproducible): the velocity a crowd agent wants, from where
 * it stands and where it is going, for `setVelocity` (engine/physics/crowd.ts), whose acceleration limit and the solver
 * do the rest: no separation code, the bodies push each other apart.
 *
 * - `seek(from, to)`: straight there, slowing inside `slowing` metres if asked (Reynolds' seek and arrive).
 * - `followFlow(field, from, to)`: round walls and up stairs by a flow field toward the target's tile
 *   (`NavGrid.flowField`), straight at the target once within `near` metres and in a clear line.
 * - `approachRing(field, from, to, ring, sway)`: closes in to a ring round the target, backs off inside it and drifts
 *   round it on it, so a crowd waits round its prey instead of piling onto it.
 * - `hover(y, floor, time)`: a flyer's vertical speed that holds it over the floor, bobbing.
 * - `airTime(up, gravity, rise)` and `hop(from, to, up, gravity)`: how long a jumper flies, and the launch velocity
 *   that lands it on a point.
 *
 * Points are metres, x east, y up, z south: a `Vector3` is one, and so is a crowd agent (its feet). Directions lie on
 * the ground (y 0), a unit vector or a share of full speed: multiply by the agent's speed. Each call writes its answer
 * into `out` (a new `Vector3` by default), so a system reuses one vector and allocates nothing per agent.
 *
 * Invariants: pure functions of their arguments, with no state and no randomness (a sway is the caller's, say
 * `Math.sin(w.time * 0.9 + phase)`), so steering is reproducible wherever the sim runs. A point within a millimetre
 * of where it is going has arrived: the direction is zero.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:346-451` (`steer`: straight when close, else the flow field,
 * else straight; the walker's ring: in beyond ring + 3 units, back at half speed inside ring − 3, swaying round at
 * 0.4; the slime's hop, `vz` 150 units/s over `2·vz/g`; the wisp's hover), and `src/emberdeep/30-monsters-core.js:151`
 * (`AI.steer`: straight within 64 units in a clear line), in metres (16 units to the metre). `Floater.hover`
 * (engine/anim/floater.ts) is the same hover on the rig's clock and tuning; this one serves a flyer without a rig.
 *
 * @example
 * import { compileLevel } from './level/compile';
 * import { NavGrid } from './nav';
 * const grid = new NavGrid(compileLevel('#######\n#.....#\n#.###.#\n#.....#\n#######\n'));
 * const field = grid.flowField(grid.cellAt(3.5, 3.5));
 * followFlow(field, { x: 4.5, z: 1.5 }, { x: 3.5, z: 3.5 }).toArray(); // [1, 0, 0]: east, the short way round
 * seek({ x: 0, z: 0 }, { x: 3, z: 4 }).toArray(); // [0.6, 0, 0.8]
 * approachRing(null, { x: 0, z: 0 }, { x: 3, z: 4 }, { radius: 5 }, 1).toArray(); // [-0.32, 0, 0.24]: round it
 * hover(1, 0, 0); // 1.5: a quarter of a metre low, it climbs at 6 × the gap
 * hop({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 6, 30)?.toArray(); // [5, 6, 0]: 0.4 s in the air
 * @see engine/world/steer.test.ts
 */
import { codeError } from '../core/log';
import { Vector3 } from '../core/math';
import type { FlowField, GroundPoint } from './nav';

/** A point in the world (m): x east, y up, z south. A `Vector3` is one, and so is a crowd agent (its feet). */
export type SteerPoint = Readonly<{ x: number; y: number; z: number }>;

/** Closer than this (m), a point has arrived: its direction is zero. */
const ARRIVED = 1e-3;

/** How `followFlow` steers. */
export interface FollowOptions {
  /** Within this many metres of the target and in a clear line, head straight at it (m). */
  near?: number;
  /** Inside this many metres of the target, slow in proportion (m; 0 for full speed up to it). */
  slowing?: number;
}

/** `followFlow`'s defaults: straight within 4 m in a clear line (emberdeep's 64 units), full speed to the target. */
export const FOLLOW: Readonly<Required<FollowOptions>> = Object.freeze({ near: 4, slowing: 0 });

/** What `approachRing` takes: the ring's radius, and how an agent moves in, out and round. */
export interface ApproachRingOptions {
  /** The ring's radius round the target (m). */
  radius: number;
  /** Half the ring's width (m): within `radius ± band` the agent is on the ring. */
  band?: number;
  /** The share of full speed it backs off at, inside the ring. */
  backoff?: number;
  /** The share of full speed it drifts round at, on the ring, times the sway. */
  circle?: number;
}

/** `approachRing`'s defaults: the prototype's walker (3 units either side, back at half speed, round at 0.4). */
export const APPROACH_RING: Readonly<Required<Omit<ApproachRingOptions, 'radius'>>> = Object.freeze({
  band: 0.1875,
  backoff: 0.5,
  circle: 0.4,
});

/** How `hover` holds a flyer up. */
export interface HoverOptions {
  /** Its height over the floor (m). */
  height?: number;
  /** How far it bobs up and down (m)… */
  bob?: number;
  /** …at this many radians per second. */
  bobRate?: number;
  /** Its vertical speed is the gap to its height times this (per second). */
  climb?: number;
}

/** `hover`'s defaults: the prototype's wisp, 20 units over the floor bobbing ±3 at 2 rad/s, climbing at 6 × the gap. */
export const HOVER: Readonly<Required<HoverOptions>> = Object.freeze({
  height: 1.25,
  bob: 0.1875,
  bobRate: 2,
  climb: 6,
});

/**
 * The prototype slime's jumps: `up` (m/s) for a hop of at most `reach` metres, `pounce` (m/s) for its lower, flatter
 * leap at a target. `hop` lands where it is aimed: shorten the aim to `reach` first.
 */
export const HOP = Object.freeze({ up: 9.375, reach: 2.75, pounce: 5.3125 });

/**
 * The way from `from` to `to` on the ground: a unit vector, zero within a millimetre. With `slowing`, its length is
 * the share of full speed, `distance / slowing` inside that many metres (arrival without overshoot).
 */
export function seek(from: GroundPoint, to: GroundPoint, out = new Vector3(), slowing = 0): Vector3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance < ARRIVED) return out.set(0, 0, 0);
  const share = distance < slowing ? distance / slowing : 1;
  return out.set((dx / distance) * share, 0, (dz / distance) * share);
}

/**
 * The way to walk from `from` to `to` along `field` (a flow field toward the target's tile): straight at `to` within
 * `near` metres when the grid has a clear line for a body (`NavGrid.lineOfSight`), else the field's look-ahead
 * direction (`FlowField.direction`), else, where the field has no way (beyond its reach, or arrived at the goal tile's
 * centre), straight at `to`, as the prototype does. A unit vector, or shorter inside `slowing` metres of `to`.
 */
export function followFlow(
  field: FlowField,
  from: GroundPoint,
  to: GroundPoint,
  out = new Vector3(),
  options: FollowOptions = FOLLOW,
): Vector3 {
  const near = options.near ?? FOLLOW.near;
  const slowing = options.slowing ?? FOLLOW.slowing;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx * dx + dz * dz < near * near && field.grid.lineOfSight(from.x, from.z, to.x, to.z)) {
    return seek(from, to, out, slowing);
  }
  return field.direction(from.x, from.z, out) ?? seek(from, to, out, slowing);
}

/**
 * The way to wait round `to` on a ring of `ring.radius` metres: beyond `radius + band`, in by `followFlow` (straight
 * when `field` is null); inside `radius − band`, straight out at `backoff` of full speed; on the ring, round it at
 * `circle × sway` of full speed (`sway` in [−1, 1]; positive turns about +Y, anticlockwise seen from above). Zero at
 * the target itself, where no way is out.
 */
export function approachRing(
  field: FlowField | null,
  from: GroundPoint,
  to: GroundPoint,
  ring: ApproachRingOptions,
  sway = 0,
  out = new Vector3(),
): Vector3 {
  const band = ring.band ?? APPROACH_RING.band;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance > ring.radius + band) return field ? followFlow(field, from, to, out) : seek(from, to, out);
  if (distance < ARRIVED) return out.set(0, 0, 0);
  if (distance < ring.radius - band) {
    const backoff = (ring.backoff ?? APPROACH_RING.backoff) / distance;
    return out.set(-dx * backoff, 0, -dz * backoff);
  }
  const round = ((ring.circle ?? APPROACH_RING.circle) * sway) / distance;
  return out.set(-dz * round, 0, dx * round);
}

/**
 * A flyer's vertical speed (m/s) that holds its feet at `y` metres `height` over `floor`, bobbing `bob` metres at
 * `bobRate` radians per second of `time` (s; its own clock, or the sim's plus a phase): the gap times `climb`.
 */
export function hover(y: number, floor: number, time: number, options: HoverOptions = HOVER): number {
  const height = options.height ?? HOVER.height;
  const bob = options.bob ?? HOVER.bob;
  const bobRate = options.bobRate ?? HOVER.bobRate;
  return (floor + height + bob * Math.sin(time * bobRate) - y) * (options.climb ?? HOVER.climb);
}

/**
 * How long (s) a body thrown up at `up` m/s flies under `gravity` (m/s², above 0) until it comes down to `rise` metres
 * above where it left (below for a drop): the later root of `rise = up·t − gravity·t²/2`. Infinity when it never
 * comes down there: it does not rise that high, or it is thrown down and the point is above.
 */
export function airTime(up: number, gravity: number, rise = 0): number {
  if (!(gravity > 0) || !Number.isFinite(gravity)) {
    throw codeError('CORE_BAD_SPEC', {
      where: 'airTime(up, gravity)',
      problems: `gravity ${gravity} m/s²: give one above 0`,
    });
  }
  const square = up * up - 2 * gravity * rise;
  if (square < 0) return Infinity;
  const time = (up + Math.sqrt(square)) / gravity;
  return time >= 0 ? time : Infinity;
}

/**
 * The launch velocity (m/s) that carries a body thrown up at `up` m/s from `from` to land on `to` under `gravity`
 * (m/s²): `up` vertically and the ground distance over `airTime` across, so a jumper hops onto a crate as well as across
 * the floor. Null when `to` is out of its reach: higher than `up` lifts it. Give a crowd agent the difference from its
 * velocity with `knockback`, work it out under the agent's own gravity (`gravityScale` × the `physics.gravity`
 * setting), and stop steering it until it lands.
 */
export function hop(
  from: SteerPoint,
  to: SteerPoint,
  up: number,
  gravity: number,
  out = new Vector3(),
): Vector3 | null {
  const time = airTime(up, gravity, to.y - from.y);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (time === Infinity) return null;
  if (time === 0) return dx * dx + dz * dz < ARRIVED * ARRIVED ? out.set(0, up, 0) : null;
  return out.set(dx / time, up, dz / time);
}
