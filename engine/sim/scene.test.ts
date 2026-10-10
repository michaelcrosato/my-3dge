/**
 * @file Unit tests for engine/sim/scene.ts (T1): scenes register as entries of the kind `scene` with defaults filled,
 * their settings are schema-checked when defined and their actions must be functions; `startScene` layers the
 * caller's settings over the scene's over the defaults, seeds the world, runs `setup` under the fdlibm swap and the
 * scene's `step` first in the phase `intents`, and every start is a fresh world and settings store; an unknown id
 * names the closest. A session records setting changes made through its own store (set, setText, load, fromUrl,
 * reset, override) at their step, merged in play order, so its replay gives the live hashes; what no step has followed
 * yet waits; a dev action that throws is rolled back and not recorded; the session restores only its own captures,
 * unchanged, taking the recording back (or forward) with them, so its replay gives the live hash; seeds are whole.
 * @see engine/sim/scene.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { defineSettings } from '../core/settings';
import { inSimMath } from '../core/simMath';
import { checkReplay, playReplay } from './replay';
import { createSession, defineScene, getScene, isScene, startScene } from './scene';
import { defineComponent } from './state';

/** The message of the EngineError `fn` throws, after its code. */
function failure(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return `${error.code} ${error.message}`;
    throw error;
  }
  throw new Error('expected an EngineError');
}

/** A registry with two settings (one view) and a `dot` component. */
function setupRegistry() {
  const registry = createRegistry();
  defineSettings(
    {
      'demo.count': { type: 'integer', default: 1, minimum: 0, description: 'Dots.' },
      'demo.speed': { type: 'number', default: 1, description: 'Speed.' },
      'demo.look': { type: 'number', default: 0, view: true, description: 'A view knob.' },
    },
    registry,
  );
  defineComponent(
    'dot',
    { description: 'A dot.', fields: { x: { type: 'number', default: 0, description: 'X.' } } },
    registry,
  );
  return registry;
}

describe('defineScene', () => {
  it('registers a scene entry with its defaults filled', () => {
    const registry = setupRegistry();
    const scene = defineScene('demo', { setup: () => {} }, registry);
    expect(isScene(scene)).toBe(true);
    expect(scene).toMatchObject({ id: 'demo', kind: 'scene', description: '', settings: {}, actions: {} });
    expect(typeof scene.step).toBe('function');
    expect(getScene('demo', registry)).toBe(scene);
    expect(registry.describe('scene').ids).toEqual(['demo']);
    expect(isScene({ id: 'demo' })).toBe(false);
  });

  it('checks its settings against the schema and its actions, naming each problem', () => {
    const registry = setupRegistry();
    const bad = () =>
      defineScene('bad', { settings: { 'demo.cuont': 2, 'demo.speed': 'fast' }, setup: () => {} }, registry);
    const message = failure(bad);
    expect(message).toMatch(/^CORE_BAD_SPEC/);
    expect(message).toContain('"demo.cuont"');
    expect(message).toContain('demo.count');
    expect(message).toContain('demo.speed');
    const actions = { go: 'no' } as unknown as Record<string, () => void>;
    expect(failure(() => defineScene('worse', { setup: () => {}, actions }, registry))).toContain(
      'actions.go is not a function',
    );
    expect(failure(() => defineScene('none', {} as never, registry))).toContain('setup');
    defineScene('twice', { setup: () => {} }, registry);
    expect(failure(() => defineScene('twice', { setup: () => {} }, registry))).toMatch(/^CORE_DUPLICATE_ID/);
  });
});

describe('startScene', () => {
  it("layers the caller's settings over the scene's over the defaults, and seeds the world", () => {
    const registry = setupRegistry();
    defineScene('demo', { settings: { 'demo.count': 3, 'demo.speed': 2 }, setup: () => {} }, registry);
    const { world, settings } = startScene('demo', { seed: 9, registry, settings: { 'demo.speed': 5 } });
    expect([settings.get('demo.count'), settings.get('demo.speed'), world.settings.get('demo.speed')]).toEqual([
      3, 5, 5,
    ]);
    expect(world.seed).toBe(9);
    expect(startScene('demo', { registry }).world.seed).toBe(1);
    expect(failure(() => startScene('demo', { registry, settings: { 'demo.nope': 1 } }))).toMatch(/^CORE_BAD_SETTING/);
  });

  it('runs setup under the swap, then step first in the intents phase, every step', () => {
    const registry = setupRegistry();
    const order: string[] = [];
    defineScene(
      'order',
      {
        setup(w) {
          order.push(`setup ${inSimMath()}`);
          w.spawn({ dot: { x: 1 } });
          w.systems.add('late', () => order.push('late'), { phase: 'intents' });
          w.systems.add('think', () => order.push('think'), { phase: 'ai' });
        },
        step(w, intents) {
          order.push(`step ${String(intents.cam)} ${w.count}`);
        },
      },
      registry,
    );
    const { world } = startScene('order', { registry });
    world.step({ cam: 0.5 });
    expect(order).toEqual(['setup true', 'step 0.5 1', 'late', 'think']);
    expect(world.systems.list().map((system) => system.name)).toEqual(['scene', 'late', 'think']);
  });

  it('makes a fresh world and settings store on every start', () => {
    const registry = setupRegistry();
    defineScene('fresh', { setup: (w) => w.spawn({ dot: {} }) }, registry);
    const a = startScene('fresh', { registry });
    a.settings.set('demo.count', 4);
    a.world.spawn({ dot: {} });
    const b = startScene('fresh', { registry });
    expect([a.world.count, b.world.count, b.settings.get('demo.count')]).toEqual([2, 1, 1]);
    expect(b.world.hash()).not.toBe(a.world.hash());
    expect(startScene(getScene('fresh', registry), { registry }).world.hash()).toBe(b.world.hash());
  });

  it('names the closest scene for an unknown id', () => {
    const registry = setupRegistry();
    defineScene('kernel', { setup: () => {} }, registry);
    expect(failure(() => startScene('kernal', { registry }))).toMatch(/^CORE_NO_ENTRY.*kernel/);
  });
});

type Dots = { dot: { x: number } };

/** A registry with a scene `drift`: three dots drift by `demo.speed` and `move`, with sin; dev actions shove and botch. */
function driftRegistry() {
  const registry = setupRegistry();
  defineScene<Dots>(
    'drift',
    {
      setup: (w) => [0, 1, 2].forEach((x) => w.spawn({ dot: { x } })),
      step(w, intents) {
        const speed = w.settings.get<number>('demo.speed') + (intents.move?.[1] ?? 0);
        for (const e of w.query('dot')) e.dot.x += (speed + 0.1 * Math.sin(e.dot.x)) * w.dt;
      },
      actions: {
        shove: (w, args) => void (w.get((args as { id: number }).id)!.dot!.x += 1),
        botch(w) {
          w.get(1)!.dot!.x = 99;
          w.spawn({ dot: {} });
          w.rng('spawn').next();
          throw new Error('botched halfway');
        },
      },
    },
    registry,
  );
  return registry;
}

describe('createSession', () => {
  it('records setting changes made through its own store: set, setText, load, fromUrl, reset, override', () => {
    const registry = driftRegistry();
    const live = createSession('drift', { seed: 4, registry, settings: { 'demo.speed': 2 } });
    const hashes: Record<string, string> = { 0: live.world.hash() };
    let layer: { dispose(): void } | undefined;
    for (let k = 0; k < 120; k++) {
      if (k === 30) live.settings.set('demo.speed', 3);
      if (k === 30) live.settings.set('demo.look', 7);
      if (k === 45) live.settings.setText('demo.speed', '5');
      if (k === 50) live.settings.load({ 'demo.speed': 2.5 });
      if (k === 60) live.settings.fromUrl('?demo.speed=4');
      if (k === 70) live.settings.reset();
      if (k === 80) layer = live.settings.override({ 'demo.speed': 6 });
      if (k === 90) layer?.dispose();
      if (k === 100) live.settings.set('demo.speed', 9);
      if (k === 100) live.settings.set('demo.speed', 1);
      live.step({ move: [0, 1] });
      hashes[k + 1] = live.world.hash();
    }
    const replay = live.record();
    const speed = (value: number) => ({ set: { 'demo.speed': value } });
    expect(replay.settings).toEqual({ 'demo.speed': 2 });
    expect(replay.inputs).toEqual([
      [0, { move: [0, 1] }],
      [30, speed(3)],
      [45, speed(5)],
      [50, speed(2.5)],
      [60, speed(4)],
      [70, speed(1)],
      [80, speed(6)],
      [90, speed(1)],
    ]);
    const played = playReplay(JSON.parse(JSON.stringify(replay)), { registry, checkpoints: 'every' });
    expect(played.hashes).toEqual(hashes);
    expect(played.session.record()).toEqual(replay);
  });

  it("merges its store's changes in play order, and leaves out what no step has followed yet", () => {
    const live = createSession('drift', { registry: driftRegistry() });
    live.settings.set('demo.speed', 2);
    live.act('shove', { id: 1 });
    live.settings.set('demo.speed', 4);
    live.step({ move: [0, 1] });
    live.step({ move: [0, 1] });
    live.settings.set('demo.speed', 7);
    live.set('demo.speed', 8);
    live.act('shove', { id: 2 });
    const replay = live.record();
    expect(replay.inputs).toEqual([
      [0, { set: { 'demo.speed': 2 }, dev: 'shove', args: { id: 1 } }],
      [0, { set: { 'demo.speed': 4 }, move: [0, 1] }],
    ]);
    expect(checkReplay(replay)).toBe(replay);
    live.step({ move: [0, 1] });
    expect(live.record().inputs.slice(2)).toEqual([[2, { set: { 'demo.speed': 8 }, dev: 'shove', args: { id: 2 } }]]);
  });

  it('runs a dev action all or nothing: one that throws leaves the world as it was and records nothing', () => {
    const registry = driftRegistry();
    const live = createSession('drift', { seed: 4, registry });
    for (let k = 0; k < 5; k++) live.step({ move: [0, 1] });
    const before = live.world.hash();
    expect(() => live.act('botch')).toThrow('botched halfway');
    expect([live.world.hash(), live.world.count]).toEqual([before, 3]);
    expect(failure(() => live.act('shvoe'))).toMatch(/^SIM_NO_ACTION.*"shvoe" \(did you mean "shove"\?\)/);
    expect(failure(() => live.act('poke'))).toMatch(/"poke" \(its actions: "botch", "shove"\)/);
    live.step({ move: [0, 1] });
    const replay = live.record();
    expect(replay.inputs.some(([, change]) => change.dev !== undefined)).toBe(false);
    expect(playReplay(replay, { registry, checkpoints: 'every' }).hashes[6]).toBe(live.world.hash());
  });
});

describe('captures through the session', () => {
  /** The hash a session's record() replays to at its last step. */
  const replayed = (live: ReturnType<typeof createSession>, registry: ReturnType<typeof driftRegistry>) => {
    const replay = live.record();
    return playReplay(replay, { registry, checkpoints: [replay.steps] }).hashes[replay.steps];
  };

  it('restores its own captures with the recording, back or forward, so record() replays the run as it stands', () => {
    const registry = driftRegistry();
    const live = createSession('drift', { seed: 4, registry });
    const steps = (n: number, move: [number, number]) => {
      for (let k = 0; k < n; k++) live.step({ move });
    };
    steps(10, [0, 1]);
    live.set('demo.speed', 3);
    const at10 = live.capture();
    live.set('demo.speed', 5); // merged into the change-point at step 10 after the capture: restoring drops it
    steps(30, [1, 0]);
    const at40 = live.capture();
    live.restore(at10); // back to an earlier step
    expect([live.steps, live.world.tick, live.settings.get('demo.speed')]).toEqual([10, 10, 3]);
    steps(5, [0, -1]);
    expect(live.record().inputs).toEqual([
      [0, { move: [0, 1] }],
      [10, { set: { 'demo.speed': 3 }, move: [0, -1] }],
    ]);
    expect(replayed(live, registry)).toBe(live.world.hash());
    live.restore(at40); // forward again, to a step the run reached before
    live.restore(at40); // at the current step: a capture restores any number of times
    steps(5, [0, 1]);
    expect(live.record().inputs).toEqual([
      [0, { move: [0, 1] }],
      [10, { set: { 'demo.speed': 5 }, move: [1, 0] }],
      [40, { move: [0, 1] }],
    ]);
    expect(replayed(live, registry)).toBe(live.world.hash());
  });

  it('refuses a capture it did not take, or one changed since, naming the fix; nothing changes', () => {
    const registry = driftRegistry();
    const live = createSession('drift', { seed: 4, registry });
    live.step({ move: [0, 1] });
    const edited = live.capture() as unknown as { entities: { dot: { x: number } }[] };
    edited.entities[0].dot.x += 5;
    const before = live.world.hash();
    expect(failure(() => live.restore(edited as never))).toMatch(
      /^SIM_EDITED_CAPTURE .*took at step 1 was changed since.*session\.act/,
    );
    const other = createSession('drift', { seed: 4, registry });
    other.step({ move: [0, 1] });
    expect(failure(() => live.restore(other.capture()))).toMatch(/^SIM_FOREIGN_CAPTURE .*did not take/);
    expect(failure(() => live.restore(live.world.capture()))).toMatch(/^SIM_FOREIGN_CAPTURE /);
    const own = live.capture();
    expect(failure(() => live.restore(JSON.parse(JSON.stringify(own))))).toMatch(/^SIM_FOREIGN_CAPTURE /);
    expect([live.world.hash(), live.steps]).toEqual([before, 1]);
    live.restore(own);
    live.step({ move: [0, 1] });
    expect(replayed(live, registry)).toBe(live.world.hash());
  });

  it('records only whole seeds from 0, which a replay can hold', () => {
    const registry = driftRegistry();
    expect(failure(() => createSession('drift', { seed: 2.5, registry }))).toMatch(
      /^SIM_BAD_SEED .*createSession\(scene, \{ seed \}\) got the seed 2\.5/,
    );
    expect(failure(() => createSession('drift', { seed: -1, registry }))).toMatch(/^SIM_BAD_SEED /);
    expect(createSession('drift', { seed: 0, registry }).record().seed).toBe(0);
  });
});
