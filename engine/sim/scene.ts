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
 * A session logs, each at the step it happens (merged in play order: set, then dev, then intents), what its intents
 * change, every non-view setting change (through `set` or its own store, `session.settings`), and its dev actions
 * (`act`, all or nothing: one that throws is rolled back). `record()` returns the replay from step 0, no capture
 * needed; change-points no step has followed yet wait for it. Step, capture and restore through the session, never
 * the world (`SIM_OFF_RECORD`): `session.restore` takes the recording back to the capture's step with the sim, so
 * `record()` replays the run as it stands; it refuses a capture it did not take (`SIM_FOREIGN_CAPTURE`) or one
 * changed since (`SIM_EDITED_CAPTURE`). Seeds are whole numbers from 0 (`SIM_BAD_SEED`). `Session` says the rest.
 *
 * Invariants: a scene's `settings` are checked against the settings schema when it is defined (`CORE_BAD_SPEC`
 * naming each problem), so declare its settings before it; they apply for the run's lifetime, as an override layer
 * (engine/core/settings.ts), and the caller's settings (`--set`, a replay's `settings`) go on top. Each start makes
 * a new settings store and world, so runs share nothing but the registry. A missing scene id is `CORE_NO_ENTRY`.
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
import { deserialize, hashValue, serialize, type Canonical } from '../core/hash';
import { codeError, defineCodes, didYouMean, type Log } from '../core/log';
import { registry as sharedRegistry, sameValue, type Entry, type Registry } from '../core/registry';
import { isPlainObject, show, type Schema } from '../core/schema';
import { createSettings, type SettingChange, type Settings, type SettingValue } from '../core/settings';
import { diffIntents, INTENT_KEYS, NO_INTENTS, normalizeIntents, type Intents } from '../input/intents';
import type { WorldCapture } from './capture';
import type { InputChange, InputEntry, Replay } from './replay';
import type { AnyComponents, PhysicsHook } from './state';
import { createWorld, type World } from './world';

/** The codes this module raises, with their fixes. */
export const SCENE_CODES = defineCodes('sim', {
  SIM_NO_ACTION: {
    template: 'the scene {scene} has no dev action {name} ({suggestion})',
    fix: "add it to the scene: defineScene('{scene}', { actions: { {name}(w, args) { … } } }), or call one it has",
  },
  SIM_OFF_RECORD: {
    template: 'the world took {count} steps outside its session, so the recording misses their intents',
    fix: 'step a recorded scene through session.step(intents), never world.step(); capture and restore it through session.capture() and session.restore(capture), never the world',
  },
  SIM_FOREIGN_CAPTURE: {
    template: 'restore() was given a capture the session of {scene} did not take',
    fix: "restore what this session's capture() (__engine.capture()) returned, the object itself: the session knows where its recording stood then; the world's own captures, another session's and copies have no place in it, so reach other state by starting the scene again (__engine.seed(n)) or playing a replay",
  },
  SIM_EDITED_CAPTURE: {
    template: 'the capture the session of {scene} took at step {step} was changed since (it hashes {now}, not {then})',
    fix: 'restore it unchanged, then make the change through the session so record() replays it: session.set(path, value) (__engine.set) for a setting, a dev action (session.act(name, args)) for components',
  },
  SIM_BAD_SEED: {
    template: '{where} got the seed {value}, which a replay cannot hold',
    fix: 'pass a whole number, 0 or more (x sim --seed 3, __engine.seed(3)): record() writes the seed into the replay',
  },
});

/** Returns `seed` (1 when absent); throws `SIM_BAD_SEED` naming `where` unless it is a whole number from 0. */
export function checkSeed(seed: unknown, where: string): number {
  if (seed === undefined) return 1;
  if (Number.isInteger(seed) && (seed as number) >= 0) return seed as number;
  throw codeError('SIM_BAD_SEED', { where, value: show(seed) });
}

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
  world.systems.add('scene', (w, intents) => entry.step(w, intents), { phase: 'intents' });
  world.run((w) => entry.setup(w));
  return { scene: entry, world, settings };
}

/**
 * A started scene that records its inputs from step 0, so `record()` returns it as a replay. `step(intents)`
 * normalizes the intents against the step before and logs what changed. Setting changes through the store
 * (`settings`: set, setText, load, fromUrl, reset, override) are logged as `set` points: before each `set`, `act` and
 * `step`, the session compares the store's non-view values with the last ones it saw. `act` captures the world, runs
 * the action inside `w.run` and, if it throws, restores the capture and logs nothing; else it logs the action with its
 * plain-data args.
 */
export interface Session<C extends object = AnyComponents, E extends EventMap = EventMap> extends SceneRun<C, E> {
  /** Steps taken through the session. */
  readonly steps: number;
  /** The intents the last step got. */
  readonly intents: Intents;
  /** The change-points so far. */
  readonly inputs: readonly InputEntry[];
  /** One step with these intents (normalized against the step before); returns them. Throws `INPUT_BAD_INTENTS`. */
  step(intents?: unknown): Intents;
  /** Sets a setting between steps; a non-view change is recorded at this step (as is any change through `settings`). */
  set(path: string, value: unknown): SettingChange;
  /** Runs the scene's dev action `name` between steps, all or nothing, then records it. Throws `SIM_NO_ACTION`. */
  act(name: string, args?: unknown): void;
  /** The whole sim, copied (`world.capture()`), with where the recording stands: what `restore` takes. */
  capture(): WorldCapture;
  /**
   * Puts back a capture this session took, unchanged, with its recording (change-points, steps, intents) as it stood
   * then. Throws `SIM_FOREIGN_CAPTURE` or `SIM_EDITED_CAPTURE` (or the world's `SIM_BAD_CAPTURE`), changing nothing.
   */
  restore(capture: WorldCapture): void;
  /** The replay of every step so far, from step 0, without hashes. Throws `SIM_OFF_RECORD`. */
  record(): Replay;
}

/** Where a session's recording stood at a capture (change-points as text: the last may change since) and its digest. */
type Mark = { steps: number; inputs: string; last: Intents; seen: Record<string, SettingValue>; hash: string };

/** The digest of a capture's data, or a note when it no longer is plain data. */
function digest(capture: WorldCapture): string {
  try {
    return hashValue(capture as unknown as Canonical);
  } catch {
    return 'no hash (no longer plain data)';
  }
}

/** Starts a scene as a recorded session: `startScene`, plus the recording. */
export function createSession<C extends object = AnyComponents, E extends EventMap = EventMap>(
  scene: Parameters<typeof startScene<C, E>>[0],
  options: SceneOptions = {},
): Session<C, E> {
  const run = startScene<C, E>(scene, { ...options, seed: checkSeed(options.seed, 'createSession(scene, { seed })') });
  const { world, settings } = run;
  const registry = options.registry ?? sharedRegistry;
  const viewOf = (path: string) => registry.get('setting', path).view === true;
  const start = Object.fromEntries(Object.entries(options.settings ?? {}).filter(([path]) => !viewOf(path)));
  const inputs: InputEntry[] = [];
  let last: Intents = NO_INTENTS;
  let steps = 0;
  let seen = settings.sim.values();
  const marks = new WeakMap<WorldCapture, Mark>();
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
  /** Logs every non-view value the store holds that differs from the last ones seen, as a `set` at this step. */
  const sync = () => {
    const now = settings.sim.values();
    for (const [path, value] of Object.entries(now)) {
      const before = Object.hasOwn(seen, path) ? seen[path] : registry.get('setting', path).default;
      if (sameValue(before, value)) continue;
      const point = pointFor('set');
      point.set = { ...point.set, [path]: deserialize(serialize(value as Canonical)) as SettingValue };
    }
    seen = now;
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
      sync();
      const change = diffIntents(last, next);
      if (Object.keys(change).length) Object.assign(pointFor('intents'), change);
      world.step(next);
      last = next;
      steps++;
      return next;
    },
    set(path, value) {
      sync();
      const change = settings.set(path, value);
      sync();
      return change;
    },
    act(name, args) {
      const actions = run.scene.actions as Record<string, (w: unknown, a: unknown) => void>;
      const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
      if (typeof action !== 'function') {
        const names = Object.keys(actions).sort();
        const near = didYouMean(name, names).trim().slice(1, -1);
        const suggestion = near || (names.length ? `its actions: ${names.map(show).join(', ')}` : 'it has none');
        throw codeError('SIM_NO_ACTION', { scene: run.scene.id, name: show(name), suggestion });
      }
      const text = args === undefined ? undefined : serialize(args as Canonical);
      sync();
      const before = world.capture();
      try {
        world.run((w) => action(w, text === undefined ? undefined : deserialize(text)));
      } catch (error) {
        world.restore(before);
        throw error;
      }
      const point = pointFor('dev');
      point.dev = name;
      if (text !== undefined) point.args = deserialize(text);
    },
    capture() {
      sync();
      const capture = world.capture();
      const text = serialize(inputs as unknown as Canonical);
      marks.set(capture, { steps, inputs: text, last, seen, hash: digest(capture) });
      return capture;
    },
    restore(capture) {
      const mark = marks.get(capture);
      if (!mark) throw codeError('SIM_FOREIGN_CAPTURE', { scene: run.scene.id });
      const now = digest(capture);
      if (now !== mark.hash) {
        throw codeError('SIM_EDITED_CAPTURE', { scene: run.scene.id, step: mark.steps, now, then: mark.hash });
      }
      world.restore(capture);
      inputs.length = 0;
      for (const entry of deserialize(mark.inputs) as unknown as InputEntry[]) inputs.push(entry);
      ({ steps, last, seen } = mark);
    },
    record() {
      if (world.tick !== steps) throw codeError('SIM_OFF_RECORD', { count: world.tick - steps });
      const taken = inputs.filter(([at]) => at < steps);
      return {
        format: 'my3dge-replay/1', // REPLAY_FORMAT, checked by its type (importing it would make the modules circular)
        scene: run.scene.id,
        settings: deserialize(serialize(start as Canonical)) as Record<string, SettingValue>,
        seed: world.seed,
        hz: world.hz,
        steps,
        inputs: deserialize(serialize(taken as unknown as Canonical)) as unknown as InputEntry[],
        hashes: {},
      };
    },
  };
  return session;
}
