/**
 * @file The block (docs/PLAYGROUND.md §2, PLAN.md WP 13.18): the playground's one site, `site:block`, 96 × 113 m of
 * terrain (`terrain:site`: the hill's ground, labs/playground/scenes/hill.ts, flattened under the yards, the range and
 * the street) and the structures standing on it, in world metres (+X east, +Z south):
 * - the range along the north edge (z 0 to 12, x 0 to 60): its shelter at x 2 to 6, its backstop at x 58; the ring
 *   east of it (x 60 to 72);
 * - the gym as built (WP 13.1 to 13.7), 41 × 101 m from (0, 12), its wall open by three gates (`GYM_GATES`): the
 *   §2 sketch's 36 × 70 m strip could not hold it, so the block runs 17 m further south than §2's 96 m (amendment 20);
 * - the backyard (x 41 to 72, z 12 to 44): the tree house, the shed; the house (labs/playground/levels/house.ts) with
 *   its garage, patio and porch at (44, 44); the front yard (z 63 to 83) with its path and the driveway;
 * - the street (z 83 to 95, x 41 to 96), from the gym's east gate to the block's east edge; the hill (x 72 to 96),
 *   rising to 10 m over the east edge's middle, the lookout on its top.
 * `SITE_AREAS` names each area's spawn: where a scene of that area puts the player, facing the way it says.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * SITE_AREAS.house.at; // [51.5, 0, 57]: in the hall, inside the front door
 * @see labs/playground/scenes/site.test.ts
 */
import { defineLevel, defineSite, defineTerrain, getSite, getTerrain, terrainHeight } from '../../../engine/sim-api';
import { PLAYGROUND_GROUND } from '../ground';
import { GYM_SITE_TEXT } from './gym';
import './house';
import './street';
import './yard';

/** The block's size (m): its width, west to east, and its depth, north to south. */
export const SITE_SIZE = [96, 113] as const;

/** The hill's ground as the hill scene has it (labs/playground/scenes/hill.ts), the block's whole depth. */
const GROUND = { seed: 13, height: 0.6, scale: 24, hills: [{ at: [96, 48], radius: 30, height: 10 }] } as const;

defineTerrain('terrain:site', {
  size: [...SITE_SIZE],
  ...GROUND,
  hills: [...GROUND.hills],
  flats: [
    { rect: [0, 0, 60, 12], height: 0, margin: 3 }, // the range, level for its lanes
    { rect: [41, 12, 72, 96], height: 0, margin: 6 }, // the yards and the street
  ],
  materials: [...PLAYGROUND_GROUND],
});

/** The lookout's corner on the hilltop, and the ground's height there (rounded to the centimetre). */
const LOOKOUT_AT = (() => {
  const [x, z] = [88, 46];
  const height = terrainHeight(getTerrain('terrain:site'), x + 2.5, z + 2.25)!;
  return [x, Math.round(height * 100) / 100, z] as const;
})();

defineLevel('level:gym-site', { text: GYM_SITE_TEXT, file: 'labs/playground/levels/gym.ts' });

/** Each structure on the block, by name: its level and where its map's north-west corner stands. */
export const SITE_STRUCTURES = {
  gym: { level: 'level:gym-site', at: [0, 0, 12] },
  house: { level: 'level:house', at: [44, 0, 44] },
  driveway: { level: 'level:driveway', at: [60, 0, 63], flatten: 1 },
  path: { level: 'level:path', at: [51, 0, 63], flatten: 1 },
  street: { level: 'level:street', at: [41, 0, 83] },
  shed: { level: 'level:shed', at: [66, 0, 15] },
  treehouse: { level: 'level:treehouse', at: [44, 0, 18] },
  lookout: { level: 'level:lookout', at: LOOKOUT_AT },
  shelter: { level: 'level:shelter', at: [2, 0, 1] },
  backstop: { level: 'level:backstop', at: [58, 0, 0] },
  ring: { level: 'level:ring', at: [62, 0, 2] },
} as const;

defineSite('site:block', { terrain: 'terrain:site', structures: Object.values(SITE_STRUCTURES) });

/** The block, made. */
export const SITE = getSite('site:block');

/** Each area's spawn (see the file comment): where the player stands and faces (rad; 0 is +Z, south). */
export const SITE_AREAS = {
  frontyard: { at: [52, 0, 74], yaw: Math.PI, what: 'the front yard, on the path, facing the porch' },
  house: { at: [51.5, 0, 57], yaw: Math.PI, what: 'the hall, inside the front door' },
  backyard: { at: [56, 0, 40], yaw: 0, what: 'the backyard, facing the patio' },
  street: { at: [62, 0.15, 84], yaw: Math.PI / 2, what: 'the street, on the sidewalk by the driveway, facing east' },
  gym: { at: [20.25, 0, 15.25], yaw: 0, what: "the gym's spawn, at its north end" },
  hill: { at: [74.5, 0, 48], yaw: Math.PI / 2, what: "the hill's foot, facing up it" },
  range: { at: [4.2, 0, 6], yaw: Math.PI / 2, what: 'the range, behind its counter, facing the lanes' },
  ring: { at: [66, 0, 12], yaw: Math.PI, what: 'the ring, at the foot of its steps' },
} as const;

/** The areas' names. */
export type SiteArea = keyof typeof SITE_AREAS;
