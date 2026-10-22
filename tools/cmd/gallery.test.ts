/**
 * @file Unit tests for `x gallery`'s Node half (tools/cmd/gallery.ts), without a browser: a frame shows its subject
 * when its ID pass sees more than the ground; `--size` reads WxH; the sheet's frames carry their labels and pixels,
 * and the sheet's font draws the degree sign of a turntable's labels; bad flags are refused before any browser starts
 * (exit 2). The browser half is proven by `node x gallery body` and tests/e2e/gallery.spec.ts (WP 7.7's Verify).
 * @see tools/cmd/gallery.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drawText } from '../lib/filmSheet';
import { dispatch, loadCommand, ROOT } from '../x';
import { emptyFrames, readSize, sheetFrames, shows, SIZE } from './gallery';

describe('x gallery', () => {
  it('counts a frame as showing its subject when its ID pass sees enough of it besides the ground', () => {
    const ground = { name: 'stage/ground', share: 0.7 };
    expect(shows({ visible: [ground] })).toBe(false);
    expect(shows({ visible: [ground, { name: 'fx/sprites/page0', share: 0.0005 }] })).toBe(false); // a speck
    expect(shows({ visible: [ground, { name: 'actor#2', share: 0.2 }] })).toBe(true);
    // A still must show in every frame; a burst in its fullest, at an eighth of the share: it thins to its last specks.
    const seen = (name: string, share: number) => ({ id: 1, name, px: 1, share, bbox: [0, 0, 0, 0] as [number, number, number, number], centre: [0, 0] as [number, number] }); // prettier-ignore
    const frame = (label: string, share: number) => ({ label, tick: 1, camera: '', width: 4, height: 4, pixels: '', visible: [seen('stage/ground', 0.7), seen('x', share)] }); // prettier-ignore
    const frames = [frame('a', 0.01), frame('b', 0.0005)];
    expect(emptyFrames({ id: 'prop:crate', frames }).map((f) => f.label)).toEqual(['b']);
    expect(emptyFrames({ id: 'emitter:hit', burst: true, frames })).toEqual([]);
    expect(emptyFrames({ id: 'emitter:hit', burst: true, frames: [frame('c', 0.0002)] }).length).toBe(1);
  });

  it('reads --size as WxH, 240 × 135 by default', () => {
    expect([readSize(undefined), readSize('96x54')]).toEqual([SIZE, { width: 96, height: 54 }]);
    expect(() => readSize('big')).toThrow('--size takes WxH in pixels');
    expect(() => readSize('8x8')).toThrow('16 to 1920 by 16 to 1080');
  });

  it('lays out every entry’s frames in order, each with its label and pixels; the font draws a turntable’s degrees', () => {
    const pixels = Buffer.from(new Uint8Array(4 * 4 * 4).fill(200)).toString('base64');
    const shot = (label: string) => ({ label, tick: 1, camera: 'cam=iso', width: 4, height: 4, pixels, visible: [] });
    const frames = sheetFrames([
      { id: 'prop:crate', frames: [shot('prop:crate 30°'), shot('prop:crate 120°')] },
      { id: 'prop:barrel', frames: [shot('prop:barrel 30°')] },
    ]);
    expect(frames.map((frame) => [frame.n, frame.label, frame.rgba[0]])).toEqual([
      [0, 'prop:crate 30°', 200],
      [1, 'prop:crate 120°', 200],
      [2, 'prop:barrel 30°', 200],
    ]);
    const sheet = { width: 8, height: 10, rgba: new Uint8Array(8 * 10 * 4) };
    drawText(sheet, [0, 0], '°', [255, 255, 255]);
    const ink = (x: number, y: number) => sheet.rgba[(y * 8 + x) * 4];
    expect([0, 1, 2].map((row) => [0, 1, 2].map((col) => (ink(col * 2, row * 2) ? 1 : 0)).join(''))).toEqual(['010', '101', '010']); // prettier-ignore
  });

  it('refuses bad flags before any browser starts (exit 2)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'x-gallery-'));
    mkdirSync(join(root, 'tests', 'pages'), { recursive: true });
    writeFileSync(join(root, 'tests', 'pages', 'gallery.html'), '<!doctype html>');
    writeFileSync(join(root, 'package.json'), '{ "version": "0.0.0" }');
    const run = async (...args: string[]) => {
      const lines: string[] = [];
      const commands = { gallery: () => loadCommand(ROOT, 'gallery') };
      const code = await dispatch(['gallery', ...args], { root, print: (line) => lines.push(line), commands });
      return { code, text: lines.join('\n') };
    };
    try {
      expect(await run('prop', '--size', 'huge')).toMatchObject({ code: 2, text: expect.stringContaining('--size takes WxH') }); // prettier-ignore
      expect(await run('prop', '--page', 'labs/nope')).toMatchObject({ code: 2, text: expect.stringContaining('there is no labs/nope/index.html') }); // prettier-ignore
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
