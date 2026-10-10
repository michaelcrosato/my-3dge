/**
 * @file The frame clock (PLAN.md §6.3, §6.4, WP 1.3, ADR-0005; doctrine: Reproducible): it turns real time into fixed
 * 60 Hz sim steps plus an interpolation `alpha`, under a time scale, a stack of slowdowns, a hit-stop with a leaky
 * budget and pause; plus a virtual clock for tests. Nothing here reads a wall clock: real time arrives from outside,
 * as the timestamps the page's loop passes to `clock.advance(now)` (requestAnimationFrame's argument), or from the
 * `now` it is given. Timers and per-entity clocks, which run in sim time, are in engine/core/timers.ts.
 *
 * `createClock` keeps an accumulator (Glenn Fiedler's "Fix your timestep"): each frame adds the real time since the
 * last, times the speed, and hands out the whole steps in it, at most `time.maxSteps`; after a stall the steps beyond
 * are dropped and only the fraction is kept. The speed is `time.scale` times the slowest pushed slowdown (`push(id,
 * k, seconds?)`, `pop(id)`), and 0 while paused or in a hit-stop. Slowdowns and hit-stops are sim decisions (rules
 * call them) that change how many steps a frame runs, never what a step does, so the clock is no part of the hash,
 * captures or replays (they record each step's intents); their durations count real seconds, so a slowdown never
 * stretches itself. The budget shrinks hit-stops that follow each other closely, so a crowd stutters once.
 *
 * Invariants: the accumulator counts whole nanoseconds times `hz` (one step is 1e9), so at speed 1 the steps after T
 * ms are exactly floor(T × hz / 1000) however the frames fall: random frame times give the fixed-step state. A
 * slowdown or hit-stop that ends inside a frame ends at its exact time. A paused frame counts no time, so resuming
 * owes none. Settings (the store's, read every frame): `time.hz` (sim-side, read when made or reset) and the view
 * settings `time.maxSteps`, `time.scale`, `time.paused` and `time.hitStop.*`. Ten frames in a row that drop steps
 * raise `CORE_CLOCK_BEHIND`, printed once and counted per slow spell; a single stall drops its backlog quietly.
 *
 * Carried from `my-3d2dge:src/lab3d/60-panel.js:143-152` (the fixed loop, its 6-step cap),
 * `my-3d2dge:src/emberdeep/10-combat.js:45-76` (the hit-stop budget, its numbers kept) and
 * `my-3d2dge:src/emberdeep/00-core.js:146-161` (the slow-motion stack, now without a wall clock).
 *
 * @example
 * const clock = createClock({ hz: 60 });
 * clock.advance(1000); // { steps: 0, alpha: 0, … }: the first frame sets the origin
 * const frame = clock.advance(1025); // 25 ms later: { steps: 1, alpha: 0.5, … }
 * clock.push('dodge', 0.25, 0.5); // a quarter speed for half a real second
 * clock.hitStop(0.07); // 0.07: a full stop; another at once would get 0.0126
 * const time = createVirtualClock(0); // tests: createClock({ now: time.now }), then time.tick(ms)
 * @see engine/core/time.test.ts
 */
import { defineCodes, codeError, log as sharedLog, type Log } from './log';
import { show, type Field } from './schema';
import { createSettings, defineSettings, type Settings } from './settings';

/** The sim's steps per second: gameplay time is counted in 60 Hz ticks (ADR-0005). */
export const SIM_HZ = 60;
/** One sim step in seconds, 1/60. */
export const SIM_DT = 1 / SIM_HZ;

/** The codes this module raises, with their fixes. */
export const TIME_CODES = defineCodes('core', {
  CORE_NO_TIME: {
    template: 'clock.advance() got no timestamp, and the clock has no now()',
    fix: "pass the frame's time in milliseconds, clock.advance(timestamp) with requestAnimationFrame's argument, or create the clock with createClock({ now }) (createVirtualClock().now in tests): sim-side code never reads a wall clock",
  },
  CORE_BAD_TIME: {
    template: '{where} got {value}',
    fix: 'pass {expected}',
    doc: 'Raised by engine/core/time.ts and engine/core/timers.ts for a timestamp that is not a finite number, a negative or infinite duration, a slowdown `k` outside 0..1 (speed-ups go through the `time.scale` setting), an empty slowdown id, an `every` shorter than one tick, a step count that is not a whole number, or an entity clock rate below 0.',
  },
  CORE_CLOCK_BEHIND: {
    template:
      'the sim is falling behind real time: {frames} frames in a row each needed more than time.maxSteps = {maxSteps} steps, and the rest were dropped',
    fix: 'make each step cheaper (__engine.stats() shows where the time goes) or lighten the scene; raise time.maxSteps only when frames are long and steps cheap',
    doc: 'Advice from `clock.advance` (engine/core/time.ts): the game runs slower than real time. A single stall (a tab coming back, a debugger pause) drops its backlog without advice.',
  },
});

/** The time settings, path → field; `defineSettings(TIME_SETTINGS, registry)` declares them on another registry. */
export const TIME_SETTINGS = {
  'time.hz': {
    type: 'integer',
    default: SIM_HZ,
    minimum: 1,
    maximum: 1000,
    unit: 'Hz',
    when: 'scene',
    description: 'Sim steps per second. The engine is tuned at 60 (ADR-0005); the hash and replays record it.',
  },
  'time.maxSteps': {
    type: 'integer',
    default: 6,
    minimum: 1,
    maximum: 1000,
    view: true,
    description:
      'The most steps one frame runs to catch up; a longer stall drops the rest (the spiral-of-death guard).',
  },
  'time.scale': {
    type: 'number',
    default: 1,
    minimum: 0,
    maximum: 100,
    view: true,
    description:
      'Sim seconds per real second: 0.5 is half speed. It changes how often steps come, never what one does.',
  },
  'time.paused': {
    type: 'boolean',
    default: false,
    view: true,
    description: 'Stops sim time; clock.step(n) still runs single steps.',
  },
  'time.hitStop.soft': {
    type: 'number',
    default: 0.07,
    minimum: 0.001,
    unit: 's',
    view: true,
    description: 'Hit-stop debt at which a new stop shrinks to its floor share: about one full stop.',
  },
  'time.hitStop.refill': {
    type: 'number',
    default: 0.22,
    minimum: 0,
    view: true,
    description: 'Seconds of hit-stop debt forgiven per real second, so a steady rhythm keeps its full stops.',
  },
  'time.hitStop.floor': {
    type: 'number',
    default: 0.18,
    minimum: 0,
    maximum: 1,
    view: true,
    description: 'The smallest share of the asked stop a hit-stop gets, however deep in debt.',
  },
} as const satisfies Record<string, Field>;
defineSettings(TIME_SETTINGS);

/** Throws `CORE_BAD_TIME` unless `ok`. */
function check(ok: boolean, where: string, value: unknown, expected: string): void {
  if (!ok) throw codeError('CORE_BAD_TIME', { where, value: show(value), expected });
}

/** Checks a duration in seconds: finite and at least 0. */
function seconds(value: number, where: string): number {
  check(Number.isFinite(value) && value >= 0, where, value, 'a finite duration in seconds, 0 or more');
  return value;
}

/** Nanoseconds per second; the accumulator counts nanoseconds × hz, so one step is `NS` units. */
const NS = 1e9;
/** The real time one frame counts at most (an hour), so the integer arithmetic stays exact. */
const MAX_FRAME_NS = 3600 * NS;
/** Frames in a row that must drop steps before `CORE_CLOCK_BEHIND`. */
const BEHIND_FRAMES = 10;

/** What one `advance` hands out. */
export interface Frame {
  /** Fixed steps to run now, each `clock.dt` of sim time. */
  steps: number;
  /** In [0, 1): how far real time is past the last step, toward the next; the view blends the last two states by it. */
  alpha: number;
  /** Real seconds since the previous frame (0 for the first, or for a timestamp that went back). */
  elapsed: number;
  /** Sim seconds per real second at the end of the frame: what sound pitch and effects follow. */
  speed: number;
  /** Whole steps dropped after a stall, beyond `time.maxSteps`. */
  dropped: number;
}

/** The clock's state as plain data, for the inspector and tests (never hashed: it changes no step). */
export interface ClockState {
  ticks: number;
  alpha: number;
  speed: number;
  timeScale: number;
  paused: boolean;
  /** Single steps waiting for the next frame. */
  pending: number;
  /** Whole steps dropped after stalls, in all. */
  dropped: number;
  /** Live slowdowns, in push order; `seconds` left is null for one that lasts until popped. */
  slowdowns: { id: string; k: number; seconds: number | null }[];
  /** The hit-stop: real seconds left, and the budget's debt in seconds. */
  hitStop: { seconds: number; debt: number };
}

/** Turns frame timestamps into fixed steps: the accumulator, the time scale, slowdowns, hit-stop and pause. */
export interface Clock {
  /** Sim steps per second (`time.hz` when the clock was made or reset). */
  readonly hz: number;
  /** One step in sim seconds, 1/hz. */
  readonly dt: number;
  /** Steps handed out since the clock was made or reset. */
  readonly ticks: number;
  /** The latest frame's alpha. */
  readonly alpha: number;
  /** Sim seconds per real second now: `timeScale` × the slowest slowdown, 0 while paused or in a hit-stop. */
  readonly speed: number;
  /** The base time scale: the `time.scale` setting, read and written through. */
  timeScale: number;
  /** Whether sim time is paused: the `time.paused` setting. */
  readonly paused: boolean;
  /** The store the clock reads its settings from (its own one unless given one). */
  readonly settings: Settings;
  /** Takes the frame's timestamp in milliseconds (default: `now()`) and returns the steps to run and alpha. */
  advance(now?: number): Frame;
  /** Pauses sim time (sets `time.paused`); keep calling `advance`, the view still renders. */
  pause(): void;
  /** Resumes sim time from the next frame. */
  resume(): void;
  /** Adds `n` steps to the next frame, paused or not, whatever the speed: `__engine.step(n)`. */
  step(n?: number): void;
  /** Slows time to `k` (0..1) until `pop(id)` or for `seconds` of real time; the slowest wins; an id replaces its own. */
  push(id: string, k: number, seconds?: number): void;
  /** Removes the slowdown `id`; false when there was none. */
  pop(id: string): boolean;
  /** Stops sim time for `seconds` of real time, shrunk by the budget unless `budget: false`; returns the stop granted. */
  hitStop(seconds: number, options?: { budget?: boolean }): number;
  /** The state as plain data. */
  state(): ClockState;
  /** Back to a fresh clock (a scene start): reads `time.hz` again and forgets the origin, slowdowns and hit-stop. */
  reset(): void;
}

/** How a clock is made. `hz` and `maxSteps` are set on the store; a store over another registry needs TIME_SETTINGS. */
export interface ClockOptions {
  /** Sets `time.hz`: sim steps per second. */
  hz?: number;
  /** Sets `time.maxSteps`: the most steps one frame runs. */
  maxSteps?: number;
  /** The frame time source in milliseconds, for `advance()` without an argument; nothing by default. */
  now?: () => number;
  /** The settings store to read and write (default: a new one over the shared registry). */
  settings?: Settings;
  /** Where `CORE_CLOCK_BEHIND` goes (default: the shared log). */
  log?: Log;
}

/** Makes a frame clock; it reads `time.*` from its settings store on every frame. */
export function createClock(options: ClockOptions = {}): Clock {
  const settings = options.settings ?? createSettings();
  const out = options.log ?? sharedLog;
  if (options.hz !== undefined) settings.set('time.hz', options.hz);
  if (options.maxSteps !== undefined) settings.set('time.maxSteps', options.maxSteps);
  const get = (path: string) => settings.get<number>(path);
  let hz = 0;
  let origin: number | undefined; // the first timestamp, in ms
  let lastNs = 0; // the previous frame, in ns since the origin
  let acc = 0; // ns × hz, a whole number
  let ticks = 0;
  let pending = 0;
  let dropped = 0;
  let behind = 0;
  let hitNs = 0; // hit-stop left
  let debt = 0; // the budget's debt, in seconds
  let runNs = 0; // real time run (not paused), for the debt's leak
  let lastHitNs = 0;
  const slowdowns = new Map<string, { k: number; ns: number }>();
  const reset = (): void => {
    hz = get('time.hz');
    origin = undefined;
    lastNs = acc = ticks = pending = dropped = behind = hitNs = debt = runNs = lastHitNs = 0;
    slowdowns.clear();
  };
  reset();
  const paused = () => settings.get<boolean>('time.paused');
  const speed = (): number => {
    if (paused() || hitNs > 0) return 0;
    let k = 1;
    for (const slow of slowdowns.values()) k = Math.min(k, slow.k);
    return get('time.scale') * k;
  };
  /** Runs `ns` of real time: the accumulator at each piece's speed, ending hit-stops and slowdowns at their times. */
  const run = (ns: number): void => {
    while (ns > 0) {
      let piece = hitNs > 0 ? Math.min(ns, hitNs) : ns;
      for (const slow of slowdowns.values()) piece = Math.min(piece, slow.ns);
      acc += Math.round(piece * hz * speed());
      hitNs = Math.max(0, hitNs - piece);
      for (const [id, slow] of slowdowns) if ((slow.ns -= piece) <= 0) slowdowns.delete(id);
      runNs += piece;
      ns -= piece;
    }
  };

  const clock: Clock = {
    get hz() {
      return hz;
    },
    get dt() {
      return 1 / hz;
    },
    get ticks() {
      return ticks;
    },
    get alpha() {
      return acc / NS;
    },
    get speed() {
      return speed();
    },
    get timeScale() {
      return get('time.scale');
    },
    set timeScale(k) {
      settings.set('time.scale', k);
    },
    get paused() {
      return paused();
    },
    settings,
    advance(now = options.now?.()) {
      if (now === undefined) throw codeError('CORE_NO_TIME');
      check(Number.isFinite(now), 'clock.advance(now)', now, 'a finite timestamp in milliseconds');
      origin ??= now;
      const nowNs = Math.round((now - origin) * 1e6);
      const ns = Math.min(MAX_FRAME_NS, Math.max(0, nowNs - lastNs));
      lastNs = nowNs;
      let steps = 0;
      let lost = 0;
      if (!paused()) {
        run(ns);
        steps = Math.floor(acc / NS);
        acc -= steps * NS;
        const maxSteps = get('time.maxSteps');
        if (steps > maxSteps) [lost, steps] = [steps - maxSteps, maxSteps];
        behind = lost > 0 ? behind + 1 : 0;
        if (behind === BEHIND_FRAMES) out.warnOnce('CORE_CLOCK_BEHIND', { frames: BEHIND_FRAMES, maxSteps });
      }
      steps += pending;
      pending = 0;
      ticks += steps;
      dropped += lost;
      return { steps, alpha: acc / NS, elapsed: ns / NS, speed: speed(), dropped: lost };
    },
    pause: () => void settings.set('time.paused', true),
    resume: () => void settings.set('time.paused', false),
    step(n = 1) {
      check(Number.isInteger(n) && n >= 0, 'clock.step(n)', n, 'a whole number of steps, 0 or more');
      pending += n;
    },
    push(id, k, length) {
      check(typeof id === 'string' && id.length > 0, 'clock.push(id, k)', id, 'a slowdown id, a non-empty string');
      check(Number.isFinite(k) && k >= 0 && k <= 1, `clock.push(${show(id)}, k)`, k, 'a slowdown k from 0 to 1');
      const ns = length === undefined ? Infinity : Math.round(seconds(length, `clock.push(${show(id)})`) * NS);
      slowdowns.delete(id);
      if (ns > 0) slowdowns.set(id, { k, ns });
    },
    pop: (id) => slowdowns.delete(id),
    hitStop(length, { budget = true } = {}) {
      let want = seconds(length, 'clock.hitStop(seconds)');
      if (budget) {
        debt = Math.max(0, debt - ((runNs - lastHitNs) / NS) * get('time.hitStop.refill'));
        lastHitNs = runNs;
        want *= Math.min(1, Math.max(get('time.hitStop.floor'), 1 - debt / get('time.hitStop.soft')));
        debt += Math.max(0, want - hitNs / NS);
      }
      hitNs = Math.max(hitNs, Math.round(want * NS));
      return want;
    },
    state: () => ({
      ticks,
      alpha: acc / NS,
      speed: speed(),
      timeScale: get('time.scale'),
      paused: paused(),
      pending,
      dropped,
      slowdowns: [...slowdowns].map(([id, s]) => ({ id, k: s.k, seconds: s.ns === Infinity ? null : s.ns / NS })),
      hitStop: { seconds: hitNs / NS, debt },
    }),
    reset,
  };
  return clock;
}

/** A clock for tests that moves only when told: `now()` in milliseconds, as a page's timestamps are. */
export interface VirtualClock {
  /** The current time in milliseconds; pass it as `createClock({ now: time.now })`. */
  now(): number;
  /** Moves time on by `ms` (0 or more) and returns the new time. */
  tick(ms: number): number;
}

/** Makes a virtual clock starting at `start` milliseconds. */
export function createVirtualClock(start = 0): VirtualClock {
  check(Number.isFinite(start), 'createVirtualClock(start)', start, 'a finite time in milliseconds');
  let time = start;
  return {
    now: () => time,
    tick(ms) {
      check(Number.isFinite(ms) && ms >= 0, 'time.tick(ms)', ms, 'a finite number of milliseconds, 0 or more');
      return (time += ms);
    },
  };
}
