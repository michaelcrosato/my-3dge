/**
 * @file Tests how a clip reads (engine/anim/clip/lens.ts, WP 8.2). Offline: `clipText`'s layout, format 2's fields
 * in their lines, the text reading back to the same clip, `foldAngle`, and the normalized lens folding every angle
 * without changing the clip it reads or the pose at any key. With the my-3d2dge checkout (else deferred: no source):
 * `clipText` prints every curated clip exactly as the source's `text` does, the text reads back within 0.5 mm at
 * 10 Hz (the source's own round-trip check), and the lens decodes every key of every clip within 0.001 mm.
 */
import { describe, expect, it } from 'vitest';
import { busy, clipOf, curatedClips, legacy, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { clipText, foldAngle, LEGEND, normalizedLens } from './lens';
import { decodePose, samplePose, type Clip, type ClipKey } from './readable';
import { parseClip, poseError } from './validate';

describe('clipText', () => {
  it('writes the header on one line, then three lines per key: torso, arms, legs', () => {
    const clip = clipOf([{ ...standing(0), root: [0, 0], shL: [5, 0] }], { clip: 'Idle', loop: true });
    expect(clipText(clip)).toBe(
      [
        '{"clip": "Idle", "dur": 0, "loop": true, "keys": [',
        '  {"t":0,',
        '   "hips":[0,0,100], "body":[0,0,0], "chest":[0,0,0], "head":[0,0,0], "root":[0,0],',
        '   "shL":[5,0], "armL":[0,0,-100,0,0], "armR":[0,0,-100,0,0],',
        '   "legL":[0,0,-100,0,0], "legR":[0,0,-100,0,0]}',
        ']}',
      ].join('\n'),
    );
  });

  it('puts format 2’s key fields after format 1’s, on their lines, and reads back to the same clip', () => {
    const key: ClipKey = { ...busy(0), spine: [1, 2, 3], yaw: 15, handR: [4, 5, 6], gripR: 80, rollL: -7 };
    const clip = clipOf([key], { speed: 120, events: [{ t: 0, name: 'hit' }] });
    const lines = clipText(clip).split('\n');
    expect(lines[2]).toMatch(/"head":\[30,-10,4\], "spine":\[1,2,3\], "yaw":15,$/);
    expect(lines[3]).toMatch(/"blade":\[80,10,55\], "handR":\[4,5,6\], "gripR":80,$/);
    expect(lines[4]).toMatch(/"footR":\[-10,-5,0\], "rollL":-7}$/);
    expect(parseClip(clipText(clip))).toEqual(clip);
  });

  it('keeps a legend line for every format-1 field', () => {
    for (const field of ['hips', 'body', 'chest', 'head', 'shL', 'armL', 'legL', 'footL', 'blade', 'root', 'speed']) {
      expect(LEGEND.some((line) => line.split(/\s+/).includes(field))).toBe(true);
    }
  });
});

describe('the normalized lens', () => {
  it('folds an angle to (−180°, 180°]', () => {
    const cases = [
      [0, 0],
      [180, 180],
      [-180, 180],
      [190, -170],
      [540, 180],
      [-190, 170],
      [360, 0],
      [-360, 0],
      [720.5, 0.5],
      [-370, -10],
    ];
    for (const [deg, folded] of cases) expect([deg, foldAngle(deg)]).toEqual([deg, folded]);
    expect(Object.is(foldAngle(-360), 0)).toBe(true);
  });

  it('folds every angle of every key, and nothing else, into a copy', () => {
    const spun: ClipKey = {
      ...busy(0),
      body: [450, 10, -370],
      armL: [40, 60, -50, 90, 400],
      footR: [-370, 5, 365],
      handL: [190, 0, 0],
      yaw: -200,
      gripL: 100,
    };
    const clip = clipOf([spun]);
    const before = JSON.stringify(clip);
    const [read] = normalizedLens(clip).keys;
    expect(JSON.stringify(clip)).toBe(before);
    expect(read).toEqual({
      ...spun,
      body: [90, 10, -10],
      armL: [40, 60, -50, 90, 40],
      footR: [-10, 5, 5],
      handL: [-170, 0, 0],
      yaw: 160,
    });
  });

  it('leaves the pose at every key as it was', () => {
    const turns = (key: ClipKey, k: number): ClipKey => ({
      ...key,
      body: [key.body[0] + 360 * k, key.body[1] - 360 * k, key.body[2] + 720],
      chest: [key.chest[0] - 720, key.chest[1], key.chest[2] + 360],
      shL: [400, -350],
      armR: [...key.armR.slice(0, 4), key.armR[4] + 1080] as ClipKey['armR'],
      footL: [385, -340, 375],
    });
    for (const k of [-2, 1, 3]) {
      const key = turns(busy(0), k);
      const [a, b] = [new Float64Array(108), new Float64Array(108)];
      decodePose(REST, key, a);
      decodePose(REST, normalizedLens(clipOf([key])).keys[0], b);
      expect(poseError(a, b)).toBeLessThan(1e-6);
    }
  });
});

describe('the curated library (it needs the my-3d2dge checkout)', () => {
  it('prints every clip exactly as the source’s text does', (context) => {
    const { MR, sets } = legacy(context);
    for (const [, , clip] of curatedClips(sets)) expect(clipText(clip)).toBe(MR.text(clip));
  });

  it('reads every clip’s text back within 0.5 mm, sampled at 10 Hz', (context) => {
    const { sets } = legacy(context);
    let most = 0;
    for (const [setName, name, clip, rest] of curatedClips(sets)) {
      const back = parseClip(clipText(clip), `${setName}/${name}`);
      for (let t = 0; t <= clip.dur; t += 0.1) {
        most = Math.max(most, poseError(samplePose(rest, clip, t), samplePose(rest, back, t)));
      }
    }
    expect(most).toBeLessThanOrEqual(0.5);
  });

  it('decodes every key of every clip through the lens within 0.001 mm', (context) => {
    const { sets } = legacy(context);
    const [a, b] = [new Float64Array(108), new Float64Array(108)];
    let most = 0;
    for (const [, , clip, rest] of curatedClips(sets)) {
      const lens: Clip = normalizedLens(clip);
      clip.keys.forEach((key, i) => {
        most = Math.max(most, poseError(decodePose(rest, key, a), decodePose(rest, lens.keys[i], b)));
      });
    }
    expect(most).toBeLessThanOrEqual(0.001);
  });
});
