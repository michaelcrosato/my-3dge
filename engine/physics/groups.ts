/**
 * @file Collision groups (PLAN.md WP 3.1, §5.1): the one table of what touches what, by name. Every collider belongs
 * to one group; two colliders touch, and a query hits a collider, only when the table lets them.
 *
 * | Group | Is | Touches |
 * |---|---|---|
 * | `world` | the level and other fixed geometry | everything |
 * | `prop` | crates, barrels, debris | world, prop, actor, crowd, corpse |
 * | `actor` | the hero and other characters with a controller | world, prop, crowd |
 * | `crowd` | crowd agents (WP 5.1) | world, prop, actor, crowd |
 * | `flyer` | wisps and other things that fly through the crowd | world, flyer |
 * | `corpse` | the dead, until they are removed | world, prop |
 *
 * Invariants: the table is symmetric (each group lists every group that lists it), so a pair touches exactly when the
 * table says so whichever collider Rapier tests first. In Rapier's encoding a group is `membership << 16 | filter`, and a
 * pair touches when each one's filter holds the other's membership; `groupBits` makes it from the table, and queries
 * use `queryBits`, which hits the groups named and nothing else.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:30-33` (`GROUPS`: world, prop, hero, mob, wisp, dead), renamed
 * for what they are (hero → actor, mob → crowd, wisp → flyer, dead → corpse).
 *
 * @example
 * touches('prop', 'actor'); // true
 * touches('flyer', 'crowd'); // false
 * groupBits('world').toString(16); // '1003f': member of world (bit 1), touches all six groups
 * dropGroups(groupBits('actor'), ['crowd']).toString(16); // '40003': an actor's query that passes the crowd
 * @see engine/physics/groups.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { show } from '../core/schema';

/** The codes this module raises, with their fixes. */
export const GROUP_CODES = defineCodes('physics', {
  PHYSICS_UNKNOWN_GROUP: {
    template: 'there is no collision group {group}{suggestion}',
    fix: 'name one of the groups in engine/physics/groups.ts: world, prop, actor, crowd, flyer, corpse',
  },
});

/** The collision groups: each one's membership bit and the groups it touches. */
export const COLLISION_GROUPS = Object.freeze({
  world: { bit: 1, touches: ['world', 'prop', 'actor', 'crowd', 'flyer', 'corpse'] },
  prop: { bit: 2, touches: ['world', 'prop', 'actor', 'crowd', 'corpse'] },
  actor: { bit: 4, touches: ['world', 'prop', 'crowd'] },
  crowd: { bit: 8, touches: ['world', 'prop', 'actor', 'crowd'] },
  flyer: { bit: 16, touches: ['world', 'flyer'] },
  corpse: { bit: 32, touches: ['world', 'prop'] },
} as const);

/** A collision group's name. */
export type GroupName = keyof typeof COLLISION_GROUPS;

/** The group names, in table order. */
export const GROUP_NAMES = Object.keys(COLLISION_GROUPS) as GroupName[];

/** The table entry of `group`; throws `PHYSICS_UNKNOWN_GROUP` naming the closest. */
function entry(group: string) {
  if (!Object.hasOwn(COLLISION_GROUPS, group)) {
    throw codeError('PHYSICS_UNKNOWN_GROUP', { group: show(group), suggestion: didYouMean(group, GROUP_NAMES) });
  }
  return COLLISION_GROUPS[group as GroupName];
}

/** The membership bits of the groups named. */
function bitsOf(groups: readonly string[]): number {
  return groups.reduce((bits, group) => bits | entry(group).bit, 0);
}

/** Whether colliders of groups `a` and `b` touch. */
export function touches(a: GroupName, b: GroupName): boolean {
  return (entry(a).touches as readonly string[]).includes(b);
}

/** Rapier's interaction groups for a collider of `group`: its membership bit and the bits of what it touches. */
export function groupBits(group: GroupName): number {
  const { bit, touches: touched } = entry(group);
  return ((bit << 16) | bitsOf(touched)) >>> 0;
}

/**
 * Rapier's interaction groups `bits` (a collider's `groupBits`) with the groups named taken out of what they touch: a
 * character controller's query that passes through them (engine/physics/character.ts `shoves`), the collider itself
 * still touching them in the solver. Throws `PHYSICS_UNKNOWN_GROUP`.
 */
export function dropGroups(bits: number, groups: readonly string[]): number {
  return (bits & ~bitsOf(groups)) >>> 0;
}

/** Rapier's interaction groups for a query that hits the groups named (all of them when none are). */
export function queryBits(groups?: GroupName | readonly GroupName[]): number {
  const named = groups === undefined ? GROUP_NAMES : typeof groups === 'string' ? [groups] : groups;
  return ((0xffff << 16) | bitsOf(named)) >>> 0;
}
