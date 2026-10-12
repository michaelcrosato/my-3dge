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
 *
 * `measureFeel(character)` drives a character over a flat course in a world of its own through the feel meter
 * (engine/physics/feel.ts) and adds the reach (the highest ledge it jumps onto, WP 4.3's climb limit) and the dash's
 * distance; it runs under the sim's maths, so the numbers match in Node and Chromium. `__engine.feel(id?)`
 * (engine/app/feelMember.ts) reports it for an actor, the first player by default; `node x sim <scene> --feel` prints it.
 *
 * Invariants: systems are added once per world, on the first (animated) spawn; all an actor remembers is in its
 * components (the sim's animators are loaded from them). Despawning leaves the body; `removeActor` removes both.
 *
 * Carried from shardfall@fa2dab6 (`pavilion-lite/src/character.rs:179-399`: the order of a step, the events).
 * @example
 * import { createCharacter } from '../physics/character';
 * import { physicsOf } from '../physics/world';
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
import { withSimMath } from '../core/simMath';
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
import { createFeelMeter, updateFeelMeter, type FeelReport } from '../physics/feel';
import { createPhysics, physicsOf } from '../physics/world';
import type { Vec3Like } from '../physics/queries';
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

/** The components this module reads: `actor`, `animator`, and `oneWay` for one-way platforms. */
export type ActorComponents = { actor: ActorComponent; animator: AnimatorComponent; oneWay: { body: number } };

/**
 * Declares the components `actor`, `animator` and `oneWay`, `reactions` and `secondary` (engine/sim/reactions.ts) and
 * the setting `physics.characterGravity` on `registry`.
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
  if (!spec.anim) return w.spawn({ ...spec.components, actor });
  if (!w.systems.has('actors.anim')) {
    w.systems.add('actors.anim', stepAnimators, { phase: 'anim' });
    w.systems.add('actors.pose', poseAnimators, { phase: 'readback' });
  }
  const { build = 'build:chibi', weapon = 'none', preciseHits = false } = spec.anim;
  const animator = { build: typeof build === 'string' ? build : build.id, weapon, preciseHits };
  return w.spawn({ ...spec.components, actor, animator });
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

/** The system `actors`: every actor's tick, in id order. */
function moveActors(w: World, intents: Intents): void {
  const physics = physicsOf(w);
  const gravity = w.settings.get('physics.characterGravity') as number;
  const worldGravity = w.settings.get('physics.gravity') as number;
  const oneWay = new Set((w.query('oneWay') as unknown as ActorComponents[]).map((e) => e.oneWay.body));
  for (const e of w.query('actor') as unknown as (ActorComponents & { id: number })[]) {
    const { actor } = e;
    const wants = intentsOf(actor, intents);
    const input = {
      move: wants.move,
      jump: held(wants, 'jump'),
      jumpPressed: pressed(wants, 'jump'),
      dashPressed: pressed(wants, 'dash'),
    };
    const step = stepCharacter(physics, actor.body, actor.character, actor, input, {
      dt: w.dt,
      gravity,
      worldGravity,
      oneWay,
    });
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

/** How `measureFeel` runs: the sim's rate, and the gravity a character falls under unless its settings name one. */
export interface FeelOptions {
  hz?: number;
  gravity?: number;
}

/** A flat course: the character on a long floor, ticked with the meter reading every tick. */
function course(character: Character, dt: number, gravity: number, ledge?: number) {
  const physics = createPhysics();
  physics.addBody({
    type: 'fixed',
    colliders: [{ shape: { type: 'box', size: [400, 1, 40] }, position: [0, -0.5, 0] }],
  });
  const { radius } = character.capsule;
  if (ledge !== undefined && ledge > 0) {
    const face = radius + character.offset + 0.02;
    physics.addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [4, ledge, 40] }, position: [face + 2, ledge / 2, 0] }],
    });
  }
  const body = addCharacter(physics, character, [0, 0, 0]);
  const state = createCharacterState();
  const meter = createFeelMeter(dt);
  const settings = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
  let tick = 0;
  const step = (input: CharacterInput) => {
    stepCharacter(physics, body, character, state, input, { dt, gravity });
    physics.step({ dt, settings });
    const feet = feetOf(physics, body, character);
    const sample = {
      tick: ++tick,
      wish: input.move ?? [0, 0],
      velocity: [state.vx, state.vy, state.vz],
      feet: [feet.x, feet.y, feet.z],
      grounded: state.grounded,
    } as const;
    updateFeelMeter(meter, sample);
    return sample;
  };
  /** Steps with `input` until `done` (or `most` ticks). */
  const until = (input: CharacterInput, done: () => boolean, most = 600) => {
    for (let i = 0; i < most && !done(); i++) step(input);
  };
  return { physics, state, meter, step, until, feet: () => feetOf(physics, body, character) };
}

/** Measures a character's feel on the standard course (the file comment says what each number is). */
export function measureFeel(character: Character, options: FeelOptions = {}): FeelReport {
  return withSimMath(() => {
    const dt = 1 / (options.hz ?? 60);
    const gravity = character.characterGravity ?? options.gravity ?? 32;
    const east = { move: [1, 0] as const };
    const west = { move: [-1, 0] as const };
    const c = course(character, dt, gravity);
    const still = () => c.state.grounded && Math.hypot(c.state.vx, c.state.vz) < 0.01;
    const top = () => Math.hypot(c.state.vx, c.state.vz) >= c.meter.report.topSpeed * 0.999;
    c.until({}, () => c.state.grounded && c.state.air === 0, 30);
    c.until(east, () => c.meter.steady);
    c.until({}, still);
    c.until(east, top);
    c.until(west, () => c.meter.turn === null && c.meter.report.turnTime > 0, 300);
    c.until({}, still);
    c.step({ jump: true, jumpPressed: true });
    c.until({ jump: true }, () => c.state.grounded);
    const { apex, airTime } = c.meter.report;
    c.until({}, still);
    c.until(east, top);
    c.step({ ...east, jump: true, jumpPressed: true });
    c.until({ ...east, jump: true }, () => c.state.grounded);
    c.until({}, still);
    const before = c.feet();
    c.step({ dashPressed: true });
    c.until({}, () => c.state.dash === 0, 600);
    const after = c.feet();
    const dashDistance = character.feel.dash.speed > 0 ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
    c.physics.dispose();
    return { ...c.meter.report, apex, airTime, reach: reachOf(character, dt, gravity, apex), dashDistance };
  });
}

/** The highest ledge the character jumps up onto from standing at its foot, to the millimetre. */
function reachOf(character: Character, dt: number, gravity: number, apex: number): number {
  const onto = (ledge: number) => {
    const c = course(character, dt, gravity, ledge);
    c.until({}, () => c.state.grounded && c.state.air === 0, 30);
    c.step({ move: [1, 0], jump: true, jumpPressed: true });
    c.until({ move: [1, 0], jump: true }, () => c.state.grounded, 600);
    c.until({ move: [1, 0] }, () => false, 20);
    const sample = c.step({});
    c.physics.dispose();
    return sample.grounded && sample.feet[1] > ledge - 0.01;
  };
  let [low, high] = [0, apex + character.capsule.radius + 0.5];
  while (high - low > 0.001) {
    const mid = (low + high) / 2;
    if (onto(mid)) low = mid;
    else high = mid;
  }
  return Math.round(low * 1000) / 1000;
}
