/**
 * @file Unit tests for engine/core/time.ts (T1): the frame clock against fixed stepping under seeded random frame
 * times at 30, 60, 75, 120 and 144 Hz (the state after 10 s identical, step counts and alpha exact every frame), alpha
 * values, the spiral-of-death clamp and its advice, the time scale, pause and single steps, the slowdown stack, the
 * leaky hit-stop budget (grants checked against the source's formula), the time settings, the refusal of a missing
 * or bad timestamp, and the virtual clock.
 * @see engine/core/time.ts
 */
import { describe, expect, it } from 'vitest';
import { createLog, EngineError } from './log';
import { derive, Rng } from './rng';
import { registry } from './registry';
import { createSettings } from './settings';
import { createClock, createVirtualClock, SIM_DT, SIM_HZ, type Clock, type VirtualClock } from './time';
import { advanceEntityClock, createEntityClock, createTimers, freezeEntityClock } from './timers';

/** The code of the EngineError `fn` throws. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  throw new Error('expected an EngineError');
}

/** Runs `count` frames of `ms` each on the virtual clock; returns the steps they handed out. */
function frames(clock: Clock, time: VirtualClock, count: number, ms = 1000 / 60): number {
  let steps = 0;
  for (let i = 0; i < count; i++) {
    time.tick(ms);
    steps += clock.advance().steps;
  }
  return steps;
}

/** A clock on a virtual clock, its first frame (the origin) already run. */
function started(options: Parameters<typeof createClock>[0] = {}): { clock: Clock; time: VirtualClock } {
  const time = createVirtualClock(1000);
  const clock = createClock({ now: time.now, ...options });
  clock.advance();
  return { clock, time };
}

/** A small sim: a forced, damped spring with noise, a repeating and a one-shot timer, and a slowed entity. */
function toy() {
  const timers = createTimers();
  const state = {
    x: 1,
    v: 0,
    kicks: 0,
    steps: 0,
    rng: new Rng(derive(7, 'toy')),
    timers,
    local: createEntityClock(0.75),
  };
  timers.every(0.25, () => (state.v += (state.rng.next() - 0.5) * 0.1 * ++state.kicks));
  timers.after(3.3, () => freezeEntityClock(state.local, 0.2));
  return state;
}

function stepToy(state: ReturnType<typeof toy>): void {
  const own = advanceEntityClock(state.local, SIM_DT);
  state.v += (-4 * state.x - 0.3 * state.v + Math.sin(state.steps * 0.1 + state.local.time)) * SIM_DT;
  state.x += state.v * SIM_DT + own * 1e-3;
  state.steps++;
  state.timers.step();
}

/** Every number of the toy's state. */
function snapshot({ rng, timers, local, ...rest }: ReturnType<typeof toy>): unknown {
  return { ...rest, rng: rng.state, timers: timers.state(), ...local };
}

/** Frame timestamps at `rate` Hz for `seconds` from `start`, each interval within ±20% (seeded), quantized to 5 µs. */
function frameTimes(rate: number, seconds: number, start: number): number[] {
  const rng = new Rng(derive(2026, 'frames', rate));
  const end = start + seconds * 1000;
  const times = [start];
  let t = start;
  while (t < end) {
    t += (1000 / rate) * (0.8 + 0.4 * rng.next());
    times.push(Math.min(end, Math.round(t * 200) / 200));
  }
  times[times.length - 1] = end;
  return times;
}

describe('the frame clock against fixed stepping', () => {
  for (const rate of [30, 60, 75, 120, 144]) {
    it(`gives the fixed-step state after 10 s of seeded random frames at ${rate} Hz`, () => {
      const start = 1234.5;
      const clock = createClock();
      const driven = toy();
      let ticks = 0;
      for (const now of frameTimes(rate, 10, start)) {
        const frame = clock.advance(now);
        for (let i = 0; i < frame.steps; i++) stepToy(driven);
        ticks += frame.steps;
        const units = Math.round((now - start) * 1e6) * SIM_HZ; // elapsed nanoseconds × hz: one step is 1e9
        expect(frame.dropped).toBe(0);
        expect(ticks).toBe(Math.floor(units / 1e9));
        expect(frame.alpha).toBe((units % 1e9) / 1e9);
      }
      const fixed = toy();
      for (let i = 0; i < 600; i++) stepToy(fixed);
      expect(ticks).toBe(600);
      expect(clock.ticks).toBe(600);
      expect(snapshot(driven)).toEqual(snapshot(fixed));
      expect(driven.kicks).toBe(40);
    });
  }
});

describe('alpha and the step count', () => {
  it('starts at the first timestamp, then hands out whole steps and the fraction left as alpha', () => {
    const clock = createClock();
    expect(clock.advance(1000)).toMatchObject({ steps: 0, alpha: 0, elapsed: 0 });
    expect(clock.advance(1025)).toMatchObject({ steps: 1, alpha: 0.5, elapsed: 0.025 });
    expect(clock.advance(1030)).toMatchObject({ steps: 0, alpha: 0.8 });
    expect(clock.advance(1030 + 1000 / 60)).toMatchObject({ steps: 1 });
    const frame = clock.advance(1050);
    expect(clock.alpha).toBe(frame.alpha);
    expect(clock.hz).toBe(60);
    expect(clock.dt).toBe(SIM_DT);
  });

  it('counts nothing for a timestamp that goes backwards, and counts on from there', () => {
    const clock = createClock();
    clock.advance(500);
    expect(clock.advance(400)).toMatchObject({ steps: 0, elapsed: 0 });
    expect(clock.advance(450)).toMatchObject({ steps: 3, alpha: 0 });
  });
});

describe('the spiral-of-death clamp', () => {
  it('runs at most maxSteps after a stall, drops the whole steps beyond and keeps the fraction', () => {
    const clock = createClock();
    clock.advance(0);
    expect(clock.advance(1010)).toMatchObject({ steps: 6, dropped: 54, alpha: 0.6 });
    expect(clock.advance(1010 + 1000 / 60)).toMatchObject({ steps: 1, dropped: 0 });
    expect(clock.state().dropped).toBe(54);
    const three = createClock({ maxSteps: 3 });
    three.advance(0);
    expect(three.advance(1000)).toMatchObject({ steps: 3, dropped: 57, alpha: 0 });
  });

  it('advises once when frames keep dropping steps, and never for a single stall', () => {
    const printed: string[] = [];
    const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
    const { clock, time } = started({ log });
    frames(clock, time, 1, 2000); // a tab coming back
    frames(clock, time, 60);
    frames(clock, time, 9, 200); // 12 steps due each, 6 run
    expect(printed).toEqual([]);
    frames(clock, time, 20, 200);
    expect(printed).toEqual([
      '[CORE_CLOCK_BEHIND] the sim is falling behind real time: 10 frames in a row each needed more than time.maxSteps = 6 steps, and the rest were dropped: make each step cheaper (__engine.stats() shows where the time goes) or lighten the scene; raise time.maxSteps only when frames are long and steps cheap',
    ]);
    frames(clock, time, 1);
    frames(clock, time, 10, 200); // a second slow spell: counted, not printed
    expect(printed.length).toBe(1);
    expect(log.advice[0].count).toBe(2);
  });
});

describe('the time scale', () => {
  it('scales how many steps real time gives, through the time.scale setting', () => {
    const { clock, time } = started();
    clock.timeScale = 0.5;
    expect(frames(clock, time, 60)).toBe(30);
    expect(clock.settings.get('time.scale')).toBe(0.5);
    clock.settings.set('time.scale', 2);
    expect(frames(clock, time, 60)).toBe(120);
    expect(clock.speed).toBe(2);
    clock.timeScale = 0;
    expect(frames(clock, time, 60)).toBe(0);
    expect(clock.speed).toBe(0);
  });

  it('reads a given store live, so x set, URL parameters and __engine.set reach the clock', () => {
    const settings = createSettings();
    settings.fromUrl('?time.scale=0.25');
    const { clock, time } = started({ settings });
    expect(frames(clock, time, 60)).toBe(15);
    settings.set('time.scale', 1);
    expect(frames(clock, time, 60)).toBe(60);
  });
});

describe('pause and single steps', () => {
  it('stops steps while paused, keeps alpha, runs requested steps, and owes nothing on resume', () => {
    const { clock, time } = started();
    frames(clock, time, 1, 25); // 1.5 steps: alpha 0.5
    clock.pause();
    expect(clock.paused).toBe(true);
    expect(clock.settings.get('time.paused')).toBe(true);
    expect(frames(clock, time, 60)).toBe(0);
    expect(clock.alpha).toBe(0.5);
    clock.step();
    expect(clock.advance(time.tick(1000 / 60))).toMatchObject({ steps: 1, alpha: 0.5 });
    clock.step(3);
    expect(frames(clock, time, 1)).toBe(3);
    clock.resume();
    expect(frames(clock, time, 60)).toBe(60);
    clock.step(2);
    expect(frames(clock, time, 1)).toBe(3);
  });

  it('pauses through the time.paused setting too, and refuses a bad step count', () => {
    const { clock, time } = started();
    clock.settings.set('time.paused', true);
    expect(frames(clock, time, 30)).toBe(0);
    expect(clock.speed).toBe(0);
    expect(codeOf(() => clock.step(-1))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => clock.step(1.5))).toBe('CORE_BAD_TIME');
  });
});

describe('the slowdown stack', () => {
  it('lets the slowest live slowdown win; an id replaces its own; pop removes one', () => {
    const { clock } = started();
    clock.push('finisher', 0.5);
    clock.push('dodge', 0.25);
    expect(clock.speed).toBe(0.25);
    clock.push('dodge', 0.75);
    expect(clock.speed).toBe(0.5);
    expect(clock.pop('finisher')).toBe(true);
    expect(clock.pop('finisher')).toBe(false);
    expect(clock.speed).toBe(0.75);
    clock.timeScale = 2;
    expect(clock.speed).toBe(1.5);
    expect(clock.state().slowdowns).toEqual([{ id: 'dodge', k: 0.75, seconds: null }]);
  });

  it('counts a slowdown in real seconds, so it never stretches itself, whatever the frame rate', () => {
    for (const ms of [1000 / 30, 1000 / 144, 1000]) {
      const { clock, time } = started({ maxSteps: 100 });
      clock.push('dodge', 0.25, 0.5);
      const steps = frames(clock, time, Math.round(1000 / ms), ms);
      expect(steps).toBe(37); // 0.5 s at a quarter (7.5 steps), then 0.5 s at full speed (30)
      expect(clock.alpha).toBe(0.5);
      expect(clock.state().slowdowns).toEqual([]);
    }
  });

  it('refuses a k outside 0..1, an empty id and a negative duration', () => {
    const { clock } = started();
    expect(codeOf(() => clock.push('fast', 1.5))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => clock.push('back', -0.5))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => clock.push('', 0.5))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => clock.push('dodge', 0.5, -1))).toBe('CORE_BAD_TIME');
  });
});

/** The hit-stop budget as `ed/10-combat.js:57-61` computes it: the oracle the clock is checked against. */
function budget(soft = 0.07, refill = 0.22, floor = 0.18) {
  let debt = 0;
  let last = 0;
  let stop = 0;
  return (at: number, seconds: number, left: number): number => {
    debt = Math.max(0, debt - (at - last) * refill);
    last = at;
    stop = left;
    const want = seconds * Math.min(1, Math.max(floor, 1 - debt / soft));
    debt += Math.max(0, want - stop);
    return want;
  };
}

describe('hit-stop', () => {
  it('stops sim time for the stop, in real seconds, whatever the frame rate', () => {
    for (const ms of [1000 / 30, 1000 / 75, 1000]) {
      const { clock, time } = started({ maxSteps: 100 });
      expect(clock.hitStop(0.1)).toBe(0.1);
      expect(clock.speed).toBe(0);
      expect(frames(clock, time, Math.round(1000 / ms), ms)).toBe(54);
      expect(clock.speed).toBe(1);
    }
  });

  it('never adds up calls made together: the longest stop holds, and later ones are shrunk', () => {
    const { clock } = started();
    expect(clock.hitStop(0.07)).toBe(0.07);
    expect(clock.hitStop(0.07)).toBeCloseTo(0.07 * 0.18, 15);
    expect(clock.state().hitStop.seconds).toBe(0.07);
  });

  it('lets a crowd stutter once: a dash through six foes, each hit the step after the last stop ends', () => {
    const { clock, time } = started();
    const oracle = budget();
    const grants: number[] = [];
    let real = 0;
    for (let foe = 0; foe < 6; foe++) {
      const granted = clock.hitStop(0.07);
      expect(granted).toBeCloseTo(oracle(real, 0.07, 0), 12);
      grants.push(granted);
      const stopFrames = Math.ceil((granted * 1000) / (1000 / 60) - 1e-9) + 1;
      frames(clock, time, stopFrames);
      real += (stopFrames * 1000) / 60 / 1000;
    }
    expect(grants[0]).toBe(0.07);
    const total = grants.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(0.07 * 6 * 0.5);
  });

  it('refills between blows of a steady rhythm, and a stop outside the budget is never shrunk', () => {
    const { clock, time } = started();
    for (let blow = 0; blow < 4; blow++) {
      expect(clock.hitStop(0.07)).toBe(0.07);
      frames(clock, time, 30); // 0.5 s: the debt leaks away
    }
    clock.hitStop(0.07);
    expect(clock.hitStop(0.3, { budget: false })).toBe(0.3);
    expect(clock.state().hitStop.seconds).toBe(0.3);
    expect(clock.state().hitStop.debt).toBeCloseTo(0.07, 15);
  });

  it('holds while paused, and reads its budget from the time.hitStop settings', () => {
    const { clock, time } = started();
    clock.hitStop(0.1);
    clock.pause();
    frames(clock, time, 60);
    clock.resume();
    expect(frames(clock, time, 6)).toBe(0);
    expect(frames(clock, time, 6)).toBe(6);
    clock.settings.set('time.hitStop.floor', 0.5);
    clock.hitStop(0.07);
    expect(clock.hitStop(0.07)).toBeCloseTo(0.035, 15);
    expect(codeOf(() => clock.hitStop(-0.1))).toBe('CORE_BAD_TIME');
  });
});

describe('the time settings', () => {
  it('declares time.hz for the sim and the rest as view settings', () => {
    const rows = createSettings()
      .describe()
      .filter((row) => row.path.startsWith('time.'));
    expect(rows.map((row) => [row.path, row.default, row.view, row.when])).toEqual([
      ['time.hitStop.floor', 0.18, true, 'now'],
      ['time.hitStop.refill', 0.22, true, 'now'],
      ['time.hitStop.soft', 0.07, true, 'now'],
      ['time.hz', 60, false, 'scene'],
      ['time.maxSteps', 6, true, 'now'],
      ['time.paused', false, true, 'now'],
      ['time.scale', 1, true, 'now'],
    ]);
    expect(registry.has('setting', 'time.hz')).toBe(true);
    const settings = createSettings();
    expect(settings.sim.get('time.hz')).toBe(60);
    expect(codeOf(() => settings.sim.get('time.scale'))).toBe('CORE_VIEW_SETTING');
    expect(Object.keys(settings.sim.values()).filter((path) => path.startsWith('time.'))).toEqual(['time.hz']);
  });

  it('validates the options through the schema, and reads time.hz again on reset', () => {
    expect(codeOf(() => createClock({ hz: 0 }))).toBe('CORE_BAD_SETTING');
    expect(codeOf(() => createClock({ maxSteps: 2.5 }))).toBe('CORE_BAD_SETTING');
    const { clock, time } = started({ hz: 30 });
    expect(clock.dt).toBe(1 / 30);
    expect(frames(clock, time, 60)).toBe(30);
    clock.settings.set('time.hz', 120);
    expect(clock.hz).toBe(30);
    clock.push('dodge', 0.5);
    clock.reset();
    expect(clock.state()).toMatchObject({ ticks: 0, slowdowns: [], alpha: 0 });
    expect(clock.hz).toBe(120);
    clock.advance();
    expect(frames(clock, time, 60)).toBe(120);
  });
});

describe('no wall clock inside', () => {
  it('refuses advance without a timestamp or now(), and a timestamp that is not a number', () => {
    expect(codeOf(() => createClock().advance())).toBe('CORE_NO_TIME');
    expect(codeOf(() => createClock().advance(Number.NaN))).toBe('CORE_BAD_TIME');
  });
});

describe('the virtual clock', () => {
  it('moves only when told, and drives a clock through now()', () => {
    const time = createVirtualClock(1000);
    expect(time.now()).toBe(1000);
    expect(time.tick(16.5)).toBe(1016.5);
    expect(time.now()).toBe(1016.5);
    expect(codeOf(() => time.tick(-1))).toBe('CORE_BAD_TIME');
    const clock = createClock({ now: time.now });
    clock.advance();
    time.tick(50);
    expect(clock.advance()).toMatchObject({ steps: 3, alpha: 0 });
  });
});
