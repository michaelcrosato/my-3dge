/**
 * @file The step's systems (PLAN.md §6.4, Q13; doctrine: Common ground): plain functions `(w, intents) => void` that
 * the world runs once per sim step in a fixed, documented order. No ECS framework: entities are plain objects, and a
 * system is a named function in a phase.
 *
 * The order of one step (`STEP_ORDER`): the systems of the phases `intents` (read the step's intents into
 * components), `ai` (decisions), `anim` (timelines, events, root motion; WP 3.7), `physics` (the Rapier step; WP
 * 3.1), `readback` (physics results into components), then the engine's `timers` stage (due timer callbacks,
 * engine/core/timers.ts), the `rules` phase (hits, damage, spawns, despawns), and the step's boundary: queued spawns,
 * then queued despawns, then the queued events, delivered in emit order (engine/sim/world.ts).
 *
 * Invariants: systems run by phase, and within a phase in the order they were added, never by name or import order.
 * Names are unique per world. `list()` returns a snapshot: a system added or removed during a step takes effect from
 * the next step. Systems run synchronously inside the step's `withSimMath`, so `Math.sin` there is the fdlibm port.
 * The schedule is world state: a capture holds `list()` beside its data and `restore` puts it back, so systems added
 * or removed after a capture are undone by restoring it (engine/sim/capture.ts).
 *
 * Gameplay state lives in components, settings, timers or RNG streams, never in closure or module variables: a
 * system's closures are neither hashed nor captured, so a restore would leave such state behind. A system reads the
 * world and writes components; anything it must remember between steps goes in a component field.
 *
 * @example
 * const systems = createSystems<{ log: string[] }>();
 * systems.add('score', (w) => w.log.push('score')); // phase 'rules' by default
 * systems.add('think', (w) => w.log.push('think'), { phase: 'ai' });
 * systems.list().map((system) => system.name); // ['think', 'score']
 * @see engine/sim/systems.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { show } from '../core/schema';
import type { Intents } from '../input/intents';

/** The codes this module raises, with their fixes. */
export const SYSTEM_CODES = defineCodes('sim', {
  SIM_BAD_SYSTEM: {
    template: 'system {name}: {problem}',
    fix: "add each system once, by a unique name: w.systems.add('<name>', (w, intents) => { … }, { phase }), the phase one of intents, ai, anim, physics, readback, rules",
    doc: 'Raised by `systems.add` and `systems.remove` (engine/sim/systems.ts) for an empty or duplicate name, a run that is not a function, an unknown phase (named with the closest one), or removing a system that was never added.',
  },
});

/** The phases systems run in, in order; the engine's `timers` stage runs between `readback` and `rules`. */
export const PHASES = ['intents', 'ai', 'anim', 'physics', 'readback', 'rules'] as const;

/** A phase of the step. */
export type Phase = (typeof PHASES)[number];

/** One step, in order: the phases, the engine's stages (`timers`, `spawns`, `despawns`, `events`) among them. */
export const STEP_ORDER = [
  'intents',
  'ai',
  'anim',
  'physics',
  'readback',
  'timers',
  'rules',
  'spawns',
  'despawns',
  'events',
] as const;

/** What the sim reads from outside in one step, recorded by replays (the vocabulary: engine/input/intents.ts). */
export type { Intents };

/** A system: called once per step with the world and the step's intents. */
export type SystemFn<W> = (w: W, intents: Intents) => void;

/** A system in the schedule. */
export interface System<W> {
  readonly name: string;
  readonly phase: Phase;
  readonly run: SystemFn<W>;
}

/** A system as `createWorld({ systems })` takes it: the phase is `rules` when left out. */
export interface SystemSpec<W> {
  name: string;
  run: SystemFn<W>;
  phase?: Phase;
}

/** A world's systems, in run order. */
export interface Systems<W> {
  /** Adds a system at the end of its phase (`rules` by default). Throws `SIM_BAD_SYSTEM`. */
  add(name: string, run: SystemFn<W>, options?: { phase?: Phase }): System<W>;
  /** Removes a system by name. Throws `SIM_BAD_SYSTEM` for a name never added. */
  remove(name: string): void;
  /** Whether a system of that name is in the schedule. */
  has(name: string): boolean;
  /** The systems in run order: a snapshot, unchanged by later adds and removes. */
  list(): readonly System<W>[];
  /** Puts back a schedule `list()` returned (a capture's), dropping systems added since. */
  restore(list: readonly System<W>[]): void;
}

/** Each phase's place in the order. */
const PHASE_INDEX = new Map<string, number>(PHASES.map((phase, i) => [phase, i]));

/** The place of `phase` in the step (`timers` sits just before `rules`). */
export function phaseIndex(phase: Phase): number {
  return PHASE_INDEX.get(phase) ?? -1;
}

/** Makes an empty schedule. */
export function createSystems<W>(): Systems<W> {
  /** Replaced on every change (copy on write), so a step walks the list it started with. */
  let list: readonly System<W>[] = [];
  const bad = (name: unknown, problem: string) => codeError('SIM_BAD_SYSTEM', { name: show(name), problem });
  return {
    add(name, run, options = {}) {
      const phase = options.phase ?? 'rules';
      if (typeof name !== 'string' || !name.trim()) throw bad(name, 'the name must be a non-empty string');
      if (list.some((system) => system.name === name)) throw bad(name, 'a system of that name is already added');
      if (typeof run !== 'function') throw bad(name, `run is ${show(run)}; it must be a function (w, intents) => void`);
      if (!PHASE_INDEX.has(phase)) {
        throw bad(
          name,
          `the phase ${show(phase)} is not one of ${PHASES.join(', ')}${didYouMean(String(phase), PHASES)}`,
        );
      }
      const system: System<W> = Object.freeze({ name, phase, run });
      const at = list.findIndex((other) => phaseIndex(other.phase) > phaseIndex(phase));
      list = at < 0 ? [...list, system] : [...list.slice(0, at), system, ...list.slice(at)];
      return system;
    },
    remove(name) {
      if (!list.some((system) => system.name === name)) {
        throw bad(
          name,
          `no system of that name was added${didYouMean(
            String(name),
            list.map((s) => s.name),
          )}`,
        );
      }
      list = list.filter((system) => system.name !== name);
    },
    has: (name) => list.some((system) => system.name === name),
    list: () => list,
    restore(saved) {
      list = saved;
    },
  };
}
