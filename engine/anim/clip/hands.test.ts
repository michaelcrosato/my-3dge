/**
 * @file Unit tests for format 2's hands (engine/anim/clip/hands.ts, WP 8.8): a straight hand lies on the forearm, its
 * thumb opposite the elbow and its palm on its side's own side; random turns and grips come back from their points
 * to the degree; the same numbers on the other side draw the mirror image; and a capture whose hands turn and close
 * is fitted with them and decodes within its tolerance, while the same capture fitted without them misses its hands.
 * Format 1's decode, unchanged, is engine/anim/clip/readable.test.ts's.
 */
import { describe, expect, it } from 'vitest';
import { busy, clipOf, REST } from '../../../tests/unit/anim/clip-fixtures';
import { fitClip, type Capture } from './encode';
import { len, norm, sub, type V } from './frames';
import { encodeHand, HALF_SPAN, handFrame, placeHand, type HandPose } from './hands';
import { POINT_INDEX, samplePose, type Clip, type ClipKey } from './readable';
import { poseError } from './validate';

const SIZES = { knuck: 85, fist: 120 };
/** A right forearm pointing right with its elbow pointing back, and the mirror image for the left. */
const ARM = { R: { F: [0, 1, 0], hint: [-1, 0, 0] }, L: { F: [0, -1, 0], hint: [-1, 0, 0] } } as const;
const near = (a: V, b: V, mm = 1e-6) => expect(len(sub(a, b))).toBeLessThan(mm);
/** The mirror image of a point: right made left. */
const mirror = (v: V): V => [v[0], -v[1], v[2]];

/** A seeded stream of numbers in [0, 1). */
function stream(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the hand frame', () => {
  it('lies straight on the forearm, its thumb opposite the elbow and its palm down on either side', () => {
    for (const s of ['R', 'L'] as const) {
      const { F, hint } = ARM[s];
      const { H, T, N } = handFrame([...F], [...hint], s);
      near(H, [...F]);
      near(T, [1, 0, 0]); // forward, away from the elbow
      near(N, [0, 0, -1]); // the palm down in a T-pose
      const hand = placeHand(SIZES, [0, 0, 0], [...F], [...hint], s);
      near(hand.knuck, [0, 85 * F[1], 0]);
      near(hand.fist, [0, 120 * F[1], 0]);
      near(sub(hand.index, hand.pinky), [2 * HALF_SPAN, 0, 0]);
    }
  });

  it('turns as named: flex toward the palm, side toward the thumb, roll the thumb toward the palm, grip toward the palm', () => {
    const { F, hint } = ARM.R;
    const at = (pose: HandPose, grip = 0) => placeHand(SIZES, [0, 0, 0], [...F], [...hint], 'R', pose, grip);
    expect(at([30, 0, 0]).knuck[2]).toBeLessThan(0); // toward the palm: down
    expect(at([0, 30, 0]).knuck[0]).toBeGreaterThan(0); // toward the thumb: forward
    expect(at([0, 0, 30]).index[2]).toBeLessThan(0); // the thumb's knuckle turned down toward the palm
    const closed = at([0, 0, 0], 100);
    near(norm(sub(closed.fist, closed.knuck)), [0, 0, -1]); // a closed hand's finger points into the palm
  });
});

describe('the round trip', () => {
  it('gives back random turns to the degree and grips to the whole, on either side', () => {
    const random = stream(8);
    for (let i = 0; i < 400; i++) {
      const s = i % 2 ? 'L' : 'R';
      const pose: HandPose = [Math.round(random() * 140 - 70), Math.round(random() * 100 - 50), Math.round(random() * 160 - 80)]; // prettier-ignore
      const grip = Math.round(random() * 100);
      const F = norm([random() - 0.5, random() - 0.5, random() - 0.5]);
      const hint = norm([random() - 0.5, random() - 0.5, random() - 0.5]);
      const back = encodeHand(SIZES, [10, 20, 30], F, hint, s, placeHand(SIZES, [10, 20, 30], F, hint, s, pose, grip));
      expect(
        back.hand.map((v, j) => Math.abs(v - pose[j])).every((d) => d <= 1),
        `${pose} → ${back.hand}`,
      ).toBe(true);
      expect(Math.abs(back.grip - grip)).toBeLessThanOrEqual(1);
    }
  });

  it('draws the mirror image from the same numbers on the other side', () => {
    const pose: HandPose = [25, -15, 40];
    const right = placeHand(SIZES, [0, 0, 0], [...ARM.R.F], [...ARM.R.hint], 'R', pose, 60);
    const left = placeHand(SIZES, [0, 0, 0], [...ARM.L.F], [...ARM.L.hint], 'L', pose, 60);
    for (const part of ['knuck', 'fist', 'index', 'pinky'] as const) near(left[part], mirror(right[part]));
  });
});

describe('a capture with turning, closing hands', () => {
  /** `busy`'s keys with hands that flex and close over the second, decoded into a 30 fps capture. */
  function capture(): { clip: Clip; cap: Capture } {
    const keys: ClipKey[] = [0, 0.5, 1].map((t, i) => ({
      ...busy(t),
      handR: [-20 + 40 * i, 10 - 10 * i, 30 * i] as ClipKey['handR'],
      handL: [10 * i, -10, -20 + 20 * i] as ClipKey['handL'],
      gripR: 50 * i,
      gripL: 100 - 40 * i,
    }));
    const clip = clipOf(keys, { dur: 1 });
    const n = 31;
    const data = new Float32Array(n * 108);
    for (let f = 0; f < n; f++) data.set(samplePose(REST, clip, f / 30), f * 108);
    return { clip, cap: { name: 'Hands', n, dur: 1, loop: false, fps: 30, data, move: null } };
  }

  it('is fitted with its hands and decodes within its tolerance; without them its hands miss', () => {
    const { cap } = capture();
    const withHands = fitClip(REST, cap, 30, { hands: true });
    expect(withHands.clip.keys.every((k) => k.handR && k.handL && k.gripR !== undefined)).toBe(true);
    expect(withHands.max).toBeLessThan(30);
    const without = fitClip(REST, cap, 30);
    expect(without.clip.keys.some((k) => k.handR || k.gripR !== undefined)).toBe(false);
    /** The worst miss, mm, of any hand point over the capture's frames. */
    const handMiss = (fitted: { clip: Clip }) => {
      let worst = 0;
      for (let f = 0; f < cap.n; f++) {
        const [X, Y] = [cap.data.subarray(f * 108, f * 108 + 108), samplePose(REST, fitted.clip, f / 30)];
        for (const part of ['knuck', 'fist', 'index', 'pinky'])
          for (const s of ['L', 'R']) {
            const i = POINT_INDEX[part + s] * 3;
            worst = Math.max(worst, len(sub([...X.subarray(i, i + 3)], [...Y.subarray(i, i + 3)])));
          }
      }
      return worst;
    };
    expect(handMiss(withHands)).toBeLessThan(15);
    expect(handMiss(without)).toBeGreaterThan(3 * handMiss(withHands));
    expect(poseError(cap.data.subarray(0, 108), samplePose(REST, withHands.clip, 0))).toBeLessThan(30);
  });
});
