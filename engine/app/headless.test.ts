/**
 * @file Unit tests for engine/app/headless.ts (T1, PLAN.md §8.3, §6.9, WP 1.6): `createHeadless` starts a scene by id
 * or as a scene, seeded, with settings over the scene's; `step(n, intents)` runs n recorded steps, holding one intents
 * object (its presses on the first step only) or following a script; the recording replays to the same hashes; the
 * kernel fixture gives the same hash through it as through a plain session; a test registry gets the clock's
 * settings; `headlessHost` takes only a headless engine.
 * @see engine/app/headless.ts
 */
import { describe, expect, it } from 'vitest';
import kernel from '../../fixtures/scenes/kernel';
import { EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { defineSettings } from '../core/settings';
import { held, pressed } from '../input/intents';
import { playReplay } from '../sim/replay';
import { createSession, defineScene } from '../sim/scene';
import { defineComponent } from '../sim/state';
import { createHeadless, headlessHost } from './headless';

/** A registry with a `walker` component, a setting and a scene that counts held and pressed `jump`s. */
function demo() {
  const registry = createRegistry();
  defineSettings({ 'demo.step': { type: 'number', default: 1, description: 'Metres a held move adds.' } }, registry);
  const fields = {
    x: { type: 'number', default: 0, description: 'East.' },
    held: { type: 'integer', default: 0, description: 'Steps jump was held.' },
    pressed: { type: 'integer', default: 0, description: 'Steps jump was pressed.' },
  } as const;
  defineComponent('walker', { description: 'Walks.', fields }, registry);
  defineScene(
    'walk',
    {
      setup: (w) => void w.spawn({ walker: {} }),
      step(w, intents) {
        for (const e of w.query('walker')) {
          const walker = e.walker as { x: number; held: number; pressed: number };
          walker.x += (intents.move?.[0] ?? 0) * w.settings.get<number>('demo.step') + w.rng('walk').next();
          if (held(intents, 'jump')) walker.held++;
          if (pressed(intents, 'jump')) walker.pressed++;
        }
      },
    },
    registry,
  );
  return registry;
}

describe('createHeadless', () => {
  it('starts a scene by id, seeded, with settings over the scene', async () => {
    const engine = await createHeadless({ scene: 'walk', seed: 5, settings: { 'demo.step': 2 }, registry: demo() });
    expect(engine.info()).toMatchObject({ scene: 'walk', seed: 5, tick: 0, runtime: 'node', headless: true });
    const { session } = headlessHost(engine);
    expect(session.settings.get('demo.step')).toBe(2);
    expect(session.record().settings).toEqual({ 'demo.step': 2 });
  });

  it('holds one intents object for n steps, its presses on the first only, and follows a script', async () => {
    const engine = await createHeadless({ scene: 'walk', registry: demo() });
    expect(engine.step(3, { move: [1, 0], b: ['jump'], p: ['dash'] })).toBe(3);
    expect(engine.get(1)?.walker).toMatchObject({ held: 3, pressed: 1 });
    expect(engine.step(2, [{ b: ['jump'] }, {}])).toBe(5);
    expect(engine.step(2, [{ p: ['jump'] }])).toBe(7);
    expect(engine.get(1)?.walker).toMatchObject({ held: 4, pressed: 2 });
    const { session } = headlessHost(engine);
    expect(session.record().inputs).toEqual([
      [0, { move: [1, 0], b: ['jump'], p: ['dash'] }], // a press implied by b is not written
      [3, { move: null }],
      [4, { b: null }],
      [5, { p: ['jump'] }],
    ]);
  });

  it('records the run, which replays to the same hashes', async () => {
    const registry = demo();
    const engine = await createHeadless({ scene: 'walk', seed: 2, registry });
    engine.step(30, { move: [0.5, 0] });
    engine.set('demo.step', 3);
    engine.step(30, [{ b: ['jump'] }]);
    const replay = { ...headlessHost(engine).session.record(), hashes: { here: { 60: engine.hash() } } };
    expect(playReplay(replay, { registry }).hashes).toEqual({ 60: engine.hash() });
  });

  it('runs the kernel fixture to the hash a plain session gives (x sim runs through it)', async () => {
    const engine = await createHeadless({ scene: kernel, seed: 3, settings: { 'kernel.movers': 4 } });
    engine.step(240);
    const session = createSession(kernel, { seed: 3, settings: { 'kernel.movers': 4 } });
    for (let k = 0; k < 240; k++) session.step({});
    expect(engine.hash()).toBe(session.world.hash());
  });

  it("gives a test registry the clock's settings, and headlessHost takes only a headless engine", async () => {
    const registry = createRegistry();
    const scene = defineScene('empty', { setup: () => {} }, registry);
    const engine = await createHeadless({ scene, registry });
    expect(registry.has('setting', 'time.scale')).toBe(true);
    expect(engine.timeScale(3)).toBe(3);
    expect(() => headlessHost({} as typeof engine)).toThrow(EngineError);
    expect(() => headlessHost({} as typeof engine)).toThrow(/APP_NOT_HEADLESS/);
  });
});
