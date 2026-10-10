/**
 * @file Capture and restore (PLAN.md §6.5 item 7, WP 1.4; doctrine: Reproducible): `capture()` copies the whole sim
 * at a step boundary, entities, components, timers, settings except `view` ones, the seed, the step rate and every
 * sim RNG state, plus the physics hook's part (Rapier's snapshot, WP 3.1), and `restore()` puts it back so the next
 * steps continue exactly like the uninterrupted run. This module builds and checks captures; engine/sim/world.ts
 * applies them.
 *
 * The capture is plain data: every enumerable field is canonical (engine/core/hash.ts), so `serialize(capture)`
 * writes it as text and `deserialize` reads it back. What is code, not data, never enters it: the timer callbacks,
 * the event listeners (with their `once` flags and scopes, engine/core/events.ts `snapshot()`) and the systems list
 * are held beside it in a side table (a `WeakMap` keyed by the capture) with the world that made it. Restored into
 * that world, from the object `capture()` returned, a capture puts all of them back: a `once` used up since runs
 * again, a listener or system added since leaves. Anywhere else (serialized, or another world) none of them can
 * move: a function closes over its world. So such a restore needs no pending timers (`SIM_NO_CALLBACKS`) and the
 * same schedule, which the capture records as data (`schedule`: systems as `phase:name`, listeners by type), else
 * `SIM_BAD_CAPTURE` names the first difference. Game code that must survive a save to text keeps delays and one-time
 * triggers in components (a tick count, a flag a system checks), never in timers or `once` listeners.
 *
 * Invariants: captures are taken and restored between steps only (`SIM_BUSY`, world.ts); a capture shares nothing
 * mutable with the world, and restoring copies again, so one capture restores any number of times. A capture holds
 * plain data only (`SIM_NOT_DATA`, state.ts) and no object in two places (`SIM_SHARED_DATA`): both would come back
 * changed. `readCapture` checks the whole shape before anything changes, naming the first problem
 * (`SIM_BAD_CAPTURE`): the step rate (`hz`, the world's, fixed when it is made; the `time.hz` setting is only a
 * setting), the setting paths and each component's fields must be exactly the world's. Entities are stored in id
 * order and restored with their components in name order and fields in declared order, the order spawn keeps. The
 * view settings and the visual RNG streams (`fxRng`) are presentation: never captured.
 *
 * @example
 * import { createWorld } from './world';
 * import { serialize, deserialize, type Canonical } from '../core/hash';
 * const w = createWorld({ seed: 7 });
 * w.rng('loot').next();
 * const saved = w.capture(); // { format: 'my3dge-capture/2', seed: 7, hz: 60, nextId: 1, entities: [], … }
 * const text = serialize(saved as unknown as Canonical); // no pending timers, so the text restores anywhere
 * w.rng('loot').next();
 * w.restore(deserialize(text) as unknown as WorldCapture);
 * @see engine/sim/capture.test.ts, engine/sim/restore.test.ts
 */
import type { EventsSnapshot } from '../core/events';
import { codeError, defineCodes } from '../core/log';
import { isPlainObject, show } from '../core/schema';
import type { SettingValue } from '../core/settings';
import type { TimerCallback, TimersCapture, TimersState } from '../core/timers';
import { capturable, notData } from './entities';
import type { ComponentTable, EntityData } from './state';
import type { System } from './systems';

/** The codes this module raises, with their fixes. */
export const CAPTURE_CODES = defineCodes('sim', {
  SIM_BAD_CAPTURE: {
    template: 'the capture cannot be restored: {problem}',
    fix: 'pass restore() what capture() returned (or its serialize/deserialize round trip), unchanged, to a world with the same step rate, component kinds, settings, physics and schedule (systems and listeners)',
    doc: "Raised by `restore` (engine/sim/capture.ts, engine/sim/world.ts) before anything changes, for a value that is not a capture of this format: a wrong format tag, a malformed part, entities out of id order or at or above `nextId`, a component whose fields are not exactly its declared ones, a step rate (`hz`) other than the world's, setting paths other than the world's, a physics part where the world has no physics hook (or the reverse), or, restoring into a world that did not make it, systems or listeners other than the world's.",
  },
  SIM_NO_CALLBACKS: {
    template: 'the capture has {count} pending timers, whose callbacks {why}',
    fix: 'restore a capture with pending timers from the object capture() returned, into the world that made it: callbacks are functions, which never survive serialization or move between worlds; to save play as text, keep delays in component fields (a tick count a system checks)',
  },
});

/** The capture format tag; a change to what captures hold changes it. */
export const CAPTURE_FORMAT = 'my3dge-capture/2';

/** The world's code as data: systems as `phase:name` in run order, listeners as `type` or `type (once)`. */
export interface ScheduleData {
  systems: string[];
  listeners: string[];
}

/** The whole sim at a step boundary, as plain data (code held aside; see the file comment). */
export interface WorldCapture {
  readonly format: typeof CAPTURE_FORMAT;
  /** The seed every sim RNG stream derives from. */
  readonly seed: number;
  /** The step rate of the world that made it. */
  readonly hz: number;
  /** The id the next spawn gets. */
  readonly nextId: number;
  /** Every entity with its components, in id order. */
  readonly entities: readonly EntityData[];
  /** The timers as numbers: tick count, next timer id, `[id, due tick, period]` in firing order. */
  readonly timers: TimersState;
  /** The settings except `view` ones, by path. */
  readonly settings: Readonly<Record<string, SettingValue>>;
  /** The state of every sim RNG stream away from its derived seed, by name. */
  readonly rng: Readonly<Record<string, number>>;
  /** The systems and listeners of the world that made it, as names (the code itself is held aside). */
  readonly schedule: ScheduleData;
  /** The physics hook's part (Rapier's snapshot), when the world has one. */
  readonly physics?: unknown;
}

/** What a capture is made from: the world's parts, read between steps. */
export interface CaptureSource {
  /** The world, recorded with the code held aside. */
  origin: object;
  table: ComponentTable;
  seed: number;
  hz: number;
  nextId: number;
  entities: readonly EntityData[];
  timers: TimersCapture;
  settings: Readonly<Record<string, SettingValue>>;
  /** A fresh record (`RngStreams.state()`), kept as it is. */
  rng: Record<string, number>;
  systems: readonly System<never>[];
  listeners: EventsSnapshot;
  physics?: () => unknown;
}

/** A checked capture, copied, ready for the world to apply; `systems` and `listeners` only for its own world. */
export interface Restoration {
  seed: number;
  nextId: number;
  entities: EntityData[];
  timers: TimersCapture;
  settings: Record<string, SettingValue>;
  rng: Record<string, number>;
  physics?: unknown;
  systems?: readonly System<never>[];
  listeners?: EventsSnapshot;
}

/** True for the values `cloneData` returns as they are. */
const scalar = (value: unknown) =>
  value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';

/**
 * A deep copy of plain data: arrays, plain objects (undefined values left out), typed arrays and values with
 * `clone()` (three.js's math classes); anything else throws `CORE_NOT_CANONICAL`.
 */
export function cloneData<T>(value: T, path = 'the value'): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw codeError('CORE_NOT_CANONICAL', { path, what: `a ${typeof value}` });
    }
    return value;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = scalar(value[i]) ? value[i] : cloneData(value[i], `${path}[${i}]`);
    return out as T;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return (value as unknown as Uint8Array).slice() as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      const item = value[key];
      if (item !== undefined) out[key] = scalar(item) ? item : cloneData(item, `${path}.${key}`);
    }
    return out as T;
  }
  const clone = (value as { clone?: unknown; toArray?: unknown }).clone;
  if (typeof clone === 'function' && typeof (value as { toArray?: unknown }).toArray === 'function') {
    return clone.call(value) as T;
  }
  const name = (value as object).constructor?.name;
  throw codeError('CORE_NOT_CANONICAL', { path, what: name ? `a ${name}` : 'an object without a prototype' });
}

/** The schedule of `systems` and a listener snapshot, as data. */
export function scheduleOf(systems: readonly System<never>[], listeners: EventsSnapshot): ScheduleData {
  return {
    systems: systems.map((system) => `${system.phase}:${system.name}`),
    listeners: listeners.registrations.map((item) => (item.once ? `${item.type} (once)` : item.type)),
  };
}

/** Each capture's code (timer callbacks, systems, listeners) and the world that made it. */
const held = new WeakMap<
  object,
  { origin: object; callbacks: readonly TimerCallback[]; systems: readonly System<never>[]; listeners: EventsSnapshot }
>();

/** Makes a capture from a world's parts: copies of everything, the code held aside. */
export function makeCapture(source: CaptureSource): WorldCapture {
  const capture: { -readonly [K in keyof WorldCapture]: WorldCapture[K] } = {
    format: CAPTURE_FORMAT,
    seed: source.seed,
    hz: source.hz,
    nextId: source.nextId,
    entities: capturable(source.entities, source.table),
    timers: {
      ticks: source.timers.ticks,
      nextId: source.timers.nextId,
      timers: source.timers.timers.map((timer) => [timer.id, timer.due, timer.period]),
    },
    settings: cloneData(source.settings, 'settings'),
    rng: source.rng,
    schedule: scheduleOf(source.systems, source.listeners),
  };
  if (source.physics) capture.physics = source.physics();
  held.set(capture, {
    origin: source.origin,
    callbacks: source.timers.timers.map((timer) => timer.fn),
    systems: source.systems,
    listeners: source.listeners,
  });
  return capture;
}

/** Throws `SIM_BAD_CAPTURE` naming `problem` unless `ok`; a function makes the text only when it is needed. */
function need(ok: boolean, problem: string | (() => string)): asserts ok {
  if (!ok) throw codeError('SIM_BAD_CAPTURE', { problem: typeof problem === 'string' ? problem : problem() });
}

/** True for a whole number at least `min`. */
const whole = (value: unknown, min: number): value is number => Number.isInteger(value) && (value as number) >= min;

/** The world a capture is read for: itself, its component kinds, physics, step rate, setting paths and schedule. */
export interface RestoreTarget {
  origin: object;
  table: ComponentTable;
  physics: boolean;
  hz: number;
  /** The paths of its settings except `view` ones. */
  settings: readonly string[];
  /** Its systems and listeners now. */
  schedule: ScheduleData;
}

/** True for a list of strings. */
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Code-unit order, so sorting never depends on the locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Throws `SIM_BAD_CAPTURE` unless the lists match, naming the first place they differ. */
function same(what: string, ours: readonly string[], theirs: readonly string[], here: string): void {
  const at = ours.findIndex((item, i) => item !== theirs[i]);
  const i = at >= 0 ? at : ours.length === theirs.length ? -1 : Math.min(ours.length, theirs.length);
  const name = (item: string | undefined) => (item === undefined ? 'nothing' : show(item));
  need(
    i < 0,
    () => `its ${what} differ from ${here} at #${i + 1}: ${name(theirs[i])} in it, ${name(ours[i])} in ${here}`,
  );
}

/** Reads one captured entity: its components checked against their declared fields, rebuilt in the order spawn keeps. */
function readEntity(entity: Record<string, unknown>, id: number, table: ComponentTable): EntityData {
  const names: string[] = [];
  for (const name in entity) if (name !== 'id') names.push(name);
  if (names.some((name, i) => i > 0 && name < names[i - 1])) names.sort(byText);
  const out: Record<string, unknown> = { id };
  for (const name of names) {
    const fields = table.fields(name);
    const data = entity[name];
    if (!isPlainObject(data))
      need(false, () => `entity ${id}'s ${name} is ${show(data)}; a component is a plain object`);
    const component: Record<string, unknown> = {};
    for (const key of fields) {
      const value = data[key];
      if (typeof value === 'number') {
        component[key] = value;
        continue;
      }
      if (value === undefined) need(false, () => `entity ${id}'s ${name} lacks its field ${key}`);
      const bad = notData(value);
      if (bad) need(false, () => `entity ${id}'s ${name}.${key}${bad.path} is ${bad.what}, not plain data`);
      component[key] = cloneData(value);
    }
    let count = 0;
    for (const _key in data) count++;
    if (count !== fields.length) {
      const extra = Object.keys(data).find((key) => !fields.includes(key));
      need(false, () => `entity ${id}'s ${name}.${extra} is not a field of ${name} (${fields.join(', ')})`);
    }
    out[name] = component;
  }
  return out as EntityData;
}

/**
 * Checks `capture` for the world `target` and returns a copy ready to apply. Throws `SIM_BAD_CAPTURE`,
 * `SIM_UNKNOWN_COMPONENT` or `SIM_NO_CALLBACKS`; changes nothing.
 */
export function readCapture(capture: unknown, target: RestoreTarget): Restoration {
  const { origin, table, physics, hz } = target;
  need(isPlainObject(capture), () => `it is ${show(capture)}, not an object from capture()`);
  need(capture.format === CAPTURE_FORMAT, () => `its format is ${show(capture.format)}, not ${show(CAPTURE_FORMAT)}`);
  const { seed, nextId, entities, timers, settings, rng, schedule } = capture;
  need(typeof seed === 'number' && Number.isFinite(seed), () => `its seed is ${show(seed)}`);
  need(
    capture.hz === hz,
    () => `it was made by a world stepping at ${show(capture.hz)} Hz; this one steps at ${hz} Hz`,
  );
  need(whole(nextId, 1), () => `its nextId is ${show(nextId)}; ids start at 1`);
  need(Array.isArray(entities), 'its entities are not a list');
  let last = 0;
  const restored: EntityData[] = [];
  for (const entity of entities as unknown[]) {
    const id = isPlainObject(entity) && whole(entity.id, 1) ? entity.id : 0;
    if (!id) need(false, () => `an entity is ${show(entity)}; each is { id, …components }`);
    if (id <= last)
      need(false, () => `entity ${id} comes after entity ${last}; entities are stored in id order, each once`);
    if (id >= nextId) need(false, () => `entity ${id} is at or above nextId ${nextId}`);
    restored.push(readEntity(entity as Record<string, unknown>, id, table));
    last = id;
  }
  need(isPlainObject(timers), () => `its timers are ${show(timers)}`);
  const list = timers.timers;
  need(whole(timers.ticks, 0) && whole(timers.nextId, 1) && Array.isArray(list), 'its timers are malformed');
  for (const timer of list as unknown[]) {
    need(Array.isArray(timer) && timer.length === 3 && timer.every(Number.isFinite), () => `a timer is ${show(timer)}`);
  }
  need(isPlainObject(settings), () => `its settings are ${show(settings)}`);
  const paths = Object.keys(settings).sort(byText);
  const ours = [...target.settings].sort(byText);
  const lacking = ours.find((path) => !Object.hasOwn(settings, path));
  need(lacking === undefined, () => `it lacks the setting ${show(lacking)}, which this world has`);
  const extra = paths.find((path) => !ours.includes(path));
  need(extra === undefined, () => `it has the setting ${show(extra)}, which this world lacks`);
  need(isPlainObject(rng), 'its RNG states are malformed');
  const states: Record<string, number> = {};
  for (const name in rng) {
    const value = rng[name];
    if (!Number.isInteger(value)) need(false, () => `its RNG state ${show(name)} is ${show(value)}, not an int32`);
    states[name] = value as number;
  }
  need(physics === (capture.physics !== undefined), physics ? 'it has no physics part' : 'it has a physics part');
  need(
    isPlainObject(schedule) && strings(schedule.systems) && strings(schedule.listeners),
    () => `its schedule is ${show(schedule)}`,
  );
  const timerList = list as [number, number, number][];
  const side = held.get(capture);
  const own = side !== undefined && side.origin === origin;
  if (timerList.length > 0) {
    const why = !side
      ? 'are not in it: it was serialized or copied'
      : !own
        ? 'belong to the world that made it, not this one'
        : side.callbacks.length !== timerList.length
          ? 'no longer match its timers: the timer list was changed'
          : '';
    if (why) throw codeError('SIM_NO_CALLBACKS', { count: timerList.length, why });
  }
  const expected = own ? scheduleOf(side.systems, side.listeners) : target.schedule;
  const here = own ? 'the world that made it' : 'this world';
  same('systems', expected.systems, schedule.systems as string[], here);
  same('listeners', expected.listeners, schedule.listeners as string[], here);
  const callbacks = side?.callbacks ?? [];
  return {
    seed,
    nextId,
    entities: restored,
    timers: {
      ticks: timers.ticks as number,
      nextId: timers.nextId as number,
      timers: timerList.map(([id, due, period], i) => ({ id, due, period, fn: callbacks[i] })),
    },
    settings: cloneData(settings as Record<string, SettingValue>, 'settings'),
    rng: states,
    physics: capture.physics,
    ...(own ? { systems: side.systems, listeners: side.listeners } : {}),
  };
}
