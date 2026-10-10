/**
 * @file Rectangles and blocks of tiles (PLAN.md WP 2.2). `mergeRects`, the greedy rectangle merge, covers every tile
 * a predicate accepts with few rectangles, rows first, for merged colliders and meshes: each rectangle is the widest
 * run from its first free tile in reading order, grown south while the whole run below is free and accepted.
 * `findBlocks` finds the 4-connected blocks of accepted tiles (a pillar's PP over PP, the areas bodies can walk
 * across), with an optional rule for which neighbours connect.
 *
 * Invariants: the rectangles cover exactly the accepted tiles, each once (no overlaps, nothing outside); they come
 * in reading order of their north-west corners. Not always the fewest rectangles (that problem is NP-hard), but the
 * prototype's count for the same map. Blocks come in reading order of their first tile. Both depend only on the
 * grid, so they are reproducible.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:81-91` (`rects`), unchanged in behaviour.
 *
 * @example
 * const map = ['##.', '##.', '...'];
 * mergeRects(3, 3, (c, r) => map[r][c] === '#'); // [[0, 0, 1, 1]]
 * findBlocks(3, 3, (c, r) => map[r][c] === '.').blocks; // [{ first: [2, 0], rect: [0, 0, 2, 2], tiles: 5 }]
 * @see engine/world/level/rects.test.ts
 */
import type { TileRect } from './types';

/** Rectangles `[col0, row0, col1, row1]` (inclusive) covering every tile of a cols × rows grid that `inside` accepts. */
export function mergeRects(cols: number, rows: number, inside: (col: number, row: number) => boolean): TileRect[] {
  const used = new Uint8Array(cols * rows);
  const free = (col: number, row: number) => !used[row * cols + col] && inside(col, row);
  const out: TileRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!free(col, row)) continue;
      let col1 = col;
      while (col1 + 1 < cols && free(col1 + 1, row)) col1++;
      let row1 = row;
      while (row1 + 1 < rows) {
        let whole = true;
        for (let c = col; c <= col1 && whole; c++) whole = free(c, row1 + 1);
        if (!whole) break;
        row1++;
      }
      for (let r = row; r <= row1; r++) used.fill(1, r * cols + col, r * cols + col1 + 1);
      out.push([col, row, col1, row1]);
    }
  }
  return out;
}

/** A 4-connected block of tiles: its first tile in reading order, its bounding rectangle and its tile count. */
export interface TileBlock {
  first: readonly [col: number, row: number];
  rect: TileRect;
  tiles: number;
}

/** The four neighbours, in a fixed order: east, west, south, north. */
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The 4-connected blocks of the tiles `inside` accepts, and the block index of every tile (−1 outside any).
 * `linked(col, row, toCol, toRow)` says whether two accepted neighbours connect (always, by default).
 */
export function findBlocks(
  cols: number,
  rows: number,
  inside: (col: number, row: number) => boolean,
  linked: (col: number, row: number, toCol: number, toRow: number) => boolean = () => true,
): { blocks: TileBlock[]; blockOf: Int32Array } {
  const blockOf = new Int32Array(cols * rows).fill(-1);
  const blocks: TileBlock[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cols * rows; start++) {
    const startCol = start % cols;
    const startRow = (start - startCol) / cols;
    if (blockOf[start] >= 0 || !inside(startCol, startRow)) continue;
    const index = blocks.length;
    let [col0, row0, col1, row1, tiles] = [startCol, startRow, startCol, startRow, 0];
    blockOf[start] = index;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop() as number;
      const col = at % cols;
      const row = (at - col) / cols;
      tiles++;
      col0 = Math.min(col0, col);
      col1 = Math.max(col1, col);
      row0 = Math.min(row0, row);
      row1 = Math.max(row1, row);
      for (const [dc, dr] of NEIGHBOURS) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const next = r * cols + c;
        if (blockOf[next] >= 0 || !inside(c, r) || !linked(col, row, c, r)) continue;
        blockOf[next] = index;
        stack.push(next);
      }
    }
    blocks.push({ first: [startCol, startRow], rect: [col0, row0, col1, row1], tiles });
  }
  return { blocks, blockOf };
}
