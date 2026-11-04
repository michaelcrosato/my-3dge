/**
 * @file Go to's places (docs/PLAYGROUND.md §8.3, PLAN.md WP 13.25; the spawn picker before WP 13.33): each area of
 * the block (`SITE_AREAS`: its spawn, facing as it faces) and each room of its structures (`roomPlace`,
 * labs/playground/scenes/site.ts: at the room's marker, ducked under a low ceiling), each as the arguments of the
 * block's dev action `place`, so a pick is a recorded operation of the run and its replay holds it. `spawnPlaces()`
 * lists them, areas first, then the rooms in the order their level lists them, each named and described as Go to shows
 * it (an area by its card, areas.ts `AREAS`; a room as a player reads it, `roomName`); `spawnPlace(id)` finds one.
 *
 * On a scene of the block (`site: 'site:block'`) the front end (labs/playground/ui/frontEnd.ts) runs a pick's action
 * at once; on another scene it opens the block (`?scene=site`) with the pick's id in the view setting
 * `playground.spawn`, which the page runs as the block's first operation once it is up (`spawnOnOpen`).
 *
 * Game code, a page's: it imports only the engine's public API (engine/sim-api.ts's settings) and the playground's
 * own files.
 *
 * @example
 * spawnPlaces().length; // 25: the block's 8 areas and the house's 17 rooms
 * spawnPlace('area:house')?.label; // 'The house'
 * spawnPlace('room:house/master')?.label; // 'Master bedroom'
 * spawnPlace('room:house/kitchen')?.args.crouch; // false
 * @see labs/playground/ui/spawns.test.ts
 */
import { defineSettings } from '../../../engine/sim-api';
import { SITE, SITE_AREAS, type SiteArea } from '../levels/site';
import { areaStart, roomPlace } from '../scenes/site';
import { AREAS, roomName } from './areas';

/** Go to's view setting (see the file comment): a place's id, or none. */
export const SPAWN_SETTINGS = defineSettings({
  'playground.spawn': {
    type: 'string',
    default: '',
    view: true,
    when: 'scene',
    description:
      "Where the playground page puts the player once a scene of the block is up (labs/playground/ui/spawns.ts): a place of Go to, `area:<area>` or `room:<structure>/<room>`; the page runs it as the block's dev action place, so the run records it. Empty: the scene's own spawn.",
  },
});

/** A place to spawn: its id, its label and the line under it in Go to, area or room, the `place` action's arguments. */
export interface SpawnPlace {
  readonly id: string;
  readonly label: string;
  readonly about: string;
  readonly group: 'area' | 'room';
  readonly args: { readonly at: readonly [number, number, number]; readonly yaw: number; readonly crouch: boolean };
}

/** `text` with its first letter capital. */
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every place (see the file comment), made once. */
let places: readonly SpawnPlace[] | null = null;

/** The block's places to spawn: its areas, then its structures' rooms. */
export function spawnPlaces(): readonly SpawnPlace[] {
  if (places) return places;
  const areas = (Object.keys(SITE_AREAS) as SiteArea[]).map((area): SpawnPlace => {
    const { yaw } = SITE_AREAS[area];
    return {
      id: `area:${area}`,
      label: AREAS[area].name,
      about: AREAS[area].text,
      group: 'area',
      args: { at: areaStart(area), yaw, crouch: false },
    };
  });
  const rooms = SITE.structures.flatMap((structure) =>
    (structure.level.rooms ?? []).map((room): SpawnPlace => {
      const { at, crouch } = roomPlace(structure, room);
      const [label, about] = [capital(roomName(room.name)), `Start in the ${structure.name}'s ${roomName(room.name)}.`];
      return { id: `room:${structure.name}/${room.name}`, label, about, group: 'room', args: { at, yaw: 0, crouch } };
    }),
  );
  return (places = Object.freeze([...areas, ...rooms]));
}

/** The place `id` names, or undefined. */
export function spawnPlace(id: string): SpawnPlace | undefined {
  return spawnPlaces().find((place) => place.id === id);
}
