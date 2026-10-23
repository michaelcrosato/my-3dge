/**
 * @file Unit tests for sway and lag (engine/anim/proc/sway.ts, PLAN.md WP 10.1): a sway chain keeps every segment's
 * length, swings most at its tip and lags down the chain, droops toward its tip, beats about its right when asked, and
 * runs the same at any step; a lagging part stays its length from its pivot, swings behind as the body turns and
 * moves, never past its limit, and settles back where the body holds it.
 * @see engine/anim/proc/sway.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { LagPart, SwayChain } from './sway';

const ROOT = new Vector3(0, 0.6, -0.2);
const STILL = new Quaternion();
const yawed = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);

describe('sway and lag', () => {
  it('swings a chain most at its tip, lagging down it, every segment its length, drooping toward its tip', () => {
    const tail = new SwayChain({ count: 5, length: 0.12, amplitude: 0.5, frequency: 1.9, lag: 0.7, droop: 0.08 });
    const sideways = Array.from({ length: 6 }, () => 0);
    for (let k = 0; k < 120; k++) {
      const points = tail.step(1 / 60, ROOT, STILL);
      for (let i = 1; i <= 5; i++) expect(points[i].distanceTo(points[i - 1])).toBeCloseTo(0.12, 12);
      points.forEach((p, i) => (sideways[i] = Math.max(sideways[i], Math.abs(p.x - ROOT.x))));
    }
    for (let i = 1; i < 5; i++) expect(sideways[i + 1]).toBeGreaterThan(sideways[i]); // growing toward the tip
    const drooped = new SwayChain(tail.options).step(1, ROOT, STILL);
    expect(drooped[5].y).toBeLessThan(ROOT.y - 0.05); // lower toward the tip
    const coarse = new SwayChain(tail.options);
    const fine = new SwayChain(tail.options);
    for (let k = 0; k < 30; k++) coarse.step(1 / 60, ROOT, yawed(0.4), 0.8, 1.5);
    for (let k = 0; k < 60; k++) fine.step(1 / 120, ROOT, yawed(0.4), 0.8, 1.5);
    expect(coarse.points[5].distanceTo(fine.points[5])).toBeLessThan(1e-12); // any step: the phase is integrated
    expect(coarse.points[5].x).toBeLessThan(0); // turned with its frame: behind a body turned 0.4 rad left
    const beat = new SwayChain({ ...tail.options, axis: 'up', droop: 0 });
    beat.step(0.4, ROOT, STILL);
    expect([Math.abs(beat.points[5].x - ROOT.x) < 1e-12, Math.abs(beat.points[5].y - ROOT.y) > 0.01]).toEqual([true, true]); // prettier-ignore
  });

  it('swings a part behind its pivot as the body turns and moves, its length kept, within its limit', () => {
    const sack = new LagPart({ length: 0.3, rest: new Vector3(0, -0.5, -1), frequency: 9, damping: 0.55, limit: 0.5 });
    const pivot = new Vector3(0, 0.5, 0);
    const rest = new Vector3(0, -0.5, -1).normalize();
    sack.step(1 / 60, pivot, STILL);
    expect(sack.tip.value.clone().sub(pivot).normalize().distanceTo(rest)).toBeLessThan(1e-12); // first: at rest
    let most = 0;
    for (let k = 0; k < 30; k++) {
      const frame = yawed(k * 0.08); // turning left at 4.8 rad/s
      const tip = sack.step(1 / 60, pivot, frame);
      expect(tip.distanceTo(pivot)).toBeCloseTo(0.3, 12);
      const held = rest.clone().applyQuaternion(frame);
      const off = Math.acos(Math.min(1, tip.clone().sub(pivot).normalize().dot(held)));
      most = Math.max(most, off);
      expect(off).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    expect(most).toBeGreaterThan(0.1); // it lagged the turn
    for (let k = 0; k < 240; k++) sack.step(1 / 60, pivot.set(0, 0.5, 0), yawed(2.4));
    const settled = sack.tip.value.clone().sub(pivot).normalize();
    expect(settled.distanceTo(rest.clone().applyQuaternion(yawed(2.4)))).toBeLessThan(1e-3); // back where it is held
    const moved = new LagPart({ length: 0.3, rest: new Vector3(0, -1, 0) });
    moved.step(1 / 60, new Vector3(), STILL);
    const tip = moved.step(1 / 60, new Vector3(0, 0, 0.2), STILL); // the pivot jerked forward
    expect(tip.z).toBeLessThan(0.2); // it trails behind
  });
});
