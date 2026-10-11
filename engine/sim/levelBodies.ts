/**
 * @file Level bodies (PLAN.md WP 3.1, WP 4.2, §5.1 "colliders from text"): a compiled level's collider descriptors
 * (engine/world/level/colliders.ts) become one fixed body in the physics world, so the level is solid exactly where
 * its text says, and as high as its glyphs stand.
 *
 * `addLevelBodies(physics, level)` adds one fixed body in the collision group `world`: the ground slab under the whole
 * map (one tile wider all round, its top at y 0), one box per merged collider, from the ground to its glyph's top, one
 * convex hull per hull collider (a flight of stairs' wedge, the dais's frustum), whose top is the floor floorHeight
 * gives, and one upright cylinder per cylinder collider (a brazier). It returns the body's id. Queries see the level
 * from the next physics step on (engine/physics/queries.ts).
 *
 * Invariants: colliders enter in the level's own order (the slab, then the descriptors as `compileLevel` lists them),
 * so the same level gives the same Rapier state and hash; the level is never changed. Friction is the prototype's 0.6.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:188-201` (`hallColliders`: one fixed body, the floor slab, the
 * merged boxes, the hulls of the stairs and the dais and the braziers' cylinders, friction 0.6), in metres and from
 * descriptors.
 *
 * @example
 * import { compileLevel } from '../world/level/compile';
 * import { createPhysics } from '../physics/world';
 * const physics = createPhysics();
 * const level = compileLevel('#####\n#@.w#\n#####\n', { file: 'cell.txt' });
 * addLevelBodies(physics, level); // 0: one fixed body, the slab and 3 boxes
 * @see engine/sim/levelBodies.test.ts
 */
import type { ColliderSpec, Physics } from '../physics/world';
import type { ColliderDescriptor, CompiledLevel, Point3 } from '../world/level/types';

/** The level's friction: the prototype's hall. */
export const LEVEL_FRICTION = 0.6;

/** A box collider from its low and high corners. */
function box(min: Point3, max: Point3): ColliderSpec {
  return {
    shape: { type: 'box', size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] },
    position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    friction: LEVEL_FRICTION,
  };
}

/** The collider a descriptor makes. */
function collider(part: ColliderDescriptor): ColliderSpec {
  if (part.shape === 'box') return box(part.min, part.max);
  if (part.shape === 'hull') return { shape: { type: 'hull', points: part.points }, friction: LEVEL_FRICTION };
  const { radius, height } = part;
  return { shape: { type: 'cylinder', radius, height }, position: part.center, friction: LEVEL_FRICTION };
}

/** Adds a level's bodies (one fixed body: the ground slab and its colliders) and returns the body's id. */
export function addLevelBodies(physics: Physics, level: Pick<CompiledLevel, 'ground' | 'colliders'>): number {
  const colliders = [box(level.ground.min, level.ground.max), ...level.colliders.map(collider)];
  return physics.addBody({ type: 'fixed', group: 'world', colliders });
}
