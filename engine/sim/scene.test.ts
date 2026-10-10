/**
 * @file Unit tests for engine/sim/scene.ts (T1): scenes register as entries of the kind `scene` with defaults filled,
 * their settings are schema-checked when defined and their actions must be functions; `startScene` layers the
 * caller's settings over the scene's over the defaults, seeds the world, runs `setup` under the fdlibm swap and the
 * scene's `step` first in the phase `intents`, and every start is a fresh world and settings store; an unknown id
 * names the closest.
 * @see engine/sim/scene.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { defineSettings } from '../core/settings';
import { inSimMath } from '../core/simMath';
import { defineScene, getScene, isScene, startScene } from './scene';
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
