/**
 * @file Unit tests for the motion metrics (engine/anim/motionMetrics.ts): a point that jumps in one step against short
 * steps either side is the worst pop of any size, and a pop only past the QA's minimum; a steady sweep is none; a sole
 * on the floor that slides is the worst slide of any size, a foot slide only past the QA's limit, and lifting it
 * starts a new contact. The anim QA family's own cases are tools/qa/anim.test.ts's.
 * @see engine/anim/motionMetrics.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { footSlide, motionTrack, pops, worstPop, worstSlide } from './motionMetrics';

/** A one-point track from its x positions (and heights), the body standing at the origin. */
const track = (xs: number[], ys: number[] = xs.map(() => 0), feet: number[] = []) =>
  motionTrack({ where: 'test', names: ['p'], world: xs.map((x, i) => [new Vector3(x, ys[i], 0)]), positions: xs.map(() => new Vector3()), feet }); // prettier-ignore

describe('motion metrics', () => {
  it('find the worst pop of any size, and a pop past the minimum only', () => {
    const small = track([0, 0.01, 0.02, 0.22, 0.23, 0.24]); // 0.2 m in one step, 0.01 either side
    expect(worstPop(small)?.value).toBeCloseTo(0.2, 9);
    expect(pops(small)).toBeUndefined(); // under the QA's 9/16 m
    const big = track([0, 0.01, 0.02, 0.62, 0.63, 0.64]);
    expect(pops(big)?.message).toMatch(/p jumps 0\.6 m in one step at frame 3/);
    expect(worstPop(track([0, 0.1, 0.2, 0.3, 0.4]))).toBeUndefined(); // a steady sweep
  });

  it('find the worst slide of a sole on the floor, a foot slide past the limit only, a lift starting a new contact', () => {
    const sliding = track([0, 0.03, 0.06, 0.09], [0, 0, 0, 0], [0]);
    expect(worstSlide(sliding)?.value).toBeCloseTo(0.09, 9);
    expect(footSlide(sliding)?.message).toMatch(/p slides 0\.09 m on the floor by frame 3/);
    const stepping = track([0, 0.03, 0.2, 0.23], [0, 0, 0.1, 0], [0]); // lifted at frame 2
    expect(worstSlide(stepping)?.value).toBeCloseTo(0.03, 9);
    expect(footSlide(stepping)).toBeUndefined();
  });
});
