/**
 * @file The read-only `QueryView` (PLAN.md WP 3.1, §6.1 "reaching physics from presentation"): the physics queries,
 * and nothing that changes the world, for code that must not change play. Presentation code (the chase camera's wall
 * avoidance, audio occlusion, foot placement) gets it from the sim's snapshot and imports only its type; it never
 * imports engine/physics/.
 *
 * It offers `raycast`, `shapeCast`, `overlap` and `probe`, as engine/physics/queries.ts describes them. Its results are
 * fresh copies (ids, numbers and three.js vectors), never Rapier objects or the physics world, so a caller can keep or
 * change them freely.
 *
 * Invariants: a view is a frozen object with exactly those four functions and no other way in: no physics world, no
 * Rapier object and no method that adds, removes, moves or steps anything (engine/sim/queryView.test.ts proves it,
 * and the `QueryView` type has nothing else to call). It follows the world it was made from, restores included.
 *
 * @example
 * import { createPhysics } from '../physics/world';
 * const view = queryView(createPhysics());
 * Object.keys(view); // ['raycast', 'shapeCast', 'overlap', 'probe']
 * view.raycast([0, 5, 0], [0, -1, 0]); // null: the world is empty
 * @see engine/sim/queryView.test.ts
 */
import type { Physics } from '../physics/world';
import { physicsOf } from '../physics/world';

/** The physics queries, read-only: what presentation code may ask of the sim's physics. */
export type QueryView = Readonly<Pick<Physics, 'raycast' | 'shapeCast' | 'overlap' | 'probe'>>;

/** The read-only view of a physics world. */
export function queryView(physics: Physics): QueryView {
  return Object.freeze({
    raycast: (...args: Parameters<Physics['raycast']>) => physics.raycast(...args),
    shapeCast: (...args: Parameters<Physics['shapeCast']>) => physics.shapeCast(...args),
    overlap: (...args: Parameters<Physics['overlap']>) => physics.overlap(...args),
    probe: (...args: Parameters<Physics['probe']>) => physics.probe(...args),
  });
}

/** The read-only view of a sim world's physics. Throws `PHYSICS_NONE` for a world without one. */
export function queryViewOf(w: object): QueryView {
  return queryView(physicsOf(w));
}
