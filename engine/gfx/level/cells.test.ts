/**
 * @file Unit tests for engine/gfx/level/cells.ts's rooms (WP 13.39): on a storey of a level with rooms, a wall between
 * a room and the outdoors faces the outdoors, one between two rooms faces nowhere, and one open on no side still faces
 * away from the map's centre; a block standing in rooms (WP 13.41) faces nowhere, one group, and a piece alone among
 * cut ones goes with them, in every list it is in; with no room grid (a level without rooms) the old rule holds, the
 * open-both-ways wall falling back to the diagonal. The common cases are engine/gfx/level/meshes.test.ts's.
 * @see engine/gfx/level/cells.ts
 */
import { describe, expect, it } from 'vitest';
import type { CompiledLevel } from '../../world/level/types';
import { levelCells, settleCuts } from './cells';

/**
 * A storey 5 × 3 on 1 m tiles: its outer rows solid, and along its middle row the outdoors, a wall, room 0, a wall and
 * room 1; `rooms` false leaves out the room grid, as a level without rooms has none.
 */
function storey(rooms: boolean): CompiledLevel {
  const S = true;
  const solid = [S, S, S, S, S, false, S, false, S, false, S, S, S, S, S];
  const room = [-1, -1, -1, -1, -1, -1, -1, 0, -1, 1, -1, -1, -1, -1, -1];
  return { cols: 5, rows: 3, tile: 1, solid, ...(rooms ? { room } : {}) } as unknown as CompiledLevel;
}

const round = (out: readonly number[]) => out.map((value) => +value.toFixed(6));

describe('a building storey’s wall cells', () => {
  it('face the outdoors from a room, nowhere between two rooms, and from the map’s centre where open on no side', () => {
    const [outer, between, buried] = levelCells(storey(true), [[1, 1, 1, 1], [3, 1, 3, 1], [1, 0, 1, 0]], 0); // prettier-ignore
    expect(outer.out).toEqual([-1, 0]); // the outdoors west of it, room 0 east
    expect(between.out).toEqual([0, 0]); // rooms 0 and 1 either side: only a line of sight cuts it
    expect(round(buried.out)).toEqual([-0.707107, -0.707107]); // walls all round: the diagonal, as before
  });

  it('keep the old rule on a level without rooms: open both ways, the map-centre diagonal', () => {
    const [outer, between] = levelCells(
      storey(false),
      [
        [1, 1, 1, 1],
        [3, 1, 3, 1],
      ],
      0,
    );
    expect([round(outer.out), round(between.out)]).toEqual([[-0.707107, 0.707107], [0.707107, 0.707107]]); // prettier-ignore
  });

  it('give a block standing in rooms, 2 × 2 or more and at most STANDING_AREA, one group facing nowhere (WP 13.41)', () => {
    // A storey 8 × 6 on 1 m tiles: room 0 inside a wall ring (outdoors beyond the map's edge), a 2 × 2 block in it,
    // a wall's line of two pieces, and a block of 2 × 2 at the map's edge.
    const map = ['SSSSSSSS', 'S......S', 'S.BB.LLS', 'S.BB...S', 'S....CCS', 'SSSSSCCS'];
    const solid = map.flatMap((row) => [...row].map((char) => char !== '.'));
    const room = solid.map((one) => (one ? -1 : 0));
    const level = { cols: 8, rows: 6, tile: 1, solid, room } as unknown as CompiledLevel;
    const tiles = (char: string) => map.flatMap((row, r) => [...row].flatMap((c, col) => (c === char ? [[col, r, col, r] as const] : []))); // prettier-ignore
    const block = levelCells(level, tiles('B'), 0);
    expect(block.map(({ out, group }) => [out, group])).toEqual(Array(4).fill([[0, 0], 18])); // its first tile: 2, 2
    expect(levelCells(level, tiles('L'), 0).every(({ group }) => group === undefined)).toBe(true); // a line, not a block
    expect(levelCells(level, tiles('C'), 0).every(({ group }) => group === undefined)).toBe(true); // the map's edge beside it
    const big = { ...level, tile: 1.5 } as CompiledLevel; // the block covers 9 m², over STANDING_AREA
    expect(levelCells(big, tiles('B'), 0).every(({ group }) => group === undefined)).toBe(true);
  });

  it('settle a cut: a piece alone among cut ones goes with them, and a cell two lists share goes in both', () => {
    // a row of three pieces, the ends cut; a piece of a fourth beside the third's end; a list sharing the middle
    const cell = (x: number) => ({ centre: [x, 0, 0] as [number, number, number], size: [1, 1] as [number, number] });
    const row = [cell(0), cell(1), cell(2)];
    expect(settleCuts([row], [[true, false, true]])).toEqual([[true, true, true]]); // the middle stood alone
    expect(settleCuts([[...row, cell(3)]], [[true, false, true, false]])).toEqual([[true, true, true, false]]);
    expect(settleCuts([[cell(0), cell(1)]], [[true, false]])).toEqual([[true, false]]); // an end, one neighbour: whole
    const lining = [row[1]]; // the middle's lining, its cell the wall's own
    expect(settleCuts([row, lining], [[true, false, true], [false]])).toEqual([[true, true, true], [true]]);
  });
});
