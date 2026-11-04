/**
 * @file The block's areas (labs/playground/ui/areas.ts): every area's spawn lies in its own area, by its structure or
 * the block's map; every area has a card whose keys are actions; the location line names the room indoors.
 */
import { describe, expect, it } from 'vitest';
import { getSite, siteStructureAt } from '../../../engine/sim-api';
import { SITE_AREAS, type SiteArea } from '../levels/site';
import { AREA_OF_STRUCTURE, AREAS, areaAt, locationLine } from './areas';

const site = getSite('site:block');

describe('the block’s areas', () => {
  it('puts each area’s spawn in its own area', () => {
    for (const [area, { at }] of Object.entries(SITE_AREAS)) {
      const structure = siteStructureAt(site, at[0], at[1] + 0.1, at[2])?.structure.name;
      expect(areaAt(at[0], at[2], structure), `${area} (${structure ?? 'outdoors'})`).toBe(area);
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
    expect(locationLine('frontyard')).toBe('Front yard');
    expect(areaAt(90, 50)).toBe<SiteArea>('hill');
    expect(areaAt(20, 60)).toBe<SiteArea>('gym');
  });
});
