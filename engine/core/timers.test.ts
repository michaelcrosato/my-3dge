/**
 * @file Unit tests for engine/core/timers.ts (T1): timers in sim time (first step at or after their time, phase kept
 * for fractional periods, due then creation order, a timer made while firing waits a step, cancel from outside and
 * inside, bad durations refused, plain state, capture and restore continuing exactly, a throw leaving the list
 * sound) and per-entity clocks (rate, nesting, freezes in world seconds, the longest winning, leftovers carried).
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
        [1, 30, 30],
        [2, 60, 0],
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
