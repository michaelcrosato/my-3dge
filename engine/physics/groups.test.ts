/**
 * @file Tests for the collision groups (engine/physics/groups.ts): the table is symmetric, Rapier's bits say what the
 * table says for every pair, queries hit only the groups they name, and an unknown group names the closest.
 */
import { describe, expect, it } from 'vitest';
import { COLLISION_GROUPS, GROUP_NAMES, groupBits, queryBits, touches, type GroupName } from './groups';

/** Rapier's rule: two colliders touch when each one's filter holds the other's membership. */
function rapierTouches(a: number, b: number): boolean {
  return ((a >>> 16) & b & 0xffff) !== 0 && ((b >>> 16) & a & 0xffff) !== 0;
}

describe('collision groups', () => {
  it('has the six groups, one bit each', () => {
    expect(GROUP_NAMES).toEqual(['world', 'prop', 'actor', 'crowd', 'flyer', 'corpse']);
    const bits = GROUP_NAMES.map((name) => COLLISION_GROUPS[name].bit);
    expect(new Set(bits).size).toBe(6);
    for (const bit of bits) expect(bit & (bit - 1)).toBe(0);
  });

  it('is symmetric, and Rapier’s bits agree with the table for every pair', () => {
    for (const a of GROUP_NAMES) {
      for (const b of GROUP_NAMES) {
        expect(touches(a, b), `${a}–${b}`).toBe(touches(b, a));
        expect(rapierTouches(groupBits(a), groupBits(b)), `${a}–${b}`).toBe(touches(a, b));
      }
    }
  });

  it('keeps the prototype’s pairs: the world touches all, flyers pass through the crowd, corpses only fall', () => {
    expect(GROUP_NAMES.every((name) => touches('world', name))).toBe(true);
    expect([touches('flyer', 'crowd'), touches('flyer', 'actor'), touches('flyer', 'flyer')]).toEqual([
      false,
      false,
      true,
    ]);
    expect([touches('corpse', 'world'), touches('corpse', 'prop'), touches('corpse', 'crowd')]).toEqual([
      true,
      true,
      false,
    ]);
    expect(touches('actor', 'actor')).toBe(false);
  });

  it('makes queries that hit exactly the groups named (all by default)', () => {
    const named: GroupName[] = ['world', 'prop'];
    for (const group of GROUP_NAMES) {
      expect(rapierTouches(queryBits(named), groupBits(group)), group).toBe(named.includes(group));
      expect(rapierTouches(queryBits(), groupBits(group)), group).toBe(true);
      expect(rapierTouches(queryBits(group), groupBits(group)), group).toBe(true);
    }
  });

  it('names the closest group for an unknown one', () => {
    expect(() => groupBits('wrold' as GroupName)).toThrow(/PHYSICS_UNKNOWN_GROUP.*"wrold".*world/);
    expect(() => queryBits(['prop', 'mob' as GroupName])).toThrow(/PHYSICS_UNKNOWN_GROUP/);
  });
});
