/**
 * @file The hill, `playground:hill` (docs/PLAYGROUND.md §2.2, PLAN.md WP 10.5): the block's ground as terrain, before
 * WP 13.18 stands the site's levels on it: 96 × 96 m on a 1 m grid, rolling 0.6 m, and in the east the hill (x 72 to
 * 96) rising to 10 m over the east edge's middle in slopes up to 29° (10° to 30° over most of its flank: slides gain
 * speed down it), turf over rock where it is steepest; the player at its foot facing up it, east. It takes the gym's
 * settings (`playground.gym.*`) and its dev action `place`, so the feel kit runs a course here as in the gym.
 *
 * The terrain is data (`terrain:block`, engine/world/terrain.ts): the scene stands its heightfield
 * (`addTerrainBody`), and the view draws it from the scene's `terrain` (engine/gfx/terrain.ts) in the playground's
 * ground materials (labs/playground/ground.ts).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course hill
 * // node x shot labs/playground --scene hill --cam iso
 * HILL_START; // [74.5, 0.5…, 48]: at its foot, on the west edge's middle
 * @see labs/playground/scenes/hill.test.ts
 */
import { addTerrainBody, defineScene, defineTerrain, getTerrain, physicsOf, terrainHeight } from '../../../engine/sim-api'; // prettier-ignore
import { spawnPlayer } from '../cast/player';
import { playgroundSounds, terrainGround } from '../sounds/events';
import { gym } from './gym';

/** The block's ground and its hill (see the file comment), and its layers' materials (labs/playground/ground.ts). */
defineTerrain('terrain:block', {
  size: [96, 96],
  seed: 13,
  height: 0.6,
  scale: 24,
  hills: [{ at: [96, 48], radius: 30, height: 10 }],
  materials: ['material:playground-grass', 'material:playground-rock'],
});

/** The block's ground, made: the hill is its east quarter. */
export const HILL = getTerrain('terrain:block');

/** Where the player starts: at the hill's foot on its west edge's middle, on the ground. */
export const HILL_START = [74.5, terrainHeight(HILL, 74.5, 48)!, 48] as const;

/** The hill: its terrain, and the player at its foot facing up it. */
export const hill = defineScene('playground:hill', {
  description: "The playground's hill: the block's ground rising to 10 m in slopes up to 29°, to run and slide down (docs/PLAYGROUND.md §2.2).", // prettier-ignore
  terrain: 'terrain:block',
  physics: true,
  sounds: playgroundSounds(terrainGround(HILL)), // its events' sounds, for x audio --replay (WP 13.22)
  setup(w) {
    addTerrainBody(physicsOf(w), HILL);
    const speed = w.settings.get<number>('playground.gym.speed');
    const jump = w.settings.get<number>('playground.gym.jump');
    spawnPlayer(w, HILL_START, Math.PI / 2, { speed, jump }); // facing east, up the hill
  },
  actions: { place: gym.actions.place },
});

export default hill;
