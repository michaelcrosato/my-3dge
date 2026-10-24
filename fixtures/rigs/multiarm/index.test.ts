/**
 * @file Unit tests for the multi-arm (fixtures/rigs/multiarm/index.ts, PLAN.md WP 10.1): its rig passes the check in
 * every state; its swing winds back, strikes through and recovers, its blade's tip trailing while it swings; its lower
 * arms replay the upper ones late; its guard raises its hands; its swing's reach is measured off the animation, at the
 * strike.
 * @see fixtures/rigs/multiarm/index.ts
 */
import { describe, expect, it } from 'vitest';
import { rigCheck } from '../../../engine/sim-api';
import { Multiarm, MULTIARM, swingCurve, swingReach } from './index';

const point = (fighter: Multiarm, name: string) => fighter.points()[MULTIARM.names.indexOf(name)];

describe('the multi-arm', () => {
  it('passes the rig check in every state', () => {
    expect(rigCheck(MULTIARM).problems.map((p) => p.message)).toEqual([]);
  });

  it('swings, its lower arms after its upper ones; guards; and measures its swing’s reach', () => {
    expect([swingCurve(0), swingCurve(0.3), swingCurve(0.55), swingCurve(1)]).toEqual([-0, -1, 1, 0]);
    const fighter = new Multiarm();
    const [upper, lower]: number[][] = [[], []];
    for (let i = 0; i <= 48; i++) {
      fighter.step({ swing: i / 48 });
      upper.push(point(fighter, 'upperR hand').z);
      lower.push(point(fighter, 'lowerR hand').z);
    }
    const peak = (zs: number[]) => zs.indexOf(Math.max(...zs));
    expect(peak(lower) - peak(upper)).toBeGreaterThanOrEqual(3); // 0.07 s late: four steps of 1/60 s
    expect(fighter.trail.samples.length).toBeGreaterThan(3);
    const ready = point(new Multiarm().step(), 'upperL hand').y;
    const guard = new Multiarm();
    for (let i = 0; i < 30; i++) guard.step({ guard: true });
    expect(point(guard, 'upperL hand').y).toBeGreaterThan(ready + 0.2);
    const reach = swingReach();
    expect(reach.at).toBeGreaterThanOrEqual(0.4);
    expect(reach.at).toBeLessThanOrEqual(0.8); // through the strike
    expect(reach.reach).toBeGreaterThan(point(new Multiarm().step(), 'upperR tip').z + 0.05); // farther than at the ready
    expect(reach.stand).toBeCloseTo(reach.reach + 0.19, 12);
  });
});
