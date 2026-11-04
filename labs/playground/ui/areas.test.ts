/**
 * @file The block's areas (labs/playground/ui/areas.ts): every area's spawn lies in its own area, by its structure or
 * the block's map; every area has a card whose keys are actions; the location line names the room indoors, as a
 * player reads it; the street reads as the street across its whole width, sidewalks and bus stop too, the house over
 * its walls at any height, and the patio and the porch, on the house's map but outside it, as the yards.
 */
import { describe, expect, it } from 'vitest';
import { getSite, siteStructureAt } from '../../../engine/sim-api';
import { HOUSE_RECTS } from '../levels/house';
import { SITE_AREAS, SITE_STRUCTURES, type SiteArea } from '../levels/site';
import { AREA_OF_STRUCTURE, AREAS, areaAt, HOUSE_WALLS, locationLine } from './areas';

const site = getSite('site:block');

describe('the block’s areas', () => {
  it('puts each area’s spawn in its own area', () => {
    for (const [area, { at }] of Object.entries(SITE_AREAS)) {
      const structure = siteStructureAt(site, at[0], at[1] + 0.1, at[2])?.structure.name;
      const room = siteStructureAt(site, at[0], at[1] + 0.1, at[2])?.room?.name;
      expect(areaAt(at[0], at[2], structure, room), `${area} (${structure ?? 'outdoors'})`).toBe(area);
    }
  });

  it('gives every area a card, and names an area for every structure that names one', () => {
    expect(Object.keys(AREAS).sort()).toEqual(Object.keys(SITE_AREAS).sort());
    for (const card of Object.values(AREAS)) {
      expect(card.tries.length).toBeGreaterThan(0);
      for (const [, action] of card.tries.join(' ').matchAll(/\{(\w+)\}/g)) expect(action).toMatch(/^[a-z]+\d?$/);
    }
    const names = site.structures.map((structure) => structure.name);
    for (const name of Object.keys(AREA_OF_STRUCTURE)) expect(names, name).toContain(name);
  });

  it('reads the location as the area, and the room indoors', () => {
    expect(locationLine('house', 'kitchen')).toBe('House · kitchen');
    expect(locationLine('house', 'master')).toBe('House · master bedroom');
    expect(locationLine('frontyard')).toBe('Front yard');
    expect(areaAt(90, 50)).toBe<SiteArea>('hill');
    expect(areaAt(20, 60)).toBe<SiteArea>('gym');
  });

  it('reads the street across its width, the house over its walls, and its patio and porch as the yards', () => {
    const at = (x: number, y: number, z: number) => {
      const found = siteStructureAt(site, x, y + 0.1, z);
      return areaAt(x, z, found?.structure.name, found?.room?.name);
    };
    const street = [at(82, 0.15, 94.3), at(85, 0.15, 84), at(85, 0.5, 89)]; // the bus stop, a sidewalk, a jump on the road
    const house = [at(56.75, 11, 54.1), at(52, 0, 54), at(52, -2, 46)]; // the chimney's top, the hall, the crawlspace
    const yards = [at(52, 0, 46.5), at(52, 0, 61.5)]; // the patio, the porch
    expect([street, house, yards]).toEqual([['street', 'street', 'street'], ['house', 'house', 'house'], ['backyard', 'frontyard']]); // prettier-ignore
    const [hx, , hz] = SITE_STRUCTURES.house.at;
    const walls = [HOUSE_RECTS.house, HOUSE_RECTS.garage].map(([x0, z0, x1, z1]) => [
      x0 + hx,
      z0 + hz,
      x1 + hx,
      z1 + hz,
    ]);
    expect(HOUSE_WALLS).toEqual(walls); // the level's own, at the house's place
  });
});
