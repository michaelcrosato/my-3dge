/**
 * @file Unit tests for the damage numbers from the sim (engine/app/damageNumbers.ts): each new `damage` event that took
 * hit points shows one number with its value, `DAMAGE_RISE` m above where it struck; events already shown, other
 * types and hits of no hit points show none; a new world is read from its first event.
 * @see engine/app/damageNumbers.ts
 */
import { describe, expect, it } from 'vitest';
import type { TraceRecord } from '../core/events';
import { createDamageNumbers, DAMAGE_RISE } from './damageNumbers';

/** A world whose trace is `records`. */
const world = (records: TraceRecord[]) => ({ events: { trace: () => records } });
/** A traced `damage` event of `amount` at x = `x`. */
const hit = (seq: number, amount: number, x = 0): TraceRecord => ({
  seq,
  type: 'damage',
  payload: { target: 2, source: 1, amount, hp: 10, killed: false, at: [x, 1, 0], dir: [1, 0, 0], stop: 0 },
  listeners: 0,
  failed: 0,
});

describe('damage numbers from the sim', () => {
  it('shows each new hit once, with its value, above where it struck', () => {
    const shown: [number, unknown][] = [];
    const numbers = createDamageNumbers({ damage: (value, options) => shown.push([value, options.at]) });
    const records = [hit(1, 12), { ...hit(2, 0), type: 'hit' }, hit(3, 0), hit(4, 22, 3)];
    const fight = world(records);
    expect(numbers.frame(fight)).toBe(2);
    expect(shown).toEqual([
      [12, [0, 1 + DAMAGE_RISE, 0]],
      [22, [3, 1 + DAMAGE_RISE, 0]],
    ]);
    expect(numbers.frame(fight)).toBe(0); // already shown
    records.push(hit(5, 9));
    expect(numbers.frame(fight)).toBe(1);
    expect(numbers.frame(world([hit(1, 7)]))).toBe(1); // a new world: from its first event
    expect(shown.map(([value]) => value)).toEqual([12, 22, 9, 7]);
  });
});
