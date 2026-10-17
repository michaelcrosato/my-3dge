/**
 * @file Unit tests for the shooter model off the ground (engine/physics/movement/air.ts): air strafing gains exactly
 * what a 1.52 m/s cap at 12.7 m/s² gives, nothing slows a flight (no air friction) and pushing straight on never speeds
 * it; the lurch turns the velocity by 0.7 of the way to the new key's direction, at most 4.6 m/s, weaker after 0.2 s and
 * gone after 0.4 s, and only for a new key; jump fatigue (0.3 of the height until 0.15 s after a jump's landing, the
 * full height from 0.75 s), the bunny-hop cost (2.54 m/s within 1 s of landing, never below the sprint speed) and the
 * fall stun (none below 7.62 m, a stop from 20.32 m, recovering over 1 s, cancelled on a slope).
 * @see engine/physics/movement/air.ts
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../../core/schema';
import { airMove, hopSpeed, jumpScale, land, landSlowdown, lurch, lurchStrength } from './air';
import { createMotionState, MODEL_FIELDS } from './model';

const DT = 1 / 60;
const model = parse(MODEL_FIELDS, {});

describe('air control', () => {
  it('gains speed strafing across its motion, as Quake’s air acceleration with a 1.52 m/s cap at 12.7 m/s² does', () => {
    const h: [number, number] = [6.604, 0];
    for (let i = 0; i < 46; i++) {
      const speed = Math.hypot(h[0], h[1]);
      airMove(model, h, [-h[1] / speed, h[0] / speed], 1, DT); // a side key, the view turning with the velocity
    }
    const gain = Math.hypot(h[0], h[1]) - 6.604;
    expect(gain).toBeCloseTo(Math.sqrt(6.604 ** 2 + 46 * (12.7 * DT) ** 2) - 6.604, 9);
    expect(gain).toBeGreaterThan(0.15); // a sprint jump's 46 ticks in the air
  });

  it('keeps its speed with no input and never speeds up pushing straight on', () => {
    const still: [number, number] = [5, 1];
    airMove(model, still, [0, 0], 1, DT);
    expect(still).toEqual([5, 1]);
    const on: [number, number] = [6.604, 0];
    for (let i = 0; i < 60; i++) airMove(model, on, [1, 0], 1, DT);
    expect(on[0]).toBeCloseTo(6.604, 12);
  });
});

describe('the lurch', () => {
  it('turns a new key’s way by 0.7 of the gap until 0.2 s, at most 4.6 m/s, then less, and none after 0.4 s', () => {
    const at = (t: number) => {
      const h: [number, number] = [6.604, 0];
      return { change: lurch(model, h, [0, 1], [1, 0], t), h };
    };
    const early = at(0.1);
    expect(early.change).toBeCloseTo(4.6, 9); // 0.7 × 9.34 m/s, capped
    expect(Math.atan2(early.h[1], early.h[0])).toBeGreaterThan(0.7); // turned about 44° toward +Z
    expect(at(0.3).change).toBeCloseTo(0.35 * 6.604 * Math.SQRT2, 9);
    expect(at(0.45).change).toBe(0);
    expect([lurchStrength(model, 0.2), lurchStrength(model, 0.3), lurchStrength(model, 0.4)]).toEqual([0.7, expect.closeTo(0.35, 12), 0]); // prettier-ignore
  });

  it('needs a new key: a key held since the take-off, or a stick turning a little, does not lurch', () => {
    const h: [number, number] = [6.604, 0];
    expect(lurch(model, h, [1, 0], [1, 0], 0.1)).toBe(0);
    const small = Math.PI / 18; // 10° in a tick
    expect(lurch(model, h, [Math.cos(small), Math.sin(small)], [1, 0], 0.1)).toBe(0);
    expect(lurch(model, h, [0, 0], [1, 0], 0.1)).toBe(0);
    expect(h).toEqual([6.604, 0]);
  });
});

describe('the jump and the landing', () => {
  it('jumps 0.3 as high until 0.15 s after a jump’s landing, then linearly more, fully from 0.75 s', () => {
    const near = (value: number) => expect.closeTo(value, 12);
    expect([0, 0.15, 0.45, 0.75, 2].map((t) => jumpScale(model, t, true))).toEqual([near(0.3), near(0.3), near(0.65), 1, 1]); // prettier-ignore
    expect(jumpScale(model, 0, false)).toBe(1); // walked off a ledge: no fatigue
  });

  it('costs a bunny hop 2.54 m/s within 1 s of landing above the sprint speed, never below it', () => {
    expect(hopSpeed(model, 10, 0.5, 1)).toBeCloseTo(7.46, 12);
    expect(hopSpeed(model, 8, 0.5, 1)).toBe(6.604);
    expect(hopSpeed(model, 6, 0.5, 1)).toBe(6);
    expect(hopSpeed(model, 10, 1.2, 1)).toBe(10);
    expect(hopSpeed(model, 11, 0.5, 1.15)).toBeCloseTo(8.46, 12); // holstered, the floor is 7.59
    expect(hopSpeed(model, 8, 0.5, 1.15)).toBeCloseTo(6.604 * 1.15, 12);
  });

  it('stuns a landing by its fall height: none below 7.62 m, a stop from 20.32 m, recovering over 1 s', () => {
    expect(landSlowdown(model, 7, 0)).toBe(1);
    expect(landSlowdown(model, 25, 0)).toBe(0);
    expect(landSlowdown(model, 25, 0.5)).toBeCloseTo(0.25, 12); // (0.5 / 1)²
    expect(landSlowdown(model, (7.62 + 20.32) / 2, 0)).toBeCloseTo(0.5, 12);
    expect(landSlowdown(model, 25, 1)).toBe(1);
  });

  it('counts the impact speed along the floor’s normal, so a slope cancels the stun', () => {
    const flat = createMotionState();
    expect(land(model, flat, [0, -20, 0], [0, 1, 0], 19.05, DT)).toBeCloseTo(1 - (400 / 38.1 - 7.62) / 12.7, 9);
    expect(flat).toMatchObject({ landAge: 0, fall: expect.closeTo(400 / 38.1, 9) });
    const slope = createMotionState();
    const n = Math.SQRT1_2;
    expect(land(model, slope, [20 * n, -20 * n, 0], [n, n, 0], 19.05, DT)).toBe(1); // down the slope, along it
    expect(slope.fall).toBeCloseTo(0, 9);
  });
});
