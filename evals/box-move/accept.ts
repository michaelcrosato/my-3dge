/**
 * @file The acceptance of the eval task box-move (evals/box-move/prompt.md), run by `node x evals` in the attempt's
 * copy: `move:whirl` (labs/box/moves/whirl.ts, its unit test beside it) plays its phases in 0.75 s with its hit window
 * in the strike, turns the body once round, and on a humanoid holding a sword sweeps nearly all the way round him, low,
 * over a metre out.
 */
import { describe, expect, it } from 'vitest';
import { Attack, getMove, measureMove } from '../../engine';
import '../../labs/box/moves/whirl';

const move = getMove('move:whirl');

describe('move:whirl', () => {
  it('plays its wind-up, strike and recovery in 0.75 s, its hit window inside the strike', () => {
    expect(move.time).toMatchObject({ wind: 0.15, active: 0.3, recover: 0.3, hold: 0.25 });
    const attack = new Attack(move);
    const seen: string[] = attack.start() ? attack.events.map((event) => event.type) : [];
    let ticks = 0;
    for (; ticks < 600 && attack.busy; ticks++) seen.push(...attack.update(1 / 60).map((event) => event.type));
    expect(seen).toEqual(['wind', 'active', 'hitOpen', 'hitClose', 'recover', 'end']);
    expect(Math.abs(ticks - 45)).toBeLessThanOrEqual(1);
  });

  it('turns the body once to the left while the blade sweeps right to left on the ground plane, a metre down', () => {
    expect([move.spin, move.plane, move.trail, move.body.crouch]).toEqual([1, 'ground', true, 0.6]);
    expect(move.arc).toEqual([1.2, -1.2]);
    expect(move.height).toEqual([-1, -1]);
    expect(move.reach).toEqual([0.55, 0.55]);
  });

  it('sweeps nearly all the way round a humanoid holding a sword, low and over a metre out', () => {
    const shape = measureMove(move, { build: 'build:heroic', weapon: 'sword' });
    expect(shape.halfAngle).toBeGreaterThan(2.5);
    expect(shape.range).toBeGreaterThan(1.1);
    expect(shape.yMax).toBeLessThan(0.8);
  });
});
