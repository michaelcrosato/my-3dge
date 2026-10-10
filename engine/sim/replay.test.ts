/**
 * @file Unit tests for engine/sim/replay.ts (T1): a session records change-points (intents as diffs, `set` for
 * non-view settings, `dev` with args, merged in play order), a recorded replay plays back to the live hashes at every
 * step and records itself again point for point, settings changed mid-run replay exactly, a checkpoint is the state
 * before its step's inputs, malformed replays are refused naming the path and the closest key, view settings and
 * another step rate are refused, and the kernel fixture's replays give their golden hashes three times in Node. The
 * bisection's comparison finds an injected divergence at its step, entity and field (inside a step, and through a dev
 * action added to a kernel replay), and the verdict on runs reports "golden: other platform" when another platform
 * recorded the goldens and the runs agree.
 * @see engine/sim/replay.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { defineSettings } from '../core/settings';
import { TIME_SETTINGS } from '../core/time';
import '../../fixtures/scenes/kernel';
import { checkpointsOf, checkReplay, firstDifference, judgeRuns, partingOf, playReplay, type Replay } from './replay';
import { createSession, defineScene } from './scene';
import { defineComponent } from './state';
import type { World } from './world';

/** The code and message of the EngineError `fn` throws. */
function failure(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return `${error.code} ${error.message}`;
    throw error;
  }
  throw new Error('expected an EngineError');
}

type Walk = { walker: { x: number; z: number } };

/** A registry with a scene `walk` whose walkers follow `move`, drift with sin and pow, and a `teleport` action. */
function walkRegistry() {
  const registry = createRegistry();
  defineSettings(TIME_SETTINGS, registry);
  defineSettings(
    {
      'walk.speed': { type: 'number', default: 1, description: 'Speed.' },
      'walk.look': { type: 'number', default: 0, view: true, description: 'View only.' },
    },
    registry,
  );
  const num = (description: string) => ({ type: 'number', default: 0, description }) as const;
  defineComponent('walker', { description: 'A walker.', fields: { x: num('X.'), z: num('Z.') } }, registry);
  defineScene<Walk>(
    'walk',
    {
      setup(w) {
        for (let i = 0; i < 3; i++) w.spawn({ walker: { x: w.rng('spawn').next(), z: i } });
      },
      step(w, intents) {
        const [mx, mz] = intents.move ?? [0, 0];
        const speed = w.settings.get<number>('walk.speed') * (intents.p?.includes('dash') ? 10 : 1);
        for (const e of w.query('walker')) {
          e.walker.x += (mx * speed + 0.1 * Math.sin(e.walker.z + w.time)) * w.dt;
          e.walker.z += (mz * speed + 0.01 * Math.pow(Math.abs(e.walker.x) + 1, 0.5)) * w.dt;
        }
      },
      actions: {
        teleport(w: World<Walk>, args) {
          const { id, x } = args as { id: number; x: number };
          w.get(id)!.walker!.x = x;
        },
      },
    },
    registry,
  );
  return registry;
}

/** A live session of `walk` driven for 120 steps: moves, a dash press, a setting change and a teleport. */
function liveWalk(registry = walkRegistry()) {
  const live = createSession('walk', { seed: 4, registry, settings: { 'walk.look': 2 } });
  const hashes: Record<string, string> = { 0: live.world.hash() };
  for (let k = 0; k < 120; k++) {
    if (k === 40) live.set('walk.speed', 3);
    if (k === 40) live.set('walk.look', 5);
    if (k === 70) live.act('teleport', { id: 2, x: -1 });
    live.step({ move: k < 60 ? [0, 1] : [1, 0], b: k >= 50 && k < 55 ? ['dash'] : [], p: k === 90 ? ['dash'] : [] });
    hashes[k + 1] = live.world.hash();
  }
  return { live, hashes, registry };
}

describe('the session', () => {
  it('records intents as change-points, settings that are not view, and dev actions with their args', () => {
    const { live } = liveWalk();
    const replay = live.record();
    expect(replay).toMatchObject({ scene: 'walk', seed: 4, hz: 60, steps: 120, settings: {}, hashes: {} });
    expect(replay.inputs).toEqual([
      [0, { move: [0, 1] }],
      [40, { set: { 'walk.speed': 3 } }],
      [50, { b: ['dash'] }],
      [55, { b: null }],
      [60, { move: [1, 0] }],
      [70, { dev: 'teleport', args: { id: 2, x: -1 } }],
      [90, { p: ['dash'] }],
    ]);
    expect(checkReplay(JSON.parse(JSON.stringify(replay)))).toEqual(replay);
  });

  it('merges what happens at one step in play order: set, then dev, then intents', () => {
    const live = createSession('walk', { registry: walkRegistry() });
    live.set('walk.speed', 2);
    live.act('teleport', { id: 1, x: 3 });
    live.set('walk.speed', 4);
    live.act('teleport', { id: 1, x: 5 });
    live.step({ move: [0, 1] });
    live.set('walk.speed', 1);
    live.step({ move: [0, 1] });
    expect(live.record().inputs).toEqual([
      [0, { set: { 'walk.speed': 2 }, dev: 'teleport', args: { id: 1, x: 3 } }],
      [0, { set: { 'walk.speed': 4 }, dev: 'teleport', args: { id: 1, x: 5 }, move: [0, 1] }],
      [1, { set: { 'walk.speed': 1 } }],
    ]);
  });

  it('names a missing dev action and a step taken around the session', () => {
    const live = createSession('walk', { registry: walkRegistry() });
    expect(failure(() => live.act('teleprt'))).toMatch(/^SIM_NO_ACTION.*did you mean "teleport"/);
    live.world.step({});
    expect(failure(() => live.record())).toMatch(/^SIM_OFF_RECORD.*1 steps outside/);
  });
});

describe('playReplay', () => {
  it('plays a recording back to the live hashes at every step, and records itself again', () => {
    const { live, hashes, registry } = liveWalk();
    const replay = live.record();
    const played = playReplay(JSON.parse(JSON.stringify(replay)), { registry, checkpoints: 'every' });
    expect(played.hashes).toEqual(hashes);
    expect(played.session.record()).toEqual(replay);
    expect(played.session.settings.get('walk.speed')).toBe(3);
  });

  it('hashes a checkpoint before the inputs of its step', () => {
    const registry = walkRegistry();
    const base: Replay = { ...createSession('walk', { registry }).record(), steps: 3 };
    const plain = playReplay(base, { registry, checkpoints: 'every' }).hashes;
    const tuned = playReplay(
      { ...base, inputs: [[1, { set: { 'walk.speed': 9 } }]] },
      { registry, checkpoints: 'every' },
    );
    expect([tuned.hashes[0], tuned.hashes[1]]).toEqual([plain[0], plain[1]]);
    expect(tuned.hashes[2]).not.toBe(plain[2]);
  });

  it('stops where asked, and hashes 0, every 60 steps and the last unless the goldens name steps', () => {
    const { live, registry } = liveWalk();
    const replay = live.record();
    expect(checkpointsOf(replay)).toEqual([0, 60, 120]);
    expect(checkpointsOf({ steps: 130, hashes: { a: { 5: '0'.repeat(16) }, b: { 7: '1'.repeat(16) } } })).toEqual([
      5, 7,
    ]);
    const half = playReplay(replay, { registry, until: 50 });
    expect([half.session.steps, Object.keys(half.hashes)]).toEqual([50, ['0']]);
  });

  it('refuses view settings and another step rate', () => {
    const registry = walkRegistry();
    const replay = createSession('walk', { registry }).record();
    const viewed = { ...replay, steps: 10, inputs: [[3, { set: { 'walk.look': 1 } }]] };
    expect(failure(() => playReplay(viewed, { registry }))).toMatch(/^SIM_BAD_REPLAY.*"walk.look" is marked view/);
    expect(failure(() => playReplay({ ...replay, hz: 30 }, { registry }))).toMatch(/recorded at 30 Hz.*60 Hz/);
  });
});

describe('checkReplay', () => {
  const good: Replay = {
    format: 'my3dge-replay/1',
    scene: 'walk',
    settings: {},
    seed: 1,
    hz: 60,
    steps: 10,
    inputs: [[0, { move: [0, 1] }]],
    hashes: { 'linux-x64': { 10: '0123456789abcdef' } },
  };

  it('names the path, the problem and the closest key', () => {
    const cases: [unknown, RegExp][] = [
      [{ ...good, stpes: 3 }, /unknown key "stpes" \(did you mean "steps"\?\)/],
      [{ ...good, format: 'x' }, /its format is "x"/],
      [
        {
          ...good,
          inputs: [
            [3, {}],
            [2, {}],
          ],
        },
        /inputs\[1\]'s step 2 must be a whole number from 3/,
      ],
      [{ ...good, inputs: [[10, {}]] }, /inputs\[0\]'s step 10 must be a whole number from 0 \(the one before\) to 9/],
      [{ ...good, inputs: [[0, { mvoe: [0, 1] }]] }, /inputs\[0\]\[1\]: unknown key "mvoe" \(did you mean "move"\?\)/],
      [{ ...good, inputs: [[0, { cam: 'n' }]] }, /cam is "n"; it must be a finite number/],
      [{ ...good, inputs: [[0, { args: 1 }]] }, /args has no dev action/],
      [{ ...good, inputs: [[0, { set: {} }]] }, /set is \{\}/],
      [{ ...good, hashes: { 'linux-x64': { 11: '0123456789abcdef' } } }, /has the step "11"; 0 to 10/],
      [{ ...good, hashes: { 'linux-x64': { 10: 'xyz' } } }, /hashes.linux-x64.10 is "xyz"; 16 hex digits/],
      [[], /it is \[\], not an object/],
    ];
    for (const [value, pattern] of cases) expect(failure(() => checkReplay(value))).toMatch(pattern);
    expect(checkReplay(good)).toBe(good);
  });
});

describe('the kernel fixture replays', () => {
  const dir = join(import.meta.dirname, '../../tests/replays');
  const files = readdirSync(dir).filter((file) => file.startsWith('kernel-') && file.endsWith('.replay.json'));
  const platform = `${process.platform}-${process.arch}`;

  it('give their golden hashes three times in Node (or agree with each other on another platform)', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const replay = checkReplay(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      const runs = [0, 1, 2].map(() => playReplay(replay).hashes);
      const golden = replay.hashes[platform] ?? runs[0];
      for (const run of runs) expect(run, file).toEqual(golden);
      expect(Object.keys(golden).length).toBeGreaterThan(5);
    }
  });

  it('record themselves again point for point', () => {
    for (const file of files) {
      const replay = checkReplay(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      const recorded = playReplay(replay).session.record();
      expect(recorded.inputs, file).toEqual(replay.inputs);
      expect([recorded.settings, recorded.seed, recorded.steps]).toEqual([replay.settings, replay.seed, replay.steps]);
    }
  });
});

describe('bisection and verdicts', () => {
  /** A registry with a scene `probe` of three dots; with `inject`, step 137 nudges entity 2's dot.y by 1e-12. */
  function probe(inject: boolean) {
    const registry = createRegistry();
    const num = (description: string) => ({ type: 'number', default: 0, description }) as const;
    defineComponent('dot', { description: 'A dot.', fields: { x: num('X.'), y: num('Y.') } }, registry);
    defineScene<{ dot: { x: number; y: number } }>(
      'probe',
      {
        setup: (w) => [1, 2, 3].forEach((x) => w.spawn({ dot: { x } })),
        step(w) {
          for (const e of w.query('dot')) e.dot.x += Math.sin(e.dot.x) * w.dt;
          if (inject && w.tick === 137) w.get(2)!.dot!.y += 1e-12;
        },
      },
      registry,
    );
    return registry;
  }
  /** The state and trace of a replay's world after `step` steps. */
  const viewAt = (replay: unknown, step: number, registry?: ReturnType<typeof createRegistry>) => {
    const { world } = playReplay(replay, { registry, until: step, checkpoints: [] }).session;
    return { state: world.state(), trace: world.trace() };
  };

  it('finds a divergence injected inside a step at its step, entity and field', () => {
    const [plain, injected] = [probe(false), probe(true)];
    const replay = { ...createSession('probe', { registry: plain }).record(), steps: 300 };
    const a = playReplay(replay, { registry: plain, checkpoints: 'every' }).hashes;
    const b = playReplay(replay, { registry: injected, checkpoints: 'every' }).hashes;
    const step = firstDifference(a, b);
    expect(step).toBe(137);
    expect(partingOf(viewAt(replay, 137, plain), viewAt(replay, 137, injected))).toEqual({
      parts: ['entities'],
      entities: [2],
      fields: [{ path: 'entities.2.dot.y', a: 0, b: 1e-12 }],
    });
    expect(firstDifference(a, a)).toBeUndefined();
  });

  it('finds a dev action injected into a kernel replay the step after it, at its entity and field', () => {
    const path = join(import.meta.dirname, '../../tests/replays/kernel-movers.replay.json');
    const replay = checkReplay(JSON.parse(readFileSync(path, 'utf8')));
    const nudge: Replay['inputs'][number] = [137, { dev: 'nudge', args: { id: 4, dx: 1e-9 } }];
    const nudged = { ...replay, inputs: [...replay.inputs, nudge].sort((x, y) => x[0] - y[0]) };
    const step = firstDifference(
      playReplay(replay, { checkpoints: 'every' }).hashes,
      playReplay(nudged, { checkpoints: 'every' }).hashes,
    );
    expect(step).toBe(138);
    const parting = partingOf(viewAt(replay, 138), viewAt(nudged, 138));
    expect(parting.entities[0]).toBe(4);
    expect(parting.fields.map((field) => field.path)).toContain('entities.4.mover.x');
  });

  it('judges runs against this platform, and on another platform against each other: "golden: other platform"', () => {
    const golden = { 0: 'a'.repeat(16), 60: 'b'.repeat(16) };
    const replay = { hashes: { 'linux-x64': golden } };
    expect(judgeRuns(replay, [golden, golden, golden], 'linux-x64')).toEqual({ golden: 'match' });
    expect(judgeRuns(replay, [golden, { ...golden, 60: 'c'.repeat(16) }], 'linux-x64')).toEqual({
      golden: 'mismatch',
      run: 1,
      step: 60,
    });
    expect(judgeRuns(replay, [{ 0: golden[0] }], 'linux-x64')).toEqual({ golden: 'mismatch', run: 0, step: 60 });
    expect(judgeRuns(replay, [golden, golden], 'darwin-arm64')).toEqual({
      golden: 'other platform',
      platforms: ['linux-x64'],
    });
    expect(judgeRuns(replay, [golden, { ...golden, 0: 'd'.repeat(16) }], 'darwin-arm64')).toEqual({
      golden: 'unstable',
      run: 1,
      step: 0,
    });
    expect(judgeRuns({ hashes: {} }, [golden, golden], 'linux-x64')).toEqual({ golden: 'none' });
  });

  it('runs a kernel replay twice on another platform and reports "golden: other platform"', () => {
    const path = join(import.meta.dirname, '../../tests/replays/kernel-crowd.replay.json');
    const replay = checkReplay(JSON.parse(readFileSync(path, 'utf8')));
    const runs = [playReplay(replay).hashes, playReplay(replay).hashes];
    expect(judgeRuns(replay, runs, 'plan9-mips')).toEqual({
      golden: 'other platform',
      platforms: Object.keys(replay.hashes),
    });
  });
});
