/**
 * @file The character controller (PLAN.md WP 3.2, §4.8, §5.8; doctrines: Common ground, Quality under the hood): a
 * capsule on a kinematic body moved by Rapier's kinematic character controller, with an action game's movement on top.
 * engine/sim/actors.ts runs it in the sim; game code spawns actors there and never meets Rapier.
 *
 * `createCharacter(spec)` checks settings against `CHARACTER_FIELDS` and fills the defaults (shardfall's movement, the
 * stress test's capsule: PLAN.md Appendix C); `addCharacter` adds the body (group `actor`), its bottom just outside the
 * skin, so it does not stick at seams. `stepCharacter` is one tick: `steer` (engine/physics/feel.ts), `moveCharacter`,
 * `settle`, then walls, pushes and the ground probe. Its `state` (`CHARACTER_STATE_FIELDS`) is plain data.
 *
 * How it moves, and why (Rapier 0.21, measured):
 * - **Across, then down.** One combined move loses all its sideways motion on some ticks on level ground (§4.8), and a
 *   capsule skimming its floor at the skin meets phantom contacts: a grounded move goes up by the skin, across, then
 *   down alone, and no tick keeps less than 95% of its motion.
 * - **Steps and snapping are ours.** Rapier's autostep misses steps while sliding and climbs ~5 cm above its setting:
 *   `autostep.height` is exactly what `moveCharacter` climbs. Grounded means standing on walkable ground (Rapier alone
 *   also says so against a wall at a jump's apex).
 * - **Pushing shares momentum** (an inelastic collision of a `push`-kg mass); walls stop the velocity going into them,
 *   slopes do not; moving floors carry it; idle on fixed ground it skips the controller.
 *
 * Invariants: Rapier's controller (one per Rapier world and skin) keeps nothing between moves, so after a restore (a
 * new Rapier world) a new one takes over. Same state, input and world: same move, in Node and Chromium.
 *
 * Carried from shardfall@fa2dab6 (`pavilion-lite/src/character.rs:179-399`, `crates/pav_core/src/character.rs:124-162,
 * 959-1089`) and `my-3d2dge:src/stress-world/20-sim.js:84, 125-131, 288-300` (the capsule and controller).
 *
 * @example
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
 * const [hero, state] = [createCharacter({ speed: 5 }), createCharacterState()];
 * const body = addCharacter(physics, hero, [0, 0, 0]);
 * const settings = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
 * for (let i = 0; i < 60; i++) {
 *   stepCharacter(physics, body, hero, state, { move: [1, 0] }, { dt: 1 / 60, gravity: 32 });
 *   physics.step({ dt: 1 / 60, settings });
 * }
 * [state.grounded, state.vx]; // [true, 5]: walking east at full speed
 * @see engine/physics/character.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { Vector3 } from '../core/math';
import { defineSchema, freezeValue, parse, type EntryOf, type Field, type Schema } from '../core/schema';
import { defineSettings } from '../core/settings';
import { bodyId, handleOf } from './capture';
import { check, vec, type Vec3Like } from './queries';
import { settle, steer } from './feel';
import { rapierOf, type Physics } from './world';

/** One degree, in radians. */
const DEG = Math.PI / 180;

/** A number field: its default, range, description and unit. */
function num(value: number, minimum: number, maximum: number, description: string, unit?: string) {
  return { type: 'number', default: value, minimum, maximum, description, ...(unit ? { unit } : {}) } as const;
}

/** An object field made of `properties`, defaulting to their defaults. */
function group<const P extends Schema>(description: string, properties: P) {
  const value = Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default]));
  return { type: 'object', description, properties, default: value } as const;
}

/** A character's settings: `createCharacter` checks a spec against these and fills the defaults. */
export const CHARACTER_FIELDS = defineSchema({
  capsule: group('Its body: a capsule standing up, sized as three.js’s CapsuleGeometry.', {
    radius: num(0.28125, 0.01, 10, 'Radius.', 'm'),
    height: num(1.125, 0, 20, 'The straight middle: the capsule stands height + 2·radius tall.', 'm'),
  }),
  offset: num(0.02, 0.001, 0.1, 'The skin: the gap the controller keeps between the capsule and the rest.', 'm'),
  snap: num(0.25, 0, 2, 'While grounded it follows the ground down this far (slopes, steps down); 0: off.', 'm'),
  autostep: group('Climbing steps without jumping.', {
    height: num(0.3, 0, 5, 'The highest step it climbs, as measured, not Rapier’s raw setting; 0: off.', 'm'),
    width: num(0.125, 0, 5, 'The room it needs on top of a step.', 'm'),
    dynamic: { type: 'boolean', default: true, description: 'Whether it also steps onto dynamic bodies (planks).' },
  }),
  maxSlope: num(50 * DEG, 0, 89 * DEG, 'The steepest slope it walks up (50°).', 'rad'),
  slideSlope: num(40 * DEG, 0, 90 * DEG, 'Ground steeper than this slides it down (40°).', 'rad'),
  slide: { type: 'boolean', default: true, description: 'Whether it slides along walls and obstacles it walks into.' },
  push: num(70, 0, 100000, 'The mass it pushes props with, and its weight on dynamic floors.', 'kg'),
  characterGravity: {
    type: 'number',
    minimum: 0,
    maximum: 1000,
    unit: 'm/s²',
    description: 'Its own gravity; absent: the setting physics.characterGravity (32 m/s²).',
  },
  speed: num(6, 0, 1000, 'Run speed.', 'm/s'),
  acceleration: num(45, 0, 100000, 'How fast it gets up to speed.', 'm/s²'),
  deceleration: num(32, 0, 100000, 'How fast it stops when let go.', 'm/s²'),
  skid: num(90, 0, 100000, 'How fast it turns around: braking when told to go against its motion.', 'm/s²'),
  jumpSpeed: num(Math.sqrt(2 * 32 * 1.35), 0, 1000, 'Take-off speed: the apex is jumpSpeed²/2g (1.35 m at 32).', 'm/s'),
  maxFall: num(26, 0, 1000, 'Its fastest fall.', 'm/s'),
  feel: group('The forgiving details of a modern action game.', {
    coyote: num(0.1, 0, 5, 'Jumping still works this long after leaving the ground.', 's'),
    buffer: num(0.12, 0, 5, 'A jump pressed this long before landing jumps on landing.', 's'),
    variableJump: num(0.45, 0, 1, 'The share of upward speed kept when jump is let go while rising; 1: off.'),
    wallJump: { type: 'boolean', default: false, description: 'Whether jumping in the air at a wall kicks off it.' },
    airControl: num(0.55, 0, 1, 'The share of its acceleration it has in the air.'),
    dash: group('A burst along its move, else its facing; a speed of 0 turns it off.', {
      speed: num(16.25, 0, 1000, 'Dash speed.', 'm/s'),
      duration: num(0.2, 0, 10, 'How long it lasts.', 's'),
      cooldown: num(0.45, 0, 60, 'From one dash’s start to the next.', 's'),
    }),
  }),
});

/** A character's settings, filled: what `createCharacter` returns and an actor's component holds. */
export type Character = EntryOf<typeof CHARACTER_FIELDS>;

/** The character's settings (the setting `physics.characterGravity`). */
export const CHARACTER_SETTINGS = {
  'physics.characterGravity': num(
    32,
    0,
    1000,
    'The gravity characters fall under; bodies use physics.gravity.',
    'm/s²',
  ),
} as const satisfies Record<string, Field>;
defineSettings(CHARACTER_SETTINGS);

/** Checks a character's settings and fills the defaults; throws `CORE_BAD_SPEC` naming each problem. */
export function createCharacter(spec: Record<string, unknown> = {}): Character {
  return freezeValue(parse(CHARACTER_FIELDS, spec, 'createCharacter(spec)'));
}

/** What a character remembers between ticks: plain data in its actor's component, hashed and captured with the sim. */
export const CHARACTER_STATE_FIELDS = defineSchema({
  vx: num(0, -1e4, 1e4, 'Velocity east (+X).', 'm/s'),
  vy: num(0, -1e4, 1e4, 'Velocity up (+Y).', 'm/s'),
  vz: num(0, -1e4, 1e4, 'Velocity south (+Z).', 'm/s'),
  grounded: { type: 'boolean', default: false, description: 'Whether it stood on the ground after its last move.' },
  air: { type: 'integer', default: 0, minimum: 0, description: 'Ticks since it last stood on the ground.' },
  jumping: { type: 'boolean', default: false, description: 'Rising from a jump: letting go cuts it (variableJump).' },
  jumpAge: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since an unused jump press; −1: none.' },
  dash: { type: 'integer', default: 0, minimum: 0, description: 'Ticks of dash left.' },
  dashCooldown: { type: 'integer', default: 0, minimum: 0, description: 'Ticks until it may dash again.' },
  dashX: num(0, -1, 1, 'The dash’s direction, east.'),
  dashZ: num(0, -1, 1, 'The dash’s direction, south.'),
  yaw: num(0, -10, 10, 'Where it faces: forward = (sin yaw, 0, cos yaw); it turns to where it moves.', 'rad'),
  pushLoad: num(0, 0, 1e9, 'The heaviest prop it pushed lately (fading over about 0.1 s), for a pushing pose.', 'kg'),
  wallX: num(0, -1, 1, 'The last wall it touched: its normal across the ground, east.'),
  wallZ: num(0, -1, 1, 'The last wall it touched: its normal across the ground, south.'),
  wallAge: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since it touched that wall; −1: none.' },
  lock: { type: 'integer', default: 0, minimum: 0, description: 'Ticks of no control left (after a wall jump).' },
  ground: { type: 'integer', default: -1, minimum: -1, description: 'The body under it (the ground probe); −1: none.' },
  slope: num(0, 0, Math.PI, 'The angle of the ground under it.', 'rad'),
});

/** A character's own state, as `stepCharacter` reads and writes it (`CHARACTER_STATE_FIELDS` documents each field). */
export type CharacterState = {
  -readonly [K in keyof EntryOf<typeof CHARACTER_STATE_FIELDS>]: EntryOf<typeof CHARACTER_STATE_FIELDS>[K];
};

/** A character's state at rest, every field at its default. */
export function createCharacterState(): CharacterState {
  return parse(CHARACTER_STATE_FIELDS, {}) as CharacterState;
}

/** What a character wants this tick: from the intents (engine/sim/actors.ts) or from its AI. */
export interface CharacterInput {
  /** Where to go across the ground, `[x, z]`, up to length 1 (longer is shortened). */
  move?: readonly [number, number];
  /** The jump button is held. */
  jump?: boolean;
  /** The jump button went down this tick. */
  jumpPressed?: boolean;
  /** The dash button went down this tick. */
  dashPressed?: boolean;
}

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

/** The Rapier body of a character, with its capsule (its first collider). */
function partsOf(world: RAPIER.World, body: number, where: string) {
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
  const groups = collider.collisionGroups();
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
  if (grounded) across = stepUp(world, character, collider, rigid, leg, from, ground, want, across) ?? across;
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
  const room = [collider.shape, 0, onto, true, FLAGS, collider.collisionGroups(), undefined, rigid] as const;
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

/** Adds a character's body (a kinematic capsule, group `actor`), its bottom just outside the skin above `feet`. */
export function addCharacter(physics: Physics, character: Character, feet: Vec3Like): number {
  const at = vec(feet, 'addCharacter(feet)');
  const { radius, height } = character.capsule;
  return physics.addBody({
    type: 'kinematic',
    position: [at.x, at.y + character.offset + 0.005 + radius + height / 2, at.z],
    colliders: [{ shape: { type: 'capsule', radius, height }, group: 'actor' }],
    group: 'actor',
  });
}

/** Where a character's feet are: the bottom of its capsule, less the skin (on flat ground, the ground's height). */
export function feetOf(physics: Physics, body: number, character: Character): Vector3 {
  const { position } = physics.readBody(body);
  return position.setY(position.y - character.capsule.height / 2 - character.capsule.radius - character.offset);
}

/** What `stepCharacter` needs beside the character: the step length, the gravities and the one-way platforms. */
export interface StepOptions {
  /** The step length (s): the sim's `dt`. */
  dt: number;
  /** The gravity it falls under unless its settings name one (the setting `physics.characterGravity`), m/s². */
  gravity: number;
  /** The world's gravity, which its weight presses dynamic floors with (9.81 m/s²). */
  worldGravity?: number;
  /** Bodies that are one-way platforms. */
  oneWay?: ReadonlySet<number>;
}

/** What one tick did. */
export interface CharacterStep {
  /** The translation it asked the controller for. */
  desired: Vector3;
  /** The translation the controller made; the body gets there when the world steps. */
  moved: Vector3;
  jumped: boolean;
  /** The speed it landed at (m/s) when it landed this tick falling faster than 2 m/s, else 0. */
  landed: number;
  dashed: boolean;
  /** False when it stood idle on fixed ground and skipped the controller. */
  moving: boolean;
}

/** How far below the skin the ground probe looks (m). */
const PROBE_DEPTH = 0.15;

/**
 * One sim tick of a character: `steer` turns its intents into a velocity and a move (engine/physics/feel.ts), the
 * controller makes the move (`moveCharacter`), `settle` fixes the velocity from what happened, walls stop the velocity
 * going into them, it pushes what it walked into (both leave at (push·v + m·u)/(push + m)), probes the ground under it
 * and presses a dynamic floor with push × world gravity. Moving floors carry it (Rapier's kinematic friction: a still
 * character moves 1 mm down to keep it checking); idle on fixed ground it skips the controller. Changes `state` and
 * sets the body's velocity, so the body gets there when the world steps: call it before (actors.ts: the phase `anim`).
 */
export function stepCharacter(
  physics: Physics,
  body: number,
  character: Character,
  state: CharacterState,
  input: CharacterInput,
  options: StepOptions,
): CharacterStep {
  const { dt } = options;
  check(Number.isFinite(dt) && dt > 0, 'stepCharacter({ dt })', dt, 'a step length above 0');
  const [mx, mz] = input.move ?? [0, 0];
  check(Number.isFinite(mx) && Number.isFinite(mz), 'stepCharacter({ move })', input.move, 'a direction [x, z]');
  const world = rapierOf(physics);
  const { rigid } = partsOf(world, body, 'stepCharacter(body)');
  const g = character.characterGravity ?? options.gravity;
  const wasGrounded = state.grounded;
  const plan = steer(character, state, input, dt, g);
  const still = Math.hypot(state.vx, state.vz) < 1e-3 && state.vy <= 0 && state.vy > -g * dt * 1.5;
  const idle = wasGrounded && still && !plan.jumped && !plan.dashing && fixedBody(world, state.ground);
  const move = idle
    ? { moved: new Vector3(), grounded: true, across: [], vertical: [] }
    : moveCharacter(physics, body, character, plan.desired, {
        grounded: wasGrounded && !plan.jumped && state.vy <= 0,
        oneWay: options.oneWay,
      });
  const landed = settle(character, state, plan, move.moved, move.grounded);
  for (const hit of [...move.across, ...move.vertical]) {
    if (!isWall(character, hit.normal) || world.bodies.get(handleOf(hit.body))?.isDynamic()) continue;
    const across = Math.hypot(hit.normal.x, hit.normal.z);
    const [nx, nz] = [hit.normal.x / across, hit.normal.z / across];
    const into = state.vx * nx + state.vz * nz;
    if (into < 0) [state.vx, state.vz] = [state.vx - into * nx, state.vz - into * nz];
  }
  afterMove(physics, world, body, character, state, move, options);
  const { moved } = move;
  rigid.setLinvel({ x: moved.x / dt, y: moved.y / dt, z: moved.z / dt }, true);
  return { desired: plan.desired, moved, jumped: plan.jumped, landed, dashed: plan.dashed, moving: !idle };
}

/** Whether `id` names a fixed body of `world`. */
function fixedBody(world: RAPIER.World, id: number): boolean {
  return id >= 0 && world.bodies.get(handleOf(id))?.isFixed() === true;
}

/** After the move: the props pushed, the wall touched, the ground probe, and the weight on a dynamic floor. */
function afterMove(
  physics: Physics,
  world: RAPIER.World,
  body: number,
  character: Character,
  state: CharacterState,
  move: CharacterMove,
  options: StepOptions,
): void {
  let load = 0;
  const pushed = new Set<number>();
  for (const { body: hit, normal, point } of move.across) {
    const other = world.bodies.get(handleOf(hit));
    const across = Math.hypot(normal.x, normal.z);
    if (across === 0) continue;
    const [dx, dz] = [-normal.x / across, -normal.z / across];
    if (other?.isDynamic() && Math.abs(normal.y) < 0.7 && !pushed.has(hit)) {
      pushed.add(hit);
      const [mass, v] = [other.mass(), other.linvel()];
      load = Math.max(load, mass);
      const [mine, theirs] = [state.vx * dx + state.vz * dz, v.x * dx + v.z * dz];
      if (mine > theirs) {
        const shared = (character.push * mine + mass * theirs) / (character.push + mass);
        const impulse = mass * (shared - theirs);
        physics.applyImpulse(hit, [dx * impulse, 0, dz * impulse], point);
        [state.vx, state.vz] = [state.vx - (mine - shared) * dx, state.vz - (mine - shared) * dz];
      }
    } else if (!other?.isDynamic() && Math.abs(normal.y) < 0.3) {
      Object.assign(state, { wallX: -dx, wallZ: -dz, wallAge: 0 });
    }
  }
  state.pushLoad = load > state.pushLoad ? load : state.pushLoad * Math.exp(-8 * options.dt);
  const { radius, height } = character.capsule;
  const center = world.bodies.get(handleOf(body))!.translation();
  const from: Vec3Like = [center.x + move.moved.x, center.y + move.moved.y, center.z + move.moved.z];
  const reach = height / 2 + radius + character.offset + PROBE_DEPTH;
  const ground = physics.raycast(from, [0, -1, 0], { maxDistance: reach, exclude: body, groups: ['world', 'prop'] });
  state.ground = ground ? ground.body : -1;
  state.slope = ground ? Math.acos(Math.min(1, Math.max(-1, ground.normal.y))) : 0;
  const floor = ground && world.bodies.get(handleOf(ground.body));
  if (ground && state.grounded && floor?.isDynamic() && character.push > 0) {
    const weight = character.push * (options.worldGravity ?? 9.81) * options.dt;
    physics.applyImpulse(ground.body, [0, -weight, 0], ground.point);
  }
}
