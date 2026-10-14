/**
 * @file The character controller's moves (PLAN.md WP 3.2, §4.8; doctrine: Quality under the hood): `moveCharacter`
 * moves a character's capsule through Rapier's kinematic character controller, across then down, climbing steps and
 * snapping to the ground itself, and `sink` takes it down with a sinking floor. engine/physics/character.ts's
 * `stepCharacter` makes one of each per tick; nothing else meets Rapier's controller.
 *
 * How it moves, and why (Rapier 0.21, measured; ADR-0020 amendment 3):
 * - **Across, then down.** One combined move loses all its sideways motion on some ticks on level ground (§4.8), and a
 *   capsule skimming its floor at the skin meets phantom contacts: a grounded move goes up by the skin, across, then
 *   down alone, and no tick keeps less than 95% of its motion.
 * - **Steps and snapping are ours.** Rapier's autostep misses steps while sliding and climbs ~5 cm above its setting:
 *   `autostep.height` is exactly what `moveCharacter` climbs. Grounded means standing on walkable ground (Rapier alone
 *   also says so against a wall at a jump's apex).
 * - **One-way platforms** are solid only to feet at or above their top, less a grace; sensors never block.
 * - **What it shoves it passes:** the controller's queries leave out the groups a character `shoves` (the box hero:
 *   the crowd), so it never steers round them; its capsule meets them in the solver and shoves them aside
 *   (`my-3d2dge:src/stress-world/20-sim.js:33`, `HERO_QUERY`; ADR-0020 amendment 9).
 *
 * Invariants: Rapier's controller (one per Rapier world and skin) keeps nothing between moves (every parameter is set
 * before each), so after a restore (a new Rapier world) a new one takes over. Same state, input and world: same move,
 * in Node and Chromium.
 *
 * Carried from shardfall@fa2dab6 (`pavilion-lite/src/character.rs:179-399`) and
 * `my-3d2dge:src/stress-world/20-sim.js:125-131, 288-300` (the controller's settings).
 *
 * @example
 * import { createPhysics } from './world';
 * import { addCharacter, createCharacter } from './character';
 * const physics = createPhysics();
 * physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
 * const hero = createCharacter({ speed: 5 });
 * const body = addCharacter(physics, hero, [0, 0, 0]);
 * const settings = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
 * physics.step({ dt: 1 / 60, settings });
 * const { moved, grounded } = moveCharacter(physics, body, hero, [0.1, -0.01, 0], { grounded: true });
 * [Math.round(moved.x * 1000) / 1000, grounded]; // [0.1, true]: all of the move across, still on the ground
 * @see engine/physics/character.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { Vector3 } from '../core/math';
import { bodyId, handleOf } from './capture';
import { dropGroups } from './groups';
import type { Character } from './character';
import { check, vec, type Vec3Like } from './queries';
import { rapierOf, type Physics } from './world';

/** One obstacle the controller met: the body, the point it touched and that surface's outward normal. */
export interface CharacterHit {
  body: number;
  point: Vector3;
  normal: Vector3;
}

/** What `moveCharacter` did: the translation it made, whether it ended grounded, and what it hit. */
export interface CharacterMove {
  moved: Vector3;
  grounded: boolean;
  /** Obstacles met moving across (pushed props among them). */
  across: CharacterHit[];
  /** Obstacles met moving down or up. */
  vertical: CharacterHit[];
}

/** How `moveCharacter` moves: whether it stands on the ground (and is not rising), and the one-way platforms. */
export interface MoveOptions {
  /** It stood on the ground and is not rising: it climbs steps and follows the ground down. */
  grounded?: boolean;
  /** Bodies that are one-way platforms: solid only to feet at or above their top. */
  oneWay?: ReadonlySet<number>;
}

/** Rapier's controller per Rapier world and skin: no state between moves (every parameter is set before each). */
const controllers = new WeakMap<RAPIER.World, Map<number, RAPIER.KinematicCharacterController>>();

/** Rapier's normal nudge factor, pinned (its default, as shardfall sets it). */
const NUDGE = 1e-4;
/** How far past `maxSlope` a slope still counts as climbable (rad): a 50° ramp is 50° only to float precision. */
const SLOPE_TOLERANCE = 1e-3;
/** A grounded move across starts this many skins (offsets) above the floor, so it never grazes it. */
const LIFT = 1;
/** One-way platforms hold feet down to this far below their top (m). */
const ONE_WAY_GRACE = 0.08;
/** Sensors never block a character. */
const FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;

/** The controller for `world` with a skin of `offset`, made once. */
function controllerOf(world: RAPIER.World, offset: number): RAPIER.KinematicCharacterController {
  let byOffset = controllers.get(world);
  if (!byOffset) controllers.set(world, (byOffset = new Map()));
  let controller = byOffset.get(offset);
  if (!controller) {
    controller = world.createCharacterController(offset);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setNormalNudgeFactor(NUDGE);
    byOffset.set(offset, controller);
  }
  return controller;
}

/** The Rapier body of a character, with its capsule (its first collider); throws `PHYSICS_BAD_ARGUMENT`. */
export function partsOf(world: RAPIER.World, body: number, where: string) {
  const rigid = Number.isInteger(body) && body >= 0 ? world.bodies.get(handleOf(body)) : null;
  const collider = rigid?.isKinematic() && rigid.numColliders() > 0 ? rigid.collider(0) : null;
  const capsule = collider?.shapeType() === RAPIER.ShapeType.Capsule;
  check(capsule, where, body, 'a character’s body id (addCharacter)');
  return { rigid: rigid!, collider: collider! };
}

/** Sets the controller up for one move: Rapier's own autostep and snap are off (`moveCharacter` does both). */
function configure(controller: RAPIER.KinematicCharacterController, character: Character, slide: boolean) {
  controller.setSlideEnabled(slide);
  controller.setMaxSlopeClimbAngle(character.maxSlope + SLOPE_TOLERANCE);
  controller.setMinSlopeSlideAngle(character.slideSlope);
  controller.setApplyImpulsesToDynamicBodies(false);
  controller.disableSnapToGround();
  controller.disableAutostep();
}

/** The obstacles of the controller's last move, by body. */
function hitsOf(controller: RAPIER.KinematicCharacterController): CharacterHit[] {
  const hits: CharacterHit[] = [];
  for (let i = 0; i < controller.numComputedCollisions(); i++) {
    const hit = controller.computedCollision(i);
    const parent = hit?.collider?.parent();
    if (!hit || !parent) continue;
    const [p, n] = [hit.witness1, hit.normal1];
    hits.push({ body: bodyId(parent.handle), point: new Vector3(p.x, p.y, p.z), normal: new Vector3(n.x, n.y, n.z) });
  }
  return hits;
}

/** One controller move's outcome. */
interface Leg {
  moved: Vector3;
  grounded: boolean;
  hits: CharacterHit[];
}

/** Whether a surface is a wall to `character`: steeper than it climbs, not a ceiling. */
export function isWall(character: Character, normal: Vector3): boolean {
  return normal.y < Math.cos(character.maxSlope + SLOPE_TOLERANCE) && normal.y > -1e-3;
}

/** The groups a character's controller queries: its collider's, less the groups it `shoves` (groups.ts `dropGroups`). */
function queryGroups(collider: RAPIER.Collider, character: Character): number {
  const groups = collider.collisionGroups();
  return character.shoves?.length ? dropGroups(groups, character.shoves) : groups;
}

/** Whether `character` can stand on a surface: no steeper than it climbs. */
export function isWalkable(character: Character, normal: Vector3): boolean {
  return normal.y >= Math.cos(character.maxSlope + SLOPE_TOLERANCE);
}

/**
 * Moves a character's capsule by `desired` as far as it can: across first (sliding along walls, up slopes it climbs,
 * pushing props), then down or up alone. A `grounded` character moves across lifted off the floor by its skin (so the
 * move never grazes the floor it stands on), climbs steps (a move across that a wall stops is tried again up by
 * `autostep.height`, across and down, and kept when it gets further and lands no higher than that on ground it can
 * stand on, with `autostep.width` of room), and follows the ground down by up to `snap`. Returns the translation made;
 * the body gets there when the world steps (`stepCharacter` sets its velocity). Throws `PHYSICS_BAD_ARGUMENT`.
 */
export function moveCharacter(
  physics: Physics,
  body: number,
  character: Character,
  desired: Vec3Like,
  options: MoveOptions = {},
): CharacterMove {
  const world = rapierOf(physics);
  const { rigid, collider } = partsOf(world, body, 'moveCharacter(body)');
  const want = vec(desired, 'moveCharacter(desired)');
  const start = new Vector3().copy(rigid.translation());
  const controller = controllerOf(world, character.offset);
  const groups = queryGroups(collider, character);
  const { radius, height } = character.capsule;
  const ground = start.y - height / 2 - radius - character.offset;
  const solid = oneWayFilter(world, options.oneWay, ground + character.offset);
  const leg: LegMove = (from, x, y, z, slide = character.slide) => {
    configure(controller, character, slide);
    collider.setTranslation(from);
    controller.computeColliderMovement(collider, { x, y, z }, FLAGS, groups, solid);
    const m = controller.computedMovement();
    return { moved: new Vector3(m.x, m.y, m.z), grounded: controller.computedGrounded(), hits: hitsOf(controller) };
  };
  const grounded = options.grounded ?? false;
  const lift = grounded ? leg(start, 0, character.offset * LIFT, 0).moved : new Vector3();
  const from = start.clone().add(lift);
  let across = leg(from, want.x, 0, want.z);
  if (grounded) across = stepUp(world, character, collider, rigid, leg, from, ground, want, across, groups) ?? across;
  const mid = from.clone().add(across.moved);
  let down = leg(mid, 0, want.y - lift.y, 0);
  if (grounded && !down.grounded && character.snap > 0) {
    const snap = leg(mid.clone().add(down.moved), 0, -character.snap, 0, false);
    if (snap.grounded) down = { moved: down.moved.add(snap.moved), grounded: true, hits: [...down.hits, ...snap.hits] };
  }
  const moved = lift.add(across.moved).add(down.moved);
  collider.setTranslation(start.clone().add(moved));
  const standing = down.grounded && down.hits.some((hit) => isWalkable(character, hit.normal));
  return { moved, grounded: standing, across: across.hits, vertical: down.hits };
}

/** A controller move from a point by `(x, y, z)`, sliding along what it meets or not. */
type LegMove = (from: Vector3, x: number, y: number, z: number, slide?: boolean) => Leg;

/** The step a wall-stopped grounded move across may be: up, across, down (see `moveCharacter`); null when it is not. */
function stepUp(
  world: RAPIER.World,
  character: Character,
  collider: RAPIER.Collider,
  rigid: RAPIER.RigidBody,
  leg: LegMove,
  from: Vector3,
  ground: number,
  want: RAPIER.Vector,
  across: Leg,
  groups: number,
): Leg | null {
  const { height, width, dynamic } = character.autostep;
  const reach = Math.hypot(want.x, want.z);
  const got = Math.hypot(across.moved.x, across.moved.z);
  const stair = (hit: CharacterHit) =>
    isWall(character, hit.normal) && (dynamic || world.bodies.get(handleOf(hit.body))?.isDynamic() !== true);
  if (height <= 0 || got >= reach - 1e-4 || !across.hits.some(stair)) return null;
  const up = leg(from, 0, height, 0);
  const top = from.clone().add(up.moved);
  const dir = { x: want.x / reach, y: 0, z: want.z / reach };
  const { radius } = character.capsule;
  const lean = Math.min(character.slideSlope, character.maxSlope);
  const onto = Math.max(reach, width, radius + character.offset - radius * Math.sin(lean) + 0.005);
  const room = [collider.shape, 0, onto, true, FLAGS, groups, undefined, rigid] as const;
  if (world.castShape(top, collider.rotation(), dir, ...room)) return null;
  const over = leg(top, dir.x * onto, 0, dir.z * onto);
  const fall = leg(top.clone().add(over.moved), 0, ground - top.y, 0, false);
  const stand = (hit: CharacterHit) => isWalkable(character, hit.normal) && hit.point.y <= ground + height + 1e-3;
  const moved = up.moved.add(over.moved).add(fall.moved);
  const fits = fall.grounded && fall.hits.some(stand) && Math.hypot(moved.x, moved.z) > got + 1e-4;
  return fits ? { moved, grounded: true, hits: over.hits } : null;
}

/**
 * The filter that makes one-way platforms solid only to feet at or above their top, less a grace. Their tops are read
 * first: Rapier calls the filter in the middle of a move, when no collider may be asked anything.
 */
function oneWayFilter(world: RAPIER.World, oneWay: ReadonlySet<number> | undefined, feet: number) {
  if (!oneWay?.size) return undefined;
  const tops = new Map<number, number>();
  for (const id of oneWay) {
    const platform = world.bodies.get(handleOf(id));
    for (let i = 0; i < (platform?.numColliders() ?? 0); i++) {
      const collider = platform!.collider(i);
      const half = collider.shapeType() === RAPIER.ShapeType.Cuboid ? (collider.halfExtents()?.y ?? 0) : 0;
      tops.set(collider.handle, collider.translation().y + half);
    }
  }
  return (collider: RAPIER.Collider) => feet >= (tops.get(collider.handle) ?? -Infinity) - ONE_WAY_GRACE;
}

/**
 * How far a character goes down `by` (< 0) with its sinking `floor`, from where its last move left the capsule: a
 * controller move that leaves the floor out, so a ledge it overhangs holds it up rather than taking it in.
 */
export function sink(
  world: RAPIER.World,
  body: number,
  character: Character,
  floor: RAPIER.RigidBody,
  by: number,
  oneWay: ReadonlySet<number> | undefined,
): number {
  const { collider } = partsOf(world, body, 'stepCharacter(body)');
  const at = collider.translation();
  const own = new Set(Array.from({ length: floor.numColliders() }, (_, i) => floor.collider(i).handle));
  const solid = oneWayFilter(world, oneWay, at.y - character.capsule.height / 2 - character.capsule.radius);
  const controller = controllerOf(world, character.offset);
  configure(controller, character, false);
  const keep = (other: RAPIER.Collider) => !own.has(other.handle) && (solid?.(other) ?? true);
  controller.computeColliderMovement(collider, { x: 0, y: by, z: 0 }, FLAGS, queryGroups(collider, character), keep);
  const y = controller.computedMovement().y;
  collider.setTranslation({ x: at.x, y: at.y + y, z: at.z });
  return y;
}
