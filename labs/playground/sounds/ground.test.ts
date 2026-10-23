/**
 * @file Unit tests for the playground's ground (labs/playground/sounds/ground.ts): the footstep surface at points about
 * the block (the sidewalk's concrete, the road's asphalt, the driveway's concrete, the path's flagstones as stone,
 * the ring's canvas as carpet, the hill's grass) and at every house room's marker (its floor, as `HOUSE_ROOMS` names
 * it, else concrete); the room each marker stands in (its area, its storey's height, its floor; a room below ground
 * bare and walled in concrete), the shed's and the treehouse's small wooden rooms (but not among the treehouse's
 * stilts), and none outdoors.
 * @see labs/playground/sounds/ground.ts
 */
import { describe, expect, it } from 'vitest';
import { siteFloorBelow, toWorld } from '../../../engine/sim-api';
import { HOUSE_ROOMS } from '../levels/house';
import { SITE } from '../levels/site';
import { BARE, roomUnder, SITE_GROUND, surfaceUnder } from './ground';

/** The floor's height under (x, z), searched down from `from` m. */
const floor = (x: number, z: number, from = 6) => siteFloorBelow(SITE, x, from, z)!;
/** A structure of the site, by its name. */
const structure = (name: string) => SITE.structures.find((s) => s.name === name)!;
const FLOORS: Record<string, string> = {
  'material:tiles': 'tile',
  'material:wood': 'wood',
  'material:carpet': 'carpet',
};

describe('the ground under the block', () => {
  it('sounds as each paving, the ring’s canvas and the hill’s grass, with no room in the open air', () => {
    const points: [string, number, number, string][] = [
      ['the north sidewalk', 62, 84, 'concrete'],
      ['the road', 62, 88, 'asphalt'],
      ['the driveway', 62, 70, 'concrete'],
      ['the front path', 52, 70, 'stone'],
      ['the ring’s canvas', 66, 6, 'carpet'],
      ['the hill', 80, 48, 'grass'],
    ];
    for (const [where, x, z, surface] of points) {
      const y = floor(x, z);
      expect(surfaceUnder(x, y, z), where).toBe(surface);
      expect(roomUnder(x, y, z), where).toBeNull();
    }
    expect(SITE_GROUND).toEqual({ surface: surfaceUnder, room: roomUnder });
  });

  it('sounds as each house room’s floor, and gives its room: its area, height and floor, a basement bare', () => {
    const house = structure('house');
    const rooms = house.level.rooms ?? [];
    expect(rooms.length).toBeGreaterThan(10);
    for (const room of rooms) {
      const [x, z] = toWorld(house, room.position[0], room.position[2]);
      const y = room.position[1] + house.at[1];
      const named = (HOUSE_ROOMS as Record<string, string>)[room.name];
      const storey = house.level.storeys![room.storey];
      expect(surfaceUnder(x, y, z), room.id).toBe(named ? FLOORS[named] : 'concrete');
      const made = roomUnder(x, y, z);
      expect(made, room.id).toMatchObject({ name: room.id, area: room.area, height: storey.height });
      expect(made!.floor, room.id).toBe(named ? FLOORS[named] : 'concrete');
      if (named) expect(made, room.id).not.toHaveProperty('contents');
      else expect(made, room.id).toMatchObject({ contents: BARE, ...(storey.base < 0 ? { walls: 'concrete' } : {}) });
    }
    expect(rooms.some((room) => house.level.storeys![room.storey].base < 0)).toBe(true); // a basement was heard
  });

  it('makes the shed and the treehouse small rooms of wood, their footprints’ size, but not under the treehouse', () => {
    for (const name of ['shed', 'treehouse']) {
      const s = structure(name);
      const [x0, z0, x1, z1] = s.footprint;
      const [x, z] = [(x0 + x1) / 2, (z0 + z1) / 2];
      const y = floor(x, z, s.bounds.max[1] - 1.5); // under its roof
      expect(surfaceUnder(x, y, z), name).toBe('wood');
      expect(roomUnder(x, y, z), name).toEqual({ name, area: (x1 - x0) * (z1 - z0), height: 2.4, floor: 'wood' });
    }
    const [x, z] = [46.5, 20.25]; // among the treehouse's stilts, on the lawn: no room
    expect([surfaceUnder(x, floor(x, z, 1), z), roomUnder(x, floor(x, z, 1), z)]).toEqual(['grass', null]);
  });
});
