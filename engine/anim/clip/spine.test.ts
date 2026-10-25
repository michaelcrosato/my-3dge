/**
 * @file Unit tests for format 2's spine override (engine/anim/clip/spine.ts and frames.ts `torso`, WP 8.8): a level
 * override lays the middle bones on the body's frame; a capture the shares rebuild exactly misses nothing; a capture
 * whose back curls past the shares misses its neck by more than `SPINE_MISS`, and fitted with the override its neck
 * and shoulders come back within millimetres, where the shares alone leave them out.
 */
import { describe, expect, it } from 'vitest';
import { busy, clipOf, REST } from '../../../tests/unit/anim/clip-fixtures';
import { fitClip, type Capture } from './encode';
import { add, fromEuler, len, qFromTo, qrot, sub, type V } from './frames';
import { decodePose, POINT_INDEX, samplePose, type Clip, type ClipKey } from './readable';
import { qBetween, SPINE_MISS, spineMiss } from './spine';

const point = (X: ArrayLike<number>, name: string): V => [0, 1, 2].map((j) => X[POINT_INDEX[name] * 3 + j]);

/** A 30 fps capture of `clip`'s decode. */
function captureOf(clip: Clip): Capture {
  const n = Math.round(clip.dur * 30) + 1;
  const data = new Float32Array(n * 108);
  for (let f = 0; f < n; f++) data.set(samplePose(REST, clip, f / 30), f * 108);
  return { name: 'Curl', n, dur: clip.dur, loop: false, fps: 30, data, move: null };
}

describe('the spine override', () => {
  it('turns a direction to another the short way, and to its opposite by a half turn about a square axis', () => {
    const turned = (a: V, b: V) => qrot(qBetween(a, b), a);
    for (const [a, b] of [
      [
        [0, 0, 2],
        [0, 3, 0],
      ],
      [
        [1, 0, 0],
        [-1, 0, 0],
      ],
      [
        [0, 0, 1],
        [0, 0, -1],
      ],
      [
        [0.6, 0.8, 0],
        [-0.6, -0.8, 0],
      ],
    ] as V[][]) {
      // prettier-ignore
      const want = b.map((x) => x / Math.hypot(...b));
      expect(turned(a, b).map((x, i) => x - want[i] * Math.hypot(...a)).every((x) => Math.abs(x) < 1e-9), `${a} to ${b}`).toBe(true); // prettier-ignore
    }
    expect(qBetween([1, 0, 0], [-1, 0, 0])).toEqual([0, 0, 1, 0]); // about z, square to x
    expect(qBetween([0, 0, 1], [0, 0, -1])).toEqual([0, 1, 0, 0]); // about y, square to z
  });

  it("lays the spine's middle bones on the body's frame when level, the others on their shares", () => {
    const k: ClipKey = { ...busy(0), spine: [0, 0, 0] };
    const X = decodePose(REST, k, new Float64Array(108));
    const qP = qFromTo(REST.Pr, fromEuler(k.body));
    const bone = (i: number) => qrot(qP, REST.spine[i]);
    expect(len(sub(point(X, 'spine2'), add(point(X, 'spine1'), bone(1))))).toBeLessThan(1e-9);
    expect(len(sub(point(X, 'chest'), add(point(X, 'spine2'), bone(2))))).toBeLessThan(1e-9);
    const plain = decodePose(REST, busy(0), new Float64Array(108));
    expect(len(sub(point(X, 'spine1'), point(plain, 'spine1')))).toBeLessThan(1e-9); // the first bone: its share
  });

  it('finds no miss in a capture its shares rebuild, and one past SPINE_MISS in a back that curls', () => {
    const keys = [0, 1].map((t) => busy(t));
    expect(spineMiss(REST, captureOf(clipOf(keys, { dur: 1 })))).toBeLessThan(1);
    const curled = keys.map((k, i) => ({ ...k, spine: [10 * i, 40, -15 * i] }) as ClipKey);
    expect(spineMiss(REST, captureOf(clipOf(curled, { dur: 1 })))).toBeGreaterThan(SPINE_MISS);
  });

  it('is fitted where the back curls: the neck and shoulders back within millimetres, where the shares miss', () => {
    const keys = [0, 0.5, 1].map((t, i) => ({ ...busy(t), spine: [15 - 15 * i, 35 + 10 * i, -10 + 10 * i] }));
    const cap = captureOf(clipOf(keys as ClipKey[], { dur: 1 }));
    /** The worst miss of the neck and shoulders at the fitted clip's own keys (in between: the fit's tolerance). */
    const miss = (fitted: { clip: Clip }) => {
      let worst = 0;
      for (const { t } of fitted.clip.keys) {
        const Y = samplePose(REST, fitted.clip, t);
        for (const p of ['neck', 'shL', 'shR'])
          worst = Math.max(worst, len(sub(point(cap.data.subarray(Math.round(t * 30) * 108), p), point(Y, p))));
      }
      return worst;
    };
    const [over, shares] = [fitClip(REST, cap, 30, { spine: true }), fitClip(REST, cap, 30)];
    expect(over.clip.keys.every((k) => k.spine)).toBe(true);
    expect(shares.clip.keys.some((k) => k.spine)).toBe(false);
    expect(miss(over)).toBeLessThan(6);
    expect(miss(shares)).toBeGreaterThan(SPINE_MISS);
  });
});
