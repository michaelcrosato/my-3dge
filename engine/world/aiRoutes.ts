/**
 * @file A town's daily round (PLAN.md WP 13.21; doctrines: Common ground, Reproducible): routes walked on a schedule,
 * and stepping aside for someone in the way, as the neighbours of open worlds go about theirs. Beside the crowd's AI
 * helpers (engine/world/ai.ts: attack tokens, sight).
 * - **Routes.** A route is a loop of stops (`RouteStop`: where, how long to stay, what to do there, a word its caller
 *   reads, and the way to face), walked in order; `ROUTE_FIELDS` keeps an agent's place on it in a component.
 *   `followRoute(stops, state, at, time)` says which stop it heads for and whether it stays there, moving its place on
 *   as it arrives (within `near` m on the ground) and as its stay runs out. The way there is the caller's: a site's
 *   navigation (engine/world/siteNav.ts `flowField`, `direction`).
 * - **Stepping aside.** `stepAside(self, heading, other)`: when someone stands in an agent's way (within `ASIDE.reach`
 *   m ahead along its heading, nearer its line than `ASIDE.width`), the way to step: to its right, or to its left when
 *   the other stands on its right.
 *
 * Invariants: pure: the route's place is plain data in the caller's component, so the hash and captures cover it;
 * times are the sim's (`w.time`); nothing random. Problems raise `CORE_BAD_SPEC`.
 *
 * Carried as concepts from open worlds' townsfolk (a schedule of places, people keeping to the right as they pass);
 * no source has them.
 *
 * @example
 * const stops = [{ at: [0, 0, 0], stay: 2 }, { at: [10, 0, 0], stay: 0 }] as const;
 * const place = { stop: 0, since: -1 };
 * followRoute(stops, place, { x: 0.2, y: 0, z: 0 }, 5).staying; // true: there, staying 2 s
 * followRoute(stops, place, { x: 0.2, y: 0, z: 0 }, 7).stop.at[0]; // 10: its stay over, on to the next
 * stepAside({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 0, z: 1 }); // [-1, 0]: someone ahead, so to its right (−X)
 * @see engine/world/aiRoutes.test.ts
 */
import { codeError } from '../core/log';
import { defineSchema } from '../core/schema';
import type { SteerPoint } from './steer';

/** A stop of a route: where (world metres), how long to stay (s), what to do there and the way to face (rad, 0 +Z). */
export interface RouteStop {
  readonly at: readonly [number, number, number];
  readonly stay: number;
  readonly doing?: string;
  readonly facing?: number;
}

/** An agent's place on its route, for a scene's component: `defineComponent('route', { description, fields: … })`. */
export const ROUTE_FIELDS = defineSchema({
  stop: { type: 'integer', default: 0, minimum: 0, description: 'The stop it heads for, or stays at.' },
  since: { type: 'number', default: -1, unit: 's', description: 'The sim time it reached that stop; −1 on its way.' },
});

/** An agent's place on its route (`ROUTE_FIELDS` says what each means). */
export interface RouteState {
  stop: number;
  since: number;
}

/** Where `followRoute` has an agent head: the stop, and whether it stays there now. */
export interface RouteLeg {
  readonly stop: RouteStop;
  readonly staying: boolean;
}

/**
 * Where an agent at `at` heads on `stops` at sim time `time` (s), and whether it stays there now: it arrives within
 * `near` metres on the ground, stays the stop's `stay`, then heads for the next, the last leading back to the first.
 */
export function followRoute(
  stops: readonly RouteStop[],
  state: RouteState,
  at: SteerPoint,
  time: number,
  near = 0.5,
): RouteLeg {
  // prettier-ignore
  if (!stops.length) throw codeError('CORE_BAD_SPEC', { where: 'followRoute(stops)', problems: 'give at least a stop' }); // prettier-ignore
  state.stop %= stops.length;
  let stop = stops[state.stop];
  if (state.since < 0 && Math.hypot(at.x - stop.at[0], at.z - stop.at[2]) <= near) state.since = time;
  if (state.since >= 0 && time - state.since >= stop.stay) {
    [state.stop, state.since] = [(state.stop + 1) % stops.length, -1];
    stop = stops[state.stop];
  }
  return { stop, staying: state.since >= 0 };
}

/** How far ahead (m) someone stands in an agent's way, and how near its line (m), for `stepAside`. */
export const ASIDE = Object.freeze({ reach: 1.6, width: 0.7 });

/**
 * The way (a unit `[x, z]`) for an agent at `self` heading `heading` (rad, 0 along +Z) to step aside for `other`
 * standing in its way, else null (see the file comment): to its right, or to its left when `other` is on its right.
 */
export function stepAside(
  self: SteerPoint,
  heading: number,
  other: SteerPoint,
  options = ASIDE,
): [number, number] | null {
  // prettier-ignore
  const [dx, dz] = [other.x - self.x, other.z - self.z];
  const ahead = dx * Math.sin(heading) + dz * Math.cos(heading);
  const left = dx * Math.cos(heading) - dz * Math.sin(heading); // on its left: +X as it faces +Z
  if (ahead <= 0 || ahead > options.reach || Math.abs(left) > options.width) return null;
  const side = left < 0 ? 1 : -1; // away from the side the other stands on; dead ahead, to its right
  return [side * Math.cos(heading), -side * Math.sin(heading)];
}
