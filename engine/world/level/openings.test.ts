/**
 * @file Unit tests for engine/world/level/openings.ts (T1; WP 13.13): doors and windows found in a storey's grid, the
 * wall's axis from their longer side (or from the wall at their ends when square), their width, depth, bottom, top and
 * centre; blocks that are not filled rectangles or have no wall at both ends come back as problems; the tiles either
 * side of each.
 * @see engine/world/level/openings.ts
 */
import { describe, expect, it } from 'vitest';
import { legendOf } from './glyph';
import type { TileGrid } from './grid';
import { findOpenings, sidesOf } from './openings';

const LEGEND = legendOf();

/** A grid of `rows` (legend characters), `tile` metres a tile. */
function grid(rows: string[], tile = 0.25): TileGrid {
  return { cols: rows[0].length, rows: rows.length, tile, tiles: rows.flatMap((row) => [...row].map((char) => LEGEND.get(char)!)) }; // prettier-ignore
}

describe('findOpenings', () => {
  it('finds a door along a wall running east to west and a window in one running north to south', () => {
    const { openings, problems } = findOpenings(grid(['########', '#......#', '#......:', '#......:', '##++++##']), { index: 2, base: 3 }); // prettier-ignore
    expect(problems).toEqual([]);
    expect(openings).toEqual([
      { kind: 'door', glyph: 'glyph:door', surface: 'stone', storey: 2, tiles: [2, 4, 5, 4], axis: 'x', width: 1, depth: 0.25, bottom: 3, top: 5.1, center: [1, 3, 1.125], rooms: [-1, -1] }, // prettier-ignore
      { kind: 'window', glyph: 'glyph:window', surface: 'stone', storey: 2, tiles: [7, 2, 7, 3], axis: 'z', width: 0.5, depth: 0.25, bottom: 3.9, top: 5.1, center: [1.875, 3.9, 0.75], rooms: [-1, -1] }, // prettier-ignore
    ]);
  });

  it('reads a square opening’s axis from the wall at its ends', () => {
    const across = findOpenings(grid(['#####', '#...#', '##+##', '#...#', '#####'], 1), { index: 0, base: 0 });
    expect(across.openings.map((o) => [o.axis, o.width])).toEqual([['x', 1]]);
    const along = findOpenings(grid(['#####', '#.#.#', '#.+.#', '#.#.#', '#####'], 1), { index: 0, base: 0 });
    expect(along.openings.map((o) => [o.axis, o.width])).toEqual([['z', 1]]);
  });

  it('refuses a block that is no filled rectangle, and one with no wall at both ends, at its first tile', () => {
    const { openings, problems } = findOpenings(grid(['#######', '#.....#', '#..:..#', '#.....#', '##++###', '##+####']), { index: 0, base: 0 }); // prettier-ignore
    expect(openings).toEqual([]);
    expect(problems.map((p) => [p.glyph.id, p.first, p.why])).toEqual([
      ['glyph:door', [2, 4], 'is not a filled rectangle (3 tiles in a 2 × 2 area)'],
      ['glyph:window', [3, 2], 'has no wall at both of its ends (north and south), so the way through it is not clear'],
    ]);
  });

  it('accepts another opening as the wall at an end: a window beside a door', () => {
    const { openings, problems } = findOpenings(grid(['#########', '#.......#', '#::++::##']), { index: 0, base: 0 });
    expect([problems, openings.map((o) => [o.kind, o.tiles])]).toEqual([[], [['door', [3, 2, 4, 2]], ['window', [1, 2, 2, 2]], ['window', [5, 2, 6, 2]]]]); // prettier-ignore
  });
});

describe('sidesOf', () => {
  it('gives the tiles either side across the wall, the lower x or z first, null off the map', () => {
    expect(sidesOf({ tiles: [2, 4, 5, 4], axis: 'x' }, 8, 5)).toEqual([[3, 3], null]);
    expect(sidesOf({ tiles: [3, 1, 3, 2], axis: 'z' }, 8, 5)).toEqual([
      [2, 1],
      [4, 1],
    ]);
  });
});
