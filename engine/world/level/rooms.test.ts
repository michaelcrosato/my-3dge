/**
 * @file Unit tests for engine/world/level/rooms.ts (T1; WP 13.13): each marker's floor inside walls and openings
 * becomes a room (its id, storey, tiles, area, bounds and place), every other tile none; a room marked twice, named
 * on two storeys, or two rooms on one floor are problems; the rooms either side of each opening.
 * @see engine/world/level/rooms.ts
 */
import { describe, expect, it } from 'vitest';
import { defineStoreyFixtureGlyphs } from '../../../fixtures/levels/storeys/glyphs';
import { createRegistry } from '../../core/registry';
import { legendOf } from './glyph';
import type { TileGrid } from './grid';
import { findRooms, roomSides, type RoomSource } from './rooms';
import type { OpeningDescriptor } from './types';

const REGISTRY = createRegistry();
defineStoreyFixtureGlyphs(REGISTRY);
const LEGEND = legendOf(REGISTRY);

/** A storey of `rows` (legend characters) on `base`, 1 m tiles. */
function storey(rows: string[], base = 0): RoomSource {
  const tiles = rows.flatMap((row) => [...row].map((char) => LEGEND.get(char)!));
  const grid: TileGrid = { cols: rows[0].length, rows: rows.length, tile: 1, tiles };
  return { grid, floored: tiles.map((glyph) => !glyph.void), base };
}

describe('findRooms', () => {
  it('floods each marker’s floor inside walls and doors, by storey, then in reading order', () => {
    const { rooms, roomOf, problems } = findRooms([
      storey(['########', '#h..#.k#', '#...+..#', '########']),
      storey(['########', '#b.~~..#', '#...#.s#', '########'], 3),
    ]);
    expect(problems).toEqual([]);
    expect(rooms.map((r) => [r.id, r.storey, r.tiles, r.area, r.rect, r.marker, r.position])).toEqual([
      ['room:hall', 0, 6, 6, [1, 1, 3, 2], [1, 1], [1.5, 0, 1.5]],
      ['room:kitchen', 0, 4, 4, [5, 1, 6, 2], [6, 1], [6.5, 0, 1.5]],
      ['room:bedroom', 1, 5, 5, [1, 1, 3, 2], [1, 1], [1.5, 3, 1.5]], // the void and the wall close it off
      ['room:study', 1, 4, 4, [5, 1, 6, 2], [6, 2], [6.5, 3, 2.5]],
    ]);
    expect([roomOf[0][2 * 8 + 4], roomOf[0][0], roomOf[1][1 * 8 + 3]]).toEqual([-1, -1, -1]); // the door, a wall, the void
  });

  it('names its problems: a room marked twice, a name on two storeys, two rooms on one floor', () => {
    const { rooms, problems } = findRooms([
      storey(['#########', '#h.#k..k#', '#########']),
      storey(['#########', '#h.#c..s#', '#########'], 3),
    ]);
    expect(rooms.map((r) => r.id)).toEqual(['room:hall']);
    expect(problems).toEqual([
      { storey: 0, at: [7, 1], why: 'the room kitchen is marked twice on one floor' },
      { storey: 1, at: [1, 1], why: 'the room hall is named twice (also on storey 1)' },
      { storey: 1, at: [4, 1], why: 'the rooms cellar and study share one floor: close one off from the other with walls and a door' }, // prettier-ignore
    ]);
  });
});

describe('roomSides', () => {
  it('fills in the rooms either side of each opening, −1 outside any', () => {
    const { roomOf } = findRooms([storey(['########', '#h..+.k#', '#...#..#', '####+###'])]);
    const door = (tiles: [number, number, number, number], axis: 'x' | 'z') => ({ tiles, axis, storey: 0 }) as unknown as OpeningDescriptor; // prettier-ignore
    expect(roomSides([door([4, 1, 4, 1], 'z'), door([4, 3, 4, 3], 'x')], roomOf, 8, 4).map((o) => o.rooms)).toEqual([[0, 1], [-1, -1]]); // prettier-ignore
  });
});
