/**
 * @file The shooter model's world (PLAN.md WP 13.5, WP 13.6, WP 13.7): `roomOf` answers what the model asks the
 * physics (engine/physics/movement/steer.ts's `Room`): whether the standing hull fits where the character is
 * (engine/physics/hull.ts), where its feet are, the walls and ledges ahead (engine/physics/ledge.ts), how far the hull
 * moves along a ride before it meets anything (a cast of the hull as it is) and how far below the feet the ground is
 * (a ray); `fitHull` gives its body the hull its stance has, keeping the feet while a path moves them (a mantle, a
 * zipline, a ladder), since the path is the feet's.
 * engine/physics/character.ts's `stepCharacter` makes one room a tick for a character with a model.
 *
 * Invariants: queries only, but for `fitHull`, which resizes the body's capsule; a ledge's crouched hull is the
 * model's (`crouch.height`).
 *
 * @example
 * // in stepCharacter: const plan = steerMotion(character, state, motion, input, dt, g, roomOf(physics, body, character, oneWay));
 * @see engine/physics/movement/mantle.test.ts
 */
import type { Character } from './character';
import { feetOf } from './characterBody';
import { hullFits, hullHeight, matchHull } from './hull';
import { findLedge, findWall } from './ledge';
import { hullFor } from './movement/crouch';
import type { MotionState } from './movement/model';
import type { Room } from './movement/steer';
import type { Shape } from './queries';
import type { Physics } from './world';

/** A point, world metres. */
type Point = readonly [number, number, number];

/** The groups a ride's casts meet, past the character's own body (as a ledge's do). */
const near = (body: number) => ({ exclude: body, groups: ['world', 'prop'] as const });

/** How far `character`'s hull, as it is, moves from feet at `from` toward feet at `to` before it meets anything (m). */
function sweep(physics: Physics, body: number, character: Character, from: Point, to: Point): number {
  const along = [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as const;
  const length = Math.hypot(along[0], along[1], along[2]);
  if (length < 1e-6) return 0;
  const { radius } = character.capsule;
  const middle = hullHeight(physics, body, character);
  const lift = character.offset + radius + middle / 2;
  const shape: Shape = { type: 'capsule', radius, height: middle };
  const dir = [along[0] / length, along[1] / length, along[2] / length] as const;
  const hit = physics.shapeCast(shape, [from[0], from[1] + lift, from[2]], dir, { ...near(body), maxDistance: length });
  return hit ? hit.distance : length;
}

/** The room `character`'s body `body` stands in now (see the file comment). */
export function roomOf(physics: Physics, body: number, character: Character, oneWay?: ReadonlySet<number>): Room {
  const crouched = Math.max(character.movement!.crouch.height - 2 * character.capsule.radius, 0);
  return {
    stand: () => hullFits(physics, body, character, character.capsule.height, 'feet', oneWay),
    feet: () => feetOf(physics, body, character).toArray() as [number, number, number],
    wall: (dir, probe) => findWall(physics, body, character, dir, probe),
    ledge: (wall, reach) => findLedge(physics, body, character, wall, { reach, crouched }),
    sweep: (from, to) => sweep(physics, body, character, from, to),
    below: (max) => {
      const [x, y, z] = feetOf(physics, body, character).toArray();
      return physics.raycast([x, y, z], [0, -1, 0], { ...near(body), maxDistance: max })?.distance ?? null;
    },
  };
}

/** The modes whose ticks move the feet along a path: the hull keeps the feet in them. */
const PATHED: ReadonlySet<MotionState['mode']> = new Set(['mantle', 'zipline', 'ladder']);

/** Gives the body the hull `motion`'s stance has: in the `air` about its middle where hull.ts says, else (and on a path) keeping the feet. */ // prettier-ignore
export function fitHull(physics: Physics, body: number, character: Character, motion: MotionState, air: boolean, oneWay?: ReadonlySet<number>): void { // prettier-ignore
  const options = { air: air && !PATHED.has(motion.mode), tuck: motion.airDuck, oneWay };
  matchHull(physics, body, character, hullFor(character, motion), options);
}
