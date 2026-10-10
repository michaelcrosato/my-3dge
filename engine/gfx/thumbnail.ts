/**
 * @file Text thumbnails (PLAN.md §8.5): a frame as a 48 × 27 grid of hex colours, kept as JSON
 * (tests/baselines/thumbs/<case>.json) instead of an image (doctrine: Assets), compared per cell with a tolerance,
 * and read as a coarse map. `thumbnail(rgba, width, height, ids?)` averages the source pixels each cell covers (the
 * nearest pixel when the source is smaller than the grid) into `rows`: 27 strings of 48 `rrggbb` colours separated
 * by spaces. Given the ID pass's per-pixel objects (engine/gfx/idpass.ts), it also writes `map`, 27 strings of 48
 * symbols, each cell the object covering most of it (`.` empty space, `?` a pixel no object claims), with `legend`
 * naming each symbol: `A` is the largest visible object, then `B`…`Z`, `a`…`z`, `0`…`9`, and `+` any after those.
 * `compareThumbnails(expected, actual, { tolerance })` counts the cells whose colour moved by more than the
 * tolerance in some channel, with the mean and largest change and the worst cells.
 *
 * Pure and DOM-free, so the page builds thumbnails from its shot (engine/gfx/shot.ts) and Node compares them with
 * the baselines (`x shot --thumb <case>`, tools/cmd/shot.ts).
 *
 * Invariants: a thumbnail is plain JSON; the same pixels give the same thumbnail; averages are of the 8-bit sRGB
 * values, rounded.
 *
 * @example
 * const thumb = thumbnail(new Uint8Array(48 * 27 * 4).fill(255), 48, 27);
 * thumb.rows[0].slice(0, 13); // 'ffffff ffffff'
 * compareThumbnails(thumb, thumb).cells; // 0
 * @see engine/gfx/thumbnail.test.ts
 */

/** The grid's size: 48 × 27 cells (16:9). */
export const THUMB_WIDTH = 48;
/** The grid's height. */
export const THUMB_HEIGHT = 27;

/** The symbols of the map, for the visible objects in order (largest first). */
export const MAP_SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** The per-pixel value of a pixel no object claims (an ID colour the pass did not assign). */
export const STRAY = 0xffffffff;

/** A text thumbnail. */
export interface Thumbnail {
  /** Cells across and down: 48 × 27. */
  width: number;
  height: number;
  /** The source frame's size in pixels. */
  source: [number, number];
  /** One string per row of cells: `width` colours `rrggbb`, separated by spaces. */
  rows: string[];
  /** One string per row: the object covering most of each cell, as a symbol of `legend` (with the ID pass). */
  map?: string[];
  /** What each symbol in `map` is: the object's name. */
  legend?: Record<string, string>;
}

/** The ID pass's objects per pixel: 0 empty space, k the k-th name of `names` (1-based), `STRAY` unclaimed. */
export interface ThumbnailIds {
  pixels: Uint32Array;
  names: readonly string[];
}

/** How two thumbnails differ. */
export interface ThumbnailDiff {
  /** Cells whose colour moved by more than the tolerance in some channel. */
  cells: number;
  /** The largest channel change of any cell, and the mean of each cell's largest channel change. */
  maxDelta: number;
  meanDelta: number;
  /** The five cells that moved most, beyond the tolerance: column, row, both colours, the change. */
  worst: { x: number; y: number; expected: string; actual: string; delta: number }[];
}

/** The source pixels a cell covers along one axis: [start, end), at least one pixel. */
function span(cell: number, cells: number, size: number): [number, number] {
  const start = Math.min(size - 1, Math.floor((cell * size) / cells));
  return [start, Math.max(start + 1, Math.floor(((cell + 1) * size) / cells))];
}

/** The symbol of the k-th visible object (1-based). */
const symbolOf = (k: number) => (k === 0 ? '.' : k === STRAY ? '?' : (MAP_SYMBOLS[k - 1] ?? '+'));

/** Builds the 48 × 27 thumbnail of a frame of row-major RGBA bytes, with the map when the ID pass is given. */
export function thumbnail(rgba: Uint8Array, width: number, height: number, ids?: ThumbnailIds): Thumbnail {
  if (width * height === 0 || rgba.length < width * height * 4)
    throw new Error(`thumbnail: ${rgba.length} bytes for ${width}×${height}`);
  const rows: string[] = [];
  const map: string[] = [];
  const seen = new Set<number>();
  for (let cy = 0; cy < THUMB_HEIGHT; cy++) {
    const [y0, y1] = span(cy, THUMB_HEIGHT, height);
    const colours: string[] = [];
    let symbols = '';
    for (let cx = 0; cx < THUMB_WIDTH; cx++) {
      const [x0, x1] = span(cx, THUMB_WIDTH, width);
      const sum = [0, 0, 0];
      const votes = new Map<number, number>();
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * width + x;
          for (let c = 0; c < 3; c++) sum[c] += rgba[p * 4 + c];
          if (ids) votes.set(ids.pixels[p], (votes.get(ids.pixels[p]) ?? 0) + 1);
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      colours.push(
        sum
          .map((value) =>
            Math.round(value / n)
              .toString(16)
              .padStart(2, '0'),
          )
          .join(''),
      );
      if (ids) {
        let best = 0;
        let bestVotes = -1;
        for (const [k, count] of votes)
          if (count > bestVotes || (count === bestVotes && k < best)) [best, bestVotes] = [k, count];
        seen.add(best);
        symbols += symbolOf(best);
      }
    }
    rows.push(colours.join(' '));
    if (ids) map.push(symbols);
  }
  const thumb: Thumbnail = { width: THUMB_WIDTH, height: THUMB_HEIGHT, source: [width, height], rows };
  if (!ids) return thumb;
  const legend: Record<string, string> = {};
  for (const k of [...seen].sort((a, b) => a - b)) {
    if (k === 0) legend['.'] = 'empty space';
    else if (k === STRAY) legend['?'] = 'a colour the ID pass did not assign';
    else if (k <= MAP_SYMBOLS.length) legend[symbolOf(k)] = ids.names[k - 1];
    else legend['+'] = `${legend['+'] ? `${legend['+']}, ` : ''}${ids.names[k - 1]}`;
  }
  return { ...thumb, map, legend };
}

/** The cells of a thumbnail as [r, g, b] triples, row by row; throws when a row is malformed. */
function cellsOf(thumb: Thumbnail): number[][][] {
  return thumb.rows.map((row, y) => {
    const cells = row.split(' ');
    if (cells.length !== thumb.width || cells.some((cell) => !/^[0-9a-f]{6}$/.test(cell)))
      throw new Error(`thumbnail row ${y}: expected ${thumb.width} colours rrggbb separated by spaces`);
    return cells.map((cell) => [0, 2, 4].map((at) => parseInt(cell.slice(at, at + 2), 16)));
  });
}

/**
 * Compares two thumbnails cell by cell: a cell differs when one of its channels moved by more than `tolerance`
 * (default 24 of 255). Throws when their grids differ in size.
 */
export function compareThumbnails(
  expected: Thumbnail,
  actual: Thumbnail,
  options: { tolerance?: number } = {},
): ThumbnailDiff {
  const tolerance = options.tolerance ?? 24;
  if (
    expected.width !== actual.width ||
    expected.height !== actual.height ||
    expected.rows.length !== actual.rows.length
  )
    throw new Error(
      `thumbnails differ in size: ${expected.width}×${expected.height} and ${actual.width}×${actual.height}`,
    );
  const [a, b] = [cellsOf(expected), cellsOf(actual)];
  const worst: ThumbnailDiff['worst'] = [];
  let cells = 0;
  let maxDelta = 0;
  let total = 0;
  for (let y = 0; y < a.length; y++) {
    for (let x = 0; x < a[y].length; x++) {
      const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(a[y][x][c] - b[y][x][c])));
      total += delta;
      maxDelta = Math.max(maxDelta, delta);
      if (delta <= tolerance) continue;
      cells++;
      const cell = (rows: string[]) => rows[y].split(' ')[x];
      worst.push({ x, y, expected: cell(expected.rows), actual: cell(actual.rows), delta });
    }
  }
  worst.sort((p, q) => q.delta - p.delta || p.y - q.y || p.x - q.x);
  const count = expected.width * expected.height;
  return { cells, maxDelta, meanDelta: Math.round((total / count) * 100) / 100, worst: worst.slice(0, 5) };
}
