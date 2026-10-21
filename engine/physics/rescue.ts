/**
 * @file The lost-body rescue (PLAN.md WP 4.1; split from engine/physics/bodies.ts at its cap, WP 13.16):
 * `rescueLost(physics, level)` puts every dynamic body that fell `depth` (3.75 m) below its tile's floor, or left the
 * level across the ground, back on the nearest walkable tile: at its centre, its lowest point 5 cm above the floor,
 * still and turned as it was, so it drops onto the floor. It returns their ids. A level is anything with per-tile
 * `walkable` and `floor` grids (`RescueLevel`: a compiled level, or a site's grid from an `origin`, engine/world/
 * siteQueries.ts's `siteRescueGrid`).
 *
 * Invariants: no state of its own; bodies in id order; the nearest tile is the first in the level's order among
 * equals; a body's lowest point is its colliders' support straight down, turned as the body is.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:508-509` (the rule: 60 units down, or outside the hall).
 *
 * @example
 * import { createPhysics } from './world';
 * import { addBall } from './bodies';
 * const p = createPhysics();
 * const ball = addBall(p, 0.25, { position: [1, -9, 1] }); // fell through the floor
 * rescueLost(p, { tile: 2, cols: 2, rows: 2, walkable: [true, true, true, true], floor: [0, 0, 0, 0] }); // [ball]
 * p.readBody(ball).position.toArray(); // [1, 0.3, 1]: on its tile, 5 cm up
 * @see engine/physics/rescue.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { Quaternion, Vector3 } from '../core/math';
import { handleOf } from './capture';
import { check } from './queries';
import { rapierOf, type Physics } from './world';

/** Straight up. */
const UP = new Vector3(0, 1, 0);

/** A finite number, or `fallback` when absent; `PHYSICS_BAD_ARGUMENT` otherwise. */
function finite(value: number | undefined, fallback: number, where: string): number {
  check(value === undefined || Number.isFinite(value), where, value, 'a finite number');
  return value ?? fallback;
}

/** A level as the rescue reads it: a compiled level (engine/world/level) or anything with these per-tile grids. */
export interface RescueLevel {
  /** Metres per tile; tiles run along +X (cols) and +Z (rows), from `origin` ([x, z], [0, 0] by default: a site's grid). */
  readonly tile: number;
  readonly origin?: readonly [number, number];
  readonly cols: number;
  readonly rows: number;
  /** Per tile, row by row. */
  readonly walkable: readonly boolean[];
  /** Per tile: the walkable surface's height (m). */
  readonly floor: readonly number[];
}

/** How far below its tile's floor a body is lost (m): the prototype's 60 units. */
const DEPTH = 3.75;
/** The gap left under a rescued body (m). */
const GAP = 0.05;

/** How far a collider reaches from its centre against `up` (in its own frame): its support straight down. */
function reachDown(c: RAPIER.Collider, up: Vector3): number {
  const S = RAPIER.ShapeType;
  switch (c.shapeType()) {
    case S.Cuboid: {
      const h = c.halfExtents()!;
      return Math.abs(up.x) * h.x + Math.abs(up.y) * h.y + Math.abs(up.z) * h.z;
    }
    case S.Capsule:
      return Math.abs(up.y) * c.halfHeight() + c.radius();
    case S.Cylinder:
      return Math.abs(up.y) * c.halfHeight() + Math.hypot(up.x, up.z) * c.radius();
    case S.ConvexPolyhedron: {
      const v = c.vertices();
      let most = -Infinity;
      for (let k = 0; k < v.length; k += 3) most = Math.max(most, -(v[k] * up.x + v[k + 1] * up.y + v[k + 2] * up.z));
      return most;
    }
    default:
      return c.radius(); // a ball
  }
}

/** How far a body's lowest point is below its origin (m), turned as it is now. */
function depthOf(b: RAPIER.RigidBody): number {
  const turn = new Quaternion().copy(b.rotation());
  let most = -Infinity;
  for (let i = 0; i < b.numColliders(); i++) {
    const c = b.collider(i);
    const [t, r] = [c.translationWrtParent()!, c.rotationWrtParent()!];
    const up = UP.clone().applyQuaternion(turn.clone().multiply(new Quaternion().copy(r)).invert());
    most = Math.max(most, reachDown(c, up) - new Vector3(t.x, t.y, t.z).applyQuaternion(turn).y);
  }
  return Number.isFinite(most) ? most : 0;
}

/** The walkable tile whose centre is nearest (x, z), from the grid's origin, the first in tile order among equals; −1 if none. */
function nearestWalkable(level: RescueLevel, x: number, z: number): number {
  let [best, distance] = [-1, Infinity];
  for (let i = 0; i < level.walkable.length; i++) {
    if (!level.walkable[i]) continue;
    const dx = ((i % level.cols) + 0.5) * level.tile - x;
    const dz = (Math.floor(i / level.cols) + 0.5) * level.tile - z;
    if (dx * dx + dz * dz < distance) [best, distance] = [i, dx * dx + dz * dz];
  }
  return best;
}

/**
 * Puts every dynamic body that fell more than `depth` below its tile's floor, or left the level across the ground, on
 * the nearest walkable tile: at its centre, its lowest point 5 cm above the floor, still, turned as it was, so it drops
 * onto the floor. Returns their ids.
 */
export function rescueLost(physics: Physics, level: RescueLevel, options: { depth?: number } = {}): number[] {
  const depth = finite(options.depth, DEPTH, 'rescueLost({ depth })');
  const { tile, cols, rows } = level;
  check(tile > 0 && level.floor.length === cols * rows, 'rescueLost(level)', level, 'a compiled level');
  const world = rapierOf(physics);
  const [ox, oz] = level.origin ?? [0, 0];
  const rescued: number[] = [];
  for (const id of physics.bodies()) {
    const b = world.bodies.get(handleOf(id))!;
    if (!b.isDynamic()) continue;
    const p = b.translation();
    const [col, row] = [Math.floor((p.x - ox) / tile), Math.floor((p.z - oz) / tile)];
    const inside = col >= 0 && row >= 0 && col < cols && row < rows;
    if (inside && p.y >= level.floor[row * cols + col] - depth) continue;
    const i = nearestWalkable(level, p.x - ox, p.z - oz);
    if (i < 0) continue;
    const y = level.floor[i] + depthOf(b) + GAP;
    b.setTranslation({ x: ((i % cols) + 0.5) * tile + ox, y, z: (Math.floor(i / cols) + 0.5) * tile + oz }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    rescued.push(id);
  }
  return rescued;
}
