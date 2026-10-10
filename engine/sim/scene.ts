/**
 * @file Scenes and sessions, sim-side (PLAN.md §6.9, §9.0, §8.4, WP 1.5; doctrines: Reproducible, Agent-operable):
 * `defineScene(id, { level?, settings, setup, step })` registers a scene as an entry of the registry kind `scene`;
 * `startScene` makes its world (a settings store with the scene's settings over the defaults and the caller's over
 * those, a world seeded from the seed, the scene's `step` as the system `scene`, then its `setup`); `createSession`
 * starts one that records its inputs from step 0, the recorder of PLAN.md §8.4. The kernel fixture, the box's scenes
 * and `createHeadless` (WP 1.6) all start scenes here, so no scene imports `app/`; engine/sim/replay.ts plays them.
 *
 * A scene is game code: `setup(w)` spawns, adds systems and listeners (inside `w.run`, so under the fdlibm swap);
 * `step(w, intents)` runs every sim step as the system `scene`, first in the phase `intents`, ahead of the systems
 * setup adds there; `actions` are its dev actions, `(w, args) => void` by name (WP 5.6 adds the engine's own).
 * `level` names the level it loads (WP 2.2 compiles it).
 *
 * A session's `step(intents)` normalizes the intents against the step before and logs what changed, `set` logs a
 * non-view setting, `act` runs a dev action inside `w.run` and logs it with its plain-data args, each at the step it
 * happens (change-points merged in play order: set, then dev, then intents); `record()` returns the replay from step
 * 0, no capture needed. Step and set through the session, never the world or the store, or the recording misses it
 * (`SIM_OFF_RECORD` for steps).
 *
 * Invariants: a scene's `settings` are checked against the settings schema when it is defined (`CORE_BAD_SPEC`
 * naming each problem), so declare its settings before it; they apply for the run's lifetime, as an override layer
 * (engine/core/settings.ts), and the caller's settings (`--set`, a replay's `settings`) go on top. Each start makes
 * a new settings store and world, so runs share nothing but the registry. A missing scene id is `CORE_NO_ENTRY`,
 * naming the closest ids.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const reg = createRegistry();
 * let made = 0;
 * defineScene('demo', { description: 'Counts its steps.', setup: (w) => w.spawn(), step: () => made++ }, reg);
 * const { world } = startScene('demo', { seed: 3, registry: reg });
 * world.step({});
 * [world.count, made]; // [1, 1]
 * const live = createSession('demo', { registry: reg });
 * live.step({ move: [0, 1] });
 * live.step({ move: [0, 1], b: ['jump'] });
 * live.record().inputs; // [[0, { move: [0, 1] }], [1, { b: ['jump'] }]]
 * @see engine/sim/scene.test.ts
 */
import type { EventMap } from '../core/events';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { codeError, defineCodes, didYouMean, type Log } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { isPlainObject, show, type Schema } from '../core/schema';
import { createSettings, type SettingChange, type Settings, type SettingValue } from '../core/settings';
import { diffIntents, INTENT_KEYS, NO_INTENTS, normalizeIntents, type Intents } from '../input/intents';
import type { InputChange, InputEntry, Replay } from './replay';
import type { AnyComponents, PhysicsHook } from './state';
import { createWorld, type World } from './world';

/** The codes this module raises, with their fixes. */
export const SCENE_CODES = defineCodes('sim', {
  SIM_NO_ACTION: {
    template: 'the scene {scene} has no dev action {name}{suggestion}',
    fix: "add it to the scene: defineScene('{scene}', { actions: { {name}(w, args) { … } } }), or call one it has",
  },
  SIM_OFF_RECORD: {
    template: 'the world took {count} steps outside its session, so the recording misses their intents',
    fix: 'step a recorded scene through session.step(intents), never world.step()',
  },
});

/** A dev action of a scene: runs between steps inside `w.run`, with plain-data `args`; recorded in replays. */
export type SceneAction<W> = (w: W, args: unknown) => void;

/** How a scene is written: `defineScene(id, spec)`. */
export interface SceneSpec<C extends object = AnyComponents, E extends EventMap = EventMap> {
  /** What the scene shows or tests, in plain sentences. */
  description?: string;
  /** The level it loads (`level:<name>`), when it has one (WP 2.2). */
  level?: string;
  /** Setting values for its lifetime, path → value (schema-checked). */
  settings?: Readonly<Record<string, unknown>>;
  /** Runs once when it starts: spawns, systems, listeners. */
  setup: (w: World<C, E>) => void;
  /** Runs every step, first in the phase `intents`: reads the step's intents and components, writes components. */
  step?: (w: World<C, E>, intents: Intents) => void;
  /** Its dev actions, by name. */
  actions?: Readonly<Record<string, SceneAction<World<C, E>>>>;
}

/** A defined scene: its spec with defaults filled, plus `id` and `kind`. */
export type Scene<C extends object = AnyComponents, E extends EventMap = EventMap> = Readonly<
  Required<Omit<SceneSpec<C, E>, 'level'>> & Pick<SceneSpec<C, E>, 'level'>
> & { readonly id: string; readonly kind: 'scene' };

/** The fields of a `scene` entry. */
const SCENE_FIELDS = {
  description: { type: 'string', default: '', description: 'What the scene shows or tests, in plain sentences.' },
  level: { type: 'string', description: 'The level it loads (level:<name>, compiled by WP 2.2), when it has one.' },
  settings: {
    type: 'object',
    default: {},
    description: "Setting values for the scene's lifetime, path → value, checked against the settings schema.",
  },
  setup: {
    type: 'function',
    required: true,
    description: 'Runs once when the scene starts, inside w.run: spawns, systems, listeners. (w) => void.',
  },
  step: {
    type: 'function',
    default: () => {},
    description: "Runs every sim step as the system 'scene', first in the phase intents. (w, intents) => void.",
  },
  actions: {
    type: 'object',
    default: {},
    description: 'Dev actions by name, (w, args) => void: run between steps by a session and recorded in replays.',
  },
} as const satisfies Schema;

/** The problems of a scene entry beyond its fields: settings the schema refuses, actions that are not functions. */
function sceneProblems(entry: Entry, registry: Registry): string[] {
  const problems: string[] = [];
  const actions = entry.actions as Record<string, unknown>;
  for (const [name, action] of Object.entries(actions)) {
    if (typeof action !== 'function') problems.push(`actions.${name} is not a function (w, args) => void`);
  }
  try {
    createSettings({ registry }).override(entry.settings as Record<string, unknown>, `scene ${entry.id}`);
  } catch (error) {
    problems.push(`settings: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems;
}

/** Declares the kind `scene` on `registry` unless it has it. */
function sceneKind(registry: Registry): void {
  if (registry.kinds().includes('scene')) return;
  registry.defineKind('scene', {
    description:
      'Scenes: a level, settings, a setup and a step, sim-side, so x sim, x replay and createHeadless run them in Node.',
    fields: SCENE_FIELDS,
    defineWith: "defineScene('<id>', { setup(w) { … }, step(w, intents) { … } })",
    check: (entry) => sceneProblems(entry, registry),
  });
}
sceneKind(sharedRegistry);

/**
 * Registers a scene on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` for a bad field
 * or a setting the schema refuses, `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineScene<C extends object = AnyComponents, E extends EventMap = EventMap>(
  id: string,
  spec: SceneSpec<C, E>,
  registry: Registry = sharedRegistry,
): Scene<C, E> {
  sceneKind(registry);
  return registry.def('scene', id, spec as unknown as Record<string, unknown>) as unknown as Scene<C, E>;
}

/** The scene `id` on `registry` (the shared one by default). Throws `CORE_NO_ENTRY` naming the closest ids. */
export function getScene(id: string, registry: Registry = sharedRegistry): Scene {
  sceneKind(registry);
  return registry.get('scene', id) as unknown as Scene;
}

/** Whether `value` is a defined scene (an entry of kind `scene`), as a module exports it. */
export function isScene(value: unknown): value is Scene {
  return isPlainObject(value) && value.kind === 'scene' && typeof value.id === 'string';
}

/** How a scene starts. */
export interface SceneOptions {
  /** The seed every sim RNG stream derives from (1). */
  seed?: number;
  /** Setting values over the scene's, path → value (`--set`, a replay's `settings`). */
  settings?: Readonly<Record<string, unknown>>;
  /** Where the scene, its components and its settings are declared (the shared registry). */
  registry?: Registry;
  /** Where failing event listeners are recorded (the shared log). */
  log?: Log;
  /** The physics hook (WP 3.1). */
  physics?: PhysicsHook;
}

/** A started scene: the scene, its world and its settings store. */
export interface SceneRun<C extends object = AnyComponents, E extends EventMap = EventMap> {
  readonly scene: Scene<C, E>;
  readonly world: World<C, E>;
  /** The whole store, view settings included (presentation reads those); the world reads its sim view. */
  readonly settings: Settings;
}

/**
 * Starts a scene (an id on the registry, or a scene): a new settings store with the scene's settings and then
 * `options.settings` over the defaults, a world seeded with `options.seed`, the scene's `step` as the system
 * `scene`, then its `setup`. Throws `CORE_NO_ENTRY` for an unknown id and `CORE_BAD_SETTING` for a bad setting.
 */
export function startScene<C extends object = AnyComponents, E extends EventMap = EventMap>(
  scene: string | Scene<C, E>,
  options: SceneOptions = {},
): SceneRun<C, E> {
  const registry = options.registry ?? sharedRegistry;
  const entry = (typeof scene === 'string' ? getScene(scene, registry) : scene) as Scene<C, E>;
  const settings = createSettings({ registry });
  settings.override(entry.settings, `scene ${entry.id}`);
  if (options.settings && Object.keys(options.settings).length) settings.override(options.settings, 'run');
  const world = createWorld<C, E>({
    seed: options.seed ?? 1,
    registry,
    settings,
    log: options.log,
    physics: options.physics,
  });
  world.systems.add('scene', (w, intents) => entry.step(w, intents as Intents), { phase: 'intents' });
  world.run((w) => entry.setup(w));
  return { scene: entry, world, settings };
}

/** A started scene that records its inputs from step 0, so `record()` returns it as a replay (see the file comment). */
export interface Session<C extends object = AnyComponents, E extends EventMap = EventMap> extends SceneRun<C, E> {
  /** Steps taken through the session. */
  readonly steps: number;
  /** The intents the last step got. */
  readonly intents: Intents;
  /** The change-points so far. */
  readonly inputs: readonly InputEntry[];
  /** One step with these intents (normalized against the step before); returns them. Throws `INPUT_BAD_INTENTS`. */
  step(intents?: unknown): Intents;
  /** Sets a setting between steps; a non-view change is recorded at this step. */
  set(path: string, value: unknown): SettingChange;
  /** Runs the scene's dev action `name` between steps, then records it. Throws `SIM_NO_ACTION`. */
  act(name: string, args?: unknown): void;
  /** The replay of everything so far, from step 0, without hashes. Throws `SIM_OFF_RECORD`. */
  record(): Replay;
}

/** Starts a scene as a recorded session: `startScene`, plus the recording. */
export function createSession<C extends object = AnyComponents, E extends EventMap = EventMap>(
  scene: Parameters<typeof startScene<C, E>>[0],
  options: SceneOptions = {},
): Session<C, E> {
  const run = startScene<C, E>(scene, options);
  const { world, settings } = run;
  const registry = options.registry ?? sharedRegistry;
  const viewOf = (path: string) => registry.get('setting', path).view === true;
  const start = Object.fromEntries(Object.entries(options.settings ?? {}).filter(([path]) => !viewOf(path)));
  const inputs: InputEntry[] = [];
  let last: Intents = NO_INTENTS;
  let steps = 0;
  /** The change-point to write a `what` into at this step: the last one when the play order allows, else a new one. */
  const pointFor = (what: 'set' | 'dev' | 'intents'): InputChange => {
    const tail = inputs[inputs.length - 1];
    if (tail && tail[0] === world.tick) {
      const change = tail[1];
      const intents = Object.keys(change).some((key) => Object.hasOwn(INTENT_KEYS, key) || key.includes(':'));
      if (!intents && (what === 'intents' || change.dev === undefined)) return change;
    }
    const change: InputChange = {};
    inputs.push([world.tick, change]);
    return change;
  };
  const session: Session<C, E> = {
    ...run,
    get steps() {
      return steps;
    },
    get intents() {
      return last;
    },
    inputs,
    step(raw = {}) {
      const next = normalizeIntents(raw, last);
      const change = diffIntents(last, next);
      if (Object.keys(change).length) Object.assign(pointFor('intents'), change);
      world.step(next);
      last = next;
      steps++;
      return next;
    },
    set(path, value) {
      const change = settings.set(path, value);
      if (!change.view) {
        const point = pointFor('set');
        point.set = { ...point.set, [path]: deserialize(serialize(change.value as Canonical)) as SettingValue };
      }
      return change;
    },
    act(name, args) {
      const actions = run.scene.actions as Record<string, (w: unknown, a: unknown) => void>;
      const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
      if (typeof action !== 'function') {
        const suggestion = didYouMean(name, Object.keys(run.scene.actions));
        throw codeError('SIM_NO_ACTION', { scene: run.scene.id, name: show(name), suggestion });
      }
      const text = args === undefined ? undefined : serialize(args as Canonical);
      world.run((w) => action(w, text === undefined ? undefined : deserialize(text)));
      const point = pointFor('dev');
      point.dev = name;
      if (text !== undefined) point.args = deserialize(text);
    },
    record() {
      if (world.tick !== steps) throw codeError('SIM_OFF_RECORD', { count: world.tick - steps });
      return {
        format: 'my3dge-replay/1', // REPLAY_FORMAT, checked by its type (importing it would make the modules circular)
        scene: run.scene.id,
        settings: deserialize(serialize(start as Canonical)) as Record<string, SettingValue>,
        seed: world.seed,
        hz: world.hz,
        steps,
        inputs: deserialize(serialize(inputs as unknown as Canonical)) as unknown as InputEntry[],
        hashes: {},
      };
    },
  };
  return session;
}
