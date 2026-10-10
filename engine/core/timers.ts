/**
 * @file Sim time (PLAN.md §6.3, WP 1.3, ADR-0005; doctrine: Reproducible): timers `after` and `every` that count sim
 * ticks and return `{ cancel }`, and per-entity clocks, plain numbers a component holds, that run an entity's time at
 * its own rate (a slowed foe, a time well) or freeze it (the attacker and victim of a hit). The frame clock that
 * decides how many ticks a frame runs is engine/core/time.ts.
 *
 * Timers: the world calls `timers.step()` once per sim step, at its place in the system order (WP 1.4), and due
 * callbacks run there, synchronously, inside the step's `withSimMath`. Durations are sim seconds, kept exact in tick
 * units (0.025 s is 1.5 ticks at 60 Hz), and a timer fires on the first step at or after its time.
 *
 * Invariants: timers fire in due order, then creation order (ids count up from 1), and never in the step that made
 * them; `every` keeps its phase (a late call never shifts the next: the leftover-time carry of
 * `my-3d2dge:engine/my-3d2dge.js:2490`) and is at least one tick, so it fires at most once a step; a one-shot timer
 * is removed before its callback runs, so a throw leaves the list sound. `state()` is plain numbers for the hash;
 * `capture()` adds the callbacks, so `restore` continues exactly in the same process, and a handle made before a
 * restore still reaches its timer by id. An entity clock's `frozen` counts the world seconds left in a freeze; a
 * freeze ending inside a step gives the rest of the step back, and the longest freeze wins, never the sum.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1594-1597` (`after`/`every` with `{ cancel }`, now in ticks) and the
 * per-unit clocks of `my-3d2dge:src/emberdeep/30-monsters-core.js:300` and `my-3d2dge:src/emberdeep/10-combat.js:320`
 * (an effect a foe owns runs on the foe's clock).
 *
 * @example
 * const timers = createTimers();
 * let waves = 0;
 * timers.every(0.5, () => waves++); // every 30 steps
 * const fuse = timers.after(2, () => {}); // fuse.cancel() stops it
 * for (let i = 0; i < 60; i++) timers.step();
 * waves; // 2
 * const foe = createEntityClock(0.5); // half speed
 * advanceEntityClock(foe, 1 / 60); // 1/120: the foe's own dt for this sim step
 * @see engine/core/timers.test.ts
 */
import { codeError } from './log';
import { show } from './schema';
import { SIM_HZ } from './time';

/** Throws `CORE_BAD_TIME` (registered by engine/core/time.ts) unless `ok`. */
function check(ok: boolean, where: string, value: unknown, expected: string): void {
  if (!ok) throw codeError('CORE_BAD_TIME', { where, value: show(value), expected });
}

/** Slack for tick comparisons: float sums of fractional ticks stay this close to the exact value. */
const EPS = 1e-6;
/** Seconds below which an entity clock's freeze counts as over. */
const EPS_SECONDS = 1e-9;

/** A timer's handle. */
export interface Timer {
  /** Its id in its `Timers`: creation order, from 1. */
  readonly id: number;
  /** False once it fired (one-shot), was cancelled or cleared. */
  readonly active: boolean;
  /** Stops it; harmless when it already stopped. */
  cancel(): void;
}

/** What a timer calls: it gets its own handle, so `every` can cancel itself. */
export type TimerCallback = (timer: Timer) => void;

/** The timers as plain numbers, for the hash: `[id, due tick, period in ticks (0 for one-shot)]` in firing order. */
export interface TimersState {
  ticks: number;
  nextId: number;
  timers: [id: number, due: number, period: number][];
}

/** The timers with their callbacks, for `restore` in the same process. */
export interface TimersCapture {
  readonly ticks: number;
  readonly nextId: number;
  readonly timers: readonly { id: number; due: number; period: number; fn: TimerCallback }[];
}

/** Timers in sim time; the world steps them once per sim step. */
export interface Timers {
  /** Sim steps taken so far. */
  readonly ticks: number;
  /** Timers waiting. */
  readonly size: number;
  /** Calls `fn` once, `seconds` of sim time from now (on the next step at the earliest). */
  after(seconds: number, fn: TimerCallback): Timer;
  /** Calls `fn` every `seconds` of sim time (one tick at least), first `seconds` from now. */
  every(seconds: number, fn: TimerCallback): Timer;
  /** One sim step: counts the tick, then runs what is due. */
  step(): void;
  /** Stops every timer (a scene change); the tick count stays. */
  clear(): void;
  /** The tick count and timers as plain numbers, for the hash. */
  state(): TimersState;
  /** The state plus the callbacks, for `restore`. */
  capture(): TimersCapture;
  /** Puts back a capture's tick count and timers (callbacks included). */
  restore(capture: TimersCapture): void;
}

/** Makes timers counting ticks at `hz` steps per second (`time.hz`, 60 by default). */
export function createTimers(options: { hz?: number } = {}): Timers {
  const hz = options.hz ?? SIM_HZ;
  check(Number.isInteger(hz) && hz >= 1, 'createTimers({ hz })', hz, 'whole steps per second, 1 or more');
  type Entry = { id: number; due: number; period: number; fn: TimerCallback };
  let ticks = 0;
  let nextId = 1;
  let list: Entry[] = []; // sorted by due, then id
  const insert = (entry: Entry): void => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const other = list[mid];
      if (other.due < entry.due || (other.due === entry.due && other.id < entry.id)) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, entry);
  };
  const handle = (id: number): Timer => ({
    id,
    get active() {
      return list.some((entry) => entry.id === id);
    },
    cancel() {
      const at = list.findIndex((entry) => entry.id === id);
      if (at >= 0) list.splice(at, 1);
    },
  });
  const add = (length: number, fn: TimerCallback, repeat: boolean, where: string): Timer => {
    check(Number.isFinite(length) && length >= 0, where, length, 'a finite duration in sim seconds, 0 or more');
    const span = length * hz;
    check(!repeat || span >= 1 - EPS, where, length, `a period of one tick (1/${hz} s) or more`);
    const id = nextId++;
    insert({ id, due: ticks + Math.max(span, 1), period: repeat ? Math.max(span, 1) : 0, fn });
    return handle(id);
  };

  return {
    get ticks() {
      return ticks;
    },
    get size() {
      return list.length;
    },
    after: (length, fn) => add(length, fn, false, 'timers.after(seconds)'),
    every: (length, fn) => add(length, fn, true, 'timers.every(seconds)'),
    step() {
      ticks++;
      while (list.length && list[0].due <= ticks + EPS) {
        const entry = list.shift()!;
        if (entry.period) insert({ ...entry, due: entry.due + entry.period });
        entry.fn(handle(entry.id));
      }
    },
    clear() {
      list = [];
    },
    state: () => ({ ticks, nextId, timers: list.map((entry) => [entry.id, entry.due, entry.period]) }),
    capture: () => ({ ticks, nextId, timers: list.map((entry) => ({ ...entry })) }),
    restore(capture) {
      ticks = capture.ticks;
      nextId = capture.nextId;
      list = [];
      for (const entry of capture.timers) insert({ ...entry });
    },
  };
}

/** A per-entity clock: plain numbers a component holds, so captures and the hash take it as data. */
export interface EntityClock {
  /** Speed against the world: 1 the same, 0.5 half speed, 0 stopped (0 or more). */
  rate: number;
  /** World seconds left in a freeze (the entity's own hit-stop); 0 when running. */
  frozen: number;
  /** The entity's own seconds so far. */
  time: number;
}

/** Makes an entity clock running at `rate`. */
export function createEntityClock(rate = 1): EntityClock {
  check(Number.isFinite(rate) && rate >= 0, 'createEntityClock(rate)', rate, 'a finite rate, 0 or more');
  return { rate, frozen: 0, time: 0 };
}

/** Advances `clock` by the world's (or its owner's) `dt` seconds and returns the entity's own dt for this step. */
export function advanceEntityClock(clock: EntityClock, dt: number): number {
  const frozen = clock.frozen > EPS_SECONDS ? clock.frozen : 0;
  clock.frozen = frozen > dt ? frozen - dt : 0;
  const own = (dt > frozen ? dt - frozen : 0) * clock.rate;
  clock.time += own;
  return own;
}

/** Freezes `clock` for `seconds` of world time; a longer freeze already running is kept. */
export function freezeEntityClock(clock: EntityClock, seconds: number): void {
  check(Number.isFinite(seconds) && seconds >= 0, 'freezeEntityClock(seconds)', seconds, 'finite seconds, 0 or more');
  clock.frozen = Math.max(clock.frozen, seconds);
}
