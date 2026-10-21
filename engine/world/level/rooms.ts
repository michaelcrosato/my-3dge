/**
 * @file Rooms (PLAN.md WP 13.13; docs/PLAYGROUND.md §6.2): the floor areas a storey's walls and openings enclose, each
 * named by its marker, a glyph with a `room`. `findRooms` floods each storey's floor (its floored tiles that are not
 * solid and not an opening) into areas, and makes each area holding a marker a room: its id `room:<name>`, storey,
 * tile count, area, bounding rectangle and the marker's place; every other tile is in no room (−1). Problems
 * (`LEVEL_BAD_ROOM`): a room marked twice, two rooms named alike, two rooms' markers on one floor. `roomSides` then
 * fills in the rooms either side of each opening.
 *
 * A room is data the rest of the playground reads (§6.2): its reverb, its light group, its name on the HUD, the
 * cutaway's grouping. A flight of stairs is floor of the storey it rises from, so a hall's stairs are the hall's.
 *
 * Invariants: pure functions of the storeys' grids; rooms come by storey, then in reading order of their markers, so the
 * same text gives the same list and the same indexes.
 *
 * @example
 * import { legendOf } from './glyph';
 * import { defineGlyph } from './glyph';
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * defineGlyph('glyph:hallMark', { char: 'H', mesh: 'floor', room: 'hall' }, reg);
 * const legend = legendOf(reg);
 * const tiles = [...'#####' + '#.H.#' + '#####'].map((char) => legend.get(char)!);
 * const { rooms, roomOf } = findRooms([{ grid: { cols: 5, rows: 3, tile: 1, tiles }, floored: tiles.map(() => true), base: 0 }]);
 * [rooms[0].id, rooms[0].tiles, roomOf[0][6]]; // ['room:hall', 3, 0]
 * @see engine/world/level/rooms.test.ts
 */
import type { Glyph } from './glyph';
import type { TileGrid } from './grid';
import { sidesOf } from './openings';
import { findBlocks } from './rects';
import type { OpeningDescriptor, RoomDescriptor } from './types';

/** One storey as `findRooms` reads it: its grid, which tiles have a floor, and its floor's height (m). */
export interface RoomSource {
  readonly grid: TileGrid;
  readonly floored: readonly boolean[];
  readonly base: number;
}

/** A room problem: where (the storey and tile, in reading order) and why. */
export interface RoomProblem {
  readonly storey: number;
  readonly at: readonly [col: number, row: number];
  readonly why: string;
}

/** Whether a tile is a room's floor: floored, neither solid nor an opening. */
const roomFloor = (glyph: Glyph, floored: boolean) => floored && !glyph.solid && glyph.opening === 'none';

/** The rooms of `storeys` (bottom first), each storey's room index per tile, and the problems; see the file comment. */
export function findRooms(storeys: readonly RoomSource[]): {
  rooms: RoomDescriptor[];
  roomOf: Int32Array[];
  problems: RoomProblem[];
} {
  const rooms: RoomDescriptor[] = [];
  const problems: RoomProblem[] = [];
  const named = new Map<string, { storey: number; at: readonly [number, number] }>();
  const roomOf = storeys.map(({ grid, floored }, s) => {
    const { cols, rows, tile: t, tiles } = grid;
    const of = new Int32Array(cols * rows).fill(-1);
    const inside = (c: number, r: number) => roomFloor(tiles[r * cols + c], floored[r * cols + c]);
    const { blocks, blockOf } = findBlocks(cols, rows, inside);
    const markers = new Map<number, number[]>();
    tiles.forEach((glyph, i) => {
      if (!glyph.room) return;
      if (blockOf[i] < 0) return void problems.push({ storey: s, at: [i % cols, Math.floor(i / cols)], why: `the room ${glyph.room}'s marker stands on no floor` }); // prettier-ignore
      markers.set(blockOf[i], [...(markers.get(blockOf[i]) ?? []), i]);
    });
    const roomOfBlock = new Map<number, number>();
    const marked = [...markers.entries()].sort((a, b) => a[1][0] - b[1][0]);
    for (const [block, [first, ...more]] of marked) {
      const glyph = tiles[first];
      const at = [first % cols, Math.floor(first / cols)] as const;
      const other = more.find((i) => tiles[i].room !== glyph.room);
      if (other !== undefined) {
        const why = `the rooms ${glyph.room} and ${tiles[other].room} share one floor: close one off from the other with walls and a door`;
        problems.push({ storey: s, at, why });
        continue;
      }
      if (more.length) {
        problems.push({ storey: s, at: [more[0] % cols, Math.floor(more[0] / cols)], why: `the room ${glyph.room} is marked twice on one floor` }); // prettier-ignore
        continue;
      }
      const seen = named.get(glyph.room);
      if (seen) {
        problems.push({
          storey: s,
          at,
          why: `the room ${glyph.room} is named twice (also on storey ${seen.storey + 1})`,
        });
        continue;
      }
      named.set(glyph.room, { storey: s, at });
      const { rect, tiles: count } = blocks[block];
      roomOfBlock.set(block, rooms.length);
      rooms.push({
        id: `room:${glyph.room}`,
        name: glyph.room,
        glyph: glyph.id,
        marker: at,
        storey: s,
        tiles: count,
        area: count * t * t,
        rect,
        position: [(at[0] + 0.5) * t, storeys[s].base + glyph.floor, (at[1] + 0.5) * t],
      });
    }
    for (let i = 0; i < of.length; i++) if (blockOf[i] >= 0) of[i] = roomOfBlock.get(blockOf[i]) ?? -1;
    return of;
  });
  return { rooms, roomOf, problems };
}

/** Each opening with the rooms either side of it filled in from `roomOf` (each storey's room per tile). */
export function roomSides(
  openings: readonly OpeningDescriptor[],
  roomOf: readonly Int32Array[],
  cols: number,
  rows: number,
): OpeningDescriptor[] {
  return openings.map((opening) => {
    const sides = sidesOf(opening, cols, rows).map((tile) =>
      tile ? roomOf[opening.storey][tile[1] * cols + tile[0]] : -1,
    ) as [number, number];
    return { ...opening, rooms: sides };
  });
}
