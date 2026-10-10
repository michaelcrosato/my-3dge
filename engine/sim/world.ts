/**
 * @file The sim world (PLAN.md §6.4, §6.5, Q13, WP 1.4, I-03; doctrines: Reproducible, Common ground): entities as
 * plain objects with monotonic ids, components as plain-data properties of declared kinds (`e.position`), systems
 * as functions in a fixed order (engine/sim/systems.ts), spawn, despawn and event queues that apply at step
 * boundaries, named seeded RNG streams, sim-time timers, and the state, hash, trace, capture and restore of all of
 * it (engine/sim/state.ts, engine/sim/capture.ts). It runs in Node and in a page alike; no ECS framework.
 *
 * Entry points: `step(intents)`, `run(fn)` (setup, dev actions), and `spawn`, `despawn` and `emit` called between
 * steps. Each runs synchronously inside `withSimMath` (engine/core/simMath.ts), as do `capture`, `restore`, `state`,
 * `hash` and `trace`: `Math.sin` in a system, timer or listener is the fdlibm port, native again afterwards. Events
 * reach listeners only through `w.emit` (`w.events` lists, never emits); a step's intents are a frozen copy.
 *
 * Invariants (the ordered world, §6.5 item 4): ids count up from 1, never reused in a timeline (a restore rewinds them
 * with the rest). Entities iterate in id order: the list is kept sorted, and the id → entity `Map` serves lookups
 * only. During an entry point, `spawn`, `despawn` and `emit` queue; at its end (the boundary) the spawns join in id
 * order, the despawns leave, then the events reach their listeners in emit order, repeated while listeners queue
 * more (1,000 rounds at most: `SIM_EVENT_STORM`), so a system sees the entities the step began with. `add` and
 * `remove` act at once; spawn and `add` copy their values and keep components in name order (engine/sim/entities.ts).
 * During step k (from 1) every phase, timer and listener sees `tick` k. `hz` is fixed when the world is made (the
 * `time.hz` setting then). A despawned entity's `rng.entity` streams are dropped (asking again is `SIM_NO_ENTITY`);
 * `fxRng` streams are never hashed or captured. A system that throws stops the step and drops what it queued.
 *
 * Gameplay state lives in components, settings, timers or RNG streams, never in closure or module variables: those
 * are neither hashed nor captured, so a restore would leave them behind. Hold ids, not entity objects, across steps:
 * a restore makes new objects; and an id (an entity's or a timer's) kept from a timeline a restore abandoned may name
 * a new object of the restored one. RNG handles stay valid across restores (engine/core/rng.ts).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineComponent } from './state';
 * const reg = createRegistry();
 * defineComponent('position', { description: 'Where.', fields: { x: { type: 'number', default: 0, description: 'East.' } } }, reg);
 * const w = createWorld<{ position: { x: number } }>({ seed: 1, registry: reg });
 * w.systems.add('drift', (w) => w.query('position').forEach((e) => (e.position.x += Math.sin(w.time) * w.dt)));
 * const id = w.spawn({ position: { x: 2 } }); // between steps: it joins at once
 * w.step({}); // w.get(id)?.position?.x is 2.000…, and w.hash() 16 hex digits, the same on every run
 * @see engine/sim/world.test.ts
 */
import { createEvents, type EventMap, type Events } from '../core/events';
import { codeError, defineCodes, log as sharedLog, type Log } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { derive, RngStreams, type Rng } from '../core/rng';
import { copyValue, freezeValue, isPlainObject, show } from '../core/schema';
import { createSettings, type Settings, type SimSettings } from '../core/settings';
import { withSimMath } from '../core/simMath';
import { SIM_HZ } from '../core/time';
import { createTimers, type Timers } from '../core/timers';
import { cloneData, makeCapture, readCapture, scheduleOf, type WorldCapture } from './capture';
import { makeEntity, placeComponent, type LiveEntity } from './entities';
import { componentTable, hashState, traceState } from './state';
import type { AnyComponents, Entity, PhysicsHook, SpawnSpec, StateView, With, WorldState, WorldTrace } from './state';
import { createSystems, phaseIndex, type Intents, type SystemSpec, type Systems } from './systems';

/** The codes this module raises, with their fixes. */
export const WORLD_CODES = defineCodes('sim', {
  SIM_NO_ENTITY: {
    template: 'there is no entity {id}{why}',
    fix: 'use an id spawn() returned while its entity lives (w.has(id) tells): a spawned entity joins the world at the end of the step that spawned it, so give it its components in spawn(); a despawned one leaves at the end of its step',
  },
  SIM_BUSY: {
    template: '{what} was called during a step',
    fix: 'call step(), run(), capture() and restore() between steps; inside a system, change the world directly (spawn, despawn and emit queue to the end of the step)',
  },
  SIM_BAD_ARGUMENT: {
    template: '{where} got {value}',
    fix: 'pass {expected}',
    doc: 'Raised by the world (engine/sim/world.ts) for a seed or step rate that is not a number of the right kind, a spawn that is not a plain object of components, or an `id` given among the components.',
  },
  SIM_EVENT_STORM: {
    template: 'the end of step {tick} was still delivering events and spawns after {rounds} rounds',
    fix: 'break the loop: a listener that emits the event it listens to, or spawns what spawns it again, never settles; act on such chains one step at a time (store a pending flag in a component and let a system handle it next step)',
  },
});

/** Sim RNG streams: `rng('ai')`, and `rng.entity(id, 'anim')` for an entity's own (dropped when it despawns). */
export interface SimRng {
  (...keys: readonly (string | number)[]): Rng;
  entity(id: number, ...keys: readonly (string | number)[]): Rng;
}

/** How a world is made. */
export interface WorldOptions<C extends object = AnyComponents, E extends EventMap = EventMap> {
  /** The seed every sim RNG stream derives from (0). */
  seed?: number;
  /** Where component kinds and settings are declared (the shared registry). */
  registry?: Registry;
  /** The settings store (a new one over `registry`); the hash and captures read its non-view values. */
  settings?: Settings;
  /** Sim steps per second, fixed for the world's life (the `time.hz` setting when it is made, else 60). */
  hz?: number;
  /** Systems to add, in order. */
  systems?: readonly SystemSpec<World<C, E>>[];
  /** The physics hook (WP 3.1). */
  physics?: PhysicsHook;
  /** Where failing event listeners are recorded (the shared log). */
  log?: Log;
}

/** The timers a world offers game code: `after` and `every` in sim seconds; the world steps them. */
export type WorldTimers = Pick<Timers, 'after' | 'every' | 'size'>;

/** The listeners a world offers game code: `on`, `once`, `off`, scopes and the trace; events go through `w.emit`. */
export type WorldEvents<E extends EventMap = EventMap> = Pick<Events<E>, 'on' | 'once' | 'off' | 'scope' | 'trace'>;

/** The sim world: entities, components, systems, events, RNG, timers, state, hash, capture and restore. */
export interface World<C extends object = AnyComponents, E extends EventMap = EventMap> {
  /** The seed every sim RNG stream derives from. */
  readonly seed: number;
  /** Sim steps per second. */
  readonly hz: number;
  /** One step in sim seconds (1 / hz). */
  readonly dt: number;
  /** Steps taken; during a step, that step's number (from 1), the same in every phase. */
  readonly tick: number;
  /** Sim seconds: tick / hz. */
  readonly time: number;
  /** Live entities. */
  readonly count: number;
  /** Sim RNG streams: hashed and captured. */
  readonly rng: SimRng;
  /** A visual stream (particles, shake): presentation only, never hashed or captured. */
  fxRng(...keys: readonly (string | number)[]): Rng;
  /** Timers in sim seconds; their callbacks run in the step's `timers` stage. */
  readonly timers: WorldTimers;
  /** The settings, read the sim-side way: view settings refused. */
  readonly settings: SimSettings;
  /** The systems, in run order. */
  readonly systems: Systems<World<C, E>>;
  /** Listeners (`on`, `once`, `off`, scopes) and the trace of delivered events; emit through `w.emit`. */
  readonly events: WorldEvents<E>;
  /** Makes an entity and returns its id; it joins at the end of the step (at once between steps). */
  spawn(components?: SpawnSpec<C>): number;
  /** Removes an entity at the end of the step (at once between steps); harmless when already gone. */
  despawn(id: number): void;
  /** Gives a live entity a component (replacing one of that kind), checked and filled; returns it. */
  add<K extends Exclude<keyof C, 'id'> & string>(id: number, name: K, values?: Partial<C[K]>): C[K];
  /** Takes a component from a live entity. */
  remove(id: number, name: Exclude<keyof C, 'id'> & string): void;
  /** The live entity, or undefined. */
  get(id: number): Entity<C> | undefined;
  /** Whether the entity lives. */
  has(id: number): boolean;
  /** The live entities holding every named component (all of them for none), in id order. */
  query<K extends Exclude<keyof C, 'id'> & string>(...names: K[]): With<C, K>[];
  /** Queues an event, delivered at the end of the step in emit order (at once between steps). */
  emit<K extends keyof E & string>(type: K, payload: E[K]): void;
  /** Runs `fn` as an entry point (a scene's setup, a dev action): inside withSimMath, then the boundary. */
  run<T>(fn: (w: World<C, E>) => T): T;
  /** One sim step: the systems in order, the timers, then the boundary. */
  step(intents?: Intents): void;
  /** The sim as plain data: what the hash covers. */
  state(): WorldState;
  /** The state digest, 16 hex digits (engine/sim/state.ts says what it covers). */
  hash(): string;
  /** Per-part and per-entity digests, to find where two runs part. */
  trace(): WorldTrace;
  /** The whole sim, copied (engine/sim/capture.ts). */
  capture(): WorldCapture;
  /** Puts back a capture; the next steps continue exactly like the run it came from. */
  restore(capture: WorldCapture): void;
}

/** Event and spawn rounds the boundary runs before it calls the chain a loop. */
const MAX_ROUNDS = 1000;
/** The intents of a step that got none. */
const NO_INTENTS: Intents = Object.freeze({});
/** The place of the `rules` phase: the timers run just before it. */
const RULES = phaseIndex('rules');

/** Throws `SIM_BAD_ARGUMENT` unless `ok`. */
function check(ok: boolean, where: string, value: unknown, expected: string): void {
  if (!ok) throw codeError('SIM_BAD_ARGUMENT', { where, value: show(value), expected });
}

/** Makes a world. */
export function createWorld<C extends object = AnyComponents, E extends EventMap = EventMap>(
  options: WorldOptions<C, E> = {},
): World<C, E> {
  const registry = options.registry ?? sharedRegistry;
  const table = componentTable(registry);
  const store = options.settings ?? createSettings({ registry });
  const firstSeed = options.seed ?? 0;
  check(Number.isFinite(firstSeed), 'createWorld({ seed })', firstSeed, 'a finite number');
  const hz = options.hz ?? (store.values({ view: false })['time.hz'] as number | undefined) ?? SIM_HZ;
  check(Number.isInteger(hz) && hz >= 1, 'createWorld({ hz })', hz, 'whole steps per second, 1 or more');
  const timers = createTimers({ hz });
  const emitter = createEvents<E>({ log: options.log ?? sharedLog });
  const systems = createSystems<World<C, E>>();
  const physics = options.physics;
  const streams = new RngStreams(firstSeed);
  const fx = new RngStreams(derive(firstSeed, 'fx'));
  let nextId = 1;
  /** Live entities in id order: what every iteration walks. */
  let order: LiveEntity[] = [];
  /** id → live entity, for lookups only (never iterated). */
  const byId = new Map<number, LiveEntity>();
  /** The queues an entry point fills and its boundary empties. */
  const spawns: LiveEntity[] = [];
  const despawns: number[] = [];
  const queued: [keyof E & string, unknown][] = [];
  let busy = false;
  /** 1 while a step runs ahead of the timers (before its `timers` stage), so `tick` holds still within a step. */
  let ahead = 0;
  const insert = (entity: LiveEntity): void => {
    let at = order.length;
    if (at > 0 && order[at - 1].id > entity.id) at = order.findIndex((other) => other.id > entity.id);
    order.splice(at, 0, entity);
    byId.set(entity.id, entity);
  };
  const removeAll = (ids: readonly number[]): void => {
    const gone = new Set(ids.filter((id) => byId.delete(id)));
    if (!gone.size) return;
    order = order.filter((entity) => !gone.has(entity.id));
    for (const id of gone) streams.dropEntity(id);
  };
  const boundary = (): void => {
    for (let round = 0; spawns.length || despawns.length || queued.length; round++) {
      if (round >= MAX_ROUNDS) throw codeError('SIM_EVENT_STORM', { tick: timers.ticks, rounds: MAX_ROUNDS });
      spawns.splice(0).forEach(insert);
      removeAll(despawns.splice(0));
      for (const [type, payload] of queued.splice(0)) emitter.emit(type, payload as E[typeof type]);
    }
  };
  /** Runs `fn` as an entry point: not inside another, inside withSimMath, the boundary after it. */
  const enter = <T>(what: string, fn: () => T): T => {
    if (busy) throw codeError('SIM_BUSY', { what });
    return withSimMath(() => {
      busy = true;
      try {
        const out = fn();
        boundary();
        return out;
      } catch (error) {
        spawns.length = despawns.length = queued.length = 0;
        throw error;
      } finally {
        busy = false;
        ahead = 0;
      }
    });
  };
  const pending = (id: number) => spawns.some((entity) => entity.id === id);
  const live = (id: number): LiveEntity => {
    const entity = byId.get(id);
    if (entity) return entity;
    const why = pending(id)
      ? ': it was spawned during this step and joins the world at its end'
      : Number.isInteger(id) && id >= 1 && id < nextId
        ? ': it was despawned'
        : ': no spawn made it';
    throw codeError('SIM_NO_ENTITY', { id: show(id), why });
  };
  const view = (): StateView => ({
    seed: streams.seed,
    nextId,
    hz,
    entities: order,
    timers: timers.state(),
    settings: store.values({ view: false }),
    rng: streams.state(),
    ...(physics ? { physics: physics.state() } : {}),
  });
  const rng = Object.assign((...keys: readonly (string | number)[]) => streams.stream(...keys), {
    entity(id: number, ...keys: readonly (string | number)[]) {
      if (!byId.has(id) && !pending(id)) live(id); // a dropped stream never comes back
      return streams.entity(id, ...keys);
    },
  });

  const world: World<C, E> = {
    get seed() {
      return streams.seed;
    },
    hz,
    dt: 1 / hz,
    get tick() {
      return timers.ticks + ahead;
    },
    get time() {
      return (timers.ticks + ahead) / hz;
    },
    get count() {
      return order.length;
    },
    rng,
    fxRng: (...keys) => fx.stream(...keys),
    timers: {
      after: (seconds, fn) => timers.after(seconds, fn),
      every: (seconds, fn) => timers.every(seconds, fn),
      get size() {
        return timers.size;
      },
    },
    settings: store.sim,
    systems,
    events: { on: emitter.on, once: emitter.once, off: emitter.off, scope: emitter.scope, trace: emitter.trace },
    spawn(components = {}) {
      if (!busy) return enter('spawn()', () => world.spawn(components));
      check(isPlainObject(components), 'spawn(components)', components, 'components by kind, { position: { x: 0 } }');
      const id = nextId;
      const entity = makeEntity(id, {});
      for (const name of Object.keys(components).sort()) {
        check(name !== 'id', 'spawn(components)', 'an id', 'components only: the world gives each entity its id');
        const values = (components as Record<string, unknown>)[name];
        if (values !== undefined) entity[name] = table.make(name, values, `spawn() of entity ${id}`);
      }
      nextId++;
      spawns.push(entity);
      return id;
    },
    despawn(id) {
      if (!(Number.isInteger(id) && id >= 1 && id < nextId)) live(id);
      if (!busy) return enter('despawn()', () => world.despawn(id));
      despawns.push(id);
    },
    add(id, name, values = {}) {
      const entity = live(id);
      const component = table.make(name, values, `add() to entity ${id}`);
      placeComponent(entity, name, component);
      return component as C[typeof name];
    },
    remove(id, name) {
      const entity = live(id);
      table.fields(name);
      delete entity[name];
    },
    get: (id) => byId.get(id) as Entity<C> | undefined,
    has: (id) => byId.has(id),
    query(...names) {
      for (const name of names) table.fields(name);
      const out: LiveEntity[] = [];
      for (const entity of order) if (names.every((name) => entity[name] !== undefined)) out.push(entity);
      return out as unknown as With<C, (typeof names)[number]>[];
    },
    emit(type, payload) {
      if (!busy) return enter('emit()', () => world.emit(type, payload));
      queued.push([type, payload]);
    },
    run: (fn) => enter('run()', () => fn(world)),
    step(given = NO_INTENTS) {
      const intents = given === NO_INTENTS ? given : freezeValue(copyValue(given));
      enter('step()', () => {
        ahead = 1;
        for (const system of systems.list()) {
          if (ahead && phaseIndex(system.phase) >= RULES) {
            ahead = 0;
            timers.step();
          }
          system.run(world, intents);
        }
        if (ahead) {
          ahead = 0;
          timers.step();
        }
      });
    },
    state: () => withSimMath(() => cloneData(view() as WorldState, 'the state')),
    hash: () => withSimMath(() => hashState(view(), table, true)),
    trace: () => withSimMath(() => traceState(view(), timers.ticks, table, true)),
    capture: () =>
      enter('capture()', () =>
        makeCapture({
          origin: world,
          table,
          seed: streams.seed,
          hz,
          nextId,
          entities: order,
          timers: timers.capture(),
          settings: store.values({ view: false }),
          rng: streams.state(),
          systems: systems.list(),
          listeners: emitter.snapshot(),
          physics: physics && (() => physics.capture()),
        }),
      ),
    restore(capture) {
      enter('restore()', () => {
        const settings = Object.keys(store.values({ view: false }));
        const schedule = scheduleOf(systems.list(), emitter.snapshot());
        const target = { origin: world, table, physics: physics !== undefined, hz, settings, schedule };
        const restored = readCapture(capture, target);
        store.load(restored.settings);
        physics?.restore(restored.physics);
        if (!Object.is(restored.seed, streams.seed)) fx.setState({}, derive(restored.seed, 'fx'));
        streams.setState(restored.rng, restored.seed);
        nextId = restored.nextId;
        order = [];
        byId.clear();
        for (const data of restored.entities) insert(makeEntity(data.id, data));
        streams.keepEntities((id) => byId.has(id));
        timers.restore(restored.timers);
        if (restored.systems) systems.restore(restored.systems as readonly never[]);
        if (restored.listeners) emitter.restore(restored.listeners);
      });
    },
  };
  for (const system of options.systems ?? []) systems.add(system.name, system.run, { phase: system.phase });
  return world;
}
