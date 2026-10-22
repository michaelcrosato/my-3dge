/**
 * @file A kinematic floor's carry (PLAN.md WP 4.1, ADR-0020 amendment 3): `carried` runs a character's move with the
 * carry of the kinematic body it stands on, so a lift, a turning platform or a mover takes its rider along exactly.
 * engine/physics/character.ts's `stepCharacter` calls it for every move it makes through the controller.
 *
 * Invariants: the floor's velocities are put back as they were, whatever the move does; any other floor (fixed,
 * dynamic, none) carries nothing.
 *
 * @example
 * // in stepCharacter: carried(physics, body, character, state.ground, options, (carry) => moveCharacter(physics, body, character, carry.add(desired), { grounded }))
 * @see engine/physics/character.test.ts
 */
import { Vector3 } from '../core/math';
import type { Character, StepOptions } from './character';
import { feetOf } from './characterBody';
import { liveBody } from './capture';
import { sink, type CharacterMove } from './move';
import { rapierOf, type Physics } from './world';

/**
 * Runs `move` with the carry of the kinematic body `floor` (where the step takes the point under the feet: turned
 * about its centre of mass and moved, as Rapier integrates it; zero for any other floor or none), that body's
 * velocities held at zero meanwhile, so Rapier's kinematic friction adds nothing. `move` gets the carry across; its
 * rise or sink is added after, since moving up or down through the controller ends on the floor where it is now: the
 * floor then rose into the rider, or sank away from it. A rising floor lifts it unchecked (a ceiling crushes it, as
 * the floor would anyway); a sinking one takes it down as far as anything else under it allows (`sink`). Rapier's
 * friction alone acts on each leg that ends within its prediction distance of the floor, so it carried 0, 1 or 2
 * times a tick: a rider slipped 0.1 to 0.8 m over a 6 m ride, lost the ground for 47 to 184 ticks of 480 on a lift
 * going down, and was thrown off floors that turned, sank as they went or ran fast (WP 4.1, Rapier 0.21). Carried
 * this way it keeps its place within 0.3 mm and the ground every tick: across, up and down at up to 5 m/s, and
 * turning at up to 3 rad/s (character.test.ts).
 */
export function carried(
  physics: Physics,
  body: number,
  character: Character,
  floor: number,
  options: StepOptions,
  move: (carry: Vector3) => CharacterMove,
): CharacterMove {
  const world = rapierOf(physics);
  const rigid = liveBody(world, floor);
  if (!rigid?.isKinematic()) return move(new Vector3());
  const [linear, angular, com] = [rigid.linvel(), rigid.angvel(), rigid.worldCom()];
  const carry = new Vector3(linear.x, linear.y, linear.z).multiplyScalar(options.dt);
  const turn = new Vector3(angular.x, angular.y, angular.z).multiplyScalar(options.dt);
  const angle = turn.length();
  if (angle > 0) {
    const arm = feetOf(physics, body, character).sub(com);
    carry.add(arm.clone().applyAxisAngle(turn.divideScalar(angle), angle).sub(arm));
  }
  const rise = carry.y;
  rigid.setLinvel({ x: 0, y: 0, z: 0 }, false);
  rigid.setAngvel({ x: 0, y: 0, z: 0 }, false);
  try {
    const made = move(carry.setY(0));
    made.moved.y += rise < 0 ? sink(world, body, character, rigid, rise, options.oneWay) : rise;
    return made;
  } finally {
    rigid.setLinvel(linear, false);
    rigid.setAngvel(angular, false);
  }
}
