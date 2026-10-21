/**
 * @file Unit tests for the stance locks (engine/anim/locomotion/locks.ts, WP 13.10): a fresh lock takes the sole where
 * its animation puts it; a foot in stance stays put while its animation moves on; once the stance ends it lets go over
 * `release`, lifting with its animation, at once when an action took the feet or the animation lifted it; a sole the
 * animation keeps on the floor holds a moment past its stance (the push-off), no longer than `push` and only on the
 * level it holds on; standing, a sole astray steps back under the body, at once past `step` and past `settle` once its
 * animation has held still, one foot at a time, the shorter step the quicker; a lock rides the treadmill and drops when
 * the body is put elsewhere; and `onFeet` says when a body's locks may hold.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { getBuild } from '../builds';
import { restContext } from '../locomotion';
import { createFootPlantState, FOOT_LOCK, holdFoot, onFeet, type HoldOptions } from './locks';

const DT = 1 / 60;
const UP = new Vector3(0, 1, 0);
/** One tick of the left foot whose animation puts the sole at `x`, `z` (lifted `lift`), told `how`. */
function tick(state: ReturnType<typeof createFootPlantState>, x: number, z: number, how: Partial<HoldOptions> = {}) {
  const at = new Vector3(x, how.lift ?? 0, z);
  const weight = holdFoot(state.feet[0], state.feet[1], at, UP.clone(), { held: true, ground: 0, lift: 0, dt: DT, ...how }); // prettier-ignore
  return { at, weight };
}

describe('the stance locks', () => {
  it('take a fresh foot where its animation is, and hold it there through its stance', () => {
    const state = createFootPlantState();
    expect(Number.isNaN(state.feet[0].point.x)).toBe(true);
    expect(tick(state, 0.1, 0.3).at.toArray()).toEqual([0.1, 0, 0.3]);
    for (let z = 0.3; z < 0.6; z += 0.05) expect(tick(state, 0.1, z).at.toArray()).toEqual([0.1, 0, 0.3]);
  });

  it('let go over FOOT_LOCK.release once the stance ends, the sole lifting with its animation', () => {
    const state = createFootPlantState();
    tick(state, 0, 0);
    const first = tick(state, 0, 0.2, { held: false, lift: 0.03 });
    expect(first.weight).toBe(0); // lifted over FOOT_LOCK.lifted: the animation took it up, at once
    const other = createFootPlantState();
    tick(other, 0, 0);
    const [a, b] = [
      tick(other, 0, 0.2, { held: false, lift: 0.01 }),
      tick(other, 0, 0.2, { held: false, lift: 0.015 }),
    ];
    expect(a.weight).toBeCloseTo(1 - DT / FOOT_LOCK.release, 12);
    expect(a.at.z).toBeCloseTo(0.2 * DT / FOOT_LOCK.release, 12); // prettier-ignore
    expect(a.at.y).toBeCloseTo(0.01, 12);
    expect(b.weight).toBeLessThan(a.weight);
    for (let i = 0; i < 3; i++) tick(other, 0, 0.2, { held: false, lift: 0.015 });
    expect(tick(other, 0, 0.2, { held: false, lift: 0.015 }).at.z).toBe(0.2);
  });

  it('let go at once when an action takes the feet (release 0)', () => {
    const state = createFootPlantState();
    tick(state, 0, 0);
    expect(tick(state, 0, 0.2, { held: false, release: 0 }).at.z).toBe(0.2);
  });

  it('hold a sole the animation keeps on the floor past its stance, for FOOT_LOCK.push at most', () => {
    const state = createFootPlantState();
    tick(state, 0, 0);
    const ticks = Math.floor(FOOT_LOCK.push / DT);
    for (let i = 0; i < ticks; i++) expect(tick(state, 0, 0.01 * i, { held: false }).at.z).toBe(0);
    for (let i = 0; i < 8; i++) tick(state, 0, 0.5, { held: false });
    expect(tick(state, 0, 0.5, { held: false }).at.z).toBe(0.5); // a dragged foot drags
    const step = createFootPlantState();
    tick(step, 0, 0);
    expect(tick(step, 0, 0.05, { held: false, ground: 0.2 }).at.z).toBeGreaterThan(0); // a step ahead takes it along
  });

  it('step a standing sole back under the body: at once past FOOT_LOCK.step, one foot at a time', () => {
    const state = createFootPlantState();
    const [left, right] = state.feet;
    tick(state, 0, 0, { steps: true });
    holdFoot(right, left, new Vector3(0.2, 0, 0), UP.clone(), { held: true, ground: 0, lift: 0, dt: DT, steps: true });
    tick(state, 0, 0.3, { steps: true });
    expect(left.stepping).toBe(true);
    const wait = holdFoot(right, left, new Vector3(0.2, 0, 0.3), UP.clone(), { held: true, ground: 0, lift: 0, dt: DT, steps: true }); // prettier-ignore
    expect([right.stepping, wait]).toEqual([false, 1]);
    let lifted = 0;
    for (let i = 0; i < 20 && left.stepping; i++) lifted = Math.max(lifted, tick(state, 0, 0.3, { steps: true }).at.y);
    expect(left.stepping).toBe(false);
    expect(lifted).toBeGreaterThan(0.05);
    expect(tick(state, 0, 0.3, { steps: true }).at.toArray()).toEqual([0, 0, 0.3]);
  });

  it('settle a sole a little astray once its animation has held still, in a quicker, lower step', () => {
    const state = createFootPlantState();
    tick(state, 0, 0, { steps: true });
    const settle = (FOOT_LOCK.settle + FOOT_LOCK.step) / 2;
    const ticks: number[] = [];
    for (let i = 0; i < 30; i++) ticks.push(tick(state, 0, settle, { steps: true }).at.y);
    expect(ticks[Math.floor(FOOT_LOCK.settleTime / DT) - 2]).toBe(0); // it waits for the animation to hold still
    expect(Math.max(...ticks)).toBeGreaterThan(0);
    expect(Math.max(...ticks)).toBeLessThan(FOOT_LOCK.stepLift);
    expect(state.feet[0].point.z).toBeCloseTo(settle, 12);
  });

  it('ride the treadmill, and drop a lock the body was carried away from', () => {
    const state = createFootPlantState();
    tick(state, 0, 0);
    const belt = new Vector3(0, 0, -3);
    expect(tick(state, 0, 0, { treadmill: belt }).at.z).toBeCloseTo(-3 * DT, 12);
    expect(tick(state, 0, 5).at.z).toBe(5); // put elsewhere: nothing holds
  });

  it('hold only a body on its feet: not lying, climbing, striking, flying, or early in a dash', () => {
    const w = restContext(getBuild('build:adult')).w;
    expect(onFeet(w)).toBe(true);
    for (const name of ['down', 'climb', 'attack'] as const) expect(onFeet({ ...w, [name]: 0.01 })).toBe(false);
    expect(onFeet({ ...w, air: 0.6 })).toBe(false);
    expect([onFeet({ ...w, dash: 0.6 }), onFeet({ ...w, dash: 0.4 }), onFeet({ ...w, kneel: 1 })]).toEqual([false, true, true]); // prettier-ignore
  });
});
