/**
 * @file Unit tests for engine/world/siteQueries.ts (T1; WP 13.15) on the fixture site (fixtures/levels/storeys/
 * site.ts): the highest surface under a point is the terrain's outside and a storey's floor, a roof's or the cellar's
 * inside (the terrain cut over it), with their tags; a point's structure, storey (a flight's to its top) and room;
 * what is solid (the ground, a wall, a slab, a door's head; not a doorway or a room's air) and what a sight line
 * meets; the rescue's grid, on the cellar's floor where the ground is cut.
 * @see engine/world/siteQueries.ts
 */
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createRegistry } from '../core/registry';
import { siteClearSight, siteFloorBelow, siteRescueGrid, siteSolidAt, siteStructureAt, siteSurfaceBelow } from './siteQueries'; // prettier-ignore
import { terrainHeight, terrainSurface } from './terrain';

const site = defineFixtureSite(createRegistry());
const [house] = site.structures;
const ground = (x: number, z: number) => terrainHeight(site.terrain!, x, z)!;

describe('the fixture site’s queries', () => {
  it('stand a point on the terrain outside, on a storey’s floor, the cellar’s or the roof inside', () => {
    expect(siteFloorBelow(site, 2, 10, 2)).toBe(ground(2, 2));
    expect(siteSurfaceBelow(site, 2, 10, 2)).toBe(terrainSurface(site.terrain!, 2, 2));
    expect([siteFloorBelow(site, 12, 1, 14), siteFloorBelow(site, 12, 4, 14), siteFloorBelow(site, 14, -2, 15)]).toEqual([0, 3, -3]); // prettier-ignore
    expect(siteFloorBelow(site, 14, 20, 15)).toBeCloseTo(house.level.roofs![0].peak, 9);
    expect(siteSurfaceBelow(site, 14, 20, 15)).toBe('shingle');
  });

  it('say which structure, storey and room a point is in: a flight’s storey and room to its top', () => {
    const at = (x: number, y: number, z: number) => {
      const found = siteStructureAt(site, x, y, z);
      return found && [found.structure.name, found.storey, found.room?.name ?? null];
    };
    expect([at(12, 1, 14), at(12, 4, 14), at(14, -2, 15), at(2, 1, 2)]).toEqual([['fixture-house', 1, 'hall'], ['fixture-house', 2, 'bedroom'], ['fixture-house', 0, 'cellar'], null]); // prettier-ignore
    const top = (3 * (5 - 1.6)) / 3.5; // the hall's flight 0.1 m short of its top
    expect(at(10.75, top, 13.6)).toEqual(['fixture-house', 1, 'hall']);
  });

  it('find the ground, a wall, a slab and a door’s head solid, and a doorway and a room’s air open', () => {
    expect(siteSolidAt(site, 2, ground(2, 2) - 0.1, 2)).toBe(true);
    expect([siteSolidAt(site, 10.25, 1, 14), siteSolidAt(site, 12, 2.85, 14), siteSolidAt(site, 11.5, 2.5, 17.75)]).toEqual([true, true, true]); // prettier-ignore
    expect([siteSolidAt(site, 11.5, 1.5, 17.75), siteSolidAt(site, 12, 1.5, 14)]).toEqual([false, false]);
  });

  it('see through the front door and not through the wall beside it', () => {
    expect(siteClearSight(site, [11.5, 1.2, 19], [11.5, 1.2, 16])).toBe(true);
    expect(siteClearSight(site, [13, 1.2, 19], [13, 1.2, 16])).toBe(false);
  });

  it('give the rescue a metre grid over it all, on the cellar’s floor where the ground is cut', () => {
    const grid = siteRescueGrid(site);
    expect([grid.tile, grid.origin, grid.cols, grid.rows]).toEqual([1, [0, 0], 32, 32]);
    expect(grid.walkable.every(Boolean)).toBe(true);
    expect(grid.floor[15 * 32 + 14]).toBe(-3); // the cell (14, 15): over the cellar
    expect(grid.floor[2 * 32 + 2]).toBe(ground(2.5, 2.5));
  });
});
