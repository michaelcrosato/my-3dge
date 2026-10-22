/**
 * @file Actors (PLAN.md WP 3.2; WP 3.7 adds the animator): entities that walk, jump and dash through the character
 * controller (engine/physics/character.ts). `spawnActor(w, { at, character, player })` adds a capsule body to the
 * scene's physics world and spawns an entity with the component `actor` (its body, settings, intents, feet and the
 * controller's state), so the sim hashes, captures and restores all of it.
 *
 * The step (shardfall's order): movers set their velocities (`intents`, `ai`), the system `actors` moves every actor in
 * id order (`anim`), the world steps (`physics`), and `actors.readback` copies the feet into `x`, `y`, `z`
 * (`readback`). A player actor reads the step's intents: `move`, `jump` (held, pressed) and `dash` (pressed); any other
 * the intents its AI writes into `actor.intents`, its presses from the edges of `b`. Events: `jump` `{ id }`, `land` `{
 * id, speed }`, `dash` `{ id }`. Gravity: `physics.characterGravity` unless the settings name one; the weight on
 * dynamic floors uses `physics.gravity`. The component `oneWay` makes its body a one-way platform. WP 3.7: `anim` adds
 * the component `animator`, stepped by `actors.anim` after `actors` (its `reactions` first, WP 7.8) and, with
 * `preciseHits`, posed by `actors.pose` after `actors.readback` (event `footstep` `{ id, side, speed }`). WP 8.9:
 * `body` adds the component `puppet` (the body drawn), `clips` the clip layer (engine/sim/actorClips.ts).
 *
 * WP 13.3 and 13.7: an actor on a movement model also holds `motion`, the model's state, and reads its buttons, view
 * and rides (`spawnActor` says which); launchers set off any actor: event `launch` `{ id }`. WP 13.9: a player's sprint
 * and crouch work as the recorded settings `input.sprint` and `input.crouch` say (held, or toggled by a press); WP
 * 13.10: an animated actor's duck is its animator's pose `crouch` (a planted stride's shorter step).
 *
 * Invariants: systems are added once per world, on the first (animated) spawn; all an actor remembers is in its
 * components (the sim's animators are loaded from them). Despawning leaves the body; `removeActor` removes both.
 * Carried from shardfall@fa2dab6 (`pavilion-lite/src/character.rs:179-399`: the order of a step, the events).
 * @example
 * import { createCharacter } from '../physics/character';
 * import { physicsOf } from '../physics/binding';
 * import { startScene, defineScene } from './scene';
 * defineScene('walk', {
 *   physics: true,
 *   setup(w) {
 *     physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
 *     spawnActor(w, { at: [0, 0, 0], character: createCharacter({ speed: 5 }) });
 *   },
 * });
 * const { world } = startScene('walk');
 * for (let i = 0; i < 60; i++) world.step({ move: [1, 0] });
 * world.query('actor')[0].actor.x; // 4.69: a second's walk east at 5 m/s, from standing
 * @see engine/sim/actors.test.ts
 */
import { AnimatorPool, ANIMATOR_FIELDS, type AnimatorData, type AnimatorOptions } from '../anim/character';
import { STEP } from '../anim/humanoid';
import type { AnimatorInput } from '../anim/states';
import { codeError } from '../core/log';
import { Vector3 } from '../core/math';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { defineSettings } from '../core/settings';
import { held, pressed, type Intents } from '../input/intents';
import {
  addCharacter,
  bodyAt,
  CHARACTER_SETTINGS,
  CHARACTER_STATE_FIELDS,
  createCharacter,
  createCharacterState,
  feetOf,
  stepCharacter,
  type Character,
  type CharacterInput,
  type CharacterState,
} from '../physics/character';
import { matchHull } from '../physics/hull';
import { hullFor } from '../physics/movement/crouch';
import { createMotionState, MOTION_FIELDS, type MotionState } from '../physics/movement/model';
import { MOVEMENT_SETTINGS, movementOverrides, tuneCharacter } from '../physics/movement/settings';
import { physicsOf } from '../physics/binding';
import { vec, type Vec3Like } from '../physics/queries';
import { clipsFor, defineClipKinds, type ClipsSpec } from './actorClips';
import { intentsOf, motionInput } from './actorInput';
import { defineActionKinds, stepActorActions } from './actorActions';
import { defineReactionKinds, stepReactions, type ReactionComponents } from './reactions';
import { defineRideKinds, ridesOf } from './rides';
import { defineComponent } from './state';
import type { World } from './world';

/** The component `actor`'s own fields, before the controller's state. */
const ACTOR_FIELDS = {
  body: { type: 'integer', default: -1, minimum: -1, description: 'Its body in the physics world.' },
  player: { type: 'boolean', default: true, description: 'Whether it reads the step’s intents (else actor.intents).' },
  character: { type: 'any', default: createCharacter(), description: 'Its settings: what createCharacter returned.' },
  intents: { type: 'any', default: {}, description: 'What its AI wants this step (move, b, p), when not a player.' },
  held: { type: 'array', default: [], description: 'The buttons its AI held last step, for presses.' },
  x: { type: 'number', default: 0, unit: 'm', description: 'Where its feet are, east.' },
  y: { type: 'number', default: 0, unit: 'm', description: 'Where its feet are, up.' },
  z: { type: 'number', default: 0, unit: 'm', description: 'Where its feet are, south.' },
} as const;

/** The component `actor`: an entity the character controller moves. */
export interface ActorComponent extends CharacterState {
  body: number;
  player: boolean;
  character: Character;
  intents: Partial<Intents>;
  held: string[];
  x: number;
  y: number;
  z: number;
}

/** The component `animator`: an actor's character animator as plain data, and what its game code tells its body. */
export interface AnimatorComponent extends AnimatorData {
  /** The body states its game code holds on (a pose, a stance, a flinch…); the controller's join them each step. */
  states: Partial<AnimatorInput>;
}

/** The component `puppet`: the body an actor is drawn as (engine/gfx/puppets/actors.ts), when not the humanoid. */
export interface PuppetComponent {
  body: string;
}

/** The components this module reads: `actor`, `animator`, `puppet`, `motion` (the shooter model's) and `oneWay`. */
export type ActorComponents = {
  actor: ActorComponent;
  animator: AnimatorComponent;
  puppet: PuppetComponent;
  motion: MotionState;
  oneWay: { body: number };
};

/**
 * How a player's sprint and crouch buttons work, as a shooter's options set them (WP 13.9, docs/PLAYGROUND.md §3.3):
 * recorded settings, since they change how the same presses move him, read by the system `actors` for player actors.
 */
export const CONTROL_SETTING_FIELDS = {
  'input.sprint': {
    type: 'string',
    enum: ['toggle', 'hold'],
    default: 'toggle',
    description: "The sprint button on the shooter model: toggle, Apex's sticky sprint (a press keeps it on while the player moves on); hold, only while held. Recorded: it changes how a player moves.", // prettier-ignore
  },
  'input.crouch': {
    type: 'string',
    enum: ['hold', 'toggle'],
    default: 'hold',
    description: 'The crouch button on the shooter model: hold, crouched while held; toggle, a press crouches until pressed again (a jump or a sprint stands it up). Recorded: it changes how a player moves.', // prettier-ignore
  },
} as const;

/**
 * Declares the components `actor`, `animator`, `puppet`, `clips` (engine/sim/actorClips.ts), `oneWay`, `reactions` and
 * `secondary` (engine/sim/reactions.ts), the setting `physics.characterGravity` and the controls' `input.sprint` and
 * `input.crouch` on `registry`.
 */
export function defineActorKinds(registry: Registry = sharedRegistry): void {
  defineReactionKinds(registry);
  defineActionKinds(registry);
  defineRideKinds(registry);
  if (!registry.kinds().includes('setting') || !registry.has('setting', 'physics.characterGravity')) {
    defineSettings(CHARACTER_SETTINGS, registry);
  }
  if (!registry.has('setting', 'movement.turnRate')) defineSettings(MOVEMENT_SETTINGS, registry);
  if (!registry.has('setting', 'input.sprint')) defineSettings(CONTROL_SETTING_FIELDS, registry);
  if (!registry.kinds().includes('component') || !registry.has('component', 'animator')) {
    const states = { type: 'object', default: {}, description: 'The body states its game code holds on.' } as const;
    const description = 'A character animator (engine/anim/character.ts): what it keeps, and what its body is told.';
    defineComponent('animator', { description, fields: { ...ANIMATOR_FIELDS, states } }, registry);
  }
  defineClipKinds(registry);
  if (!registry.has('component', 'puppet')) {
    const body = {
      type: 'string',
      default: 'body:humanoid',
      description: 'Its body’s id (the body grammar’s).',
    } as const;
    defineComponent('puppet', { description: 'The body an actor is drawn as, when not the humanoid.', fields: { body } }, registry); // prettier-ignore
  }
  if (registry.has('component', 'actor')) return;
  defineComponent(
    'actor',
    {
      description: 'An entity the character controller moves.',
      fields: { ...ACTOR_FIELDS, ...CHARACTER_STATE_FIELDS },
    },
    registry,
  );
  defineComponent(
    'motion',
    {
      description: 'An actor’s state in the shooter movement model (engine/physics/movement/model.ts).',
      fields: MOTION_FIELDS,
    },
    registry,
  );
  defineComponent(
    'oneWay',
    {
      description: 'Makes a body a one-way platform: solid only to an actor whose feet are at or above its top.',
      fields: { body: { type: 'integer', default: -1, minimum: -1, description: 'The platform’s body.' } },
    },
    registry,
  );
}
defineActorKinds();

/** What `spawnActor` takes. */
export interface ActorSpec {
  /** Where its feet go: on the ground below them (it starts just above, outside the skin). */
  at: Vec3Like;
  /** Its settings (createCharacter). */
  character: Character;
  /** Whether it reads the step's intents (true); false: its AI writes `actor.intents`. */
  player?: boolean;
  /** Where it faces (rad; forward = (sin yaw, 0, cos yaw)). */
  yaw?: number;
  /** Its character animator's make (engine/anim/character.ts); none when absent. */
  anim?: Pick<AnimatorOptions, 'build' | 'weapon' | 'preciseHits'>;
  /** The body it is drawn as (`body:mannequin`), with `anim`; the neutral humanoid when absent. */
  body?: string;
  /** With `anim`, the clip layer in its animator, playing from these sets (engine/sim/actorClips.ts); none when absent. */
  clips?: ClipsSpec;
  /** With a movement model, whether it starts with no weapon out (true: the model's holstered speeds). */
  holstered?: boolean;
  /**
   * Further components it spawns with, by name (its `reactions`, its `secondary`: engine/sim/reactions.ts), so they
   * are there from its first step, and a page's first warm-up builds what they draw.
   */
  components?: Readonly<Record<string, object>>;
}

/**
 * Spawns an actor in a scene with a physics world: its body, and an entity with the component `actor`. Returns the id.
 * An actor on a movement model (engine/physics/movement/, WP 13.3) also holds `motion`, the model's state (holstered
 * unless spawned `holstered: false`), and reads `sprint` (held, pressed), `walk` and `crouch` (held), `crouchToggle`
 * (pressed), the view from `look`, the keys' frame from `cam` (else `look`) and what it faces from `aim` (else
 * `look`), under the live `movement.*` settings (WP 13.4); WP 13.7: the look's pitch and `interact` (pressed) too,
 * riding the scene's ziplines and ladders (engine/sim/rides.ts); WP 13.9: a player's sprint held only while held with
 * `input.sprint` at `hold`, and his crouch toggled by its press with `input.crouch` at `toggle`.
 */
export function spawnActor<C extends object>(world: World<C>, spec: ActorSpec): number {
  const w = world as unknown as World;
  const physics = physicsOf(w);
  const body = addCharacter(physics, spec.character, spec.at);
  const { x, y, z } = feetOf(physics, body, spec.character);
  const state = { ...createCharacterState(), yaw: spec.yaw ?? 0 };
  if (!w.systems.has('actors')) {
    w.systems.add('actors', moveActors, { phase: 'anim' });
    w.systems.add('actors.readback', readActors, { phase: 'readback' });
  }
  const actor = { body, player: spec.player ?? true, character: spec.character, x, y, z, ...state };
  const motion = spec.character.movement ? { motion: { ...createMotionState(), holstered: spec.holstered ?? true } } : {}; // prettier-ignore
  if (!spec.anim) return w.spawn({ ...spec.components, ...motion, actor });
  if (!w.systems.has('actors.anim')) {
    w.systems.add('actors.anim', stepAnimators, { phase: 'anim' });
    w.systems.add('actors.pose', poseAnimators, { phase: 'readback' });
  }
  const { build = 'build:chibi', weapon = 'none', preciseHits = false } = spec.anim;
  const animator = { build: typeof build === 'string' ? build : build.id, weapon, preciseHits };
  const puppet = spec.body !== undefined ? { body: spec.body } : undefined;
  const clips = spec.clips && (clipsFor(w, spec.clips, animator.build) as unknown as Record<string, unknown>);
  return w.spawn({ ...spec.components, ...motion, actor, animator, puppet, clips });
}

/**
 * Puts actor `id` at `at`, its feet on the ground below (just above, outside the skin, as a spawn stands it), facing
 * `yaw` (its own when absent), at rest: no velocity, no jump, dash or landing pending, standing (its hull too); on the
 * shooter model its motion state starts again, holstered as it was, or ducked with `crouch`, its hull crouched from its
 * next step on and kept so until it has headroom, for a place no standing hull fits (a crawlspace). A place where the
 * level (the queries' as of the last step, one-way platforms aside) stands over its feet lower than its hull's top, up
 * its axis, throws `SIM_BAD_ARGUMENT` before it moves anything: the body would sink through the floor. For a scene's dev actions: a feel
 * course places its player where it measures (engine/dev/feel/course.ts).
 */
export function placeActor<C extends object>(
  world: World<C>,
  id: number,
  at: Vec3Like,
  yaw?: number,
  options: { crouch?: boolean } = {},
): void {
  const w = world as unknown as World;
  const e = w.get(id) as Partial<ActorComponents> | undefined;
  if (!e?.actor) throw codeError('SIM_BAD_ARGUMENT', { where: 'placeActor(w, id)', value: String(id), expected: 'an actor’s id' }); // prettier-ignore
  const { actor, motion } = e;
  if (options.crouch && !motion) throw codeError('SIM_BAD_ARGUMENT', { where: 'placeActor(options.crouch)', value: `true for actor ${id}, on no movement model`, expected: 'no crouch: only an actor on a movement model (its component motion) crouches' }); // prettier-ignore
  const physics = physicsOf(w);
  const { offset, capsule } = actor.character;
  const centre = bodyAt(actor.character, at, 'placeActor(at)'); // the standing hull's, its feet just over `at`
  const middle = motion && options.crouch ? hullFor(actor.character, { ...motion, stance: 'crouch' }) : capsule.height; // prettier-ignore
  const up = { maxDistance: middle + capsule.radius, exclude: actor.body, groups: 'world' } as const;
  const ceiling = physics.raycast([centre[0], centre[1] - capsule.height / 2, centre[2]], [0, 1, 0], up); // up its axis
  if (ceiling && !oneWayOf(w).has(ceiling.body)) {
    const given = vec(at, 'placeActor(at)');
    const place = [given.x, given.y, given.z].map((v) => Math.round(v * 100) / 100).join(', ');
    const [over, tall] = [(offset + capsule.radius + ceiling.distance).toFixed(2), (middle + 2 * capsule.radius).toFixed(2)]; // prettier-ignore
    throw codeError('SIM_BAD_ARGUMENT', { where: 'placeActor(at)', value: `[${place}], where a ceiling ${over} m over its feet cuts its ${options.crouch ? 'crouched' : 'standing'} hull, ${tall} m tall (it would sink through the floor)`, expected: motion && !options.crouch ? 'a place with headroom, or { crouch: true } under a low ceiling' : 'a place with headroom' }); // prettier-ignore
  }
  matchHull(physics, actor.body, actor.character, capsule.height, { air: false, tuck: false });
  physics.setBody(actor.body, { position: centre, velocity: [0, 0, 0] });
  const { x, y, z } = feetOf(physics, actor.body, actor.character);
  Object.assign(actor, createCharacterState(), { yaw: yaw ?? actor.yaw, x, y, z });
  if (motion) Object.assign(motion, createMotionState(), { holstered: motion.holstered }, options.crouch ? { stance: 'crouch', duck: 'ducked' } : {}); // prettier-ignore
}

/** The bodies of the one-way platforms (the component `oneWay`). */
const oneWayOf = (w: World) => new Set((w.query('oneWay') as unknown as ActorComponents[]).map((e) => e.oneWay.body));

/** Removes an actor and its body. */
export function removeActor<C extends object>(world: World<C>, id: number): void {
  const w = world as unknown as World;
  const actor = (w.get(id) as Partial<ActorComponents> | undefined)?.actor;
  if (!actor)
    throw codeError('SIM_BAD_ARGUMENT', { where: 'removeActor(w, id)', value: String(id), expected: 'an actor’s id' });
  physicsOf(w).removeBody(actor.body);
  w.despawn(id);
}

/** The system `actors`: every actor's tick, in id order. */
function moveActors(w: World, intents: Intents): void {
  const physics = physicsOf(w);
  const gravity = w.settings.get('physics.characterGravity') as number;
  const worldGravity = w.settings.get('physics.gravity') as number;
  const oneWay = oneWayOf(w);
  const tuning = movementOverrides((path) => w.settings.get(path));
  const rides = ridesOf(w);
  const controls = { holdSprint: w.settings.get('input.sprint') === 'hold', toggleCrouch: w.settings.get('input.crouch') === 'toggle' }; // prettier-ignore
  for (const e of w.query('actor') as unknown as (ActorComponents & { id: number })[]) {
    const { actor, motion } = e;
    const wants = intentsOf(actor, intents);
    const input: CharacterInput = {
      move: wants.move,
      jump: held(wants, 'jump'),
      jumpPressed: pressed(wants, 'jump'),
      dashPressed: pressed(wants, 'dash'),
      ...(motion ? motionInput(actor, wants, controls, (e as { interactor?: { usedAt: number } }).interactor?.usedAt === w.tick) : {}), // prettier-ignore
    };
    const character = motion ? tuneCharacter(actor.character, tuning) : actor.character;
    const step = stepCharacter(physics, actor.body, character, actor, input, { dt: w.dt, gravity, worldGravity, oneWay, rides }, motion); // prettier-ignore
    if (step.jumped) w.emit('jump', { id: e.id });
    if (step.landed) w.emit('land', { id: e.id, speed: step.landed });
    if (step.dashed) w.emit('dash', { id: e.id });
    if (step.launched) w.emit('launch', { id: e.id });
  }
}

/** The sim's animators, a pool per world: loaded from the components at every step, so they keep no state of their own. */
const pools = new WeakMap<World, AnimatorPool>();
const [velocity, feet] = [new Vector3(), new Vector3()];

/** The animated actors of `w`, and its pool (pruned of the despawned). */
function animated(w: World) {
  const pool = pools.get(w) ?? new AnimatorPool();
  pools.set(w, pool);
  pool.prune((id) => w.has(id));
  const actors = w.query('actor', 'animator') as unknown as (ActorComponents & Partial<ReactionComponents>)[];
  return [actors as (ActorComponents & Partial<ReactionComponents> & { id: number })[], pool] as const;
}

/**
 * The system `actors.anim`: each animator's step in id order, told its `states` and the controller's (`velocity`, `yaw`,
 * `air`, `dash`; a movement model's duck as the pose `crouch` where the states hold no pose), its breathing phase drawn
 * from `rng.entity(id, 'anim')` at its first step; emits its events. An actor's `reactions` step first, what their phase
 * tells the body laid over its `states`, then its `actions` (engine/sim/actorActions.ts), what their beat tells it laid
 * over those.
 */
function stepAnimators(w: World): void {
  const [actors, pool] = animated(w);
  for (const entity of actors) {
    const { id, actor, animator: data, reactions, motion } = entity;
    const rng = w.rng.entity(id, 'anim');
    if (!data.started) [data.state.clock, data.started] = [rng.next() * STEP.clockSpread, true]; // as a humanoid does
    const animator = pool.get(id, data, { rng, dt: w.dt });
    velocity.set(actor.vx, actor.vy, actor.vz);
    const reacted = reactions ? { ...data.states, ...stepReactions(reactions, w.dt) } : data.states;
    const told = { ...reacted, ...stepActorActions(w, id, entity) };
    const ducked = motion?.duck === 'ducking' || motion?.duck === 'ducked'; // the movement model's crouch
    const pose = told.pose ?? (ducked ? 'crouch' : undefined);
    animator.step({ ...told, pose, velocity, yaw: actor.yaw, air: !actor.grounded, dash: actor.dash > 0 }).save(data);
    for (const { type, ...event } of animator.events) w.emit(type, { id, ...event });
  }
}

/** The system `actors.pose`: the `preciseHits` animators posed where their feet are now, so their trail is sim data. */
function poseAnimators(w: World): void {
  const [actors, pool] = animated(w);
  for (const { id, actor, animator: data } of actors) {
    if (!data.preciseHits) continue;
    const animator = pool.get(id, data, { rng: w.rng.entity(id, 'anim'), dt: w.dt });
    animator.pose({ at: feet.set(actor.x, actor.y, actor.z), yaw: actor.yaw }).save(data);
  }
}

/** The system `actors.readback`: where each actor's feet are, after the world stepped. */
function readActors(w: World): void {
  const physics = physicsOf(w);
  for (const { actor } of w.query('actor') as unknown as ActorComponents[]) {
    const feet = feetOf(physics, actor.body, actor.character);
    [actor.x, actor.y, actor.z] = [feet.x, feet.y, feet.z];
  }
}
