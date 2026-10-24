/**
 * @file Unit tests for looking and blinking (engine/anim/proc/look.ts, PLAN.md WP 10.1): a look closing its angle by
 * e^(−rate × dt) at any step count, bounded about its frame, turning to a target straight behind, back to forward
 * with none, its angles in the frame; a blink drawn from its stream, as often as its bounds say, shut at its middle,
 * skipped while held, and the same from the same stream.
 * @see engine/anim/proc/look.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { Rng } from '../../core/rng';
import { Blink, LookAt } from './look';

const EYE = new Vector3(0, 1, 0);
const FACING = new Quaternion();

describe('looking and blinking', () => {
  it('turns a look toward its target by e^(−rate) a second, at any step, within its bounds', () => {
    const [coarse, fine] = [new LookAt({ rate: 7 }), new LookAt({ rate: 7 })];
    const target = new Vector3(2, 1, 2); // 45° to the left
    for (let i = 0; i < 6; i++) coarse.step(1 / 60, EYE, target, FACING);
    for (let i = 0; i < 12; i++) fine.step(1 / 120, EYE, target, FACING);
    const left = Math.acos(coarse.direction.dot(new Vector3(1, 0, 1).normalize()));
    expect(left).toBeCloseTo((Math.PI / 4) * Math.exp(-7 * 0.1), 12);
    expect(coarse.direction.distanceTo(fine.direction)).toBeLessThan(1e-12);
    const bounded = new LookAt({ rate: 1e6, yaw: 1, pitch: 0.4 });
    bounded.step(1, EYE, new Vector3(-5, 6, 0.5), FACING); // far right and high: to its bounds
    const [yaw, pitch] = bounded.angles(FACING);
    expect([yaw, pitch]).toEqual([expect.closeTo(-1, 9), expect.closeTo(0.4, 9)]);
    expect(bounded.direction.length()).toBeCloseTo(1, 12);
  });

  it('turns to a target straight behind, and back to its frame’s forward with none', () => {
    const head = new LookAt({ rate: 10 });
    head.step(0.05, EYE, new Vector3(0, 1, -4), FACING); // straight behind: about the frame's up
    expect(Math.abs(head.direction.x)).toBeGreaterThan(0.3);
    for (let i = 0; i < 120; i++) head.step(1 / 60, EYE, new Vector3(0, 1, -4), FACING);
    expect(head.direction.z).toBeCloseTo(-1, 6);
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
    for (let i = 0; i < 240; i++) head.step(1 / 60, EYE, null, turned);
    expect(head.angles(turned).map((a) => Math.abs(a) < 1e-6)).toEqual([true, true]); // its frame's forward
  });

  it('blinks as often as its bounds say, shut at a blink’s middle, skipped while held, the same from the same stream', () => {
    const lid = new Blink(new Rng(7), { every: [1.5, 5], close: 0.16 });
    const opens: number[] = [];
    let blinks = 0;
    let was = 1;
    for (let i = 0; i < 60 * 60; i++) {
      const open = lid.step(1 / 60);
      if (open < 0.5 && was >= 0.5) blinks++;
      opens.push(open);
      was = open;
    }
    expect(blinks).toBeGreaterThanOrEqual(Math.floor(60 / 5.16)); // a minute: every 1.5 to 5 s
    expect(blinks).toBeLessThanOrEqual(Math.ceil(60 / 1.66));
    expect(Math.min(...opens)).toBeLessThan(0.05); // shut at its middle
    const again = new Blink(new Rng(7), { every: [1.5, 5], close: 0.16 });
    expect(Array.from({ length: 60 * 60 }, () => again.step(1 / 60))).toEqual(opens);
    const held = new Blink(new Rng(7));
    expect(Array.from({ length: 600 }, () => held.step(1 / 60, true)).every((open) => open === 1)).toBe(true);
  });
});
