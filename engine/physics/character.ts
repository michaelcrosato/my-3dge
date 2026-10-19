/**
 * @file The character controller (PLAN.md WP 3.2, §4.8, §5.8; doctrines: Common ground, Quality under the hood): a
 * capsule on a kinematic body moved by Rapier's kinematic character controller, with an action game's movement on top.
 * engine/sim/actors.ts runs it in the sim; game code spawns actors there and never meets Rapier.
 *
 * `createCharacter(spec)` checks settings against `CHARACTER_FIELDS` and fills the defaults (shardfall's movement, the
 * stress test's capsule: PLAN.md Appendix C); `addCharacter` adds the body (group `actor`), its bottom just outside the
 * skin, so it does not stick at seams (engine/physics/characterBody.ts, re-exported here). `stepCharacter` is one tick: `steer` (engine/physics/feel.ts), the controller's
 * move (engine/physics/move.ts's `moveCharacter`: across then down, its own steps and snap), `settle`, then walls,
 * pushes and the ground probe. Its `state` (`CHARACTER_STATE_FIELDS`) is plain data. Pushing shares momentum (an
 * inelastic collision of a `push`-kg mass); walls stop the velocity going into them, slopes do not; kinematic floors
 * carry it exactly (engine/physics/carry.ts); idle on fixed ground it skips the controller (ADR-0020 amendments 3 and 5). A
 * character that `shoves` a group (the box's hero, the crowd) moves as if those bodies were not there, and its capsule
 * pushes them aside in the physics step, as the prototype's hero shoved monsters (ADR-0020 amendment 9). A character
 * given a movement profile, `createCharacter({ movement: 'movement:apex' })`, takes its settings and, with a model,
 * steers by the shooter model instead (engine/physics/movement/), its state in a `MotionState` beside this one, asking
 * the world through engine/physics/room.ts; a mantle's tick moves its feet straight along the mantle's path.
 *
 * Invariants: it keeps nothing between ticks but `state` (move.ts's controller keeps nothing either), so a restored
 * world steps on alike. Same state, input and world: same tick, in Node and Chromium.
 *
 * Carried from shardfall@fa2dab6 (`crates/pav_core/src/character.rs:124-162, 959-1089`) and
 * `my-3d2dge:src/stress-world/20-sim.js:84` (the capsule).
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
import type RAPIER from '@dimforge/rapier3d-simd-compat';
import { Vector3 } from '../core/math';
import type { Registry } from '../core/registry';
import { defineSchema, freezeValue, parse, type EntryOf, type Field, type Schema } from '../core/schema';
import { defineSettings } from '../core/settings';
import { handleOf } from './capture';
import { feetOf } from './characterBody';
import { GROUP_NAMES } from './groups';
import { settle, steer } from './feel';
import { carried } from './carry';
import { halfHeightOf, isWall, moveCharacter, partsOf, type CharacterMove } from './move';
import { MODEL_FIELDS, type MotionState } from './movement/model';
import { applyMovement } from './movement/profile';
import { launch, NO_RIDES, type Rides } from './movement/ride';
import './movement/profiles';
import { settleMotion, steerMotion } from './movement/steer';
import { check, type Vec3Like } from './queries';
import { fitHull, roomOf } from './room';
import { rapierOf, type Physics } from './world';

export { addCharacter, bodyAt, feetOf } from './characterBody';

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
  stepFrom: { type: 'string', enum: ['start', 'contact'], description: "Where a climb measures its reach from: 'contact', where the step stopped the move, so a fast move steps up without stopping dead (the shooter model's); absent, the tick's start." }, // prettier-ignore
  stayOnGround: { type: 'boolean', description: 'Whether it also follows the ground down after a leg down that nothing stopped, so it slides over a crest instead of flying off it (the shooter model’s, as Source’s StayOnGround); absent, no.' }, // prettier-ignore
  maxSlope: num(50 * DEG, 0, 89 * DEG, 'The steepest slope it walks up (50°).', 'rad'),
  slideSlope: num(40 * DEG, 0, 90 * DEG, 'Ground steeper than this slides it down (40°).', 'rad'),
  slide: { type: 'boolean', default: true, description: 'Whether it slides along walls and obstacles it walks into.' },
  push: num(70, 0, 100000, 'The mass it pushes props with, and its weight on dynamic floors.', 'kg'),
  shoves: {
    type: 'array',
    items: { type: 'string', enum: GROUP_NAMES },
    description:
      'Collision groups its controller passes through, so only the solver meets them: its capsule shoves their bodies aside, never steering round them (the box hero: crowd). Absent: none.',
  },
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
  movement: {
    type: 'object',
    properties: MODEL_FIELDS,
    description:
      'The shooter model’s numbers (engine/physics/movement/model.ts), from a movement profile: createCharacter({ movement: "movement:apex" }); absent: the platformer model of the fields above.',
  },
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

/**
 * Checks a character's settings and fills the defaults; throws `CORE_BAD_SPEC` naming each problem. A `movement`
 * profile's id applies that profile first, the spec's own fields winning, and a `model` beside it changes the
 * profile's model field by field (engine/physics/movement/profile.ts).
 */
export function createCharacter(spec: Record<string, unknown> = {}, registry?: Registry): Character {
  return freezeValue(parse(CHARACTER_FIELDS, applyMovement(spec, registry), 'createCharacter(spec)'));
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
  /** The shooter model's: the sprint button is held, went down this tick, the walk or the crouch button is held. */
  sprint?: boolean;
  sprintPressed?: boolean;
  walk?: boolean;
  crouch?: boolean;
  /** The shooter model's: the crouch toggle went down this tick (it crouches until pressed again or stood up). */
  crouchToggle?: boolean;
  /** The shooter model's: the view's yaw (rad; forward = (sin, 0, cos)), which the sprint keeps within 45° of. */
  view?: number;
  /** The shooter model's: the yaw the move's keys are turned by (the camera's heading); absent, the world's. */
  frame?: number;
  /** The shooter model's: a yaw to face (the look's or the aim's); absent, it faces where it moves. */
  face?: number;
  /** The shooter model's: the view's pitch (rad, up above 0): which way a vertical zipline goes, how steep a skydive. */
  pitch?: number;
  /** The shooter model's: the use button went down this tick (a zipline or a ladder in reach takes it). */
  usePressed?: boolean;
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
  /** The world's ziplines, ladders and launchers (engine/sim/rides.ts); none when absent. */
  rides?: Rides;
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
  /** A launcher set it off this tick (engine/physics/movement/ride.ts's `launch`). */
  launched: boolean;
}

/** How far below the skin the ground probe looks (m). */
const PROBE_DEPTH = 0.15;

/**
 * One sim tick of a character: `steer` turns its intents into a velocity and a move (engine/physics/feel.ts), the
 * controller makes the move (`moveCharacter`), `settle` fixes the velocity from what happened, walls stop the velocity
 * going into them, it pushes what it walked into (both leave at (push·v + m·u)/(push + m)), probes the ground under it
 * and presses a dynamic floor with push × world gravity. A kinematic floor it stands on carries it (`carried`); idle on
 * fixed ground it skips the controller. Changes `state` and sets the body's velocity, so the body gets there when the
 * world steps: call it before (actors.ts: the phase `anim`). A character with a movement model steers by it
 * (engine/physics/movement/steer.ts) and needs its `motion`, else `PHYSICS_BAD_ARGUMENT`.
 */
export function stepCharacter(
  physics: Physics,
  body: number,
  character: Character,
  state: CharacterState,
  input: CharacterInput,
  options: StepOptions,
  motion?: MotionState,
): CharacterStep {
  const { dt } = options;
  check(Number.isFinite(dt) && dt > 0, 'stepCharacter({ dt })', dt, 'a step length above 0');
  const [mx, mz] = input.move ?? [0, 0];
  check(Number.isFinite(mx) && Number.isFinite(mz), 'stepCharacter({ move })', input.move, 'a direction [x, z]');
  const world = rapierOf(physics);
  const { rigid } = partsOf(world, body, 'stepCharacter(body)');
  const g = character.characterGravity ?? options.gravity;
  const rides = options.rides ?? NO_RIDES;
  const launched = rides.launchers.length > 0 && launch(rides, feetOf(physics, body, character).toArray(), character, state, motion, dt, g); // prettier-ignore
  const wasGrounded = state.grounded;
  const model = character.movement !== undefined;
  check(!model || motion !== undefined, 'stepCharacter(motion)', motion, 'the character’s MotionState (createMotionState(), the component motion an actor keeps): it has a movement model'); // prettier-ignore
  const { oneWay } = options;
  const plan = model ? steerMotion(character, state, motion!, input, dt, g, roomOf(physics, body, character, oneWay), rides) : steer(character, state, input, dt, g); // prettier-ignore
  if (model) fitHull(physics, body, character, motion!, !wasGrounded && !state.grounded, oneWay);
  const still = Math.hypot(state.vx, state.vz) < 1e-3 && state.vy <= 0 && state.vy > -g * dt * 1.5;
  const idle = wasGrounded && still && !plan.jumped && !plan.dashing && fixedBody(world, state.ground);
  const grounded = (wasGrounded || state.grounded) && !plan.jumped && state.vy <= 0; // a mantle stepped off onto its top
  const move = plan.path
    ? { moved: new Vector3(...plan.path).sub(feetOf(physics, body, character)), grounded: false, climbed: 0, across: [], vertical: [] } // prettier-ignore
    : idle
      ? { moved: new Vector3(), grounded: true, climbed: 0, across: [], vertical: [] }
      : carried(physics, body, character, grounded ? state.ground : -1, options, (carry) =>
          moveCharacter(physics, body, character, carry.add(plan.desired), { grounded, oneWay: options.oneWay }),
        );
  const landed = model
    ? settleMotion(character, state, motion!, input, plan, move, g, dt)
    : settle(character, state, plan, move.moved, move.grounded);
  if (model) fitHull(physics, body, character, motion!, !state.grounded, oneWay);
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
  return { desired: plan.desired, moved, jumped: plan.jumped, landed, dashed: plan.dashed, moving: !idle, launched };
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
        const at: Vec3Like = [point.x, other.worldCom().y, point.z]; // level with its centre: turns it, never tips it
        physics.applyImpulse(hit, [dx * impulse, 0, dz * impulse], at);
        [state.vx, state.vz] = [state.vx - (mine - shared) * dx, state.vz - (mine - shared) * dz];
      }
    } else if (!other?.isDynamic() && Math.abs(normal.y) < 0.3) {
      Object.assign(state, { wallX: -dx, wallZ: -dz, wallAge: 0 });
    }
  }
  state.pushLoad = load > state.pushLoad ? load : state.pushLoad * Math.exp(-8 * options.dt);
  const { rigid, collider } = partsOf(world, body, 'stepCharacter(body)');
  const center = rigid.translation();
  const from: Vec3Like = [center.x + move.moved.x, center.y + move.moved.y, center.z + move.moved.z];
  const reach = halfHeightOf(collider, character) + character.capsule.radius + character.offset + PROBE_DEPTH;
  const ground = physics.raycast(from, [0, -1, 0], { maxDistance: reach, exclude: body, groups: ['world', 'prop'] });
  state.ground = ground ? ground.body : -1;
  state.slope = ground ? Math.acos(Math.min(1, Math.max(-1, ground.normal.y))) : 0;
  const floor = ground && world.bodies.get(handleOf(ground.body));
  if (ground && state.grounded && floor?.isDynamic() && character.push > 0) {
    const weight = character.push * (options.worldGravity ?? 9.81) * options.dt;
    physics.applyImpulse(ground.body, [0, -weight, 0], ground.point);
  }
}
