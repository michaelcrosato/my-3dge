/**
 * @file Unit tests for hovering (engine/anim/proc/hover.ts, PLAN.md WP 10.1): the hover bobbing about its height and
 * rising with speed; the bank into sideways motion, the right side down, within its bound, and back level; the lean
 * back with forward speed about a low pivot; the fold pulling the limbs in at its rates; any step the same.
 * @see engine/anim/proc/hover.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { Hover } from './hover';

const FLOOR = new Vector3();
const run = (ghost: Hover, velocity: Vector3, seconds: number, fold = 0, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) ghost.step(dt, velocity, 0, fold);
  return ghost;
};

describe('hovering', () => {
  it('bobs about its height and rises with its speed', () => {
    const ghost = new Hover();
    const heights: number[] = [];
    for (let i = 0; i < 180; i++) heights.push(ghost.step(1 / 60, new Vector3(), 0).offset);
    expect(Math.max(...heights)).toBeCloseTo(0.25 + 0.044, 3);
    expect(Math.min(...heights)).toBeCloseTo(0.25 - 0.044, 3);
    run(ghost, new Vector3(0, 0, 5), 2);
    expect(ghost.climb).toBe(1);
    expect(ghost.offset - (0.25 + 0.044 * Math.sin(ghost.phase))).toBeCloseTo(0.075, 12); // its rise at full speed
  });

  it('banks into its sideways motion within its bound, leans back as it speeds ahead, and levels at rest', () => {
    const ghost = run(new Hover(), new Vector3(-2, 0, 0), 1.5); // to its right (−X facing +Z)
    expect(ghost.bank).toBeCloseTo(2 / 6.9, 3);
    const tip = ghost.place(new Vector3(0.3, 0, 0), FLOOR, 0); // its left side
    expect(tip.y).toBeGreaterThan(ghost.place(new Vector3(-0.3, 0, 0), FLOOR, 0).y); // its right side down
    expect(run(new Hover(), new Vector3(-20, 0, 0), 2).bank).toBeCloseTo(0.5, 3); // bounded
    run(ghost, new Vector3(0, 0, 5), 2);
    expect([ghost.bank, ghost.lean]).toEqual([expect.closeTo(0, 3), expect.closeTo(5 / 36, 3)]);
    const top = ghost.place(new Vector3(0, 0.4, 0), FLOOR, 0);
    expect(top.z).toBeLessThan(-0.03); // its top trails the glide
    run(ghost, new Vector3(), 3);
    expect([ghost.bank, ghost.lean].map((a) => Math.abs(a) < 1e-4)).toEqual([true, true]);
  });

  it('folds its limbs in at its rates, and steps alike at any rate', () => {
    const ghost = new Hover();
    const hand = new Vector3(0.4, 0.2, 0.3);
    const open = ghost.place(hand, FLOOR, 0).clone();
    ghost.step(1 / 30, new Vector3(), 0, 1);
    expect(ghost.fold).toBeCloseTo(0.5, 12); // 15 a second in
    run(ghost, new Vector3(), 0.1, 1);
    const folded = ghost.place(hand, FLOOR, 0);
    const core = ghost.place(new Vector3(), FLOOR, 0);
    expect([folded.x - core.x, folded.z - core.z]).toEqual([
      expect.closeTo(0.4 * 0.35, 9),
      expect.closeTo(0.3 * 0.65, 9),
    ]);
    expect(folded.x - core.x).toBeLessThan(open.x);
    run(ghost, new Vector3(), 1 / 30, 0);
    expect(ghost.fold).toBeCloseTo(0.7, 12); // 9 a second out
    const [coarse, fine] = [
      run(new Hover(), new Vector3(1, 0, 3), 1),
      run(new Hover(), new Vector3(1, 0, 3), 1, 0, 1 / 120),
    ];
    expect(coarse.place(hand, FLOOR, 0.4).distanceTo(fine.place(hand, FLOOR, 0.4))).toBeLessThan(1e-9);
  });
});
