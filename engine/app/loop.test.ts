/**
 * @file Unit tests for engine/app/loop.ts (T1, PLAN.md §6.4, WP 2.7): frames at any rate run the fixed steps real time
 * holds (a 60 Hz display one each, a 144 Hz one some none, a stall at most `time.maxSteps`) and draw at the clock's
 * alpha; a frame's sample goes to its first step and its later steps get it without `p`; a press sampled in a frame
 * that runs no step reaches the next step; frames held by a replay neither step nor draw; an error stops the loop
 * once; `start` runs frames from animation frames until `stop`.
 * @see engine/app/loop.ts
 */
import { describe, expect, it } from 'vitest';
import { createClock } from '../core/time';
import { createLoop, type LoopOptions } from './loop';

/** A loop over a 60 Hz clock whose steps and draws are recorded, sampling `samples` in turn (then `{}`). */
function recorded(samples: Record<string, unknown>[] = [], extra: Partial<LoopOptions> = {}) {
  const clock = createClock({ hz: 60 });
  const steps: Record<string, unknown>[] = [];
  const draws: number[] = [];
  const loop = createLoop({
    clock: () => clock,
    sample: () => samples.shift() ?? {},
    step: (intents) => void steps.push(intents),
    draw: ({ alpha }) => void draws.push(alpha),
    onError: () => {},
    ...extra,
  });
  return { loop, clock, steps, draws };
}

describe('createLoop', () => {
  it('runs the fixed steps real time holds and draws at the alpha', () => {
    const { loop, steps, draws } = recorded();
    loop.frame(1000); // the first frame sets the origin
    for (let k = 1; k <= 60; k++) loop.frame(1000 + (k * 1000) / 60);
    expect(steps).toHaveLength(60);
    expect(loop.steps).toBe(60);
    expect(loop.frames).toBe(61);
    const fast = recorded();
    fast.loop.frame(0);
    for (let k = 1; k <= 144; k++) fast.loop.frame((k * 1000) / 144);
    expect(fast.steps).toHaveLength(60);
    expect(fast.draws.every((alpha) => alpha >= 0 && alpha < 1)).toBe(true);
    const stalled = recorded();
    stalled.loop.frame(0);
    expect(stalled.loop.frame(5000)).toMatchObject({ steps: 6, dropped: 294 });
    expect(draws.length).toBe(61);
  });

  it("gives a frame's sample to its first step, without p to the rest, and keeps a press from a stepless frame", () => {
    const { loop, steps } = recorded([{ p: ['jump'] }, { move: [0, 1], p: ['dash'], b: ['run'] }]);
    loop.frame(1000); // no step: the jump waits
    loop.frame(1000 + 2000 / 60 + 1); // two steps
    expect(steps).toEqual([
      { move: [0, 1], p: ['dash', 'jump'], b: ['run'] },
      { move: [0, 1], p: undefined, b: ['run'] },
    ]);
  });

  it('neither steps nor draws while held, and drops the time held', () => {
    let held = true;
    const { loop, steps, draws } = recorded([], { hold: () => held });
    loop.frame(0);
    loop.frame(1000);
    expect([steps.length, draws.length]).toEqual([0, 0]);
    held = false;
    loop.frame(1000 + 1000 / 60 + 0.5);
    expect(steps.length).toBe(1);
  });

  it('runs on animation frames until stopped, and stops at the first error', () => {
    const queued: ((now: number) => void)[] = [];
    const request = (callback: (now: number) => void) => queued.push(callback);
    const errors: unknown[] = [];
    const { loop } = recorded([], { request, cancel: () => queued.splice(0), onError: (e) => errors.push(e) });
    loop.start();
    loop.start(); // once
    expect(queued).toHaveLength(1);
    queued.shift()!(0);
    expect([loop.running, loop.frames]).toEqual([true, 1]);
    loop.stop();
    expect(loop.running).toBe(false);
    const failing = recorded([], {
      request,
      cancel: () => {},
      draw: () => {
        throw new Error('boom');
      },
      onError: (e) => errors.push(e),
    });
    failing.loop.start();
    queued.shift()!(0);
    expect([failing.loop.running, errors.map(String)]).toEqual([false, ['Error: boom']]);
  });
});
