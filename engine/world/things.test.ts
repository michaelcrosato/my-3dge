/**
 * @file Tests for things (engine/world/things.ts): a hit counts and takes its points, the last one putting the thing
 * down, which takes no hit until it stands back up after its kind's `rise` with its points whole, or never (broken);
 * a standing thing slides along its track at its speed and turns back at each end, one down stays where it fell; the
 * kind's defaults, its fallback and its refusals.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../core/registry';
import { defineThing, getThing, hitThing, stepThing, thingAt, thingState } from './things';

describe('things', () => {
  it('count their hits, go down at the last point, and stand back up after their rise with their points whole', () => {
    const reg = createRegistry();
    const kind = defineThing('thing:dummy', { hp: 3, rise: 2 }, reg);
    const dummy = thingState(kind, [1, 0, 2]);
    expect([hitThing(dummy, kind, 1, 1), hitThing(dummy, kind, 0, 1.5)]).toEqual([{ outcome: 'hit', hp: 2 }, { outcome: 'hit', hp: 2 }]); // prettier-ignore
    expect(hitThing(dummy, kind, 5, 2)).toEqual({ outcome: 'down', hp: 0 });
    expect([dummy.state, dummy.hits, dummy.hitAt, dummy.downAt]).toEqual(['down', 3, 2, 2]);
    expect(hitThing(dummy, kind, 1, 3)).toBeNull(); // down: no hit
    expect(dummy.hits).toBe(3);
    expect(stepThing(dummy, kind, 3.9, 1 / 60)).toBe(false);
    expect(stepThing(dummy, kind, 4, 1 / 60)).toBe(true); // 2 s after it fell
    expect([dummy.state, dummy.hp]).toEqual(['up', 3]);
    expect(hitThing(dummy, kind, 1, 4.5)).toEqual({ outcome: 'hit', hp: 2 });
  });

  it('break for good when their kind never rises', () => {
    const reg = createRegistry();
    const kind = defineThing('thing:bottle', { rise: -1 }, reg);
    const bottle = thingState(kind, [0, 1, 0]);
    expect(hitThing(bottle, kind, 1, 0)).toEqual({ outcome: 'broken', hp: 0 });
    expect([stepThing(bottle, kind, 100, 1 / 60), bottle.state, hitThing(bottle, kind, 1, 101)]).toEqual([false, 'broken', null]); // prettier-ignore
  });

  it('slide along their track at their speed while they stand, turning back at each end', () => {
    const reg = createRegistry();
    const kind = defineThing('thing:mover', { track: [3, 0, -4], speed: 2.5 }, reg); // 5 m long, 2 s each way
    const mover = thingState(kind, [10, 1, 10]);
    const places: number[][] = [];
    for (let k = 1; k <= 300; k++) {
      stepThing(mover, kind, k / 60, 1 / 60);
      if (k % 60 === 0) places.push(thingAt(mover, kind).map((v) => +v.toFixed(6)));
    }
    expect(places).toEqual([[11.5, 1, 8], [13, 1, 6], [11.5, 1, 8], [10, 1, 10], [11.5, 1, 8]]); // prettier-ignore
    hitThing(mover, kind, 1, 5);
    const fell = thingAt(mover, kind);
    stepThing(mover, kind, 5.5, 1 / 60);
    expect(thingAt(mover, kind)).toEqual(fell); // down: it stays where it fell
    const still = thingState(getThing('thing:target', reg), [0, 0, 0]);
    stepThing(still, getThing('thing:target', reg), 1, 1);
    expect(still.along).toBe(0);
  });

  it('take their kind’s defaults, fall back to thing:target with a warning, and refuse a bad track or point', () => {
    const reg = createRegistry();
    const target = getThing('thing:target', reg);
    expect([target.prop, target.hp, target.rise, target.track, target.speed]).toEqual(['prop:crate', 1, 3, [0, 0, 0], 0]); // prettier-ignore
    expect(() => target.hit({ thing: thingState(target, [0, 0, 0]), kind: target, from: [0, 0, 0], outcome: 'hit', amount: 1 })).not.toThrow(); // prettier-ignore
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getThing('thing:tagret', reg).id).toBe('thing:target');
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[CORE_UNKNOWN_ID\].*thing:tagret.*defineThing/)]); // prettier-ignore
    warn.mockRestore();
    expect(() => defineThing('thing:bent', { track: [1, 2] as never }, reg)).toThrow(/CORE_BAD_SPEC.*track/);
    expect(() => thingState(target, [0, Number.NaN, 0])).toThrow(/CORE_BAD_SPEC.*metres/);
    expect(() => hitThing(thingState(target, [0, 0, 0]), target, -1, 0)).toThrow(/CORE_BAD_SPEC.*0 points or more/);
  });
});
