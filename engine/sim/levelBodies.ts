/**
 * @file Level bodies (PLAN.md WP 3.1, WP 4.2, WP 10.5, §5.1 "colliders from text"): a compiled level's collider
 * descriptors (engine/world/level/colliders.ts) become one fixed body in the physics world, so the level is solid
 * exactly where its text says, and as high as its glyphs stand.
 *
 * `addLevelBodies(physics, level)` adds one fixed body in the collision group `world`: the ground slab under the whole
 * map (one tile wider all round, its top at y 0), one box per merged collider, from the ground to its glyph's top, one
 * convex hull per hull collider (a flight of stairs' wedge, the dais's frustum), whose top is the floor floorHeight
 * gives, and one upright cylinder per cylinder collider (a brazier). It returns the body's id. Queries see the level
 * from the next physics step on (engine/physics/queries.ts).
 *
 * `addTerrainBody(physics, terrain)` stands a terrain (engine/world/terrain.ts) as one fixed body in `world` too: one
 * heightfield collider over its grid (engine/physics/heightfield.ts), its surface exactly `terrainHeight`'s; given the
 * cells a site cuts (`cut`), one triangle mesh of the others instead (engine/physics/trimesh.ts: a heightfield has no
 * holes), split as the heightfield splits them. `addSiteBodies(physics, site)` stands a site (engine/world/site.ts):
 * its terrain, cut, then each structure's level bodies at its place and quarter turn (`addLevelBodies`'s `place`).
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
import { quarterTurn, type QuarterTurns, type Site } from '../world/site';
import type { Terrain } from '../world/terrain';

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

/**
 * Adds a level's bodies (one fixed body: the ground slab and its colliders) and returns the body's id; `place` stands it
 * at a site's place, its map's north-west corner at `at`, turned `turn` quarter turns about +Y.
 */
export function addLevelBodies(
  physics: Physics,
  level: Pick<CompiledLevel, 'ground' | 'colliders'>,
  place?: { at: Point3; turn: QuarterTurns },
): number {
  const colliders = [box(level.ground.min, level.ground.max), ...level.colliders.map(collider)];
  const pose = place ? { position: place.at, rotation: quarterTurn(place.turn) } : {};
  return physics.addBody({ type: 'fixed', group: 'world', ...pose, colliders });
}

/**
 * Adds a terrain's body (one fixed body: its heightfield, or with `cut` cells, one triangle mesh of the rest) and
 * returns the body's id.
 */
export function addTerrainBody(physics: Physics, terrain: Terrain, cut?: Uint8Array | null): number {
  const { cols, rows, cell, origin, heights } = terrain;
  if (cut) return physics.addBody({ type: 'fixed', group: 'world', colliders: [{ shape: cutMesh(terrain, cut), friction: LEVEL_FRICTION }] }); // prettier-ignore
  const size = [cols * cell, rows * cell] as const;
  const shape = { type: 'heightfield', cols, rows, size, heights } as const;
  const position = [origin[0] + size[0] / 2, 0, origin[2] + size[1] / 2] as const;
  return physics.addBody({ type: 'fixed', group: 'world', colliders: [{ shape, position, friction: LEVEL_FRICTION }] });
}

/** The triangle mesh of `terrain`'s cells but the `cut` ones: every corner, two triangles a cell split as Rapier's heightfield. */
function cutMesh(terrain: Terrain, cut: Uint8Array) {
  const { cols, rows, cell, origin, heights } = terrain;
  const vertices: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++)
      vertices.push(origin[0] + c * cell, heights[r * (cols + 1) + c], origin[2] + r * cell);
  }
  const indices: number[] = [];
  const at = (c: number, r: number) => r * (cols + 1) + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cut[r * cols + c]) continue;
      // North-west, south-west, north-east; north-east, south-west, south-east: facing up.
      indices.push(at(c, r), at(c, r + 1), at(c + 1, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1));
    }
  }
  return { type: 'trimesh', vertices, indices } as const;
}

/** Adds a site's bodies (its terrain, cut, then each structure's) and returns their ids in that order. */
export function addSiteBodies(physics: Physics, site: Site): number[] {
  const ids = site.terrain ? [addTerrainBody(physics, site.terrain, site.cut)] : [];
  for (const s of site.structures) ids.push(addLevelBodies(physics, s.level, { at: s.at, turn: s.turn }));
  return ids;
}
