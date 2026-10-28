/**
 * @file A body's plants in the view (PLAN.md WP 13.10, WP 13.11, WP 13.20): the foot plant, the traversal plant and the
 * hold, the last layers of an animator's `post` slot, attached in that order (`attachPlants`), and laid before each
 * pose from what the view keeps of the body (`layPlants`): the foot plant weighed by what the traversal leaves on the
 * ground and by what a clip holds of the legs, reset when it weighs nothing, locked as the movement lets it
 * (`plantsFeet`), on the ground the sim's queries find; the movement shown on the body (`MovementPose`); the limbs on
 * the traversal's contacts; the head along the look, the gun held while the traversal leaves the hands free. The
 * page's puppets (engine/gfx/puppets/actors.ts, actorLayers.ts) and the feel kit (engine/dev/feel/anim.ts) both pose
 * through it, so a course measures the body the page draws.
 *
 * Invariants: presentation only: `layPlants` writes the layers' settings and the shown movement onto the animator,
 * never what the sim saves; a hold made again follows the one before it, so a new weapon's draw starts where the last
 * one stood.
 *
 * @example
 * import { Animator } from './character';
 * const hero = new Animator({ build: 'build:adult' });
 * const plants = attachPlants(hero, 'view');
 * [plants.plant.name, plants.traversal.name, plants.hold.name]; // ['view:footPlant', 'view:traversal', 'view:hold']
 * @see engine/anim/bodyPlants.test.ts
 */
import type { Animator } from './character';
import { FootPlant } from './footPlant';
import type { GroundProbe } from './ik';
import { plantsFeet, type MotionView, type MovementPose } from './locomotion/motion';
import { HoldPlant, type LookPose } from './traversal/hold';
import { TraversalPlant } from './traversal/plant';
import type { TraversalPose } from './traversal/pose';

/** A body's plants, in the order they run. */
export interface BodyPlants {
  readonly plant: FootPlant;
  readonly traversal: TraversalPlant;
  readonly hold: HoldPlant;
}

/** What the view keeps of a body between poses, as `layPlants` reads it. */
export interface PlantedBody {
  /** Its movement model's state, if it has one. */
  readonly motion?: MotionView | null;
  /** What the view shows of its movement, updated once a step. */
  readonly shown: MovementPose;
  /** Its traversal, updated once a step. */
  readonly traversal: TraversalPose;
  /** Where it looks, updated once a step. */
  readonly look: LookPose;
}

/** Attaches the foot plant, the traversal plant and the hold to `animator`, in that order, named `<prefix>:footPlant`…; the hold follows `previous`. */ // prettier-ignore
export function attachPlants(animator: Animator, prefix: string, previous?: HoldPlant): BodyPlants {
  const plant = new FootPlant({ name: `${prefix}:footPlant` }).attach(animator);
  const traversal = new TraversalPlant({ name: `${prefix}:traversal` }).attach(animator);
  const hold = Object.assign(new HoldPlant({ name: `${prefix}:hold` }).follow(previous).attach(animator), { contacts: traversal }); // prettier-ignore
  return { plant, traversal, hold };
}

/** Lays `plants` for `animator`'s next pose from `body` (see the file comment), on `ground`; `legsHeld`, how much a clip holds the legs (0 to 1). */ // prettier-ignore
export function layPlants(animator: Animator, plants: BodyPlants, body: PlantedBody, ground: GroundProbe | null, legsHeld = 0): void { // prettier-ignore
  plants.plant.weight = (1 - legsHeld) * body.traversal.plantShare; // a traversal holds the legs off the ground (WP 13.11)
  if (plants.plant.weight === 0) plants.plant.reset(); // skipped, it keeps no stale lock
  plants.plant.locks = plantsFeet(body.motion); // never while it slides, flies, mantles, climbs or rides (WP 13.10)
  plants.plant.ground = ground; // on stairs and slopes
  body.shown.apply(animator); // its crouch, slide, air, landing and lean (WP 13.10)
  plants.traversal.pose = body.traversal; // its hands and feet on what it traverses (WP 13.11)
  [plants.hold.look, plants.hold.busy] = [body.look.look, body.traversal.weight]; // its look and its gun
}
