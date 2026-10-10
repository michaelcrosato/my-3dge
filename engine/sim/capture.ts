/**
 * @file Capture and restore (PLAN.md §6.5 item 7, WP 1.4; doctrine: Reproducible): `capture()` copies the whole sim
 * at a step boundary, entities, components, timers, settings except `view` ones, the seed and every sim RNG state,
 * plus the physics hook's part (Rapier's snapshot, WP 3.1), and `restore()` puts it back so the next steps continue
 * exactly like the uninterrupted run. This module builds and checks captures; engine/sim/world.ts applies them.
 *
 * The capture is plain data: every enumerable field is canonical (engine/core/hash.ts), so `serialize(capture)`
 * writes it as text and `deserialize` reads it back. Timer callbacks are functions, so they are never part of that
 * data: the capture object holds them in a side table (a `WeakMap` keyed by the capture, aligned with
 * `capture.timers.timers`), together with the world that made it. A capture with pending timers therefore restores
 * only from the object `capture()` returned, into the world that made it (`SIM_NO_CALLBACKS` otherwise: a callback
 * closes over its world, and moving it would act on the wrong one); a capture without pending timers, serialized or
 * not, restores into any world with the same component kinds, settings and step rate (`time.hz` is fixed when a
 * world is made, so a capture made at another rate is refused). Game code that must survive a save to text keeps its
 * delays in component fields (a tick count a system checks) instead of timers.
 *
 * Invariants: captures are taken and restored between steps only (`SIM_BUSY`, world.ts); a capture shares nothing
 * mutable with the world, and restoring copies again, so one capture restores any number of times. `readCapture`
 * checks the whole shape before anything changes, naming the first problem (`SIM_BAD_CAPTURE`). Entities are stored in
 * id order. The view settings and the visual RNG streams (`fxRng`) are presentation: never captured.
 *
 * @example
 * import { createWorld } from './world';
 * import { serialize, deserialize, type Canonical } from '../core/hash';
 * const w = createWorld({ seed: 7 });
 * w.rng('loot').next();
 * const saved = w.capture(); // { format: 'my3dge-capture/1', seed: 7, nextId: 1, entities: [], … }
 * const text = serialize(saved as unknown as Canonical); // no pending timers, so the text restores anywhere
 * w.rng('loot').next();
 * w.restore(deserialize(text) as unknown as WorldCapture);
 * @see engine/sim/capture.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import { isPlainObject, show } from '../core/schema';
import type { SettingValue } from '../core/settings';
import type { TimerCallback, TimersCapture, TimersState } from '../core/timers';
import type { ComponentTable, EntityData } from './state';

/** The codes this module raises, with their fixes. */
export const CAPTURE_CODES = defineCodes('sim', {
  SIM_BAD_CAPTURE: {
    template: 'the capture cannot be restored: {problem}',
    fix: 'pass restore() what capture() returned (or its serialize/deserialize round trip), unchanged, to a world with the same component kinds, step rate (time.hz), settings and physics',
    doc: 'Raised by `restore` (engine/sim/capture.ts, engine/sim/world.ts) before anything changes, for a value that is not a capture of this format: a wrong format tag, a malformed part, entities out of id order or at or above `nextId`, a `time.hz` other than the world step rate, or a physics part where the world has no physics hook (or the reverse).',
  },
  SIM_NO_CALLBACKS: {
    template: 'the capture has {count} pending timers, whose callbacks {why}',
    fix: 'restore a capture with pending timers from the object capture() returned, into the world that made it: callbacks are functions, which never survive serialization or move between worlds; to save play as text, keep delays in component fields (a tick count a system checks)',
  },
});

/** The capture format tag; a change to what captures hold changes it. */
export const CAPTURE_FORMAT = 'my3dge-capture/1';

/** The whole sim at a step boundary, as plain data (callbacks held aside; see the file comment). */
export interface WorldCapture {
  readonly format: typeof CAPTURE_FORMAT;
  /** The seed every sim RNG stream derives from. */
  readonly seed: number;
  /** The id the next spawn gets. */
  readonly nextId: number;
  /** Every entity with its components, in id order. */
  readonly entities: readonly EntityData[];
  /** The timers as numbers: tick count, next timer id, `[id, due tick, period]` in firing order. */
  readonly timers: TimersState;
  /** The settings except `view` ones, by path. */
  readonly settings: Readonly<Record<string, SettingValue>>;
  /** The state of every sim RNG stream, by canonical key. */
  readonly rng: Readonly<Record<string, number>>;
  /** The physics hook's part (Rapier's snapshot), when the world has one. */
  readonly physics?: unknown;
}

/** What a capture is made from: the world's parts, read between steps. */
export interface CaptureSource {
  /** The world, recorded with the callbacks. */
  origin: object;
  seed: number;
  nextId: number;
  entities: readonly EntityData[];
  timers: TimersCapture;
  settings: Readonly<Record<string, SettingValue>>;
  rng: Record<string, number>;
  physics?: () => unknown;
}

/** A checked capture, copied, ready for the world to apply. */
export interface Restoration {
  seed: number;
  nextId: number;
  entities: EntityData[];
  timers: TimersCapture;
  settings: Record<string, SettingValue>;
  rng: Record<string, number>;
  physics?: unknown;
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

/** Each capture's timer callbacks and the world that made it. */
const held = new WeakMap<object, { origin: object; callbacks: readonly TimerCallback[] }>();

/** Makes a capture from a world's parts: copies of everything, the callbacks held aside. */
export function makeCapture(source: CaptureSource): WorldCapture {
  const capture: { -readonly [K in keyof WorldCapture]: WorldCapture[K] } = {
    format: CAPTURE_FORMAT,
    seed: source.seed,
    nextId: source.nextId,
    entities: source.entities.map((entity) => cloneData(entity, `entity ${entity.id}`)),
    timers: {
      ticks: source.timers.ticks,
      nextId: source.timers.nextId,
      timers: source.timers.timers.map((timer) => [timer.id, timer.due, timer.period]),
    },
    settings: cloneData(source.settings, 'settings'),
    rng: { ...source.rng },
  };
  if (source.physics) capture.physics = source.physics();
  held.set(capture, { origin: source.origin, callbacks: source.timers.timers.map((timer) => timer.fn) });
  return capture;
}

/** Throws `SIM_BAD_CAPTURE` naming `problem` unless `ok`; a function makes the text only when it is needed. */
function need(ok: boolean, problem: string | (() => string)): asserts ok {
  if (!ok) throw codeError('SIM_BAD_CAPTURE', { problem: typeof problem === 'string' ? problem : problem() });
}

/** True for a whole number at least `min`. */
const whole = (value: unknown, min: number): value is number => Number.isInteger(value) && (value as number) >= min;

/** The world a capture is read for: itself, its component kinds, whether it has physics, and its step rate. */
export interface RestoreTarget {
  origin: object;
  table: ComponentTable;
  physics: boolean;
  hz: number;
}

/**
 * Checks `capture` for the world `target` and returns a copy ready to apply. Throws `SIM_BAD_CAPTURE`,
 * `SIM_UNKNOWN_COMPONENT` or `SIM_NO_CALLBACKS`; changes nothing.
 */
export function readCapture(capture: unknown, target: RestoreTarget): Restoration {
  const { origin, table, physics, hz } = target;
  need(isPlainObject(capture), `it is ${show(capture)}, not an object from capture()`);
  need(capture.format === CAPTURE_FORMAT, `its format is ${show(capture.format)}, not ${show(CAPTURE_FORMAT)}`);
  const { seed, nextId, entities, timers, settings, rng } = capture;
  need(typeof seed === 'number' && Number.isFinite(seed), `its seed is ${show(seed)}`);
  need(whole(nextId, 1), `its nextId is ${show(nextId)}; ids start at 1`);
  need(Array.isArray(entities), 'its entities are not a list');
  let last = 0;
  for (const entity of entities as unknown[]) {
    need(
      isPlainObject(entity) && whole(entity.id, 1),
      () => `an entity is ${show(entity)}; each is { id, …components }`,
    );
    const id = entity.id as number;
    need(id > last, () => `entity ${id} comes after entity ${last}; entities are stored in id order, each once`);
    need(id < nextId, () => `entity ${id} is at or above nextId ${nextId}`);
    for (const [name, data] of Object.entries(entity)) {
      if (name === 'id') continue;
      table.fields(name);
      need(isPlainObject(data), () => `entity ${id}'s ${name} is ${show(data)}; a component is a plain object`);
    }
    last = id;
  }
  need(isPlainObject(timers), `its timers are ${show(timers)}`);
  const list = timers.timers;
  need(whole(timers.ticks, 0) && whole(timers.nextId, 1) && Array.isArray(list), 'its timers are malformed');
  for (const timer of list as unknown[]) {
    need(Array.isArray(timer) && timer.length === 3 && timer.every(Number.isFinite), () => `a timer is ${show(timer)}`);
  }
  need(isPlainObject(settings), `its settings are ${show(settings)}`);
  const made = settings['time.hz'];
  need(made === undefined || made === hz, () => `it was made at time.hz ${show(made)}; this world steps at ${hz} Hz`);
  need(isPlainObject(rng) && Object.values(rng).every((v) => Number.isInteger(v)), 'its RNG states are malformed');
  need(physics === (capture.physics !== undefined), physics ? 'it has no physics part' : 'it has a physics part');
  const timerList = list as [number, number, number][];
  const side = held.get(capture);
  if (timerList.length > 0) {
    const why = !side
      ? 'are not in it: it was serialized or copied'
      : side.origin !== origin
        ? 'belong to the world that made it, not this one'
        : side.callbacks.length !== timerList.length
          ? 'no longer match its timers: the timer list was changed'
          : '';
    if (why) throw codeError('SIM_NO_CALLBACKS', { count: timerList.length, why });
  }
  const callbacks = side?.callbacks ?? [];
  return {
    seed,
    nextId,
    entities: (entities as EntityData[]).map((entity) => cloneData(entity, `entity ${entity.id}`)),
    timers: {
      ticks: timers.ticks as number,
      nextId: timers.nextId as number,
      timers: timerList.map(([id, due, period], i) => ({ id, due, period, fn: callbacks[i] })),
    },
    settings: cloneData(settings as Record<string, SettingValue>, 'settings'),
    rng: { ...(rng as Record<string, number>) },
    physics: capture.physics,
  };
}
