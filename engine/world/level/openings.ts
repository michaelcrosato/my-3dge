/**
 * @file Doors and windows (PLAN.md WP 13.13; docs/PLAYGROUND.md §6.1, §7.1): the openings in a storey's walls, found
 * in its tiles. `findOpenings` turns each block of an opening glyph's tiles (`opening: 'door'` or `'window'`) into an
 * `OpeningDescriptor`: a filled rectangle in a wall, the wall's axis its longer side (for a square block, the side
 * with the wall at both ends), its width along the wall and depth through it, its bottom and top (a door's floor and
 * head, a window's sill and head, absolute) and the centre of its bottom. Blocks that make none come back as problems
 * (`LEVEL_BAD_OPENING`): not a filled rectangle, or no wall (a solid tile, or another opening) at both ends along the
 * wall. The rooms either side are rooms.ts's to fill in; the head over each opening is a collider of storeys.ts's.
 *
 * Invariants: pure functions of the storey's grid; openings come by glyph id, then in reading order of their first
 * tile, so the same text gives the same list.
 *
 * @example
 * import { legendOf } from './glyph';
 * const legend = legendOf();
 * const row = (text: string) => [...text].map((char) => legend.get(char)!);
 * const grid = { cols: 6, rows: 3, tile: 0.25, tiles: [...row('######'), ...row('#....#'), ...row('#++++#')] };
 * const { openings } = findOpenings(grid, { index: 0, base: 0 });
 * [openings[0].kind, openings[0].axis, openings[0].width, openings[0].top]; // ['door', 'x', 1, 2.1]
 * @see engine/world/level/openings.test.ts
 */
import type { Glyph } from './glyph';
import { glyphsOf, holds, type TileGrid } from './grid';
import { findBlocks } from './rects';
import type { OpeningDescriptor, TileRect } from './types';

/** A block of an opening glyph that makes no opening, and why, for storeys.ts's problems. */
export interface OpeningProblem {
  readonly glyph: Glyph;
  /** The block's first tile, in reading order: `[col, row]`. */
  readonly first: readonly [col: number, row: number];
  /** What is wrong, as a phrase after "this <char> block". */
  readonly why: string;
}

/** The tiles just past both ends of `rect` along `axis`, inside a `cols` × `rows` map (null off the map). */
function ends(rect: TileRect, axis: 'x' | 'z', cols: number, rows: number): ([number, number] | null)[] {
  const [c0, r0, c1, r1] = rect;
  const tiles: ([number, number] | null)[] = [];
  if (axis === 'x') {
    for (let row = r0; row <= r1; row++) {
      tiles.push(c0 > 0 ? [c0 - 1, row] : null, c1 + 1 < cols ? [c1 + 1, row] : null);
    }
  } else {
    for (let col = c0; col <= c1; col++) {
      tiles.push(r0 > 0 ? [col, r0 - 1] : null, r1 + 1 < rows ? [col, r1 + 1] : null);
    }
  }
  return tiles;
}

/** The openings of a storey's grid and the opening blocks that make none; `storey` gives its index and floor (m). */
export function findOpenings(
  grid: TileGrid,
  storey: { index: number; base: number },
): { openings: OpeningDescriptor[]; problems: OpeningProblem[] } {
  const openings: OpeningDescriptor[] = [];
  const problems: OpeningProblem[] = [];
  const t = grid.tile;
  const walled = (tile: [number, number] | null) => {
    if (!tile) return false;
    const glyph = grid.tiles[tile[1] * grid.cols + tile[0]];
    return glyph.solid || glyph.opening !== 'none';
  };
  for (const glyph of glyphsOf(grid).filter((entry) => entry.opening !== 'none')) {
    const kind = glyph.opening as 'door' | 'window';
    for (const { first, rect, tiles } of findBlocks(grid.cols, grid.rows, holds(grid, [glyph])).blocks) {
      const [c0, r0, c1, r1] = rect;
      const [w, h] = [c1 - c0 + 1, r1 - r0 + 1];
      if (tiles !== w * h) {
        problems.push({ glyph, first, why: `is not a filled rectangle (${tiles} tiles in a ${w} × ${h} area)` });
        continue;
      }
      const shut = (axis: 'x' | 'z') => ends(rect, axis, grid.cols, grid.rows).every(walled);
      const axis = w > h ? 'x' : h > w ? 'z' : shut('x') ? 'x' : 'z';
      if (!shut(axis)) {
        const along = axis === 'x' ? 'east and west' : 'north and south';
        problems.push({ glyph, first, why: `has no wall at both of its ends (${along}), so the way through it is not clear` }); // prettier-ignore
        continue;
      }
      const bottom = storey.base + (kind === 'door' ? glyph.floor : glyph.top);
      openings.push({
        kind,
        glyph: glyph.id,
        surface: glyph.surface,
        storey: storey.index,
        tiles: rect,
        axis,
        width: (axis === 'x' ? w : h) * t,
        depth: (axis === 'x' ? h : w) * t,
        bottom,
        top: storey.base + glyph.head,
        center: [((c0 + c1 + 1) / 2) * t, bottom, ((r0 + r1 + 1) / 2) * t],
        rooms: [-1, -1],
      });
    }
  }
  return { openings, problems };
}

/** The tiles either side of an opening across its wall, the lower x or z first: `[col, row]` each, or null off the map. */
export function sidesOf(
  opening: Pick<OpeningDescriptor, 'tiles' | 'axis'>,
  cols: number,
  rows: number,
): [[number, number] | null, [number, number] | null] {
  const [c0, r0, c1, r1] = opening.tiles;
  if (opening.axis === 'x') {
    const col = Math.floor((c0 + c1) / 2);
    return [r0 > 0 ? [col, r0 - 1] : null, r1 + 1 < rows ? [col, r1 + 1] : null];
  }
  const row = Math.floor((r0 + r1) / 2);
  return [c0 > 0 ? [c0 - 1, row] : null, c1 + 1 < cols ? [c1 + 1, row] : null];
}
