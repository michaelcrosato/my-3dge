/**
 * @file The interact scene, `playground:interact` (PLAN.md WP 13.16; docs/PLAYGROUND.md §7.1): the cottage of
 * labs/playground/levels/cottage.ts on a 20 × 20 m lot, with what a player uses in a house: its front door on its
 * hinge (`addLevelDoors`), panes in its windows (`addLevelWindows`), the kitchen's lamp and its switch inside the door,
 * and a crate and two chairs in the yard; the player in the yard south of the door, facing it. Use (E) opens the door
 * away from the player and closes it, flips the switch, picks a chair up and throws it along the view, through a pane
 * it breaks; a strike (V) bursts the door open, and the second breaks it off its hinges. It takes the gym's settings
 * (`playground.gym.*`) and its dev action `place`, so its replay places the player as the gym's do
 * (tests/replays/playground-interact.replay.json). WP 13.18's house takes its place.
 *
 * The site is data (`site:interact`, engine/world/site.ts): the scene stands its bodies (`addSiteBodies`), and the
 * view draws it from the scene's `site` (engine/gfx/stageSite.ts), the terrain in the playground's ground materials.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // node x replay tests/replays/playground-interact.replay.json --browser page
 * // node x shot labs/playground --scene interact --cam iso
 * INTERACT_START; // [10, 0…, 13]: in the yard, three metres south of the front door
 * @see labs/playground/scenes/interact.test.ts
 */
import { addInteraction, addLevelDoors, addLevelWindows, addSiteBodies, addSwitch, defineScene, defineSite, defineTerrain, getSite, physicsOf, siteFloorBelow, spawnProp } from '../../../engine/sim-api'; // prettier-ignore
import { spawnPlayer } from '../cast/player';
import { PLAYGROUND_GROUND } from '../ground';
import '../levels/cottage';
import { gym } from './gym';

/** The lot's ground: 20 × 20 m rolling 0.15 m, flattened round the cottage (engine/world/site.ts). */
defineTerrain('terrain:interact', { size: [20, 20], seed: 5, height: 0.15, scale: 8, materials: [...PLAYGROUND_GROUND] }); // prettier-ignore

/** The lot: the cottage, its map's north-west corner at (7, 5). */
defineSite('site:interact', { terrain: 'terrain:interact', structures: [{ level: 'level:cottage', at: [7, 0, 5] }] });

/** The lot, made. */
export const INTERACT = getSite('site:interact');

/** A point on the ground (or the cottage's floor) at (x, z). */
const ground = (x: number, z: number) => [x, siteFloorBelow(INTERACT, x, 10, z)!, z] as const;

/** Where the player starts: in the yard, three metres south of the front door. */
export const INTERACT_START = ground(10, 13);

/** The interact scene (see the file comment). */
export const interact = defineScene('playground:interact', {
  description: "The playground's cottage: a door to open, kick in and break, windows to break, a light to switch and chairs to throw (docs/PLAYGROUND.md §7.1).", // prettier-ignore
  site: 'site:interact',
  physics: true,
  setup(w) {
    addSiteBodies(physicsOf(w), INTERACT);
    const speed = w.settings.get<number>('playground.gym.speed');
    const jump = w.settings.get<number>('playground.gym.jump');
    spawnPlayer(w, INTERACT_START, Math.PI, { speed, jump }); // first: the player is entity 1
    const [cottage] = INTERACT.structures;
    const place = { at: cottage.at, turn: cottage.turn };
    addLevelDoors(w, cottage.level, place); // 2: the front door
    addLevelWindows(w, cottage.level, place); // 3 to 6: two panes in each window
    spawnProp(w, { prop: 'prop:lamp', at: [10, 2.7, 7.5], yaw: 0 }, { group: 'room:kitchen' }); // 7
    addSwitch(w, { at: [11, 1.2, 9.5], yaw: Math.PI, group: 'room:kitchen' }); // 8: inside, east of the door
    spawnProp(w, { prop: 'prop:chair', at: ground(14.6, 6.75), yaw: Math.PI / 2 }); // 9: east of the cottage
    spawnProp(w, { prop: 'prop:chair', at: ground(12.6, 12.4), yaw: -0.4 }); // 10
    spawnProp(w, { prop: 'prop:crate', at: ground(15.4, 12), yaw: 0.3 }); // 11
    addInteraction(w);
  },
  actions: { place: gym.actions.place },
});

export default interact;
