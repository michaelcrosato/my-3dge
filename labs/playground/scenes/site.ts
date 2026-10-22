/**
 * @file The block's scenes (docs/PLAYGROUND.md §2, PLAN.md WP 13.18): `playground:site`, the whole block with the
 * player in the front yard, and a scene per area (`playground:site-<area>`: the house, the backyard, the street, the
 * gym, the hill, the range, the ring), the same block with the player at that area's spawn (`SITE_AREAS`,
 * labs/playground/levels/site.ts). Each stands the site's bodies and ladders, the player first (entity 1), then the
 * house's things: its doors on their hinges and its panes (`addLevelDoors`, `addLevelWindows`), the garage's
 * up-and-over door on its two switches, a lamp and a switch in each room (its light group `room:<name>`), its
 * furniture, the shed's door and pane; the outdoor things (labs/playground/furnish.ts), trees and rocks on the hill by
 * seed; the gym's own props and rides at its place; the block's ziplines, balloon and trampoline; use
 * (`addInteraction`) and melee (`addMelee`, WP 13.19); last, the ring's sparring dummies
 * (labs/playground/cast/dummies.ts). They take the gym's settings (`playground.gym.*`) and its dev action `place`, so
 * a course or a replay places the player as the gym's do; `roomPlace` says where it puts him in a room, ducked under
 * a low ceiling.
 *
 * The site is data (`site:block`): the view draws it from the scene's `site` (engine/gfx/stageSite.ts), each building
 * in its level's own looks, the terrain in the playground's ground materials.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // node x shot labs/playground --scene site-house --cam iso
 * // node x replay tests/replays/playground-site.replay.json --browser page
 * SITE_SCENES.house.id; // 'playground:site-house'
 * @see labs/playground/scenes/site.test.ts
 */
import { addDoor, addInteraction, addLauncher, addLevelDoors, addLevelWindows, addMelee, addSiteBodies, addSiteLadders, addSwitch, addZipline, defineScene, physicsOf, scatterTerrain, siteFloorBelow, siteSolidAt, spawnProp, terrainHeight, toWorld, type World } from '../../../engine/sim-api'; // prettier-ignore
import { standDummies } from '../cast/dummies';
import { spawnPlayer } from '../cast/player';
import { GARAGE_SWITCHES, HOUSE_FURNITURE, HOUSE_LIGHTS, OUTDOORS, SITE_RIDES } from '../furnish';
import { GYM_BALLOON, GYM_LAUNCHERS, GYM_PROPS, GYM_ZIPLINE } from '../levels/gym';
import { SITE, SITE_AREAS, SITE_STRUCTURES, type SiteArea } from '../levels/site';
import { DECK_HEIGHT } from '../levels/yard';
import '../props/house';
import '../props/outdoors';
import { gym } from './gym';

/** A structure of the block by its name in `SITE_STRUCTURES`. */
const structure = (name: keyof typeof SITE_STRUCTURES) => SITE.structures[Object.keys(SITE_STRUCTURES).indexOf(name)];
const [HOUSE, SHED, GYM, LOOKOUT] = [structure('house'), structure('shed'), structure('gym'), structure('lookout')];

/** A point of the house's (its own metres, a height over its ground floor) in the world. */
function inHouse(x: number, y: number, z: number): [number, number, number] {
  const [wx, wz] = toWorld(HOUSE, x, z);
  return [wx, HOUSE.at[1] + y, wz];
}

/** The house's storey `k`'s floor (m over its ground floor). */
const floorOf = (k: number) => HOUSE.level.storeys![k].base;

/** Where the attic's lamp hangs from: its gable's underside over row `z` (its ridge along x, over the house's middle). */
function atticCeiling(z: number): number {
  const roof = HOUSE.level.roofs![0];
  const [, z0, , z1] = roof.footprint;
  return roof.eave + ((z1 - z0) / 2 - Math.abs(z - (z0 + z1) / 2)) * roof.slope - roof.thickness;
}

/** The ground's height on the block at (x, z), for what stands on the terrain. */
const ground = (x: number, z: number) => terrainHeight(SITE.terrain!, x, z)!;

/** A ride's spec moved `dz` metres south: the gym's, at its place on the block. */
function south<T extends Record<string, unknown>>(spec: T, dz: number): T {
  const moved = Object.entries(spec).map(([key, value]) => [key, ['from', 'to', 'at'].includes(key) ? [(value as number[])[0], (value as number[])[1], (value as number[])[2] + dz] : value]); // prettier-ignore
  return Object.fromEntries(moved) as T;
}

/** The lookout's zipline: from a pole on its deck down to one in the backyard; the hill's balloon, 60 m up. */
const LOOKOUT_DECK = LOOKOUT.at[1] + DECK_HEIGHT.lookout;
const LOOKOUT_LINE = { from: [89, LOOKOUT_DECK + 3, 47.2], to: [68, 3, 26], feet: [LOOKOUT_DECK, 0] } as const;
const BALLOON = { from: [84, ground(84, 70), 70], to: [84, ground(84, 70) + 60, 70], balloon: true } as const;

/** The house's things (see the file comment). */
function furnishHouse(w: World): void {
  const place = { at: HOUSE.at, turn: HOUSE.turn };
  addLevelDoors(w, HOUSE.level, place);
  addLevelWindows(w, HOUSE.level, place);
  addLevelDoors(w, SHED.level, { at: SHED.at, turn: SHED.turn });
  addLevelWindows(w, SHED.level, { at: SHED.at, turn: SHED.turn });
  // The garage door: 2.6 m in its 2.75 m opening, tilting up and in to lie flat under the garage's ceiling.
  const garage = addDoor(w, { prop: 'prop:garageDoor', hinge: inHouse(17.575, 0, 13.875), yaw: 0, tilt: true });
  for (const [x, z, yaw] of GARAGE_SWITCHES) addSwitch(w, { at: inHouse(x, 1.2, z), yaw, door: garage });
  for (const [room, light] of Object.entries(HOUSE_LIGHTS)) {
    const base = floorOf(light.storey);
    const group = `room:${room}`;
    if (light.lamp) {
      const [x, z] = light.lamp;
      const top = light.storey === 3 ? atticCeiling(z) : base + 2.7;
      spawnProp(w, { prop: 'prop:lamp', at: inHouse(x, top, z), yaw: 0 }, { group });
    }
    const [x, z, yaw] = light.switch;
    addSwitch(w, { at: inHouse(x, base + 1.2, z), yaw, group });
  }
  for (const [prop, x, z, yaw, storey] of HOUSE_FURNITURE) spawnProp(w, { prop, at: inHouse(x, floorOf(storey), z), yaw }); // prettier-ignore
}

/** The outdoor things, the hill's trees and rocks, the gym's props and every ride (see the file comment). */
function furnishOutdoors(w: World): void {
  for (const [prop, x, y, z, yaw] of OUTDOORS) spawnProp(w, { prop, at: [x, y, z], yaw });
  const onHill = (place: { x: number; z: number }) => place.x > 74 && place.z < 80 && Math.hypot(place.x - 90.5, place.z - 48.5) > 6 && Math.hypot(place.x - 84, place.z - 70) > 3; // prettier-ignore
  for (const [prop, salt, density] of [
    ['prop:playground-tree', 1, 0.025],
    ['prop:playground-rock', 2, 0.012],
  ] as const) {
    for (const { position: [x, y, z], yaw } of scatterTerrain(SITE.terrain!, { density, salt })) if (onHill({ x, z })) spawnProp(w, { prop, at: [x, y, z], yaw }); // prettier-ignore
  }
  const dz = GYM.at[2];
  for (const { prop, at, yaw } of GYM_PROPS) spawnProp(w, { prop, at: [at[0], at[1], at[2] + dz], yaw });
  addZipline(w, south(GYM_ZIPLINE, dz));
  addZipline(w, south(GYM_BALLOON, dz));
  for (const { height: _height, ...launcher } of GYM_LAUNCHERS) addLauncher(w, south(launcher, dz));
  addZipline(w, SITE_RIDES.treehouse);
  addZipline(w, LOOKOUT_LINE);
  addZipline(w, BALLOON);
  addLauncher(w, SITE_RIDES.trampoline);
}

/** Where `area`'s spawn stands: its point, on the highest floor at or under it. */
export function areaStart(area: SiteArea): [number, number, number] {
  const { at } = SITE_AREAS[area];
  return [at[0], siteFloorBelow(SITE, at[0], at[1] + 0.5, at[2])!, at[2]];
}

/** How high over his feet a standing player's head reaches, m: where that is solid, he is put ducked. */
export const HEAD_HEIGHT = 1.5;

/**
 * Where the `place` action puts the player in one of a structure's rooms: at its marker, on its floor, ducked where a
 * standing player's head would be in something solid (the crawlspace's 1.4 m ceiling).
 */
export function roomPlace(
  structure: (typeof SITE.structures)[number],
  room: { position: readonly number[] },
): { at: [number, number, number]; crouch: boolean } {
  // prettier-ignore
  const [x, z] = toWorld(structure, room.position[0], room.position[2]);
  const y = room.position[1] + structure.at[1];
  return { at: [x, y, z], crouch: siteSolidAt(SITE, x, y + HEAD_HEIGHT, z) };
}

/** The block with the player at `area`'s spawn (see the file comment): a scene's spec. */
function siteSpec(area: SiteArea) {
  return {
    description: `The playground's block (docs/PLAYGROUND.md §2): the house, the yards, the street, the gym, the hill, the range and the ring; the player in ${SITE_AREAS[area].what}.`, // prettier-ignore
    site: 'site:block',
    physics: true,
    setup(w: World) {
      addSiteBodies(physicsOf(w), SITE);
      const speed = w.settings.get<number>('playground.gym.speed');
      const jump = w.settings.get<number>('playground.gym.jump');
      spawnPlayer(w, areaStart(area), SITE_AREAS[area].yaw, { speed, jump }); // first: the player is entity 1
      addSiteLadders(w, SITE);
      furnishHouse(w);
      furnishOutdoors(w);
      addInteraction(w);
      addMelee(w);
      standDummies(w); // last: the ring's sparring dummies
    },
    actions: { place: gym.actions.place },
  };
}

// Each scene by its id written out, so the tools find it by its module's text (tools/lib/scenes.ts).
/** The block, the player in the front yard: `playground:site`, the site's own scene. */
export const site = defineScene('playground:site', siteSpec('frontyard'));
/** The block, the player in the hall. */
export const house = defineScene('playground:site-house', siteSpec('house'));
/** The block, the player in the backyard. */
export const backyard = defineScene('playground:site-backyard', siteSpec('backyard'));
/** The block, the player on the street's sidewalk. */
export const street = defineScene('playground:site-street', siteSpec('street'));
/** The block, the player at the gym's spawn. */
export const siteGym = defineScene('playground:site-gym', siteSpec('gym'));
/** The block, the player at the hill's foot. */
export const siteHill = defineScene('playground:site-hill', siteSpec('hill'));
/** The block, the player behind the range's counter. */
export const range = defineScene('playground:site-range', siteSpec('range'));
/** The block, the player at the ring's steps. */
export const ring = defineScene('playground:site-ring', siteSpec('ring'));
export default site;

/** The block's scenes by area: the front yard's is `playground:site`, every other `playground:site-<area>`. */
export const SITE_SCENES: Readonly<Record<SiteArea, typeof site>> = { frontyard: site, house, backyard, street, gym: siteGym, hill: siteHill, range, ring }; // prettier-ignore
