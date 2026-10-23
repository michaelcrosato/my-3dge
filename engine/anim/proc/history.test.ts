/**
 * @file Unit tests for the pose history (engine/anim/proc/history.ts, PLAN.md WP 10.1): the newest pose at a lag of
 * 0, a pose between two records at a lag between them, the oldest past what it holds, a window kept and one record
 * more, a time not after the newest dropped, and nothing recorded leaving the pose as it was.
 * @see engine/anim/proc/history.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { PoseHistory } from './history';

describe('the pose history', () => {
  it('plays a pose back a lag late, between the records around it, the oldest past what it holds', () => {
    const echo = new PoseHistory({ count: 2, keep: 0.4 });
    const out = [new Vector3(9, 9, 9), new Vector3()];
    expect(echo.at(0.1, out)[0].x).toBe(9); // nothing yet
    for (let i = 0; i <= 60; i++) echo.push(i / 60, [new Vector3(i / 60, 0, 0), new Vector3(0, 2 * (i / 60), 0)]);
    expect(echo.at(0, out)[0].x).toBe(1); // the newest
    expect(echo.at(0.105, out)[0].x).toBeCloseTo(0.895, 12); // between 53/60 and 54/60
    expect(out[1].y).toBeCloseTo(2 * 0.895, 12);
    expect(echo.at(5, out)[0].x).toBeCloseTo(1 - echo.length / 60 + 1 / 60, 12); // the oldest it holds
    expect(echo.length).toBe(0.4 * 60 + 1); // the window (24 steps), and one older
    echo.push(1, [new Vector3(7, 7, 7), new Vector3()]); // the same time again: dropped
    expect(echo.at(0, out)[0].x).toBe(1);
  });
});
