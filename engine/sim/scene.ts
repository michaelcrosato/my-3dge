/**
 * @file Scenes, sim-side (PLAN.md §6.9, §9.0, WP 1.5; doctrines: Reproducible, Agent-operable):
 * `defineScene(id, { level?, settings, setup, step })` registers a scene as an entry of the registry kind `scene`;
 * `startScene` makes its world (a settings store with the scene's settings over the defaults and the caller's over
 * those, a world seeded from the seed, the scene's `step` as the system `scene`, then its `setup`). A session
 * (engine/sim/session.ts `createSession`) starts one that records its inputs. The kernel fixture, the box's scenes and
 * `createHeadless` (WP 1.6) all start scenes here, so no scene imports `app/`; engine/sim/replay.ts plays them.
 *
 * A scene is game code: `setup(w)` spawns, adds systems and listeners (inside `w.run`, so under the fdlibm swap);
 * `step(w, intents)` runs every sim step as the system `scene`, first in the phase `intents`, ahead of the systems
 * setup adds there; `actions` are its dev actions, `(w, args) => void` by name (WP 5.6 adds the engine's own).
 * `level` names the level it loads (WP 2.2 compiles it); `physics: true` gives it a physics world (physicsOf, WP 3.1).
 * Seeds are whole numbers from 0 (`checkSeed`, `SIM_BAD_SEED`).
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
 * @see engine/sim/scene.test.ts
 */
import type { EventMap } from '../core/events';
import { codeError, defineCodes, type Log } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { isPlainObject, show, type Schema } from '../core/schema';
import { createSettings, type Settings } from '../core/settings';
import type { Intents } from '../input/intents';
import { attachPhysics, scenePhysics } from '../physics/binding';
import type { AnyComponents, PhysicsHook } from './state';
import { createWorld, type SystemProbe, type World } from './world';

/** The codes this module raises, with their fixes. */
export const SCENE_CODES = defineCodes('sim', {
  SIM_BAD_SEED: {
    template: '{where} got the seed {value}, which a replay cannot hold',
    fix: 'pass a whole number, 0 or more (x sim --seed 3, __engine.seed(3)): record() writes the seed into the replay',
  },
});

/** Returns `seed` (1 when absent; -0 as 0); throws `SIM_BAD_SEED` naming `where` unless it is a whole number from 0. */
export function checkSeed(seed: unknown, where: string): number {
  if (seed === undefined) return 1;
  if (Number.isInteger(seed) && (seed as number) >= 0) return (seed as number) + 0; // -0 + 0 is 0
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
  /** Whether it has a physics world (WP 3.1): `physicsOf(w)` reaches it, the system `physics` steps it. */
  physics?: boolean;
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
  physics: { type: 'boolean', default: false, description: 'Whether it has a physics world: physicsOf(w) reaches it.' },
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
  /** The world's system probe (engine/sim/world.ts; the stats meter, WP 5.5). */
  probe?: SystemProbe;
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
  const physics = options.physics ? undefined : scenePhysics(entry.physics, registry);
  const settings = createSettings({ registry });
  settings.override(entry.settings, `scene ${entry.id}`);
  if (options.settings && Object.keys(options.settings).length) settings.override(options.settings, 'run');
  const world = createWorld<C, E>({
    seed: options.seed ?? 1,
    registry,
    settings,
    log: options.log,
    physics: options.physics ?? physics,
    probe: options.probe,
  });
  world.systems.add('scene', (w, intents) => entry.step(w, intents), { phase: 'intents' });
  if (physics) attachPhysics(world, physics);
  world.run((w) => entry.setup(w));
  return { scene: entry, world, settings };
}
