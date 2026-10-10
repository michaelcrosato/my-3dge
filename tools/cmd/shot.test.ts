/**
 * @file Unit tests for `x shot`'s Node half (`tools/cmd/shot.ts`): how a page argument and the `--scene`, `--cam`
 * and `--set` flags become a URL, the verdict on look notes, the PNG encoder (round trip through tools/lib/png.ts),
 * and the flat report metrics of a shot (look metrics, the ID-pass list, repeated names, the marks' legend). The
 * metrics themselves are tested in engine/gfx/lookMetrics.test.ts; the browser half by tests/e2e/shot.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { decodePng } from '../lib/png';
import { encodePng, frameMetrics, judgeFrame, pageUrl, resolvePage, shotMetrics } from './shot';

describe('resolvePage and pageUrl', () => {
  it('opens a lab by its directory and an .html file as is, keeping the query', () => {
    expect(resolvePage('labs/hello')).toEqual({ path: 'labs/hello/', file: 'labs/hello/index.html' });
    expect(resolvePage('./labs/hello/?post=0')).toEqual({ path: 'labs/hello/?post=0', file: 'labs/hello/index.html' });
    expect(resolvePage('tests/pages/harness.html?throw')).toEqual({
      path: 'tests/pages/harness.html?throw',
      file: 'tests/pages/harness.html',
    });
  });

  it('adds the scene, the camera and each setting as URL parameters', () => {
    expect(pageUrl('labs/box', { scene: 'room', cam: 'iso', set: ['gfx.resolution=full', 'crowd=a=b'] })).toBe(
      'labs/box/?scene=room&cam=iso&gfx.resolution=full&crowd=a%3Db',
    );
    expect(pageUrl('labs/hello/?post=0', { cam: 'top' })).toBe('labs/hello/?post=0&cam=top');
    expect(pageUrl('tests/pages/shot.html')).toBe('tests/pages/shot.html');
    expect(() => pageUrl('labs/box', { set: ['gfx.resolution'] })).toThrow('--set takes key=value');
  });
});

describe('judgeFrame and frameMetrics', () => {
  it('turns failing notes into failures and the rest into warnings', () => {
    const blank = frameMetrics(new Uint8Array(16).fill(9), 2, 2);
    expect(blank.blank).toBe(true);
    const verdict = judgeFrame([
      { id: 'LOOK_BLANK', level: 'fail', value: 0, limit: 0, message: 'blank' },
      { id: 'LOOK_FLAT', level: 'warn', value: 0.5, limit: 0.4, message: 'flat' },
    ]);
    expect(verdict).toEqual({
      failures: [{ id: 'LOOK_BLANK', message: 'blank' }],
      warnings: [{ id: 'LOOK_FLAT', message: 'flat' }],
    });
  });
});

describe('encodePng', () => {
  it('writes an RGBA PNG that decodes to the same pixels', () => {
    const rgba = new Uint8Array(5 * 3 * 4).map((_, i) => (i * 37) % 256);
    const decoded = decodePng(encodePng(5, 3, rgba));
    expect(decoded).toEqual({ width: 5, height: 3, rgba });
  });
});

describe('shotMetrics', () => {
  it('flattens the look metrics, the ID-pass list and the marks for report.json', () => {
    const entry = (id: number, name: string, px: number) => ({
      id,
      name,
      px,
      share: px / 100,
      bbox: [0, 0, 9, 9] as [number, number, number, number],
      centre: [4, 4] as [number, number],
    });
    const metrics = shotMetrics({
      width: 10,
      height: 10,
      metrics: { ...frameMetrics(new Uint8Array(400), 10, 10), largest: 'floor', largestShare: 0.6 },
      ids: {
        width: 10,
        height: 10,
        objects: 4,
        visible: [entry(1, 'floor', 60), entry(2, 'post', 10), entry(3, 'post', 5)],
        unseen: [{ id: 4, name: 'hero', reason: 'covered', protagonist: true }],
        empty: 25,
        stray: 0,
        protagonist: { name: 'hero', px: 0 },
      },
      marks: [{ n: 1, id: 1, name: 'floor', px: 60, at: [4, 4] }],
    });
    expect(metrics).toMatchObject({ width: 10, height: 10, coverage: 0, largest: 'floor', largestShare: 0.6 });
    expect(metrics).toMatchObject({ objects: 4, visible: 3, empty: 25, stray: 0, protagonist: false });
    expect(metrics).toMatchObject({ 'px.floor': 60, 'share.floor': 0.6, 'bbox.floor': '0,0,9,9', 'mark.1': 'floor' });
    expect(metrics).toMatchObject({ 'px.post#2': 10, 'px.post#3': 5, 'unseen.hero': 'covered' });
    expect(Object.values(metrics).every((value) => ['number', 'string', 'boolean'].includes(typeof value))).toBe(true);
  });
});
