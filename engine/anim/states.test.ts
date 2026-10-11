/**
 * @file Unit tests for the body-state vocabulary (engine/anim/states.ts), PLAN.md WP 3.7's Done when: unknown body
 * states warn with a suggestion. Also: wrong kinds of value warn and are dropped, each word warns once, valid input
 * passes through untouched, the vocabulary is the humanoid's words plus `trail`, and every sample state shows itself
 * on a humanoid.
 */
import { describe, expect, it } from 'vitest';
import { createLog, type Log } from '../core/log';
import { Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { SIM_DT } from '../core/time';
import { Humanoid, type HumanoidInput } from './humanoid';
import { BODY_STATES, checkBodyStates, SAMPLE_STATES, TRAILS, type AnimatorInput, type SampleState } from './states';

/** A log that prints nothing, and what it would have printed. */
function quietLog(): { log: Log; printed: string[] } {
  const printed: string[] = [];
  const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
  return { log, printed };
}

describe('the body-state vocabulary', () => {
  it('is every word the humanoid reads, plus the trail', () => {
    const humanoid: (keyof HumanoidInput)[] = ['position', 'velocity', 'yaw', 'run', 'dash', 'hurt', 'air'];
    humanoid.push('climb', 'point', 'aim', 'pose', 'stance', 'down', 'body');
    expect(Object.keys(BODY_STATES)).toEqual([...humanoid, 'trail']);
    expect(Object.keys(TRAILS)).toEqual(['blade', 'fistR', 'fistL', 'kick']);
  });

  it('passes valid body states through untouched, and skips undefined words', () => {
    const { log, printed } = quietLog();
    const input: AnimatorInput = {
      ...{ position: new Vector3(1, 0, 2), velocity: new Vector3(0, 0, 3), yaw: 0.5, run: 0, dash: true },
      ...{ hurt: false, air: false, climb: false, point: true, aim: 0.2, pose: 'cheer', stance: 'guard' },
      ...({ down: 0, body: { lunge: 0.1 }, trail: 'kick', hop: undefined } as AnimatorInput),
    };
    expect(checkBodyStates(input, log)).toBe(input);
    expect(printed).toEqual([]);
  });

  it('warns once for a word outside it, naming the closest, and drops it (ANIM_UNKNOWN_STATE)', () => {
    const { log, printed } = quietLog();
    const ignored = new Set<string>();
    const input = { psoe: 'cheer', dash: true } as AnimatorInput;
    const out = checkBodyStates(input, log, ignored);
    expect(out).toEqual({ dash: true });
    expect(input).toEqual({ psoe: 'cheer', dash: true });
    checkBodyStates({ psoe: 'wave' } as AnimatorInput, log, ignored);
    checkBodyStates({ stnace: 'guard', velocty: new Vector3() } as AnimatorInput, log, ignored);
    expect(printed).toEqual([
      '[ANIM_UNKNOWN_STATE] "psoe" is not a body state (did you mean "pose"?); it is ignored: use one of: ' +
        Object.keys(BODY_STATES).join(', '),
      expect.stringContaining('"stnace" is not a body state (did you mean "stance"?)'),
      expect.stringContaining('"velocty" is not a body state (did you mean "velocity"?)'),
    ]);
    expect(log.advice.find((a) => a.subject === 'state:psoe')?.count).toBe(2);
    expect([...ignored].sort()).toEqual(['psoe', 'stnace', 'velocty']);
  });

  it('warns once for a value of the wrong kind, naming what it takes, and drops it (ANIM_BAD_STATE)', () => {
    const { log, printed } = quietLog();
    const bad = { dash: 1, trail: 'blad', velocity: [0, 0, 1], yaw: Number.NaN, body: 'lunge', pose: 3 };
    expect(checkBodyStates({ ...bad, air: true } as unknown as AnimatorInput, log)).toEqual({ air: true });
    expect(printed).toEqual([
      '[ANIM_BAD_STATE] body state dash is 1, not true or false; it is ignored: give dash true or false',
      expect.stringContaining('trail is "blad", not one of blade, fistR, fistL, kick (did you mean "blade"?)'),
      expect.stringContaining('velocity is [0,0,1], not a Vector3'),
      expect.stringContaining('yaw is NaN, not a finite number'),
      expect.stringContaining('body is "lunge", not an object'),
      expect.stringContaining('pose is 3, not a name'),
    ]);
  });

  it('names states a humanoid shows: each sample state, held for its time, raises its weight', () => {
    const shows: Record<keyof typeof SAMPLE_STATES, (h: Humanoid) => boolean> = {
      idle: (h) => Object.values(h.state.weights).every((w) => w === 0),
      run: (h) => h.state.weights.speed === 1 && h.state.phase > 0,
      dodge: (h) => h.state.weights.dash > 0.97,
      jump: (h) => h.state.weights.air > 0.95 && h.position.y === 0.625,
      cast: (h) => h.state.weights.cast === 1,
      guard: (h) => h.state.weights.stanceGuard === 1,
      hurt: (h) => h.state.weights.hurt === 1,
      knockedDown: (h) => h.state.weights.down === 1,
      death: (h) => h.state.weights.down === 1 && h.state.dieTime > 2,
      cheer: (h) => h.state.weights.cheer === 1,
      wave: (h) => h.state.weights.wave === 1,
    };
    const { log, printed } = quietLog();
    for (const name of Object.keys(SAMPLE_STATES) as (keyof typeof SAMPLE_STATES)[]) {
      const { states, seconds }: SampleState = SAMPLE_STATES[name];
      expect(checkBodyStates(states, log)).toBe(states);
      const humanoid = new Humanoid({ build: 'build:heroic', rng: new Rng(1), log });
      for (let t = 0; t < Math.round(seconds / SIM_DT); t++) humanoid.step(states);
      expect(shows[name](humanoid), name).toBe(true);
    }
    expect(printed).toEqual([]);
  });
});
