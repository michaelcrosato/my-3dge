/**
 * @file The lot, `playground:lot` (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): a site, the house and the shed of
 * labs/playground/levels/lot.ts standing on a 32 × 32 m terrain, the house's map at (10, 12), the shed's at (24, 6)
 * turned a quarter, the ground flattened round each and cut under the house's cellar; the player in the yard south-west
 * of the house, facing north. It takes the gym's settings (`playground.gym.*`) and its dev action `place`, so a course
 * runs here as in the gym; the bot's tour reaches every room of the house from the yard and back, and the follow
 * cameras never stand in a wall on it (labs/playground/scenes/lot.test.ts). WP 13.18's site takes its place.
 *
 * The site is data (`site:lot`, engine/world/site.ts): the scene stands its bodies and its ladders (`addSiteBodies`,
 * `addSiteLadders`), and the view draws it from the scene's `site` (engine/gfx/stageSite.ts), the terrain in the
 * playground's ground materials (labs/playground/ground.ts).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // node x sim labs/playground/scenes/lot.ts --steps 60
 * // node x shot labs/playground --scene lot --cam iso
 * LOT_START; // [6, 0.17…, 20]: in the yard, on the ground
 * @see labs/playground/scenes/lot.test.ts
 */
import { addSiteBodies, addSiteLadders, defineScene, defineSite, defineTerrain, getSite, physicsOf, siteFloorBelow } from '../../../engine/sim-api'; // prettier-ignore
import { spawnPlayer } from '../cast/player';
import { PLAYGROUND_GROUND } from '../ground';
import '../levels/lot';
import { gym } from './gym';

/** The lot's ground: 32 × 32 m rolling 0.4 m, flattened round the buildings (engine/world/site.ts). */
defineTerrain('terrain:lot', { size: [32, 32], seed: 3, height: 0.4, scale: 12, materials: [...PLAYGROUND_GROUND] });

/** The lot: the house and the shed on its ground (see the file comment). */
defineSite('site:lot', {
  terrain: 'terrain:lot',
  structures: [
    { level: 'level:lot-house', at: [10, 0, 12] },
    { level: 'level:lot-shed', at: [24, 0, 6], turn: 1 },
  ],
});

/** The lot, made. */
export const LOT = getSite('site:lot');

/** Where the player starts: in the yard south-west of the house, on the ground. */
export const LOT_START = [6, siteFloorBelow(LOT, 6, 10, 20)!, 20] as const;

/** The lot: its site, and the player in the yard facing north, toward the house. */
export const lot = defineScene('playground:lot', {
  description: "The playground's lot: a house written as storeys and a shed on a terrain, a site to walk through (docs/PLAYGROUND.md §6.3).", // prettier-ignore
  site: 'site:lot',
  physics: true,
  setup(w) {
    addSiteBodies(physicsOf(w), LOT);
    const speed = w.settings.get<number>('playground.gym.speed');
    const jump = w.settings.get<number>('playground.gym.jump');
    spawnPlayer(w, LOT_START, Math.PI, { speed, jump }); // first: the player is entity 1
    addSiteLadders(w, LOT);
  },
  actions: { place: gym.actions.place },
});

export default lot;
