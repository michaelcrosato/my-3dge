/**
 * @file Unit tests for a sim step that throws (T1; engine/sim/world.ts `step`, engine/sim/scene.ts `Session.step`; the
 * G1 re-review): a system that throws before the timers stage leaves the step uncounted, so `tick`, the timers and
 * the hash stay as they were, the next step runs as that step again (an `every(1/60)` fires once a step, a one-shot
 * on time), and the session records nothing of it, so `record()` keeps replaying the run; a throw after the timers
 * stage counts the step, and the session records it.
 * @see engine/sim/world.ts
 */
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { createRegistry } from '../core/registry';
import { playReplay } from './replay';
import { createSession, defineScene } from './scene';
import { defineComponent } from './state';
import { createWorld } from './world';

/** Throws an Error with `message`: a system failing on purpose. */
function fail(message: string): never {
  throw new Error(message);
}

type Dots = { dot: { x: number } };

/** A registry with the component `dot` (`x`). */
function dotRegistry() {
  const registry = createRegistry();
  const x = { type: 'number', default: 0, description: 'East.' } as const;
  defineComponent('dot', { description: 'A dot.', fields: { x } }, registry);
  return registry;
}

/** Where the scene `trap` throws: '' (nowhere), 'ai' (before the timers stage) or 'rules' (after it). */
let trap = '';

/**
 * The scene `trap`: one dot that `walk` moves in `rules` by 1 + the intents' forward move, an `every(1/60)` adding
 * the tick to its x, and the system `trap` in `ai`, which throws while `trap` says so (the scene's own step is empty).
 */
function trapRegistry() {
  const registry = dotRegistry();
  defineScene<Dots>(
    'trap',
    {
      setup(w) {
        const id = w.spawn({ dot: {} });
        w.systems.add('trap', () => void (trap === 'ai' && fail('sprung')), { phase: 'ai' });
        w.systems.add('walk', (w, intents) => {
          w.get(id)!.dot!.x += 1 + (intents.move?.[1] ?? 0);
          if (trap === 'rules') fail('sprung late');
        });
        w.timers.every(1 / 60, () => void (w.get(id)!.dot!.x += w.tick));
      },
    },
    registry,
  );
  return registry;
}

describe('the world', () => {
  it('does not count a step that throws before its timers stage: tick, timers and hash stay as they were', () => {
    const log = createLog({ console: { warn: () => {}, error: () => {} } });
    const w = createWorld<Dots>({ seed: 2, registry: dotRegistry(), log });
    let at = '';
    const fired: number[] = [];
    w.systems.add('early trap', () => void (at === 'ai' && fail('sprung')), { phase: 'ai' });
    w.systems.add('late trap', () => void (at === 'rules' && fail('sprung late')));
    w.timers.every(1 / 60, () => fired.push(w.tick));
    w.timers.after(3 / 60, () => fired.push(-w.tick)); // due on step 3
    w.step();
    w.step();
    const before = { state: w.state(), hash: w.hash() };
    at = 'ai';
    expect(() => w.step()).toThrow('sprung');
    expect(() => w.step()).toThrow('sprung');
    at = '';
    expect([w.tick, w.state(), w.hash()]).toEqual([2, before.state, before.hash]);
    w.step();
    w.step();
    expect(fired).toEqual([1, 2, 3, -3, 4]); // not [1, 2, 4, 4, -4]: once a step, the one-shot on time
    at = 'rules'; // a throw after the timers stage counts the step: its timers fired
    expect(() => w.step()).toThrow('sprung late');
    at = '';
    w.step();
    expect([w.tick, fired.slice(5)]).toEqual([6, [5, 6]]);
  });
});

describe('the session', () => {
  it('records nothing of a step the world did not count, so record() replays the run to the live hash', () => {
    const registry = trapRegistry();
    const live = createSession('trap', { registry });
    live.step({});
    live.step({});
    const before = { tick: live.world.tick, steps: live.steps, hash: live.world.hash(), replay: live.record() };
    trap = 'ai';
    try {
      expect(() => live.step({ move: [0, 1] })).toThrow('sprung');
    } finally {
      trap = '';
    }
    const after = { tick: live.world.tick, steps: live.steps, hash: live.world.hash(), replay: live.record() };
    expect(after).toEqual(before);
    expect(live.world.state().timers).toEqual({ ticks: 2, nextId: 2, timers: [[1, 3, 1, 0, 2]] });
    live.step({});
    live.step({});
    const replay = live.record();
    expect(replay.inputs).toEqual([]); // the failed step's move is not in it
    expect(playReplay(replay, { registry, checkpoints: [4] }).hashes[4]).toBe(live.world.hash());
    expect(live.world.get(1)!.dot!.x).toBe(4 + (1 + 2 + 3 + 4)); // walked 4 steps; the timer fired once on each
  });

  it('records a step that threw after its timers stage, which the world counted', () => {
    const registry = trapRegistry();
    const live = createSession('trap', { registry });
    live.step({});
    trap = 'rules';
    try {
      expect(() => live.step({ move: [0, 1] })).toThrow('sprung late');
    } finally {
      trap = '';
    }
    expect([live.world.tick, live.steps]).toEqual([2, 2]);
    expect(live.record().inputs).toEqual([[1, { move: [0, 1] }]]);
  });
});
