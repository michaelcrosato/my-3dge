/**
 * @file Unit tests for `x shot`'s Node half (`tools/cmd/shot.ts`): the look metrics of synthetic frames, the verdict
 * (a blank frame fails, an almost empty one warns), and how a page argument becomes a URL. The browser half is
 * proven by `node x shot labs/hello` (WP 0.8's Verify) and tests/e2e/hello.spec.ts, which measures with the same
 * `frameMetrics`.
 */
import { describe, expect, it } from 'vitest';
import { frameMetrics, judgeFrame, resolvePage } from './shot';

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

describe('frameMetrics', () => {
  it('measures a blank frame: one colour, no coverage', () => {
    const metrics = frameMetrics(frame(4, 2, [29, 36, 48]), 4, 2);
    expect(metrics).toMatchObject({ width: 4, height: 2, colors: 1, blank: true, background: '#1d2430', coverage: 0 });
    expect(metrics.meanColor).toBe('#1d2430');
    expect(metrics.histogram).toBe('#103030 100.0%');
  });

  it('takes the commonest colour as the background and counts the rest as coverage', () => {
    // 10 × 10, a 4 × 5 white block on black: 20% coverage.
    const rgba = frame(10, 10, [0, 0, 0], (x, y) => (x < 4 && y < 5 ? [255, 255, 255] : undefined));
    const metrics = frameMetrics(rgba, 10, 10);
    expect(metrics).toMatchObject({ colors: 2, blank: false, background: '#000000', coverage: 0.2 });
    expect(metrics).toMatchObject({ lumaMean: 0.2, lumaP5: 0, lumaP95: 1, dark: 0.8, blown: 0.2 });
    expect(metrics.histogram).toBe('#101010 80.0%, #f0f0f0 20.0%');
  });

  it('ignores differences within the tolerance of 6 per channel', () => {
    const rgba = frame(10, 1, [100, 100, 100], (x) =>
      x === 0 ? [106, 94, 100] : x === 1 ? [107, 100, 100] : undefined,
    );
    expect(frameMetrics(rgba, 10, 1)).toMatchObject({ colors: 3, coverage: 0.1 });
  });

  it('reads luma percentiles with Rec. 709 weights', () => {
    // Pure green has luma 0.7152: P5 is the black half, P95 the green half.
    const rgba = frame(2, 1, [0, 0, 0], (x) => (x === 1 ? [0, 255, 0] : undefined));
    const metrics = frameMetrics(rgba, 2, 1);
    expect(metrics.lumaP5).toBe(0);
    expect(metrics.lumaP95).toBeCloseTo(182 / 255, 4);
    expect(metrics.lumaMean).toBeCloseTo(0.3576, 4);
  });

  it('refuses a buffer too small for its size', () => {
    expect(() => frameMetrics(new Uint8Array(4), 2, 1)).toThrow('4 bytes for 2×1');
  });
});

describe('judgeFrame', () => {
  it('fails a blank frame, naming the colour and the fix', () => {
    const { failures } = judgeFrame(frameMetrics(frame(2, 2, [1, 2, 3]), 2, 2), 'labs/x');
    expect(failures).toEqual([{ id: 'SHOT_BLANK', message: expect.stringContaining('all 2×2 pixels are #010203') }]);
    expect(failures[0].message).toContain('Draw before signalling ready');
  });

  it('warns about an almost empty frame and passes a drawn one', () => {
    const speck = frame(100, 100, [0, 0, 0], (x, y) => (x + y === 0 ? [255, 0, 0] : undefined));
    expect(judgeFrame(frameMetrics(speck, 100, 100), 'labs/x')).toEqual({
      failures: [],
      warnings: [{ id: 'SHOT_EMPTY', message: expect.stringContaining('0.01% of 100×100') }],
    });
    const drawn = frame(10, 10, [0, 0, 0], (x) => (x < 5 ? [255, 0, 0] : undefined));
    expect(judgeFrame(frameMetrics(drawn, 10, 10), 'labs/x')).toEqual({ failures: [], warnings: [] });
  });
});

describe('resolvePage', () => {
  it('opens a lab by its directory and an .html file as is, keeping the query', () => {
    expect(resolvePage('labs/hello')).toEqual({ path: 'labs/hello/', file: 'labs/hello/index.html' });
    expect(resolvePage('./labs/hello/?post=0')).toEqual({ path: 'labs/hello/?post=0', file: 'labs/hello/index.html' });
    expect(resolvePage('tests/pages/harness.html?throw')).toEqual({
      path: 'tests/pages/harness.html?throw',
      file: 'tests/pages/harness.html',
    });
  });
});
