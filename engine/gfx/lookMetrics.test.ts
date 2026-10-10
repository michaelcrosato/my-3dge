/**
 * @file Unit tests for engine/gfx/lookMetrics.ts on synthetic frames: coverage against the commonest colour (with
 * its tolerance), Rec. 709 luma percentiles, the palette and flat share, checkerboard dithering, edge density, the
 * ID pass's largest object and protagonist, and the notes with their numbers and fixes (a blank frame fails alone; a
 * rich frame raises none).
 */
import { describe, expect, it } from 'vitest';
import { judgeLook, lookMetrics, LOOK_LIMITS } from './lookMetrics';

/** A width × height frame filled with `fill`, then `paint(x, y)` where it returns a colour. */
function frame(
  width: number,
  height: number,
  fill: number[],
  paint: (x: number, y: number) => number[] | undefined = () => undefined,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set([...(paint(x, y) ?? fill), 255].slice(0, 4), (y * width + x) * 4);
  }
  return rgba;
}

/** A 16 × 16 gradient: 256 colours, every one its own 5-bit colour, no flat area, wide luma. */
const rich = () => frame(16, 16, [0, 0, 0], (x, y) => [x * 16, y * 16, 128]);

describe('lookMetrics', () => {
  it('measures a blank frame: one colour, no coverage', () => {
    const metrics = lookMetrics(frame(4, 2, [29, 36, 48]), 4, 2);
    expect(metrics).toMatchObject({ width: 4, height: 2, colors: 1, palette: 1, blank: true, coverage: 0, flat: 1 });
    expect(metrics).toMatchObject({ background: '#1d2430', meanColor: '#1d2430', histogram: '#103030 100.0%' });
    expect(metrics).toMatchObject({ largest: null, largestShare: null, protagonist: null, edges: 0 });
  });

  it('takes the commonest colour as the background and counts the rest as coverage', () => {
    // 10 × 10, a 4 × 5 white block on black: 20% coverage.
    const metrics = lookMetrics(
      frame(10, 10, [0, 0, 0], (x, y) => (x < 4 && y < 5 ? [255, 255, 255] : undefined)),
      10,
      10,
    );
    expect(metrics).toMatchObject({ colors: 2, blank: false, background: '#000000', coverage: 0.2, flat: 0.8 });
    expect(metrics).toMatchObject({ lumaMean: 0.2, lumaP5: 0, lumaP95: 1, spread: 1, dark: 0.8, blown: 0.2 });
    expect(metrics.histogram).toBe('#101010 80.0%, #f0f0f0 20.0%');
    // The block's right column (5 pixels) and bottom row (4, one shared) meet black: 8 edge pixels.
    expect(metrics.edges).toBe(0.08);
  });

  it('ignores differences within the tolerance of 6 per channel', () => {
    const rgba = frame(10, 1, [100, 100, 100], (x) =>
      x === 0 ? [106, 94, 100] : x === 1 ? [107, 100, 100] : undefined,
    );
    expect(lookMetrics(rgba, 10, 1)).toMatchObject({ colors: 3, coverage: 0.1 });
  });

  it('reads luma percentiles with Rec. 709 weights', () => {
    const metrics = lookMetrics(
      frame(2, 1, [0, 0, 0], (x) => (x === 1 ? [0, 255, 0] : undefined)),
      2,
      1,
    );
    expect(metrics.lumaP5).toBe(0);
    expect(metrics.lumaP95).toBeCloseTo(182 / 255, 4);
    expect(metrics.lumaMean).toBeCloseTo(0.3576, 4);
  });

  it('counts the palette, the flat share and checkerboard dithering at 5 bits per channel', () => {
    const metrics = lookMetrics(rich(), 16, 16);
    expect(metrics).toMatchObject({ colors: 256, palette: 256, flat: 0.0039, checker: 0, edges: 0 });
    const dither = lookMetrics(
      frame(8, 8, [0, 0, 0], (x, y) => ((x + y) % 2 ? [200, 200, 200] : undefined)),
      8,
      8,
    );
    // Every pixel but the last differs from its right or lower neighbour.
    expect(dither).toMatchObject({ checker: 1, palette: 2, edges: 0.9844 });
  });

  it("takes the ID pass's largest object and whether the protagonist covers any pixel", () => {
    const ids = {
      visible: [
        { name: 'floor', share: 0.4 },
        { name: 'wall', share: 0.45 },
      ],
      protagonist: { name: 'hero', px: 0 },
    };
    expect(lookMetrics(rich(), 16, 16, ids)).toMatchObject({ largest: 'wall', largestShare: 0.45, protagonist: false });
    const seen = lookMetrics(rich(), 16, 16, { visible: [], protagonist: { name: 'hero', px: 3 } });
    expect(seen).toMatchObject({ largest: null, largestShare: null, protagonist: true });
  });

  it('refuses a buffer too small for its size', () => {
    expect(() => lookMetrics(new Uint8Array(4), 2, 1)).toThrow('4 bytes for 2×1');
  });
});

describe('judgeLook', () => {
  it('fails a blank frame alone, naming the colour and the fix', () => {
    const notes = judgeLook(lookMetrics(frame(2, 2, [1, 2, 3]), 2, 2), 'labs/x');
    expect(notes).toEqual([
      {
        id: 'LOOK_BLANK',
        level: 'fail',
        value: 0,
        limit: 0,
        message: expect.stringContaining('all 2×2 pixels are #010203'),
      },
    ]);
    expect(notes[0].message).toContain('Draw before signalling ready');
  });

  it('raises nothing on a rich frame', () => {
    expect(judgeLook(lookMetrics(rich(), 16, 16))).toEqual([]);
  });

  it('warns with the number, the limit and a fix', () => {
    const speck = lookMetrics(
      frame(100, 100, [0, 0, 0], (x, y) => (x + y === 0 ? [255, 0, 0] : undefined)),
      100,
      100,
    );
    const notes = judgeLook(speck, 'labs/x');
    expect(notes.map((note) => note.id)).toEqual([
      'LOOK_EMPTY',
      'LOOK_FEW_COLOURS',
      'LOOK_FLAT',
      'LOOK_LOW_CONTRAST',
      'LOOK_DARK',
    ]);
    expect(notes.every((note) => note.level === 'warn')).toBe(true);
    expect(notes[0]).toMatchObject({ value: 0.0001, limit: LOOK_LIMITS.empty });
    expect(notes[0].message).toContain('0.01% of 100×100');
    expect(notes[2].message).toBe(
      '100% of labs/x is one flat colour (limit 40%): fill it with a sky or backdrop, textured ground or props',
    );
  });

  it('warns when one object fills the frame and when the protagonist is not seen', () => {
    const ids = { visible: [{ name: 'wall', share: 0.71 }], protagonist: { name: 'hero', px: 0 } };
    const notes = judgeLook(lookMetrics(rich(), 16, 16, ids), 'the box from cam iso', ids);
    expect(notes.map((note) => note.id)).toEqual(['LOOK_ONE_OBJECT', 'LOOK_NO_PROTAGONIST']);
    expect(notes[0].message).toContain('one object covers 71% of the box from cam iso: wall (limit 70%)');
    expect(notes[1].message).toContain('the protagonist hero covers 0 px in the box from cam iso');
  });
});
