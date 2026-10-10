/**
 * @file Unit tests for engine/core/timers.ts (T1): timers in sim time (first step at or after their time, the tick
 * counted as a step begins so a timer made before its timers stage waits a step, `every` exact past 130,000 periods of
 * 0.07 s, firing n of `every` on its own exact tick (1/7, 1/9, 1/13 s), phase kept for fractional periods, at most one
 * firing a step, due then creation order, a timer made while firing waits a step, cancel from outside and inside, bad
 * durations refused, plain state, capture and restore continuing exactly with the firing count, a throw leaving the
 * list sound) and per-entity clocks (rate, nesting, freezes in world seconds, the longest winning, leftovers carried).
 * @see engine/core/timers.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from './log';
import { SIM_DT } from './time';
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

describe('timers in sim time', () => {
  it('fires after on the first step at or after its time, never in the step that made it', () => {
    const timers = createTimers();
    const fired: number[] = [];
    timers.after(0.5, () => fired.push(timers.ticks));
    timers.after(0, () => fired.push(timers.ticks));
    for (let i = 0; i < 40; i++) timers.step();
    expect(fired).toEqual([1, 30]);
  });

  it('counts the tick as a step begins and fires at the timers stage: a timer made between them waits a step', () => {
    const timers = createTimers();
    const fired: string[] = [];
    timers.step();
    timers.step();
    timers.tick(); // step 3 begins: systems ahead of the timers stage run now
    expect(timers.ticks).toBe(3);
    timers.after(0, () => fired.push(`after(0) at ${timers.ticks}`));
    timers.after(1 / 60, () => fired.push(`after(1/60) at ${timers.ticks}`));
    timers.fire(); // the timers stage of step 3
    expect(fired).toEqual([]);
    timers.step();
    expect(fired).toEqual(['after(0) at 4', 'after(1/60) at 4']);
  });

  it('keeps every exact over many periods: firing n of every(0.07) lands on tick ceil(4.2 n), past 130,000', () => {
    const timers = createTimers();
    const off: string[] = [];
    let n = 0;
    timers.every(0.07, () => {
      n++;
      const exact = Math.floor((21 * n + 4) / 5); // ceil(21 n / 5) in integers
      if (timers.ticks !== exact && off.length < 3) off.push(`#${n} at ${timers.ticks}, not ${exact}`);
    });
    for (let i = 0; i < 548_100; i++) timers.step(); // 130,500 periods of 4.2 ticks
    expect(off).toEqual([]);
    expect(n).toBe(130_500);
  });

  it('puts firing n of every on its own exact tick: never a rounded period added up (1/7, 1/9, 1/13 s at 60 Hz)', () => {
    const timers = createTimers();
    const at: Record<string, number[]> = { '1/7': [], '1/9': [], '1/13': [] };
    timers.every(1 / 7, () => at['1/7'].push(timers.ticks)); // 8.571428… ticks
    timers.every(1 / 9, () => at['1/9'].push(timers.ticks)); // 6.666… ticks
    timers.every(1 / 13, () => at['1/13'].push(timers.ticks)); // 4.615… ticks
    for (let i = 0; i < 6000; i++) timers.step();
    expect([at['1/7'][6], at['1/9'][2], at['1/13'][12]]).toEqual([60, 20, 60]);
    const exact = (k: number, n: number) => Math.ceil((60 * n) / k - 1e-9); // ceil(60 n / k), a whole when k divides
    for (const [k, ticks] of [7, 9, 13].map((k) => [k, at[`1/${k}`]] as const)) {
      expect(ticks.length, `1/${k}`).toBe((6000 * k) / 60);
      const off = ticks.map((tick, i) => [i + 1, tick]).filter(([n, tick]) => tick !== exact(k, n));
      expect(off.slice(0, 3), `1/${k}`).toEqual([]);
    }
  });

  it('keeps the phase of every, so a fractional period keeps its average rate exactly', () => {
    const timers = createTimers();
    const quick: number[] = [];
    const tenth: number[] = [];
    timers.every(0.025, () => quick.push(timers.ticks)); // 1.5 ticks
    timers.every(0.1, () => tenth.push(timers.ticks)); // 6.000000000000001 ticks
    for (let i = 0; i < 600; i++) timers.step();
    expect(quick.slice(0, 6)).toEqual([2, 3, 5, 6, 8, 9]);
    expect(quick.length).toBe(400);
    expect(tenth.slice(0, 3)).toEqual([6, 12, 18]);
    expect(tenth.length).toBe(100);
  });

  it('fires in due order, then creation order, and waits a step for a timer made while firing', () => {
    const timers = createTimers();
    const fired: string[] = [];
    timers.after(0.05, () => fired.push('c'));
    timers.after(0.05, () => fired.push('d'));
    timers.after(1 / 30, () => {
      fired.push('b');
      timers.after(0, () => fired.push(`made at ${timers.ticks - 1}`));
    });
    timers.after(1 / 60, () => fired.push('a'));
    for (let i = 0; i < 4; i++) timers.step();
    expect(fired).toEqual(['a', 'b', 'c', 'd', 'made at 2']);
  });

  it('cancels, from outside or from inside its own callback', () => {
    const timers = createTimers();
    let ticks = 0;
    const never = timers.after(0.1, () => (ticks = -1));
    expect(never.active).toBe(true);
    never.cancel();
    expect(never.active).toBe(false);
    timers.every(1 / 60, (timer) => {
      if (++ticks === 3) timer.cancel();
    });
    for (let i = 0; i < 10; i++) timers.step();
    expect(ticks).toBe(3);
    expect(timers.size).toBe(0);
  });

  it('refuses a repeat shorter than one tick and a bad duration', () => {
    const timers = createTimers();
    expect(codeOf(() => timers.every(0.01, () => {}))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => timers.after(-1, () => {}))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => timers.after(Number.NaN, () => {}))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => createTimers({ hz: 0 }))).toBe('CORE_BAD_TIME');
  });

  it('gives its state as plain numbers, and restores a capture that continues exactly', () => {
    const timers = createTimers();
    const log: string[] = [];
    const wave = timers.every(0.5, () => log.push(`wave ${timers.ticks}`));
    timers.after(1, () => log.push(`boss ${timers.ticks}`));
    for (let i = 0; i < 10; i++) timers.step();
    expect(timers.state()).toEqual({
      ticks: 10,
      nextId: 3,
      timers: [
        [1, 30, 30, 0, 0],
        [2, 60, 0, 0, 0],
      ],
    });
    const saved = timers.capture();
    for (let i = 0; i < 100; i++) timers.step();
    const first = log.splice(0);
    timers.restore(saved);
    for (let i = 0; i < 100; i++) timers.step();
    expect(log).toEqual(first);
    wave.cancel(); // a handle made before the restore still reaches its timer
    expect(timers.state().timers).toEqual([]);
    timers.after(1, () => {});
    timers.clear();
    expect(timers.size).toBe(0);
  });

  it('keeps the firing count and phase of every through capture and restore, and through its plain numbers alone', () => {
    const timers = createTimers();
    const log: number[] = [];
    const record = () => log.push(timers.ticks);
    timers.every(1 / 7, record);
    for (let i = 0; i < 50; i++) timers.step(); // fired 5 times: 9, 18, 26, 35, 43
    expect(log.splice(0)).toEqual([9, 18, 26, 35, 43]);
    const numbers = JSON.stringify(timers.state()); // [id, due, period, start, fired]: due 51.428571 (6 × 8.571428…)
    expect(JSON.parse(numbers)).toEqual({ ticks: 50, nextId: 2, timers: [[1, 51.428571, (1 / 7) * 60, 0, 5]] });
    const saved = timers.capture();
    for (let i = 0; i < 70; i++) timers.step();
    const first = log.splice(0);
    expect(first).toEqual([52, 60, 69, 78, 86, 95, 103, 112, 120]); // firing n on ceil(60 n / 7)
    timers.restore(saved);
    for (let i = 0; i < 70; i++) timers.step();
    expect(log.splice(0)).toEqual(first);
    const copy = createTimers(); // the state's numbers alone carry the phase: one callback handed back
    const { ticks, nextId, timers: list } = JSON.parse(numbers) as ReturnType<typeof timers.state>;
    copy.restore({
      ticks,
      nextId,
      timers: list.map(([id, due, period, start, fired]) => ({
        id,
        due,
        period,
        start,
        fired,
        fn: () => log.push(copy.ticks),
      })),
    });
    for (let i = 0; i < 70; i++) copy.step();
    expect(log).toEqual(first);
  });

  it('fires every at most once a step, even where rounding would put two firings of a near-tick period in one', () => {
    const timers = createTimers();
    const fired = 2_499_950; // a period of 0.9999996 ticks rounds to one tick; firing 2,499,999 meets 2,499,998's tick
    const due = Math.round((fired + 1) * 0.9999996 * 1e6) / 1e6;
    const at: number[] = [];
    const fn = () => at.push(timers.ticks);
    timers.restore({
      ticks: Math.ceil(due) - 1,
      nextId: 2,
      timers: [{ id: 1, due, period: 0.9999996, start: 0, fired, fn }],
    });
    for (let i = 0; i < 100; i++) timers.step();
    expect(at).toHaveLength(100);
    expect(new Set(at).size).toBe(100);
  });

  it('removes a one-shot timer before calling it, so a throw leaves the list sound', () => {
    const timers = createTimers();
    timers.after(0, () => {
      throw new Error('boom');
    });
    expect(() => timers.step()).toThrow('boom');
    expect(timers.size).toBe(0);
  });
});

describe('per-entity clocks', () => {
  it('runs at its own rate against the world, as plain numbers a component holds', () => {
    const slow = createEntityClock(0.5);
    expect(slow).toEqual({ rate: 0.5, frozen: 0, time: 0 });
    expect(advanceEntityClock(slow, SIM_DT)).toBe(SIM_DT * 0.5);
    slow.rate = 2;
    expect(advanceEntityClock(slow, SIM_DT)).toBe(SIM_DT * 2);
    expect(slow.time).toBe(SIM_DT * 0.5 + SIM_DT * 2);
    const effect = createEntityClock();
    expect(advanceEntityClock(effect, advanceEntityClock(slow, SIM_DT))).toBe(SIM_DT * 2);
  });

  it('freezes for world seconds, the longest freeze winning, and carries the leftover of a step', () => {
    const hit = createEntityClock();
    freezeEntityClock(hit, 0.1);
    freezeEntityClock(hit, 0.05);
    const dts = Array.from({ length: 8 }, () => advanceEntityClock(hit, SIM_DT));
    expect(dts).toEqual([0, 0, 0, 0, 0, 0, SIM_DT, SIM_DT]);
    freezeEntityClock(hit, 0.025);
    expect(advanceEntityClock(hit, SIM_DT)).toBe(0);
    expect(advanceEntityClock(hit, SIM_DT)).toBeCloseTo(2 * SIM_DT - 0.025, 15);
    expect(hit.frozen).toBe(0);
    expect(codeOf(() => createEntityClock(-1))).toBe('CORE_BAD_TIME');
    expect(codeOf(() => freezeEntityClock(hit, Number.POSITIVE_INFINITY))).toBe('CORE_BAD_TIME');
  });
});
