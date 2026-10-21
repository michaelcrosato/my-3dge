/**
 * @file Unit tests for engine/world/siteNav.ts (T1; WP 13.15) on the fixture site (fixtures/levels/storeys/site.ts): a
 * grid for the terrain and each storey, linked by the flights, the ladder and the doorways; the node under a body (a
 * flight's to its top, the rim beside a hatch, the terrain outside); a way from the yard to every room and back, the
 * attic's crouched; a stairwell walked in its middle; how far the next step rises and the feet stand over the floor.
 * @see engine/world/siteNav.ts
 */
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createRegistry } from '../core/registry';
import { toWorld } from './site';
import { createSiteNav } from './siteNav';

const site = defineFixtureSite(createRegistry());
const nav = createSiteNav(site, { climb: 0.5 });
const [house] = site.structures;
/** A point of the house's own frame in the world. */
const world = (lx: number, y: number, lz: number): [number, number, number] => {
  const [x, z] = toWorld(house, lx, lz);
  return [x, y, z];
};
const gridOf = (node: number) => (node < 0 ? null : nav.locate(node).grid.name);
const YARD: [number, number, number] = [6, 0.2, 20];
const ROOMS = house.level.rooms!.map((room) => ({ name: room.name, at: world(room.position[0], room.position[1], room.position[2]) })); // prettier-ignore

describe('a site’s navigation', () => {
  it('builds a grid for the terrain and each storey, linked by the flights, the ladder and the doorways', () => {
    expect(nav.grids.map((g) => g.name)).toEqual(['terrain', 'fixture-house/0', 'fixture-house/1', 'fixture-house/2', 'fixture-house/3', 'fixture-shed/0']); // prettier-ignore
    const kinds: Record<string, number> = {};
    for (const [a, b] of nav.links) kinds[`${gridOf(a)} ${gridOf(b)}`] = (kinds[`${gridOf(a)} ${gridOf(b)}`] ?? 0) + 1;
    expect(kinds).toEqual({
      'fixture-house/0 fixture-house/1': 2, // the cellar's flight, two tiles wide
      'fixture-house/1 fixture-house/2': 2, // the hall's
      'fixture-house/2 fixture-house/3': 1, // the ladder, up through the attic's hatch
      'fixture-house/1 terrain': 2, // the front door
      'fixture-shed/0 terrain': 2, // the shed's
    });
  });

  it('finds the node under a body: a flight’s to its top, the rim beside a hatch, the terrain outside', () => {
    expect(gridOf(nav.nodeAt(...world(0.75, (3 * (5 - 1.6)) / 3.5, 1.6)))).toBe('fixture-house/1'); // the hall's flight
    expect(gridOf(nav.nodeAt(...world(4.1, 6, 3.25)))).toBe('fixture-house/3'); // over the hatch, on its rim
    expect(gridOf(nav.nodeAt(...YARD))).toBe('terrain');
  });

  it('leads from the yard to every room and back, the attic crouched, and walks a stairwell in its middle', () => {
    const yard = nav.nodeAt(...YARD);
    for (const room of ROOMS) {
      const [there, back] = [nav.flowField(room.at), nav.flowField(YARD)];
      expect([room.name, there[yard] < Infinity, back[nav.nodeAt(...room.at)] < Infinity]).toEqual([room.name, true, true]); // prettier-ignore
      expect([room.name, nav.crouch(there, ...room.at)]).toEqual([room.name, room.name === 'attic']);
    }
    const way = nav.findPath(YARD, ROOMS.find((room) => room.name === 'cellar')!.at)!;
    expect(way.at(-1)!.toArray()).toEqual([10.75 + 0.1964, -3, 12.75 + 0.1964].map((v) => expect.closeTo(v, 9)));
    const flight = nav.nodeAt(...world(6.75, -1.5, 3.25)); // the cellar's flight, its west column by the railing
    expect([nav.center(flight).x, nav.clearAt(flight).x]).toEqual([16.75, expect.closeTo(16.9464, 9)]);
  });

  it('tells how far the next step rises and the feet stand over their floor', () => {
    const cellar = nav.flowField(ROOMS.find((room) => room.name === 'cellar')!.at);
    expect(nav.rise(cellar, ...world(6.75, -1.5, 3.25))).toBeCloseTo(-3 / 7, 9); // down the flight a tile
    expect(nav.over(...world(2, 1, 2))).toBe(1);
  });
});
