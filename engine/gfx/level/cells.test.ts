/**
 * @file Unit tests for engine/gfx/level/cells.ts's rooms (WP 13.39): on a storey of a level with rooms, a wall between
 * a room and the outdoors faces the outdoors, one between two rooms faces nowhere, and one open on no side still faces
 * away from the map's centre; with no room grid (a level without rooms) the old rule holds, the open-both-ways wall
 * falling back to the diagonal. The common cases are engine/gfx/level/meshes.test.ts's.
 * @see engine/gfx/level/cells.ts
 */
import { describe, expect, it } from 'vitest';
import type { CompiledLevel } from '../../world/level/types';
import { levelCells } from './cells';

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
});
