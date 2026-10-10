/**
 * @file Unit tests for engine/world/level/rects.ts (T1): the greedy merge gives the prototype's rectangles (a direct
 * transcription of `rects()` from my-3d2dge:src/stress-world/10-hall.js:81-91 as the reference) on seeded random grids,
 * covers exactly the accepted tiles once each, and `findBlocks` finds 4-connected blocks with their bounds, counts and
 * first tiles, honouring `linked`.
 * @see engine/world/level/rects.ts
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import { findBlocks, mergeRects } from './rects';

/** The prototype's `rects(ch)`, transcribed with the map passed in (`tile(x, y) === ch` becomes `on(x, y)`). */
function prototypeRects(MW: number, MH: number, on: (x: number, y: number) => boolean): number[][] {
  const used = new Uint8Array(MW * MH),
    out: number[][] = [];
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      if (used[y * MW + x] || !on(x, y)) continue;
      let x1 = x;
      while (x1 + 1 < MW && on(x1 + 1, y) && !used[y * MW + x1 + 1]) x1++;
      let y1 = y;
      for (;;) {
        const ny = y1 + 1;
        if (ny >= MH) break;
        let ok = true;
        for (let k = x; k <= x1; k++)
          if (!on(k, ny) || used[ny * MW + k]) {
            ok = false;
            break;
          }
        if (!ok) break;
        y1 = ny;
      }
      for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[yy * MW + xx] = 1;
      out.push([x, y, x1, y1]);
    }
  return out;
}

/** A seeded random grid of cols × rows, each tile on with probability `p`. */
function randomGrid(seed: number, cols: number, rows: number, p: number): boolean[] {
  const rng = new Rng(seed);
  return Array.from({ length: cols * rows }, () => rng.chance(p));
}

describe('mergeRects', () => {
  it("gives the prototype's rectangles on 200 seeded random grids", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed * 7919);
      const [cols, rows] = [rng.int(1, 24), rng.int(1, 18)];
      const grid = randomGrid(seed, cols, rows, rng.range(0.2, 0.9));
      const on = (c: number, r: number) => grid[r * cols + c];
      expect(mergeRects(cols, rows, on)).toEqual(prototypeRects(cols, rows, on));
    }
  });

  it('covers exactly the accepted tiles, each once', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const [cols, rows] = [17, 13];
      const grid = randomGrid(seed, cols, rows, 0.6);
      const count = new Array(cols * rows).fill(0);
      for (const [c0, r0, c1, r1] of mergeRects(cols, rows, (c, r) => grid[r * cols + c])) {
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * cols + c]++;
      }
      expect(count).toEqual(grid.map((on) => (on ? 1 : 0)));
    }
  });

  it('merges a filled rectangle into one and an L into two, rows first', () => {
    const map = ['##..', '##..', '###.'];
    const on = (c: number, r: number) => map[r][c] === '#';
    expect(mergeRects(4, 3, on)).toEqual([
      [0, 0, 1, 2],
      [2, 2, 2, 2],
    ]);
    expect(mergeRects(4, 3, () => false)).toEqual([]);
    expect(mergeRects(4, 3, () => true)).toEqual([[0, 0, 3, 2]]);
  });
});

describe('findBlocks', () => {
  const map = ['PP.P', 'PP.P', '..PP'];
  const on = (c: number, r: number) => map[r][c] === 'P';

  it('finds 4-connected blocks with first tile, bounds and count, in reading order', () => {
    const { blocks, blockOf } = findBlocks(4, 3, on);
    expect(blocks).toEqual([
      { first: [0, 0], rect: [0, 0, 1, 1], tiles: 4 },
      { first: [3, 0], rect: [2, 0, 3, 2], tiles: 4 },
    ]);
    expect([...blockOf]).toEqual([0, 0, -1, 1, 0, 0, -1, 1, -1, -1, 1, 1]);
  });

  it('connects only the neighbours `linked` accepts', () => {
    const { blocks } = findBlocks(4, 3, on, (c, r, c2) => !(r === 2 && c + c2 === 5));
    expect(blocks.map((block) => block.tiles)).toEqual([4, 3, 1]);
  });
});
