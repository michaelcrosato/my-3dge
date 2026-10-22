/**
 * @file Unit tests for engine/world/siteNavGrids.ts (T1; WP 13.15) on the fixture house (fixtures/levels/storeys/):
 * a flight's tile stands highest at its upper edge; what is above a tile (the slab of the storey floored over it, a
 * door's head, the roof's underside, nothing over the stairwell); the links between storeys (a flight's top, the
 * ladder through the attic's hatch); the terrain closed under the footprints and the cut; a storey's steps need the
 * body's height clear (none off the cellar flight's top under the ground floor's slab) and walk a flight along its
 * rise (off its foot, never its side); and a block closes the tiles within a body's radius of it, but none behind a
 * wall (WP 13.18).
 * @see engine/world/siteNavGrids.ts
 */
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createRegistry } from '../core/registry';
import { roofUnder } from './level/roofs';
import { storeyView } from './level/storeys';
import {
  blockedSurface,
  siteTerrainSurface,
  storeyCeilings,
  storeyLinks,
  storeySurface,
  tileHighs,
} from './siteNavGrids';

const site = defineFixtureSite(createRegistry());
const [house] = site.structures;
const { level } = house;
const tile = (c: number, r: number) => r * level.cols + c;

describe('the site’s grids', () => {
  it('stand a flight’s tile highest at its upper edge, a flat tile at its floor', () => {
    const view = storeyView(level, 0);
    const highs = tileHighs(view);
    expect(view.floor[tile(13, 6)]).toBeCloseTo(-1.5, 9); // the cellar's flight: its centre
    expect(highs[tile(13, 6)]).toBeCloseTo(-3 + (3 * (5 - 3.005)) / 3.5, 6); // its upper edge, 1% in
    expect(highs[tile(5, 5)]).toBe(-3);
  });

  it('read what is above a tile: the next floored storey’s slab, a door’s head, the roof, or nothing', () => {
    const [cellar, ground, , attic] = [0, 1, 2, 3].map((k) => storeyCeilings(level, k));
    expect(cellar[tile(5, 5)]).toBeCloseTo(-0.3, 9); // the ground floor's slab
    expect([ground[tile(4, 4)], ground[tile(2, 11)]]).toEqual([2.7, 2.1]); // the upper floor's slab, the front door's head
    expect(ground[tile(1, 5)]).toBeCloseTo(5.7, 9); // the hall's stairwell: open up to the attic's slab
    expect(attic[tile(5, 5)]).toBeCloseTo(roofUnder(level.roofs![0], 2.75, 2.75), 9);
    expect(storeyCeilings(level, 9).every((c) => c === Infinity)).toBe(true);
  });

  it('link a flight’s top to the floor above it, and the ladder to the attic’s floor beside its hatch', () => {
    expect(storeyLinks(level, 0)).toEqual([
      [tile(13, 3), tile(13, 2)],
      [tile(14, 3), tile(14, 2)],
    ]);
    expect(storeyLinks(level, 1)).toEqual([
      [tile(1, 3), tile(1, 2)],
      [tile(2, 3), tile(2, 2)],
    ]);
    expect(storeyLinks(level, 2)).toEqual([[tile(8, 6), tile(7, 6)]]);
  });

  it('close the terrain under every footprint and the cut, and open it elsewhere', () => {
    const surface = siteTerrainSurface(site)!;
    const at = (x: number, z: number) => surface.walkable[Math.floor(z) * surface.cols + Math.floor(x)];
    expect([at(14.5, 15.5), at(26.5, 4.5), at(5.5, 20.5)]).toEqual([false, false, true]);
  });

  it('step a storey only where the body’s height is clear, and a flight along its rise: off its foot, never its side', () => {
    const surface = storeySurface(house, 0, 1.24);
    const west = (r: number) => surface.canStep(13, r, -1, 0, 0.5); // off the flight's side onto the cellar's floor
    // Its top under the slab, and its side anywhere: each of its rows stands more than a curb (0.1 m) over the floor.
    expect([west(3), west(4), west(8), west(9)]).toEqual([false, false, false, false]);
    expect([surface.canStep(13, 9, 0, 1, 0.5), surface.canStep(13, 10, 0, -1, 0.5)]).toEqual([true, true]); // its foot
  });

  it('close the tiles a block stands near, within a body’s radius, but none behind a wall', () => {
    // A row of 0.25 m tiles, x 0 to 1.5, a wall at the fourth (x 0.75 to 1); a 0.2 m box against its east face.
    const walkable = [true, true, true, false, true, true];
    const surface = { cols: 6, rows: 1, tile: 0.25, walkable, floor: walkable.map(() => 0), canStep: () => true };
    const blocked = blockedSurface(surface, [{ min: [1, 0, 0], max: [1.2, 1, 0.25] }], 1.88, 0.41);
    // The third's middle stands 0.375 m from the box, within the radius, but the wall is between: it stays open.
    expect(blocked.walkable).toEqual([true, true, true, false, false, false]);
  });
});
