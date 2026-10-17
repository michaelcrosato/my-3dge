/**
 * @file A character's body in the physics world (PLAN.md WP 3.2; WP 13.4 split it from engine/physics/character.ts,
 * which re-exports it, to keep that file under 400 lines): `addCharacter` adds the kinematic capsule (group `actor`),
 * `bodyAt` is where it stands for given feet, its bottom just outside the skin above them, so it does not stick at
 * seams, and `feetOf` reads its feet back: the bottom of the capsule it has now, less the skin (a crouch shrinks it:
 * engine/physics/hull.ts). engine/sim/actors.ts spawns and places actors through them; `bodyAt` stands the standing
 * hull.
 *
 * Invariants: `feetOf` of a body `bodyAt` placed gives the feet back, 5 mm up (the gap above the skin); pure but for
 * the body it adds or reads.
 *
 * @example
 * import { createCharacter } from './character';
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * const hero = createCharacter();
 * feetOf(physics, addCharacter(physics, hero, [1, 0, 2]), hero).y; // 0.005: just above the floor's height
 * @see engine/physics/character.test.ts
 */
import { Vector3 } from '../core/math';
import type { Character } from './character';
import { halfHeightOf, partsOf } from './move';
import { vec, type Vec3Like } from './queries';
import { rapierOf, type Physics } from './world';

/** Where a character's body stands for its feet at `feet`: its capsule's bottom just outside the skin above them. */
export function bodyAt(character: Character, feet: Vec3Like, where = 'bodyAt(feet)'): [number, number, number] {
  const at = vec(feet, where);
  const { radius, height } = character.capsule;
  return [at.x, at.y + character.offset + 0.005 + radius + height / 2, at.z];
}

/** Adds a character's body (a kinematic capsule, group `actor`), its bottom just outside the skin above `feet`. */
export function addCharacter(physics: Physics, character: Character, feet: Vec3Like): number {
  const { radius, height } = character.capsule;
  return physics.addBody({
    type: 'kinematic',
    position: bodyAt(character, feet, 'addCharacter(feet)'),
    colliders: [{ shape: { type: 'capsule', radius, height }, group: 'actor' }],
    group: 'actor',
  });
}

/**
 * Where a character's feet are: the bottom of its capsule as it is now (a crouch shrinks it, engine/physics/hull.ts),
 * less the skin (on flat ground, the ground's height).
 */
export function feetOf(physics: Physics, body: number, character: Character): Vector3 {
  const { position } = physics.readBody(body);
  const half = halfHeightOf(partsOf(rapierOf(physics), body, 'feetOf(body)').collider, character);
  return position.setY(position.y - half - character.capsule.radius - character.offset);
}
