/**
 * @file The engine's dev actions (PLAN.md WP 5.6, §5.6; doctrines: Agent-operable, Reproducible): the registry kind
 * `devAction`, a change a developer makes to a running scene between steps, recorded so that a replay makes it again,
 * and the engine's own five. An entry says what it changes:
 * - `run(w, args)`: the sim, inside `w.run`, through the session (`session.act(name, args)`: all or nothing, recorded
 *   as the change-point's `dev` with its `args`); a scene's own action of the same name wins (engine/sim/scene.ts);
 * - `settings(args)`: the settings it sets, by path, through the session's store (recorded as `set`, unless view).
 * Its `args` are a schema (engine/core/schema.ts): `devArgs` checks what it is given and fills the defaults before
 * anything changes. `__engine.actions` lists and runs them (engine/dev/actions.ts); `defineDevAction` adds a game's.
 *
 * The engine's, each on the player (the first actor whose `player` is set) unless given an `id`:
 * - `god { on, id }`: the entity holds the component `invulnerable`, so `damage` takes no hit on it
 *   (engine/sim/damage.ts); off, it lets go of it;
 * - `freeze { on }`: the setting `ai.frozen`, so the step skips the systems of the phase `ai` (engine/sim/world.ts),
 *   and the movers they drive stand: each actor that is not a player lets go of its AI's intents, and each living crowd
 *   agent (a component holding every field of `CROWD_AGENT_FIELDS`) stops across the ground;
 * - `spawn { prop, count, distance }`: `count` props of the entry `prop`, `distance` m from the player, 0.4 rad apart
 *   about the way it faces, each on the floor below (the physics' probe from 2 m over its feet, else at its feet);
 * - `travel { at, yaw, id }`: the actor put at `at` (its feet, m), facing `yaw` (its own when absent), at rest
 *   (`placeActor`, engine/sim/actors.ts);
 * - `timeScale { scale }`: the setting `time.scale`, the frame clock's speed (engine/core/time.ts): a view setting,
 *   so it never reaches the sim or a replay.
 *
 * Invariants: an action changes the sim only through `run`, inside the session's capture, so a throw leaves nothing
 * (settings included) and a replay's `dev` makes the same change; `settings` is a pure function of the args.
 * `defineDevActionKinds(registry)` declares the kind, the component `invulnerable`, the setting `ai.frozen` and the
 * engine's five on a registry (the shared one when this module loads; engine/sim/session.ts imports it, so every
 * session finds them). Carried from `my-3d2dge:src/emberdeep/62-developer.js:1-132` (the sandbox's switches, its
 * spawn in a fan before the hero, its travel) and `10-combat.js:106` (god mode: a hit takes nothing), mechanisms only.
 *
 * @example
 * import { registry } from '../core/registry';
 * listDevActions(registry).map((action) => action.id); // ['freeze', 'god', 'spawn', 'timeScale', 'travel']
 * devArgs(findDevAction(registry, 'freeze')!, undefined, 'freeze'); // { on: true }: the default filled
 * // in a scene with a player actor: session.act('travel', { at: [3, 0, 5] }) puts him there, and record() holds
 * // the change-point { dev: 'travel', args: { at: [3, 0, 5] } }
 * @see engine/dev/actions.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { checkField, isPlainObject, parse, show, type Schema } from '../core/schema';
import { defineSettings, type SettingValue } from '../core/settings';
import { CROWD_AGENT_FIELDS } from '../physics/crowd';
import { physicsOf } from '../physics/binding';
import { placeActor, type ActorComponent } from './actors';
import { spawnProp } from './props';
import { defineComponent } from './state';
import { AI_FROZEN, AI_FROZEN_SETTINGS } from './systems';
import type { World } from './world';

/** The codes this module raises, with their fixes. */
export const DEV_ACTION_CODES = defineCodes('sim', {
  SIM_NO_ACTOR: {
    template: '{what} has no actor to work on: {problem}',
    fix: 'give the id of an actor ({ id }), or spawn a player actor in the scene (spawnActor, player: true)',
    doc: "Raised by the engine's dev actions that work on an actor (engine/sim/devActions.ts: god, spawn, travel) and by the bot (engine/dev/bot.ts) when the id given is no live actor, or none is given and the scene has no player actor. Nothing has changed.",
  },
});

/** How a dev action is written: `defineDevAction(name, spec)`. */
export interface DevActionSpec {
  /** What it does, one line: `__engine.actions.list()` shows it. */
  help: string;
  /** Its arguments, name → schema field: checked, defaults filled, before it runs. */
  args?: Schema;
  /** What it changes in the sim, inside `w.run`, between steps: recorded as a dev action. */
  run?: (w: World, args: Record<string, unknown>) => void;
  /** The settings it sets, by path: through the session, recorded unless view. */
  settings?: (args: Record<string, unknown>) => Record<string, SettingValue>;
}

/** A registered dev action: its spec, plus `id` (its name) and `kind`. */
export type DevAction = Entry & Required<DevActionSpec>;

/** What an entry without a `run` changes in the sim: nothing, and it is not recorded as a dev action. */
const NO_RUN = (): void => {};
/** What an entry without `settings` sets: nothing. */
const NO_SETTINGS = (): Record<string, SettingValue> => ({});

/** The fields of a `devAction` entry. */
const DEV_ACTION_FIELDS = {
  help: { type: 'string', required: true, description: 'What it does, one line: __engine.actions.list() shows it.' },
  args: {
    type: 'object',
    default: {},
    description:
      'Its arguments, name → schema field (engine/core/schema.ts): checked, defaults filled, before it runs.',
  },
  run: {
    type: 'function',
    default: NO_RUN,
    description:
      '(w, args) => void: what it changes in the sim, inside w.run, between steps; recorded as a dev action.',
  },
  settings: {
    type: 'function',
    default: NO_SETTINGS,
    description: '(args) => { path: value }: the settings it sets through the session (recorded unless view).',
  },
} as const satisfies Schema;

/** A dev action's name: a word, as a replay's `dev` holds it. */
const NAME = /^[a-z][A-Za-z0-9]*$/;

/** The problems of a dev action entry beyond its fields. */
function problemsOf(entry: DevAction): string[] {
  const problems = NAME.test(entry.id) ? [] : [`the name ${show(entry.id)} must be a word in camelCase (timeScale)`];
  for (const [key, field] of Object.entries(entry.args)) problems.push(...checkField(field, `args.${key}`).map((p) => p.message)); // prettier-ignore
  if (!changesSim(entry) && entry.settings === NO_SETTINGS) problems.push('it changes nothing: give it run(w, args), settings(args) or both'); // prettier-ignore
  return problems;
}

/** The player's id, or (with `id`) that entity's, for the dev action `action`. Throws `SIM_NO_ACTOR`. */
function actorOf(w: World, action: string, id: unknown, actor = true): number {
  if (id !== undefined) {
    const e = w.get(id as number) as { actor?: ActorComponent } | undefined;
    if (!e || (actor && !e.actor)) throw codeError('SIM_NO_ACTOR', { what: `the dev action ${action}`, problem: `${show(id)} is no live ${actor ? 'actor' : 'entity'}` }); // prettier-ignore
    return id as number;
  }
  const players = w.query('actor') as unknown as { id: number; actor: ActorComponent }[];
  const player = players.find((e) => e.actor.player);
  if (!player) throw codeError('SIM_NO_ACTOR', { what: `the dev action ${action}`, problem: 'no id was given and the scene has no player actor' }); // prettier-ignore
  return player.id;
}

/** The actor a dev action names, with its component. */
const actorIn = (w: World, action: string, id: unknown) => {
  const at = actorOf(w, action, id);
  return { id: at, actor: (w.get(at) as unknown as { actor: ActorComponent }).actor };
};

/** Whether `value` is a crowd agent: a plain object holding every field of `CROWD_AGENT_FIELDS`. */
const isAgent = (value: unknown): value is { body: number; state: string } =>
  isPlainObject(value) && Object.keys(CROWD_AGENT_FIELDS).every((key) => key in value);

/** The `on` argument: whether to switch it on (true). */
const ON = { type: 'boolean', default: true, description: 'On (true) or off.' } as const;
/** The `id` argument: the entity to work on, the player when absent. */
const ID = { type: 'integer', minimum: 1, description: 'The entity to work on: the player when absent.' } as const;

/** The engine's dev actions (see the file comment). */
const ENGINE_ACTIONS: Readonly<Record<string, DevActionSpec>> = {
  god: {
    help: 'Makes an entity take no hit (damage): the player, or id.',
    args: { on: ON, id: ID },
    run(w, { on, id }) {
      const at = actorOf(w, 'god', id, false);
      const held = (w.get(at) as { invulnerable?: object }).invulnerable !== undefined;
      if (on && !held) w.add(at, 'invulnerable' as never);
      if (!on && held) w.remove(at, 'invulnerable' as never);
    },
  },
  freeze: {
    help: 'Freezes the AI: the step skips the phase ai, and the actors and crowd agents it drives stand.',
    args: { on: ON },
    settings: ({ on }) => ({ [AI_FROZEN]: on as boolean }),
    run(w, { on }) {
      if (!on) return;
      for (const { actor } of w.query('actor') as unknown as { actor: ActorComponent }[]) {
        if (!actor.player) [actor.intents, actor.held] = [{}, []];
      }
      const physics = physicsOrNull(w);
      if (!physics) return;
      for (const e of w.query()) {
        for (const value of Object.values(e)) {
          if (!isAgent(value) || value.state !== 'alive' || !physics.hasBody(value.body)) continue;
          physics.setBody(value.body, { velocity: [0, physics.readBody(value.body).velocity.y, 0] });
        }
      }
    },
  },
  spawn: {
    help: 'Spawns count props of an entry, distance m before the player, fanned 0.4 rad apart, on the floor.',
    args: {
      prop: { type: 'string', required: true, description: 'The prop entry to spawn (prop:crate).' },
      count: { type: 'integer', default: 1, minimum: 1, maximum: 100, description: 'How many.' },
      distance: { type: 'number', default: 2, minimum: 0, maximum: 100, unit: 'm', description: 'How far out.' },
    },
    run(w, { prop, count, distance }) {
      const { actor } = actorIn(w, 'spawn', undefined);
      const physics = physicsOf(w);
      const n = count as number;
      for (let i = 0; i < n; i++) {
        const yaw = actor.yaw + (i - (n - 1) / 2) * 0.4;
        const [x, z] = [actor.x + Math.sin(yaw) * (distance as number), actor.z + Math.cos(yaw) * (distance as number)];
        const y = physics.probe(x, z, { from: actor.y + 2 })?.y ?? actor.y;
        spawnProp(w, { prop: prop as string, at: [x, y, z], yaw: yaw + Math.PI });
      }
    },
  },
  travel: {
    help: 'Puts an actor at a point at rest: the player, or id.',
    args: {
      at: { type: 'array', required: true, items: { type: 'number' }, unit: 'm', description: 'Where its feet go: [x, y, z].' }, // prettier-ignore
      yaw: { type: 'number', unit: 'rad', description: 'Where it faces: its own way when absent.' },
      id: ID,
    },
    run(w, { at, yaw, id }) {
      const point = at as number[];
      if (point.length !== 3) throw codeError('SIM_BAD_ARGUMENT', { where: 'travel { at }', value: show(at), expected: 'a point [x, y, z] in metres' }); // prettier-ignore
      placeActor(w, actorIn(w, 'travel', id).id, point as [number, number, number], yaw as number | undefined);
    },
  },
  timeScale: {
    help: 'Runs the frame clock at scale times real time (a view setting: never recorded).',
    args: {
      scale: { type: 'number', required: true, minimum: 0, maximum: 16, description: 'The speed: 0.25 is slow motion.' }, // prettier-ignore
    },
    settings: ({ scale }) => ({ 'time.scale': scale as number }),
  },
};

/** The physics world of `w`, or null when its scene has none. */
function physicsOrNull(w: World) {
  try {
    return physicsOf(w);
  } catch {
    return null;
  }
}

/**
 * Declares on `registry` (once): the kind `devAction`, the component `invulnerable` (damage takes no hit on its holder),
 * the setting `ai.frozen` (engine/sim/systems.ts), and the engine's five actions (see the file comment).
 */
export function defineDevActionKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('devAction')) return;
  registry.defineKind('devAction', {
    description:
      'Dev actions: changes made to a running scene between steps (god mode, freeze, spawn, travel, time scale), recorded in replays.',
    fields: DEV_ACTION_FIELDS,
    defineWith: "defineDevAction('<name>', { help, args, run(w, args) })",
    check: (entry) => problemsOf(entry as unknown as DevAction),
  });
  if (!registry.kinds().includes('setting') || !registry.has('setting', AI_FROZEN)) defineSettings(AI_FROZEN_SETTINGS, registry); // prettier-ignore
  if (!registry.kinds().includes('component') || !registry.has('component', 'invulnerable')) {
    const description = 'Takes no hit: damage() leaves its holder untouched (god mode, the dev action god).';
    defineComponent('invulnerable', { description, fields: {} }, registry);
  }
  for (const [name, spec] of Object.entries(ENGINE_ACTIONS)) defineDevAction(name, spec, registry);
}

/** Registers a dev action on `registry` (the shared one by default). Throws `CORE_BAD_SPEC` naming each problem. */
export function defineDevAction(name: string, spec: DevActionSpec, registry: Registry = sharedRegistry): DevAction {
  defineDevActionKinds(registry);
  return registry.def('devAction', name, spec as unknown as Record<string, unknown>) as DevAction;
}

/** Whether `action` changes the sim (a `run` of its own): only then does a session record it as a dev action. */
export function changesSim(action: DevActionSpec): boolean {
  return action.run !== undefined && action.run !== NO_RUN;
}

/** The dev action `name` on `registry`, or undefined (the kind undeclared there too). */
export function findDevAction(registry: Registry, name: string): DevAction | undefined {
  if (!registry.kinds().includes('devAction') || !registry.has('devAction', name)) return undefined;
  return registry.get('devAction', name) as DevAction;
}

/** The dev actions on `registry`, by name. */
export function listDevActions(registry: Registry): DevAction[] {
  return registry.kinds().includes('devAction') ? (registry.list('devAction') as DevAction[]) : [];
}

/** `args` checked against `action`'s schema, defaults filled; throws `CORE_BAD_SPEC` naming each problem. */
export function devArgs(action: DevAction, args: unknown, where: string): Record<string, unknown> {
  return parse(action.args, args ?? {}, `the dev action ${where}`) as Record<string, unknown>;
}

defineDevActionKinds();
