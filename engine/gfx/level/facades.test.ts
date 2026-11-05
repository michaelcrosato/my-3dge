/**
 * @file Unit tests for engine/gfx/level/facades.ts (T1; WP 13.40): an opening faces the side its rooms are not on, or
 * no way between two rooms, a room found past a counter beside it (WP 13.41); a storey's openings draw facade by facade
 * into one geometry, inside first, each facade a range of its index with a cell facing its way; and the draws left
 * standing are the ranges of the facades not cut, run together where they meet, a part with none left drawing no group,
 * its `visible` untouched.
 * @see engine/gfx/level/facades.ts
 */
import { Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { CompiledLevel, OpeningDescriptor } from '../../world/level/types';
import { boxGeometry } from '../geometry/box';
import { facadeDraws, facadeParts, INSIDE, openingFacade, openingRooms } from './facades';
import { LINING_FACES } from './linings';

/** The index into `LINING_FACES` of the face named `name`. */
const face = (name: string) => LINING_FACES.findIndex((one) => one.name === name);

/** An opening `axis`-wise on `tiles`, with `rooms` on its two sides (the lower x or z first). */
const opening = (axis: 'x' | 'z', tiles: [number, number, number, number], rooms: [number, number]) =>
  ({ axis, tiles, rooms }) as unknown as OpeningDescriptor;

describe('openingFacade', () => {
  it('faces the side its rooms are not on, and no way between two rooms or none', () => {
    expect([
      openingFacade(opening('x', [0, 0, 1, 0], [-1, 2])),
      openingFacade(opening('x', [0, 0, 1, 0], [2, -1])),
      openingFacade(opening('z', [0, 0, 0, 1], [-1, 2])),
      openingFacade(opening('z', [0, 0, 0, 1], [2, -1])),
      openingFacade(opening('x', [0, 0, 1, 0], [1, 2])),
      openingFacade(opening('x', [0, 0, 1, 0], [-1, -1])),
    ]).toEqual([face('north'), face('south'), face('west'), face('east'), INSIDE, INSIDE]);
  });
});

describe('openingRooms', () => {
  it('finds a side’s room past the low solids beside it (a counter), never past a taller one', () => {
    // a column 1 wide, 5 deep on 1 m tiles: the outdoors, the window, a counter (0.9 m), the kitchen (room 3)
    const view = (counter: number) => ({ cols: 1, rows: 5, solid: [false, true, true, false, false], room: [-1, -1, -1, 3, 3], top: [0, 3, counter, 0, 0], floor: [0, 0, 0, 0, 0] }) as unknown as CompiledLevel; // prettier-ignore
    const window = { ...opening('x', [0, 1, 0, 1], [-1, -1]), storey: 0 } as OpeningDescriptor;
    expect([openingRooms(view(0.9), window), openingRooms(view(2), window)]).toEqual([
      [-1, 3],
      [-1, -1],
    ]);
    expect(openingFacade({ ...window, rooms: openingRooms(view(0.9), window) })).toBe(face('north'));
  });
});

describe('facadeParts', () => {
  const openings = [opening('x', [2, 0, 3, 0], [-1, 0]), opening('z', [0, 2, 0, 3], [-1, 0]), opening('x', [2, 4, 3, 4], [0, 1])]; // prettier-ignore
  const drawn = facadeParts(openings, 0.5, 0, (own) => (own.length ? boxGeometry() : null))!;

  it('draws inside first, then each facade, a range each covering the index in order, a cell facing its way', () => {
    expect(drawn.facades.map(({ face: way, start, count }) => [way, start, count])).toEqual([[INSIDE, 0, 36], [face('west'), 36, 36], [face('north'), 72, 36]]); // prettier-ignore
    expect(drawn.geometry.getIndex()!.count).toBe(108);
    const north = drawn.facades[2].cell;
    expect([north.out, north.centre, north.size]).toEqual([
      [0, -1],
      [1.5, 0, 0.25],
      [1, 0.5],
    ]);
  });

  it('leaves out the ranges of the facades cut, run together where they meet, a part with none left drawing no group', () => {
    const mesh = new Mesh(drawn.geometry);
    const draws = facadeDraws([{ name: 'heads', mesh, facades: drawn.facades, bottom: 0, top: 3 }]);
    draws.show([[false, true, false]]); // the west facade cut
    expect(mesh.geometry.groups.map(({ start, count }) => [start, count])).toEqual([
      [0, 36],
      [72, 36],
    ]);
    expect(draws.cut()).toEqual({ heads: [face('west')] });
    draws.show([[false, false, true]]); // the north one: inside and west run together
    expect(mesh.geometry.groups.map(({ start, count }) => [start, count])).toEqual([[0, 72]]);
    draws.show([[true, true, true]]);
    expect([mesh.geometry.groups.length, mesh.visible]).toEqual([0, true]); // its `visible` is the storey cut's
  });
});
