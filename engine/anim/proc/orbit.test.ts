/**
 * @file Unit tests for orbiters and detached parts (engine/anim/proc/orbit.ts, PLAN.md WP 10.1): orbiters evenly
 * spaced on their ring in the frame's plane, going round at their rate, a change of rate never jumping them, their
 * radius easing out, their bob within its height; a detached part trailing its moving spot and catching up, drifting
 * about it within its sway when still.
 * @see engine/anim/proc/orbit.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { DetachedPart, Orbiters } from './orbit';

const CENTRE = new Vector3(0, 1, 0);
const FLAT = new Quaternion();

describe('orbiters and detached parts', () => {
  it('spaces orbiters evenly round their ring, at their rate, never jumping when it changes', () => {
    const leaves = new Orbiters({ count: 3, radius: 0.75, rate: 0.9, bob: 0.19 });
    leaves.step(1 / 60, CENTRE, FLAT);
    const across = leaves.points.map((p) => Math.atan2(p.x, p.z));
    const gaps = [1, 2].map((i) => (((across[i] - across[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    expect(gaps).toEqual([expect.closeTo((2 * Math.PI) / 3, 9), expect.closeTo((4 * Math.PI) / 3, 9)]);
    for (const p of leaves.points) expect(Math.hypot(p.x, p.z)).toBeCloseTo(0.75, 12);
    let most = 0;
    for (let i = 0; i < 120; i++) {
      const before = leaves.points[0].clone();
      leaves.step(1 / 60, CENTRE, FLAT, i < 60 ? 0.9 : 9); // a dash spins them up
      most = Math.max(most, before.distanceTo(leaves.points[0]));
      for (const p of leaves.points) expect(Math.abs(p.y - 1)).toBeLessThanOrEqual(0.19 + 1e-12);
    }
    expect(most).toBeLessThan(0.75 * (9 / 60) + 0.02); // a step's arc at its fastest, never a jump
    expect(leaves.angle).toBeCloseTo((0.9 * 61 + 9 * 60) / 60, 9); // integrated: 61 steps slow, 60 fast
    leaves.step(0.25, CENTRE, FLAT, 0.9, 1);
    expect(leaves.radius).toBeCloseTo(1, 12); // eased out at 1 m/s
    const tilted = new Orbiters({ count: 2, radius: 0.5, rate: 1, bob: 0 });
    tilted.step(0.3, CENTRE, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)); // its plane stood up
    for (const p of tilted.points) expect(p.x).toBeCloseTo(0, 12);
  });

  it('starts a detached part at its spot, not springing in from the origin', () => {
    const hand = new DetachedPart({ sway: 0 });
    expect(hand.step(1 / 60, new Vector3(0.3, 1, 0.2)).distanceTo(new Vector3(0.3, 1, 0.2))).toBeLessThan(1e-12);
  });

  it('trails a detached part behind its moving spot, catching up, drifting within its sway when still', () => {
    const hand = new DetachedPart({ frequency: 10, damping: 0.8, sway: 0.02 });
    const spot = new Vector3(0.3, 1, 0.2);
    hand.step(1 / 60, spot);
    for (let i = 0; i < 30; i++) hand.step(1 / 60, spot.set(0.3, 1, 0.2 + (i + 1) * 0.05)); // carried forward at 3 m/s
    expect(hand.part.value.z).toBeLessThan(spot.z - 0.05); // behind it
    let far = 0;
    for (let i = 0; i < 600; i++) far = Math.max(far, i > 120 ? hand.step(1 / 60, spot).distanceTo(spot) : (hand.step(1 / 60, spot), 0)); // prettier-ignore
    expect(far).toBeLessThan(0.02 * Math.sqrt(3) + 1e-3); // about its spot, within its drift
    expect(far).toBeGreaterThan(0.005); // and drifting
  });
});
