/**
 * @file The shooter model's world (PLAN.md WP 13.5, WP 13.6): `roomOf` answers what the model asks the physics
 * (engine/physics/movement/steer.ts's `Room`): whether the standing hull fits where the character is
 * (engine/physics/hull.ts), where its feet are, and the walls and ledges ahead (engine/physics/ledge.ts); `fitHull`
 * gives its body the hull its stance has, keeping the feet while it mantles, since the mantle's path is the feet's.
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
import { hullFits, matchHull } from './hull';
import { findLedge, findWall } from './ledge';
import { hullFor } from './movement/crouch';
import type { MotionState } from './movement/model';
import type { Room } from './movement/steer';
import type { Physics } from './world';

/** The room `character`'s body `body` stands in now (see the file comment). */
export function roomOf(physics: Physics, body: number, character: Character, oneWay?: ReadonlySet<number>): Room {
  const crouched = Math.max(character.movement!.crouch.height - 2 * character.capsule.radius, 0);
  return {
    stand: () => hullFits(physics, body, character, character.capsule.height, 'feet', oneWay),
    feet: () => feetOf(physics, body, character).toArray() as [number, number, number],
    wall: (dir, probe) => findWall(physics, body, character, dir, probe),
    ledge: (wall, reach) => findLedge(physics, body, character, wall, { reach, crouched }),
  };
}

/** Gives the body the hull `motion`'s stance has: in the `air` about its middle where hull.ts says, else (and mantling) keeping the feet. */ // prettier-ignore
export function fitHull(physics: Physics, body: number, character: Character, motion: MotionState, air: boolean, oneWay?: ReadonlySet<number>): void { // prettier-ignore
  const options = { air: air && motion.mode !== 'mantle', tuck: motion.airDuck, oneWay };
  matchHull(physics, body, character, hullFor(character, motion), options);
}
