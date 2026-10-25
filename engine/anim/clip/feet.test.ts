/**
 * @file Unit tests for format 2's foot roll (engine/anim/clip/feet.ts, WP 8.8): no roll leaves the toes where format 1
 * puts them; a roll turns the sole inward on either side, the same number drawing the mirror image; random rolls and
 * bends come back from the toes' direction to the degree; and a capture whose feet roll is fitted with the roll and
 * its toes decode within a few millimetres, where format 1 misses them.
 */
import { describe, expect, it } from 'vitest';
import { busy, clipOf, REST } from '../../../tests/unit/anim/clip-fixtures';
import { fitClip, type Capture } from './encode';
import { encodeRoll, footLine, rolledToe } from './feet';
import { add, cross, fromEuler, len, mul, norm, sub, type V } from './frames';
import { decodePose, POINT_INDEX, samplePose, type ClipKey } from './readable';

const near = (a: V, b: V, by = 1e-9) => expect(len(sub(a, b))).toBeLessThan(by);
const point = (X: ArrayLike<number>, name: string): V => [0, 1, 2].map((j) => X[POINT_INDEX[name] * 3 + j]);

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

describe('the rolled toe', () => {
  it('lies where format 1 puts it with no roll, and turns the sole inward with one, on either side', () => {
    const k: ClipKey = { ...busy(0), footL: [25, 10, 35], footR: [-10, -5, -20] };
    const flat = decodePose(REST, k, new Float64Array(108));
    const zero = decodePose(REST, { ...k, rollL: 0, rollR: 0 }, new Float64Array(108));
    for (const s of ['L', 'R']) near(point(zero, `toe${s}`), point(flat, `toe${s}`), 1e-9);
    // a right foot pointing forward, its toes bent down 30° off the line: rolled inward, they swing to its left
    const [d, down] = [
      [1, 0, 0],
      [0, 0, -1],
    ];
    expect(rolledToe(d, down, 30, 20, 'R')[1]).toBeLessThan(0); // r < 0: toward the left, inward
    expect(rolledToe(d, down, 30, 20, 'L')[1]).toBeGreaterThan(0); // the left foot's inward is to the right
    near(
      rolledToe(d, down, 30, 20, 'L'),
      [...rolledToe(d, down, 30, 20, 'R')].map((v, i) => (i === 1 ? -v : v)),
    );
  });

  it('gives back random rolls and bends to the degree, from a foot pointing any way', () => {
    const random = stream(5);
    for (let i = 0; i < 400; i++) {
      const s = i % 2 ? 'L' : 'R';
      const d = norm([random() - 0.5, random() - 0.5, random() - 0.5]);
      const down = norm(cross(d, norm([random() - 0.5, random() - 0.5, random() - 0.5])));
      const [roll, delta] = [Math.round(random() * 160 - 80), Math.round(random() * 100 - 50) || 7];
      const back = encodeRoll(d, down, rolledToe(d, down, delta, roll, s), s);
      expect(Math.abs(back.roll - roll), `${roll} → ${back.roll}`).toBeLessThan(1e-6);
      expect(Math.abs(back.delta - delta)).toBeLessThan(1e-6);
    }
  });

  it('follows the key before past a quarter turn, and keeps its roll when the toes run along the line', () => {
    const [d, down] = [
      [1, 0, 0],
      [0, 0, -1],
    ];
    const toe = rolledToe(d, down, 30, 120, 'R');
    expect(encodeRoll(d, down, toe, 'R').roll).toBeCloseTo(-60, 9); // alone: the reading within a quarter turn
    expect(encodeRoll(d, down, toe, 'R', 110).roll).toBeCloseTo(120, 9); // after 110: the one that continues
    expect(encodeRoll(d, down, d, 'R', 12)).toEqual({ roll: 12, delta: 0 });
  });

  it("builds the decode's own line and plane from a key: its ball, and its toes with no roll", () => {
    const k: ClipKey = { ...busy(0), footR: [-10, -5, 25] };
    const X = decodePose(REST, k, new Float64Array(108));
    const { d, down } = footLine(fromEuler(k.body), k.footR as V, REST.abPitch, 'R');
    near(add(point(X, 'ankleR'), mul(d, REST.ab)), point(X, 'ballR'), 1e-9);
    const toe = rolledToe(d, down, REST.btPitch - REST.abPitch - 25, 0, 'R');
    near(add(point(X, 'ballR'), mul(toe, REST.bt)), point(X, 'toeR'), 1e-9);
  });
});

describe('a capture whose feet roll', () => {
  it('is fitted with the roll, its toes decoding within a few millimetres where format 1 misses them', () => {
    const keys: ClipKey[] = [0, 0.5, 1].map((t, i) => ({
      ...busy(t),
      ...{ footL: [10 + 10 * i, 5, 20 - 15 * i], footR: [-5, 0, 30], rollL: -20 + 25 * i, rollR: 35 - 30 * i },
    })) as ClipKey[];
    const clip = clipOf(keys, { dur: 1 });
    const [n, data] = [31, new Float32Array(31 * 108)];
    for (let f = 0; f < n; f++) data.set(samplePose(REST, clip, f / 30), f * 108);
    const cap: Capture = { name: 'Roll', n, dur: 1, loop: false, fps: 30, data, move: null };
    const toeMiss = (fitted: ReturnType<typeof fitClip>) => {
      let worst = 0;
      for (let f = 0; f < n; f++) {
        const Y = samplePose(REST, fitted.clip, f / 30);
        for (const s of ['L', 'R'])
          worst = Math.max(worst, len(sub(point(data.subarray(f * 108), `toe${s}`), point(Y, `toe${s}`))));
      }
      return worst;
    };
    const [rolled, plain] = [fitClip(REST, cap, 30, { feet: true }), fitClip(REST, cap, 30)];
    expect(rolled.clip.keys.every((k) => k.rollL !== undefined && k.rollR !== undefined)).toBe(true);
    expect(toeMiss(rolled)).toBeLessThan(5);
    expect(toeMiss(plain)).toBeGreaterThan(3 * toeMiss(rolled));
  });
});
