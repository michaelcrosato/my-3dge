/**
 * @file Unit tests for tip trails (engine/anim/proc/trails.ts, PLAN.md WP 10.1): a tip sampled each active step, the
 * newest first, with its base for a ribbon; samples aging out after their life once the tip stops, not at once; at
 * most the capacity kept; a jump starting the trail afresh.
 * @see engine/anim/proc/trails.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { TipTrail } from './trails';

describe('tip trails', () => {
  it('samples the tip and its base each active step, newest first, and lets them age out after', () => {
    const swing = new TipTrail({ life: 0.1 });
    for (let i = 0; i < 12; i++) swing.step(1 / 60, new Vector3(i * 0.1, 1.2, 0), new Vector3(i * 0.1, 1, 0));
    expect(swing.samples.length).toBe(7); // 0 to 0.1 s old
    expect(swing.samples.map((s) => s.tip.x)).toEqual([11, 10, 9, 8, 7, 6, 5].map((x) => expect.closeTo(x * 0.1, 12)));
    expect(swing.samples[0].base.y).toBe(1);
    swing.step(1 / 60, new Vector3(2, 1.2, 0), undefined, false); // still: no new sample
    expect(swing.samples.length).toBe(6);
    for (let i = 0; i < 6; i++) swing.step(1 / 60, new Vector3(), undefined, false);
    expect(swing.samples.length).toBe(0); // aged out
  });

  it('keeps at most its capacity, and starts afresh after a jump', () => {
    const lash = new TipTrail({ life: 1, capacity: 5, jump: 1 });
    for (let i = 0; i < 20; i++) lash.step(1 / 60, new Vector3(0, 0, i * 0.05));
    expect(lash.samples.length).toBe(5);
    lash.step(1 / 60, new Vector3(0, 0, 9)); // teleported
    expect(lash.samples.length).toBe(1);
  });
});
