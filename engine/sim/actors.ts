/**
 * @file Actors (PLAN.md WP 3.2; WP 3.7 adds the animator): entities that walk, jump and dash through the character
 * controller (engine/physics/character.ts). `spawnActor(w, { at, character, player })` adds a capsule body to the
 * scene's physics world and spawns an entity with the component `actor` (its body, settings, intents, feet and the
 * controller's state), so the sim hashes, captures and restores all of it.
 *
 * The step (shardfall's order): movers set their velocities (`intents`, `ai`), the system `actors` moves every actor in
 * id order (`anim`), the world steps (`physics`), and `actors.readback` copies the feet into `x`, `y`, `z`
 * (`readback`). A player actor reads the step's intents: `move`, `jump` (held, pressed) and `dash` (pressed); any other
 * the intents its AI writes into `actor.intents`, its presses taken from the edges of `b`. Events: `jump` `{ id }`,
 * `land` `{ id, speed }`, `dash` `{ id }`. Gravity: `physics.characterGravity` unless the settings name one; the weight
 * on dynamic floors uses `physics.gravity`. Entities with the component `oneWay` make their body a one-way platform.
 * WP 3.7: `anim` adds the component `animator`, stepped by `actors.anim` after `actors` (its `reactions` first, WP
 * 7.8) and, with `preciseHits`, posed by `actors.pose` after `actors.readback`. Event: `footstep` `{ id, side, speed }`.
 * WP 8.9: `body` adds the component `puppet` (the body drawn) and `clips` the clip layer (engine/sim/actorClips.ts).
 *
 * WP 13.3: an actor whose character has a movement model (engine/physics/movement/) also holds the component
 * `motion`, the model's state, and reads `sprint` (held, pressed), `walk` and `crouch` (held), its view from `look`
 * and what it faces from `aim` (the point's direction), else `look`. Its feel course is engine/sim/feelCourse.ts.
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
import { held, normalizeIntents, pressed, type Intents } from '../input/intents';
import {
  addCharacter,
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
import { createMotionState, MOTION_FIELDS, type MotionState } from '../physics/movement/model';
import { physicsOf } from '../physics/binding';
import type { Vec3Like } from '../physics/queries';
import { clipsFor, defineClipKinds, type ClipsSpec } from './actorClips';
import { defineReactionKinds, stepReactions, type ReactionComponents } from './reactions';
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
 * Declares the components `actor`, `animator`, `puppet`, `clips` (engine/sim/actorClips.ts), `oneWay`, `reactions` and
 * `secondary` (engine/sim/reactions.ts) and the setting `physics.characterGravity` on `registry`.
 */
export function defineActorKinds(registry: Registry = sharedRegistry): void {
  defineReactionKinds(registry);
  if (!registry.kinds().includes('setting') || !registry.has('setting', 'physics.characterGravity')) {
    defineSettings(CHARACTER_SETTINGS, registry);
  }
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
  /**
   * Further components it spawns with, by name (its `reactions`, its `secondary`: engine/sim/reactions.ts), so they
   * are there from its first step, and a page's first warm-up builds what they draw.
   */
  components?: Readonly<Record<string, object>>;
}

/** Spawns an actor in a scene with a physics world: its body, and an entity with the component `actor`. Returns the id. */
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
  const motion = spec.character.movement ? { motion: createMotionState() } : {};
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

/** Removes an actor and its body. */
export function removeActor<C extends object>(world: World<C>, id: number): void {
  const w = world as unknown as World;
  const actor = (w.get(id) as Partial<ActorComponents> | undefined)?.actor;
  if (!actor)
    throw codeError('SIM_BAD_ARGUMENT', { where: 'removeActor(w, id)', value: String(id), expected: 'an actor’s id' });
  physicsOf(w).removeBody(actor.body);
  w.despawn(id);
}

/** The intents an actor acts on this step: the step's for a player, else its AI's (with presses from `b`'s edges). */
function intentsOf(actor: ActorComponent, intents: Intents): Intents {
  if (actor.player) return intents;
  const own = normalizeIntents(actor.intents, normalizeIntents({ b: actor.held }));
  const { p: _pressed, ...rest } = actor.intents;
  [actor.held, actor.intents] = [[...(own.b ?? [])], rest];
  return own;
}

/** The shooter model's input from `wants`: the sprint, walk and crouch buttons, the view and what it faces. */
function motionInput(actor: ActorComponent, wants: Intents): CharacterInput {
  const [aimX, , aimZ] = wants.aim ?? [];
  const aimed = aimX !== undefined && Math.hypot(aimX - actor.x, aimZ! - actor.z) > 0.05;
  const face = aimed ? Math.atan2(aimX - actor.x, aimZ! - actor.z) : wants.look?.[0];
  return {
    sprint: held(wants, 'sprint'),
    sprintPressed: pressed(wants, 'sprint'),
    walk: held(wants, 'walk'),
    crouch: held(wants, 'crouch'),
    ...(wants.look ? { view: wants.look[0] } : {}),
    ...(face !== undefined ? { face } : {}),
  };
}

/** The system `actors`: every actor's tick, in id order. */
function moveActors(w: World, intents: Intents): void {
  const physics = physicsOf(w);
  const gravity = w.settings.get('physics.characterGravity') as number;
  const worldGravity = w.settings.get('physics.gravity') as number;
  const oneWay = new Set((w.query('oneWay') as unknown as ActorComponents[]).map((e) => e.oneWay.body));
  for (const e of w.query('actor') as unknown as (ActorComponents & { id: number })[]) {
    const { actor, motion } = e;
    const wants = intentsOf(actor, intents);
    const input: CharacterInput = {
      move: wants.move,
      jump: held(wants, 'jump'),
      jumpPressed: pressed(wants, 'jump'),
      dashPressed: pressed(wants, 'dash'),
      ...(motion ? motionInput(actor, wants) : {}),
    };
    const step = stepCharacter(physics, actor.body, actor.character, actor, input, { dt: w.dt, gravity, worldGravity, oneWay }, motion); // prettier-ignore
    if (step.jumped) w.emit('jump', { id: e.id });
    if (step.landed) w.emit('land', { id: e.id, speed: step.landed });
    if (step.dashed) w.emit('dash', { id: e.id });
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
 * `air`, `dash`), its breathing phase drawn from `rng.entity(id, 'anim')` at its first step; emits its events. An
 * actor's `reactions` step first, what their phase tells the body laid over its `states`.
 */
function stepAnimators(w: World): void {
  const [actors, pool] = animated(w);
  for (const { id, actor, animator: data, reactions } of actors) {
    const rng = w.rng.entity(id, 'anim');
    if (!data.started) [data.state.clock, data.started] = [rng.next() * STEP.clockSpread, true]; // as a humanoid does
    const animator = pool.get(id, data, { rng, dt: w.dt });
    velocity.set(actor.vx, actor.vy, actor.vz);
    const told = reactions ? { ...data.states, ...stepReactions(reactions, w.dt) } : data.states;
    animator.step({ ...told, velocity, yaw: actor.yaw, air: !actor.grounded, dash: actor.dash > 0 }).save(data);
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
