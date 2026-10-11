/**
 * @file Level bodies (PLAN.md WP 3.1, §5.1 "colliders from text"; WP 4.2 adds hulls): a compiled level's collider
 * descriptors (engine/world/level/colliders.ts) become one fixed body of merged boxes in the physics world, so the
 * level is solid exactly where its text says, and as high as its glyphs stand.
 *
 * `addLevelBodies(physics, level)` adds one fixed body in the collision group `world`: the ground slab under the whole
 * map (one tile wider all round, its top at y 0) and one box per merged collider, from the ground to its glyph's top.
 * It returns the body's id. Queries see the level from the next physics step on (engine/physics/queries.ts).
 *
 * Invariants: colliders enter in the level's own order (the slab, then the descriptors as `compileLevel` lists them),
 * so the same level gives the same Rapier state and hash; the level is never changed. Friction is the prototype's 0.6.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:188-201` (`hallColliders`: one fixed body, the floor slab and
 * the merged boxes, friction 0.6), in metres and from descriptors.
 *
 * @example
 * import { compileLevel } from '../world/level/compile';
 * import { createPhysics } from '../physics/world';
 * const physics = createPhysics();
 * const level = compileLevel('#####\n#@.w#\n#####\n', { file: 'cell.txt' });
 * addLevelBodies(physics, level); // 0: one fixed body, the slab and 3 boxes
 * @see engine/sim/levelBodies.test.ts
 */
import type { Physics } from '../physics/world';
import type { CompiledLevel, Point3 } from '../world/level/types';

/** The level's friction: the prototype's hall. */
export const LEVEL_FRICTION = 0.6;

/** A box collider from its low and high corners. */
function box(min: Point3, max: Point3) {
  return {
    shape: { type: 'box' as const, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const },
    position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as const,
    friction: LEVEL_FRICTION,
  };
}

/** Adds a level's bodies (one fixed body: the ground slab and its merged boxes) and returns the body's id. */
export function addLevelBodies(physics: Physics, level: Pick<CompiledLevel, 'ground' | 'colliders'>): number {
  const colliders = [level.ground, ...level.colliders].map((part) => box(part.min, part.max));
  return physics.addBody({ type: 'fixed', group: 'world', colliders });
}
