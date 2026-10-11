/**
 * @file Unit tests for engine/dev/stats.ts (T1, PLAN.md §8.3, §8.7, WP 5.5): on a clock the test moves, the meter's
 * medians cover the last 60 steps or frames; the probe adds each `physics` and `anim` system's time to its phase for
 * the step under way and passes the other phases through, each system run once; phases timed outside a step are not
 * counted; the renderer's counts are read live, and are null headless with `renderMs`; `reset` forgets the samples;
 * and the `stats` member reads its host's meter, or throws `DEV_NO_METER` naming the fix.
 * @see engine/dev/stats.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/log';
import { registry as sharedRegistry } from '../core/registry';
import { createInspector } from './inspector';
import type { InspectorHost } from './members';
import { createStatsMeter, medianOf, STATS_WINDOW, type RenderCounts, type StatsMeter } from './stats';

/** A meter on a clock the test moves; `step(ms)` times a step whose phases take `ms.physics`, `ms.anim` and `ms.logic`. */
function clocked(counts?: () => RenderCounts | null) {
  let t = 0;
  const meter = createStatsMeter({ now: () => t, counts });
  const step = (ms: { physics?: number; anim?: number; logic?: number }) =>
    meter.time('sim', () => {
      meter.probe({ phase: 'ai' }, () => (t += ms.logic ?? 0));
      meter.probe({ phase: 'anim' }, () => (t += ms.anim ?? 0));
      meter.probe({ phase: 'physics' }, () => (t += ms.physics ?? 0));
    });
  const frame = (ms: number) => meter.time('render', () => (t += ms));
  return { meter, step, frame, advance: (ms: number) => (t += ms) };
}

/** The counts a renderer gives after a frame. */
const COUNTS: RenderCounts = {
  drawCalls: 12,
  triangles: 3400,
  computeCalls: 1,
  textures: 5,
  geometries: 9,
  pipelines: 21,
  pipelinesAfterWarmUp: 0,
};

describe('the meter', () => {
  it('reports the medians of the last 60 steps and frames, split into physics, anim and the rest', () => {
    const { meter, step, frame } = clocked();
    for (let k = 0; k < STATS_WINDOW; k++) step({ physics: 2, anim: 1, logic: 0.5 });
    for (let k = 0; k < 3; k++) frame(4);
    frame(10);
    expect(meter.read()).toMatchObject({ simMs: 3.5, physicsMs: 2, animMs: 1, renderMs: 4, steps: 60, frames: 4 });
    for (let k = 0; k < STATS_WINDOW; k++) step({ physics: 6, anim: 0, logic: 1 });
    expect(meter.read()).toMatchObject({ simMs: 7, physicsMs: 6, animMs: 0, steps: 120 });
    step({ physics: 100 });
    expect(meter.read().physicsMs).toBe(6); // one slow step of 60 moves no median
  });

  it('runs each system once, passes other phases through, and counts phases only inside a timed step', () => {
    const { meter, step, advance } = clocked();
    const ran: string[] = [];
    meter.probe({ phase: 'physics' }, () => (ran.push('physics'), advance(50))); // outside a step: dropped
    meter.probe({ phase: 'rules' }, () => void ran.push('rules'));
    step({ physics: 1 });
    expect(ran).toEqual(['physics', 'rules']);
    expect(meter.read()).toMatchObject({ simMs: 1, physicsMs: 1, animMs: 0, steps: 1 });
    expect(() => meter.time('sim', () => meter.probe({ phase: 'anim' }, () => advance(3) && fail()))).toThrow('no');
    expect(meter.read()).toMatchObject({ steps: 2, animMs: 1.5 }); // a step that threw still took its time
  });

  it('reads the renderer’s counts live, and leaves them and renderMs null headless', () => {
    expect(clocked().meter.read()).toEqual({
      simMs: null,
      physicsMs: null,
      animMs: null,
      renderMs: null,
      steps: 0,
      frames: 0,
      drawCalls: null,
      triangles: null,
      computeCalls: null,
      textures: null,
      geometries: null,
      pipelines: null,
      pipelinesAfterWarmUp: null,
    });
    let counts: RenderCounts | null = null;
    const { meter, frame } = clocked(() => counts);
    frame(2);
    expect(meter.read()).toMatchObject({ renderMs: 2, drawCalls: null });
    counts = COUNTS;
    expect(meter.read()).toMatchObject({ ...COUNTS, renderMs: 2, frames: 1 });
    meter.reset();
    expect(meter.read()).toMatchObject({ ...COUNTS, renderMs: null, simMs: null, frames: 0, steps: 0 });
  });

  it('takes medians of odd and even counts, and none of no samples', () => {
    expect([medianOf([3, 1, 2]), medianOf([4, 1, 3, 2]), medianOf([])]).toEqual([2, 2.5, null]);
  });
});

/** Throws, for a probe that fails. */
function fail(): never {
  throw new Error('no');
}

describe('__engine.stats()', () => {
  /** An inspector over the shared members, on a host with `meter` (or none). */
  const inspect = (meter?: StatsMeter) =>
    createInspector({ members: sharedRegistry, runtime: 'node', meter } as unknown as InspectorHost);

  it("reads its host's meter, and help() lists it", () => {
    const { meter, step } = clocked(() => COUNTS);
    step({ physics: 1, logic: 1 });
    const engine = inspect(meter);
    expect((engine.stats as () => unknown)()).toEqual(meter.read());
    expect(engine.help('stats')).toMatch(/^stats\(\) {2}Performance counters, never fps/);
  });

  it('throws DEV_NO_METER on a host without a meter, naming the fix', () => {
    const engine = inspect();
    try {
      (engine.stats as () => unknown)();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe('DEV_NO_METER');
      expect((error as EngineError).message).toContain('createEngine or createHeadless');
    }
  });
});
