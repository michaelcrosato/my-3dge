/**
 * @file Tests for awareness (engine/world/awareness.ts): sight puts the target where it is seen and wakes an unaware
 * agent once; it remembers where for `memory` seconds, then forgets; a noise is heard within its loudness times the
 * agent's hearing, half as far through a wall, the nearest for its earshot winning among several, its maker kept;
 * sight wins over a noise in the same step; bad input names its field.
 */
import { describe, expect, it } from 'vitest';
import { AWARENESS, earshot, hears, sense, type Awareness, type Noise } from './awareness';
import type { SteerPoint } from './steer';

/** An agent with `fields` over the defaults. */
const agent = (fields: Partial<Awareness> = {}): Awareness => ({ ...AWARENESS, ...fields });
/** A noise of `loudness` metres at (x, 1, z), made by `source`. */
const noise = (x: number, z: number, loudness: number, source = 2, kind = 'shot'): Noise => ({ x, y: 1, z, loudness, source, kind }); // prettier-ignore
const ears: SteerPoint = { x: 0, y: 1, z: 0 };

describe('awareness', () => {
  it('sees its target where he is, waking once, and remembers where for its memory', () => {
    const aware = agent({ memory: 3 });
    const target = { x: 5, y: 0, z: -2 };
    expect(sense(aware, { time: 1, ears, sees: false })).toEqual({ state: 'unaware', alerted: false });
    expect(sense(aware, { time: 2, ears, sees: true, target })).toEqual({ state: 'sees', alerted: true });
    expect([aware.x, aware.y, aware.z, aware.seen, aware.at]).toEqual([5, 0, -2, 2, 2]);
    expect(sense(aware, { time: 2.5, ears, sees: true, target: { x: 6, y: 0, z: -2 } })).toEqual({ state: 'sees', alerted: false }); // prettier-ignore
    expect(sense(aware, { time: 3, ears, sees: false })).toEqual({ state: 'remembers', alerted: false });
    expect([aware.x, aware.seen]).toEqual([6, 2.5]); // where it last saw him
    expect(sense(aware, { time: 5.5, ears, sees: false }).state).toBe('remembers'); // 3 s after: still
    expect(sense(aware, { time: 5.6, ears, sees: false }).state).toBe('unaware'); // forgotten
    expect(sense(aware, { time: 6, ears, sees: true, target }).alerted).toBe(true); // woken again
  });

  it('hears a noise within its loudness times its hearing, half as far through a wall, and keeps its maker', () => {
    expect(hears(noise(9, 0, 10), ears)).toBe(true);
    expect(hears(noise(11, 0, 10), ears)).toBe(false);
    const walled = () => false;
    expect([earshot(noise(9, 0, 10), ears, 1, walled), hears(noise(9, 0, 10), ears, 1, walled)]).toEqual([5, false]);
    expect(hears(noise(4, 0, 10), ears, 1, walled)).toBe(true);
    expect([hears(noise(9, 0, 10), ears, 2), hears(noise(1, 0, 10), ears, 0)]).toEqual([true, false]); // keen; deaf
    const aware = agent();
    expect(sense(aware, { time: 4, ears, sees: false, noises: [noise(6, 8, 20, 7, 'kick')] })).toEqual({ state: 'heard', alerted: true }); // prettier-ignore
    expect([aware.x, aware.z, aware.heard, aware.source, aware.at]).toEqual([6, 8, 4, 7, 4]);
    expect(sense(aware, { time: 5, ears, sees: false }).state).toBe('remembers'); // where the noise was
  });

  it('turns to the noise nearest for its earshot, the first of equals, and sees over what it hears', () => {
    const aware = agent();
    const far = noise(30, 0, 100, 3); // 30% of its earshot away
    const near = noise(0, 5, 10, 4); // 50% of its earshot away
    sense(aware, { time: 1, ears, sees: false, noises: [near, far, noise(0, 50, 10, 5)] });
    expect([aware.source, aware.x]).toEqual([3, 30]);
    sense(aware, { time: 2, ears, sees: false, noises: [noise(0, 3, 10, 8), noise(3, 0, 10, 9)] });
    expect(aware.source).toBe(8); // equals: the first
    expect(sense(aware, { time: 3, ears, sees: true, target: { x: 1, y: 0, z: 1 }, noises: [far] })).toEqual({ state: 'sees', alerted: false }); // prettier-ignore
    expect([aware.x, aware.heard, aware.source]).toEqual([1, 3, 3]); // it heard too
  });

  it('refuses a time or a point that is no number, and a sighting with no target', () => {
    expect(() => sense(agent(), { time: Number.NaN, ears, sees: false })).toThrow(/CORE_BAD_SPEC.*time/);
    expect(() => sense(agent(), { time: 1, ears: { x: 0, y: Infinity, z: 0 }, sees: false })).toThrow(/ears\.y/);
    expect(() => sense(agent(), { time: 1, ears, sees: true })).toThrow(/no target/);
  });
});
