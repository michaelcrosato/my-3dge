/**
 * @file Which of the gym's signs show (docs/PLAYGROUND.md §2; labs/playground/main.ts labels them, WP 13.38):
 * `signShown(sign, player, where, covered)`. A sign's label draws over everything, walls too, so on the block it shows
 * only while the player stands in the gym (from the yard or the house the signs showed through their walls: the owner's
 * report of 2026-11-03, "you can see through walls"), and only within `SIGN_RANGE` of him, the features around him
 * rather than the whole gym at once; on the gym's own scene the range alone decides, and with no player every sign
 * shows. None shows while a screen covers the play (`covered`: photo mode, a menu).
 *
 * Invariants: pure; presentation only.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * const [x, z] = [20, 30]; // a sign's place on the block, in the gym
 * signShown([x, 1, z], { x: x + 2, z }, { gymScene: false, structure: 'gym-site' }, false); // true: in the gym, 2 m off
 * signShown([x, 1, z], { x: x + 2, z }, { gymScene: false, structure: 'house' }, false); // false: from the house
 * signShown([x, 1, z], { x: x + 2, z }, { gymScene: false, structure: null }, false); // false: outdoors, in the yard
 * @see labs/playground/ui/signs.test.ts
 */
import { SITE_STRUCTURES } from '../levels/site';

/** How near the player a sign shows (m): the features around him, not the whole gym at once. */
export const SIGN_RANGE = 24;

/** Where the player stands, for the signs: on the gym's own scene, and in which of the block's structures, by name. */
export interface SignPlace {
  /** The gym's own scene (labs/playground/scenes/gym.ts): no site, the gym all round him. */
  readonly gymScene: boolean;
  /** The structure his feet stand in on the block (engine/world/siteQueries.ts `siteStructureAt`); none outdoors. */
  readonly structure?: string | null;
}

/** Whether the sign at `sign` (world, m) shows for `player` standing at `where`, unless `covered` (see the file comment). */
export function signShown(
  sign: readonly number[],
  player: { readonly x: number; readonly z: number } | null | undefined,
  where: SignPlace,
  covered: boolean,
): boolean {
  if (covered) return false;
  if (!player) return true;
  const inGym = where.gymScene || `level:${where.structure}` === SITE_STRUCTURES.gym.level;
  return inGym && Math.hypot(sign[0] - player.x, sign[2] - player.z) <= SIGN_RANGE;
}
