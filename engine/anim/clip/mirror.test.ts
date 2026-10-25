/**
 * @file Tests mirroring (engine/anim/clip/mirror.ts, WP 8.2). Offline: the swap and sign rules for format 1 and 2,
 * the input untouched, the mirrored clip decoding to the reflected body on a symmetric rest body, and mirroring twice
 * giving the original back. With the my-3d2dge checkout (else deferred: no source): every curated clip mirrors exactly
 * as the source's `mirror` does, and mirrored twice decodes within 0.5 mm of itself at 10 Hz (the source's check).
 */
import { describe, expect, it } from 'vitest';
import { busy, clipOf, curatedClips, legacy, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { mirrorClip } from './mirror';
import { POINT_INDEX, POSE_POINTS, samplePose, type Clip, type ClipKey } from './readable';
import { poseError } from './validate';

describe('mirrorClip', () => {
  const key: ClipKey = {
    ...busy(0),
    root: [30, 12],
    spine: [10, 5, -4],
    yaw: 30,
    handL: [20, 5, -10],
    rollR: 8,
    gripL: 70,
  };
  const clip = clipOf([key], {
    clip: 'Strike_R',
    events: [
      { t: 0, name: 'hit', side: 'R' },
      { t: 0, name: 'land' },
    ],
    contacts: [{ part: 'footL', from: 0, to: 0.5 }],
    props: ['sword:R', 'box:LR'],
  });

  it('swaps the sides, flips turns, tilts and the right, negates twists, and renames the clip', () => {
    const before = JSON.stringify(clip);
    const mirrored = mirrorClip(clip);
    expect(JSON.stringify(clip)).toBe(before);
    expect(mirrored.clip).toBe('Strike_R_Mirror');
    const [m] = mirrored.keys;
    expect([m.hips, m.body, m.chest, m.head, m.root, m.blade]).toEqual([
      [5, 3, 92],
      [-20, 12, 6],
      [15, 25, -8],
      [-30, -10, -4],
      [30, -12],
      [80, -10, 55],
    ]);
    expect([m.armL, m.armR, m.legL, m.legR]).toEqual([
      [100, -10, 20, 15, 45],
      [40, 60, -50, 90, -30],
      [-20, 5, -100, 10, 20],
      [30, 20, -90, 60, -15],
    ]);
    expect([m.shL, m.shR, m.footL, m.footR]).toEqual([key.shR, key.shL, key.footR, key.footL]);
    expect([m.spine, m.yaw, m.handR, m.handL, m.rollL, m.rollR, m.gripR]).toEqual([
      [-10, 5, 4],
      -30,
      [20, 5, -10],
      undefined,
      8,
      undefined,
      70,
    ]);
    expect(mirrored.events).toEqual([
      { t: 0, name: 'hit', side: 'L' },
      { t: 0, name: 'land' },
    ]);
    expect(mirrored.contacts).toEqual([{ part: 'footR', from: 0, to: 0.5 }]);
    expect(mirrored.props).toEqual(['sword:L', 'box:LR']);
  });

  it('gives the original numbers back when mirrored twice', () => {
    const twice = mirrorClip(mirrorClip(clip));
    expect(twice.clip).toBe('Strike_R_Mirror_Mirror');
    expect({ ...twice, clip: clip.clip }).toEqual(clip);
  });

  it('decodes to the reflected body on a symmetric rest body (the finger helpers aside, which follow the chest)', () => {
    const { blade: _blade, ...free } = busy(0);
    const plain = clipOf([free, standing(1)]);
    const other = (name: string) => name.replace(/[LR]$/, (side) => (side === 'L' ? 'R' : 'L'));
    for (const t of [0, 0.4, 1]) {
      const [a, b] = [
        samplePose(REST, plain, t, new Float64Array(108)),
        samplePose(REST, mirrorClip(plain), t, new Float64Array(108)),
      ];
      for (const name of POSE_POINTS.filter((p) => !/^(index|pinky)/.test(p))) {
        const [i, j] = [POINT_INDEX[name] * 3, POINT_INDEX[other(name)] * 3];
        expect(Math.hypot(a[i] - b[j], a[i + 1] + b[j + 1], a[i + 2] - b[j + 2])).toBeLessThan(1e-6);
      }
    }
  });

  it("decodes format 2's keys to the reflected body, every hand, spine and toe point with it", () => {
    const { blade: _blade, ...free } = busy(0);
    const hands = {
      ...{ handL: [20, -10, 35], handR: [-15, 25, -40], gripL: 80, gripR: 30 },
      ...{ spine: [12, 30, -9], rollL: 20, rollR: -15, footL: [25, 10, 35], footR: [-10, -5, -20] },
    } as const;
    const clip = clipOf([{ ...free, ...hands } as ClipKey, { ...standing(1), ...hands } as ClipKey]);
    const other = (name: string) => name.replace(/[LR]$/, (side) => (side === 'L' ? 'R' : 'L'));
    for (const t of [0, 0.4, 1]) {
      const [a, b] = [samplePose(REST, clip, t), samplePose(REST, mirrorClip(clip), t)];
      for (const name of POSE_POINTS) {
        const [i, j] = [POINT_INDEX[name] * 3, POINT_INDEX[other(name)] * 3];
        expect(Math.hypot(a[i] - b[j], a[i + 1] + b[j + 1], a[i + 2] - b[j + 2]), name).toBeLessThan(1e-6);
      }
    }
  });
});

describe('the curated library (it needs the my-3d2dge checkout)', () => {
  it('mirrors every clip exactly as the source does', (context) => {
    const { MR, sets } = legacy(context);
    for (const [, , clip] of curatedClips(sets)) expect(mirrorClip(clip)).toEqual(MR.mirror(clip));
  });

  it('mirrors every clip twice within 0.5 mm of itself, sampled at 10 Hz', (context) => {
    const { sets } = legacy(context);
    let most = 0;
    for (const [, , clip, rest] of curatedClips(sets)) {
      const twice: Clip = mirrorClip(mirrorClip(clip));
      for (let t = 0; t <= clip.dur; t += 0.1)
        most = Math.max(most, poseError(samplePose(rest, clip, t), samplePose(rest, twice, t)));
    }
    expect(most).toBeLessThanOrEqual(0.5);
  });
});
