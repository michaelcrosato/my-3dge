/**
 * @file A character's hull (PLAN.md WP 13.5, docs/PLAYGROUND.md §3.2): the capsule its body has now. A crouch shrinks
 * it and standing up grows it back, in place: Rapier's `setHalfHeight` on the body's capsule, and the body moved so its
 * feet stay where they are (on the ground: the hull changes at the top) or its centre does (in the air: at both ends,
 * the feet tucked up or let down). `hullFits` asks first whether a hull fits there, so standing up waits for headroom.
 * The shooter model decides the stance (engine/physics/movement/crouch.ts); engine/physics/character.ts's
 * `stepCharacter` gives the body that stance's hull (`matchHull`) before the move and after it, and `feetOf`
 * (engine/physics/characterBody.ts), the controller's moves (engine/physics/move.ts) and the ground probe read the hull
 * the capsule has now (`halfHeightOf`), never the standing one alone.
 *
 * Invariants: only the straight middle changes, never the radius; a hull fits where a capsule of it, a tenth of the
 * skin wider (er-apex's `overlaps(…, skin × 0.1)`), overlaps nothing the character's controller collides with
 * (sensors, the groups it shoves and one-way platforms above its feet left out). Rapier's snapshot holds the capsule's
 * shape, so a restored world has the hull it had; Rapier keeps the half height as a float32, so a hull is compared as
 * one, and the standing hull reads back exactly (`halfHeightOf`), so a character that never crouches moves as before.
 *
 * @example
 * import { addCharacter, createCharacter } from './character';
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * const hero = createCharacter({ movement: 'movement:apex' });
 * const body = addCharacter(physics, hero, [0, 0, 0]);
 * hullFits(physics, body, hero, 0.381, 'feet'); // true: nothing about
 * setHull(physics, body, hero, 0.381, 'feet'); // crouched: 47 u tall, the feet where they were
 * hullHeight(physics, body, hero); // 0.381…, as a float32
 * @see engine/physics/hull.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Character } from './character';
import { halfHeightOf, oneWayFilter, partsOf, QUERY_FLAGS, queryGroups } from './move';
import { rapierOf, type Physics } from './world';

/** What a new hull keeps where it is: the feet (on the ground) or the centre (in the air). */
export type HullKeep = 'feet' | 'centre';

/** A character's capsule's straight middle now (m): its standing one, or what a crouch made it. */
export function hullHeight(physics: Physics, body: number, character: Character): number {
  return halfHeightOf(partsOf(rapierOf(physics), body, 'hullHeight(body)').collider, character) * 2;
}

/** Where the body's centre goes for a hull of straight middle `height`, keeping `keep` (see the file comment). */
function centreFor(
  physics: Physics,
  body: number,
  character: Character,
  height: number,
  keep: HullKeep,
  where: string,
) {
  const { rigid, collider } = partsOf(rapierOf(physics), body, where);
  const at = rigid.translation();
  const y = keep === 'feet' ? at.y - halfHeightOf(collider, character) + height / 2 : at.y;
  return { rigid, collider, centre: { x: at.x, y, z: at.z } };
}

/**
 * Whether a capsule of straight middle `height` fits where `character`'s body is, its feet or its centre kept (see
 * the file comment): what standing up asks before it stands.
 */
export function hullFits(
  physics: Physics,
  body: number,
  character: Character,
  height: number,
  keep: HullKeep,
  oneWay?: ReadonlySet<number>,
): boolean {
  const world = rapierOf(physics);
  const { rigid, collider, centre } = centreFor(physics, body, character, height, keep, 'hullFits(body)');
  const { radius } = character.capsule;
  const shape = new RAPIER.Capsule(height / 2, radius + character.offset / 10);
  const solid = oneWayFilter(world, oneWay, centre.y - height / 2 - radius);
  const groups = queryGroups(collider, character);
  return !world.intersectionWithShape(centre, collider.rotation(), shape, QUERY_FLAGS, groups, undefined, rigid, solid);
}

/** Gives `character`'s body a capsule of straight middle `height`, its feet or its centre kept where they are. */
export function setHull(physics: Physics, body: number, character: Character, height: number, keep: HullKeep): void {
  const { rigid, collider, centre } = centreFor(physics, body, character, height, keep, 'setHull(body)');
  collider.setHalfHeight(height / 2);
  collider.clearShapeCache();
  rigid.setTranslation(centre, true);
  collider.setTranslation(centre);
}

/**
 * Gives `character`'s body the hull of straight middle `height` unless it has it: on the ground keeping the feet; in
 * the `air` growing about the centre where that fits, else from the feet, and shrinking about the centre when the
 * crouch began in the air (`tuck`: the feet tucked up), else from the top.
 */
export function matchHull(
  physics: Physics,
  body: number,
  character: Character,
  height: number,
  options: { air: boolean; tuck: boolean; oneWay?: ReadonlySet<number> },
): void {
  const { collider } = partsOf(rapierOf(physics), body, 'matchHull(body)');
  if (collider.halfHeight() === Math.fround(height / 2)) return;
  const grows = height > halfHeightOf(collider, character) * 2;
  const about = options.air && (grows || options.tuck);
  const centre = about && hullFits(physics, body, character, height, 'centre', options.oneWay);
  setHull(physics, body, character, height, centre ? 'centre' : 'feet');
}
