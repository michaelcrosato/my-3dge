/**
 * @file Unit tests for engine/core/math.ts (T1): the re-exports are three.js's own math classes and nothing else, the
 * angle helpers, `smoothDamp` and `ease` against my-3d2dge's reference vectors (tests/baselines/port/core.json), and
 * the swing-twist decomposition on random rotations and its degenerate cases.
 *
 * The ports reuse the source's formulas, so they are compared bit for bit, which is stricter than the 1e-12 that
 * PLAN.md WP 1.1 allows the angle helpers; a reformulation would loosen these comparisons to that bound.
 * @see engine/core/math.ts
 */
import { readFileSync } from 'node:fs';
import * as three from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { THREE_MATH } from '../../tools/eslint/layers';
import * as math from './math';
import { angDiff, approach, approachAng, ease, lerpAng, Quaternion, smoothDamp, swingTwist, Vector3 } from './math';
import { Rng } from './rng';

const CORE = JSON.parse(readFileSync('tests/baselines/port/core.json', 'utf8')) as Record<string, number[][]> & {
  ease: Record<string, [number, number][]>;
};

/** Records whose output (the last number) differs from `fn` of the inputs, bit for bit. */
function misses(name: string, fn: (...args: number[]) => number): unknown[] {
  return CORE[name]
    .filter((row) => !Object.is(fn(...row.slice(0, -1)), row[row.length - 1]))
    .map((row) => [name, ...row]);
}

describe('the re-exports', () => {
  it("are three.js's own math classes, Color included, and the module adds only its helpers", () => {
    for (const name of THREE_MATH)
      expect((math as Record<string, unknown>)[name], name).toBe((three as Record<string, unknown>)[name]);
    const own = ['angDiff', 'approach', 'approachAng', 'ease', 'lerpAng', 'smoothDamp', 'swingTwist'];
    expect(Object.keys(math).sort()).toEqual([...THREE_MATH, ...own].sort());
  });
});

describe("my-3d2dge's helpers", () => {
  it('match the reference vectors bit for bit: angDiff, lerpAng, approachAng, approach', () => {
    expect(CORE.angDiff.length).toBe(144);
    expect([
      ...misses('angDiff', angDiff),
      ...misses('lerpAng', lerpAng),
      ...misses('approachAng', approachAng),
      ...misses('approach', approach),
    ]).toEqual([]);
  });

  it('match the reference vectors bit for bit: smoothDamp (value and velocity)', () => {
    const rows = CORE.smoothDamp;
    expect(rows.length).toBe(48);
    const bad = rows.filter(([x, to, v, st, dt, value, velocity]) => {
      const [gotValue, gotVelocity] = smoothDamp(x, to, v, st, dt);
      return !Object.is(gotValue, value) || !Object.is(gotVelocity, velocity);
    });
    expect(bad).toEqual([]);
  });

  it('match the reference vectors bit for bit: every ease curve', () => {
    expect(Object.keys(ease)).toEqual(Object.keys(CORE.ease));
    const bad = Object.entries(CORE.ease).flatMap(([name, rows]) =>
      rows.filter(([u, want]) => !Object.is(ease[name as keyof typeof ease](u), want)).map((row) => [name, ...row]),
    );
    expect(bad).toEqual([]);
  });

  it('keep angDiff in [−π, π) and land lerpAng and approachAng on the target', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 10_000; i++) {
      const [a, b] = [rng.range(-50, 50), rng.range(-50, 50)];
      const d = angDiff(a, b);
      expect(d >= -Math.PI && d < Math.PI).toBe(true);
      expect(Math.abs(angDiff(lerpAng(a, b, 1), b))).toBeLessThan(1e-12);
      expect(approachAng(a, b, 7)).toBe(b);
    }
  });
});

describe('swingTwist', () => {
  /** A random unit quaternion and a random unit axis. */
  function random(rng: Rng): [Quaternion, Vector3] {
    const q = new Quaternion(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    const axis = new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    return [q, axis];
  }

  it('splits a rotation into swing · twist: twist about the axis, swing perpendicular to it', () => {
    const rng = new Rng(3);
    const [swing, twist] = [new Quaternion(), new Quaternion()];
    for (let i = 0; i < 2000; i++) {
      const [q, axis] = random(rng);
      const angle = swingTwist(q, axis, swing, twist);
      const back = swing.clone().multiply(twist);
      expect(Math.abs(back.dot(q))).toBeCloseTo(1, 12);
      expect(new Vector3(twist.x, twist.y, twist.z).cross(axis).length()).toBeLessThan(1e-12);
      expect(Math.abs(swing.x * axis.x + swing.y * axis.y + swing.z * axis.z)).toBeLessThan(1e-12);
      expect(new Quaternion().setFromAxisAngle(axis, angle).angleTo(twist)).toBeLessThan(1e-7);
      expect(angle > -Math.PI && angle <= Math.PI).toBe(true);
    }
  });

  it('returns the twist angle of a pure twist, and identity twist for a pure swing', () => {
    const up = new Vector3(0, 1, 0);
    const [swing, twist] = [new Quaternion(), new Quaternion()];
    expect(swingTwist(new Quaternion().setFromAxisAngle(up, 0.7), up, swing, twist)).toBeCloseTo(0.7, 14);
    expect(swing.angleTo(new Quaternion())).toBeLessThan(1e-7);
    expect(swingTwist(new Quaternion().setFromAxisAngle(up, -2.5), up, swing, twist)).toBeCloseTo(-2.5, 14);
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
    expect(swingTwist(tilt, up, swing, twist)).toBe(0);
    expect(twist.equals(new Quaternion())).toBe(true);
    expect(swing.angleTo(tilt)).toBeLessThan(1e-7);
  });

  it('gives identity twist when the rotation turns the axis half a turn (the twist is undefined there)', () => {
    const half = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    const [swing, twist] = [new Quaternion(), new Quaternion()];
    expect(swingTwist(half, new Vector3(0, 1, 0), swing, twist)).toBe(0);
    expect(twist.equals(new Quaternion())).toBe(true);
    expect(Math.abs(swing.dot(half))).toBeCloseTo(1, 12);
  });
});
