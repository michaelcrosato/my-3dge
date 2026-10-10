/**
 * @file Unit tests for engine/input/intents.ts (T1): the vocabulary is checked and normalized (fixed key order, sorted
 * buttons, frozen copies, unknown keys named with the closest), presses are the given taps plus the edges of `b`,
 * `fromCamera` walks away from the camera at every heading and never faster than 1, and the replay encoding round
 * trips: `applyIntents(prev, diffIntents(prev, next))` gives `next` back over seeded random sequences, `-0` included.
 * @see engine/input/intents.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/log';
import { Rng } from '../core/rng';
import {
  applyIntents,
  diffIntents,
  fromCamera,
  held,
  NO_INTENTS,
  normalizeIntents,
  pressed,
  type IntentChanges,
  type Intents,
} from './intents';

/** The message of the EngineError `fn` throws. */
function failure(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return `${error.code} ${error.message}`;
    throw error;
  }
  throw new Error('expected an EngineError');
}

describe('normalizeIntents', () => {
  it('keeps the vocabulary in a fixed order, sorts buttons and freezes copies', () => {
    const raw = { 'game:charge': { level: 2, tags: ['a'] }, b: ['jump', 'attack', 'jump'], cam: 0.5, move: [0, 1] };
    const intents = normalizeIntents(raw);
    expect(Object.keys(intents)).toEqual(['move', 'cam', 'b', 'p', 'game:charge']);
    expect(intents.b).toEqual(['attack', 'jump']);
    expect(intents.p).toEqual(['attack', 'jump']);
    expect(Object.isFrozen(intents) && Object.isFrozen(intents.move) && Object.isFrozen(intents['game:charge'])).toBe(
      true,
    );
    expect(intents.move).not.toBe(raw.move);
  });

  it('leaves out null, undefined and empty button lists', () => {
    expect(normalizeIntents({ move: null, b: [], p: [], aim: undefined })).toEqual({});
    expect(normalizeIntents()).toEqual({});
  });

  it('names unknown keys with the closest, and every bad value at once', () => {
    const message = failure(() => normalizeIntents({ mvoe: [0, 1], cam: NaN, aim: [1, 2], b: [''], charge: 1 }));
    expect(message).toMatch(/^INPUT_BAD_INTENTS/);
    expect(message).toContain('unknown key "mvoe" (did you mean "move"?)');
    expect(message).toContain('custom keys are namespaced: "game:charge"');
    expect(message).toContain('cam is NaN; it must be a finite number');
    expect(message).toContain('aim is [1,2]; it must be 3 finite numbers');
    expect(message).toContain('b holds ""');
    expect(failure(() => normalizeIntents({ 'game:x': [1, Infinity] }))).toContain('game:x[1] is Infinity');
    expect(failure(() => normalizeIntents({ 'game:x': { f: () => 1 } }))).toContain('game:x.f is a function');
    expect(failure(() => normalizeIntents([1] as unknown))).toContain('intents are an object');
    expect(failure(() => normalizeIntents({ toString: 1 }))).toContain('unknown key "toString"');
  });

  it('suggests the namespaced form a misspelt custom key means', () => {
    expect(failure(() => normalizeIntents({ 'Game:x': 1 }))).toContain('custom keys are namespaced: "game:x"');
    expect(failure(() => normalizeIntents({ 'game:': 1 }))).toContain('custom keys are namespaced: "game:key"');
    expect(failure(() => normalizeIntents({ 'my game:charge up': 1 }))).toContain(
      'custom keys are namespaced: "mygame:chargeup"',
    );
  });

  it('presses on the step a button goes down, adds taps, and repeats holds without pressing', () => {
    const one = normalizeIntents({ b: ['jump'] });
    const two = normalizeIntents({ b: ['jump', 'run'] }, one);
    const three = normalizeIntents({ b: ['run'], p: ['jump'] }, two);
    expect([pressed(one, 'jump'), pressed(two, 'jump'), pressed(two, 'run')]).toEqual([true, false, true]);
    expect([held(three, 'jump'), pressed(three, 'jump'), pressed(three, 'run')]).toEqual([false, true, false]);
    expect([held(NO_INTENTS, 'jump'), pressed(NO_INTENTS, 'jump')]).toEqual([false, false]);
  });
});

describe('fromCamera', () => {
  it('walks away from the camera with W, to its right with D, at every heading', () => {
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * 2 * Math.PI - Math.PI;
      const [x, z] = fromCamera(yaw, [0, 1]);
      expect(x).toBeCloseTo(Math.sin(yaw), 14);
      expect(z).toBeCloseTo(Math.cos(yaw), 14);
      const [rx, rz] = fromCamera(yaw, [1, 0]);
      // right = forward × up: at yaw 0 the camera looks along +Z and its right is −X.
      expect(rx).toBeCloseTo(-Math.cos(yaw), 14);
      expect(rz).toBeCloseTo(Math.sin(yaw), 14);
    }
    expect(fromCamera(0, [0, 1])).toEqual([0, 1]);
    expect(fromCamera(0, [1, 0])).toEqual([-1, 0]);
  });

  it('scales two keys at once to length 1 and keeps a half-pushed stick', () => {
    const [x, z] = fromCamera(0.3, [1, 1]);
    expect(Math.hypot(x, z)).toBeCloseTo(1, 15);
    const [hx, hz] = fromCamera(0.3, [0, 0.5]);
    expect(Math.hypot(hx, hz)).toBeCloseTo(0.5, 15);
    expect(fromCamera(1, [0, 0]).map(Math.abs)).toEqual([0, 0]);
  });
});

describe('the replay encoding', () => {
  it('writes only what changed, null for a cleared key, p only for unexplained taps', () => {
    const a = normalizeIntents({ move: [0, 1], cam: 0.5, b: ['run'] });
    const b = normalizeIntents({ move: [0, 1], cam: 0.5, b: ['jump', 'run'], p: ['use'] }, a);
    expect(diffIntents(a, b)).toEqual({ b: ['jump', 'run'], p: ['use'] });
    expect(diffIntents(b, normalizeIntents({ cam: 0.5 }, b))).toEqual({ b: null, move: null });
    expect(diffIntents(b, normalizeIntents({ move: [0, 1], cam: 0.5, b: ['jump', 'run'] }, b))).toEqual({});
    expect(diffIntents(a, normalizeIntents({ move: [-0, 1], cam: 0.5, b: ['run'] }, a))).toEqual({ move: [-0, 1] });
  });

  it('round trips random sequences exactly: apply(prev, diff(prev, next)) is next', () => {
    const rng = new Rng(7);
    const pick = <T>(items: readonly T[]) => items[rng.int(0, items.length - 1)];
    const numbers = [0, -0, 1, -1, 0.1, 1e-300, Math.PI];
    let live: Intents = NO_INTENTS;
    let replayed: Intents = NO_INTENTS;
    const changes: IntentChanges[] = [];
    let last: Record<string, unknown> = {};
    for (let step = 0; step < 500; step++) {
      const raw: Record<string, unknown> = rng.next() < 0.3 ? { ...last, p: undefined } : {};
      if (rng.next() < 0.7) raw.move = [pick(numbers), pick(numbers)];
      if (rng.next() < 0.5) raw.cam = pick(numbers);
      if (rng.next() < 0.3) raw.aim = [pick(numbers), pick(numbers), pick(numbers)];
      if (rng.next() < 0.6) raw.b = ['a', 'b', 'c'].filter(() => rng.next() < 0.5);
      if (rng.next() < 0.2) raw.p = [pick(['a', 'b', 'tap'])];
      if (rng.next() < 0.3) raw['game:mode'] = pick(['x', 'y', 1, true]);
      last = raw;
      const next = normalizeIntents(raw, live);
      const change = diffIntents(live, next);
      changes.push(change);
      replayed = applyIntents(replayed, structuredClone(change));
      expect(replayed).toEqual(next);
      for (const key of ['move', 'aim'] as const) {
        next[key]?.forEach((value, i) => expect(Object.is(value, replayed[key]?.[i])).toBe(true));
      }
      live = next;
    }
    expect(changes.filter((change) => Object.keys(change).length === 0).length).toBeGreaterThan(0);
  });
});
