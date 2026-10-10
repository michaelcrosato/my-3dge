/**
 * @file Unit tests for engine/gfx/thumbnail.ts: the 48 × 27 grid of averaged hex colours (larger and smaller
 * sources), the object map and its legend from the ID pass's per-pixel objects, and the per-cell comparison with a
 * tolerance.
 */
import { describe, expect, it } from 'vitest';
import { compareThumbnails, STRAY, thumbnail, THUMB_HEIGHT, THUMB_WIDTH } from './thumbnail';

/** A width × height frame painted by `paint(x, y)`. */
function frame(width: number, height: number, paint: (x: number, y: number) => number[]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...paint(x, y), 255], (y * width + x) * 4);
  return rgba;
}

describe('thumbnail', () => {
  it('averages each cell of a larger frame into rows of hex colours', () => {
    // 96 × 54: each cell is 2 × 2 pixels; the left half red, the right half blue, one cell half grey.
    const rgba = frame(96, 54, (x, y) => (x === 0 && y === 0 ? [100, 100, 100] : x < 48 ? [255, 0, 0] : [0, 0, 255]));
    const thumb = thumbnail(rgba, 96, 54);
    expect(thumb).toMatchObject({ width: THUMB_WIDTH, height: THUMB_HEIGHT, source: [96, 54] });
    expect(thumb.rows).toHaveLength(27);
    const cells = thumb.rows[1].split(' ');
    expect(cells).toHaveLength(48);
    expect(cells.slice(22, 26)).toEqual(['ff0000', 'ff0000', '0000ff', '0000ff']);
    // (100 + 3 × 255) / 4 = 216.25 red, 100 / 4 = 25 green and blue.
    expect(thumb.rows[0].split(' ')[0]).toBe('d81919');
    expect(thumb.map).toBeUndefined();
  });

  it('takes the nearest pixel when the frame is smaller than the grid', () => {
    const thumb = thumbnail(
      frame(4, 3, (x, y) => [x * 60, y * 100, 0]),
      4,
      3,
    );
    expect(thumb.rows[0].split(' ').slice(0, 13)).toEqual([...Array(12).fill('000000'), '3c0000']);
    expect(thumb.rows[26].split(' ')[47]).toBe('b4c800');
  });

  it('maps each cell to the object covering most of it, with the legend', () => {
    const pixels = new Uint32Array(96 * 54);
    for (let y = 0; y < 54; y++) {
      for (let x = 0; x < 96; x++) pixels[y * 96 + x] = x < 48 ? 1 : y < 2 ? STRAY : x < 50 ? 2 : 0;
    }
    const thumb = thumbnail(
      frame(96, 54, () => [0, 0, 0]),
      96,
      54,
      { pixels, names: ['wall', 'crate'] },
    );
    expect(thumb.map![0]).toBe(`${'A'.repeat(24)}${'?'.repeat(24)}`);
    expect(thumb.map![5]).toBe(`${'A'.repeat(24)}B${'.'.repeat(23)}`);
    expect(thumb.legend).toEqual({
      '.': 'empty space',
      A: 'wall',
      B: 'crate',
      '?': 'a colour the ID pass did not assign',
    });
  });

  it('refuses a buffer too small for its size', () => {
    expect(() => thumbnail(new Uint8Array(4), 2, 1)).toThrow('4 bytes for 2×1');
  });
});

describe('compareThumbnails', () => {
  const base = thumbnail(
    frame(48, 27, (x, y) => [x * 5, y * 9, 40]),
    48,
    27,
  );

  it('finds no difference between equal thumbnails', () => {
    expect(compareThumbnails(base, structuredClone(base))).toEqual({ cells: 0, maxDelta: 0, meanDelta: 0, worst: [] });
  });

  it('counts the cells beyond the tolerance and names the worst', () => {
    const moved = structuredClone(base);
    const row = moved.rows[3].split(' ');
    row[5] = 'ffffff';
    row[6] = row[6].replace(/^../, (red) => (parseInt(red, 16) + 10).toString(16).padStart(2, '0'));
    moved.rows[3] = row.join(' ');
    const diff = compareThumbnails(base, moved);
    expect(diff.cells).toBe(1);
    expect(diff.maxDelta).toBe(255 - 25);
    expect(diff.worst).toEqual([{ x: 5, y: 3, expected: '191b28', actual: 'ffffff', delta: 230 }]);
    expect(compareThumbnails(base, moved, { tolerance: 230 }).cells).toBe(0);
  });

  it('refuses thumbnails of different sizes or malformed rows', () => {
    expect(() => compareThumbnails(base, { ...base, width: 47 })).toThrow('differ in size');
    expect(() => compareThumbnails(base, { ...base, rows: base.rows.map(() => 'nothex') })).toThrow('thumbnail row 0');
  });
});
