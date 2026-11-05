/**
 * @file Unit tests for engine/gfx/level/facades.ts (T1; WP 13.40): an opening faces the side its rooms are not on, or
 * no way between two rooms, a room found past a counter beside it (WP 13.41); a storey's openings draw facade by facade
 * into one geometry, inside first, each facade a range of its index with a cell facing its way, then each doorway
 * between rooms (WP 13.41); a facade is cut by facing and a doorway by blocking, the draws left standing the ranges not
 * cut, run together where they meet, a part with none left drawing no group, its `visible` untouched.
 * @see engine/gfx/level/facades.ts
 */
import { Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { CompiledLevel, OpeningDescriptor } from '../../world/level/types';
import { boxGeometry } from '../geometry/box';
import { DOORWAY, facadeDraws, facadeParts, INSIDE, openingFacade, openingRooms } from './facades';
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
  const drawn = facadeParts(openings, 0.5, 0, (own, way) => (own.length || way === INSIDE ? boxGeometry() : null))!;

  it('draws inside first, then each facade, then each doorway between rooms, a range each covering the index in order', () => {
    expect(drawn.facades.map(({ face: way, start, count }) => [way, start, count])).toEqual([[INSIDE, 0, 36], [face('west'), 36, 36], [face('north'), 72, 36], [DOORWAY, 108, 36]]); // prettier-ignore
    expect(drawn.geometry.getIndex()!.count).toBe(144);
    const [north, doorway] = [drawn.facades[2].cell, drawn.facades[3].cell];
    expect([north.out, north.centre, north.size, doorway.out, doorway.centre]).toEqual([[0, -1], [1.5, 0, 0.25], [1, 0.5], [0, 0], [1.5, 0, 2.25]]); // prettier-ignore
  });

  it('cuts a facade by facing and a doorway by blocking, leaving out their ranges, run together where they meet', () => {
    const mesh = new Mesh(drawn.geometry);
    const draws = facadeDraws([{ name: 'heads', mesh, facades: drawn.facades, bottom: 0, top: 3 }]);
    expect(draws.targets.map(({ when, cells }) => [when, cells.length])).toEqual([
      ['facing', 2],
      ['blocking', 1],
    ]);
    const groups = () => mesh.geometry.groups.map(({ start, count }) => [start, count]);
    draws.show([[true, false], [false]]); // the west facade cut: the north one and the doorway run together
    expect([groups(), draws.cut()]).toEqual([[[0, 36], [72, 72]], { heads: [face('west')] }]); // prettier-ignore
    draws.show([[false, false], [true]]); // the doorway, in the way
    expect([groups(), draws.cut()]).toEqual([[[0, 108]], { heads: [DOORWAY] }]);
    draws.show([[true, true], [true]]); // all but what stands at no opening, never cut
    expect(groups()).toEqual([[0, 36]]);
  });

  it('draws no group for a part with no range left, its `visible` the storey cut’s', () => {
    const bare = facadeParts(openings, 0.5, 0, (own) => (own.length ? boxGeometry() : null))!; // nothing inside
    const mesh = new Mesh(bare.geometry);
    facadeDraws([{ name: 'frames', mesh, facades: bare.facades, bottom: 0, top: 3 }]).show([[true, true], [true]]);
    expect([mesh.geometry.groups.length, mesh.visible]).toEqual([0, true]);
  });
});
