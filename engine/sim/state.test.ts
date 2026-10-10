/**
 * @file Unit tests for engine/sim/state.ts (T1): component kinds validated on declaration, the hash independent of
 * key and spawn-call order but not of ids, fields read in declared order, undeclared components and fields and
 * non-canonical values refused with the entity named, view settings and visual streams left out, `hashState` of
 * `state()` equal to `hash()`, `trace()` naming the entity, and `diffStates` naming the field.
 * @see engine/sim/state.ts
 */
import { describe, expect, it } from 'vitest';
import { Fnv64 } from '../core/hash';
import { Vector3 } from '../core/math';
import { createLog, EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { componentTable, defineComponent, diffStates, hashState, traceState } from './state';
import { createWorld } from './world';

/** The code of the EngineError `fn` throws. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  throw new Error('expected an EngineError');
}

/** A registry with `body` (two numbers, an optional note) and `team`, plus one sim and one view setting. */
function makeRegistry() {
  const registry = createRegistry();
  defineComponent(
    'body',
    {
      description: 'A test body.',
      fields: {
        mass: { type: 'number', default: 1, description: 'Kilograms.' },
        speed: { type: 'number', default: 0, description: 'Metres per second.' },
        note: { type: 'string', description: 'Optional.' },
        dir: { type: 'any', default: [0, 0, 1], description: 'A direction.' },
      },
    },
    registry,
  );
  defineComponent(
    'team',
    { description: 'A side.', fields: { side: { type: 'integer', default: 0, description: 'Which.' } } },
    registry,
  );
  defineSettings(
    {
      'demo.gravity': { type: 'number', default: -30, description: 'Sim gravity.' },
      'demo.bloom': { type: 'number', default: 1, view: true, description: 'A look.' },
    },
    registry,
  );
  return registry;
}

/** A world over `registry`, with a quiet log. */
function makeWorld(registry = makeRegistry(), seed = 5) {
  const settings = createSettings({ registry });
  const log = createLog({ console: { warn: () => {}, error: () => {} } });
  return { w: createWorld({ seed, registry, settings, log }), settings };
}

describe('component kinds', () => {
  it('validate their names and fields when declared', () => {
    const registry = createRegistry();
    const field = { type: 'number', default: 0, description: 'A number.' } as const;
    expect(codeOf(() => defineComponent('Body', { description: 'x', fields: { a: field } }, registry))).toBe(
      'CORE_BAD_SPEC',
    );
    expect(() => defineComponent('id', { description: 'x', fields: { a: field } }, registry)).toThrow(/other than/);
    const hook = { type: 'function', default: () => 0, description: 'A hook.' } as const;
    expect(() => defineComponent('aim', { description: 'x', fields: { onHit: hook } }, registry)).toThrow(
      /onHit is a hook/,
    );
    const bad = { type: 'number', minimum: 2, default: 1, description: 'Out of range.' } as const;
    expect(codeOf(() => defineComponent('aim', { description: 'x', fields: { a: bad } }, registry))).toBe(
      'CORE_BAD_SPEC',
    );
    const kind = defineComponent('aim', { description: 'Where it points.', fields: { a: field } }, registry);
    expect([kind.id, kind.kind, Object.keys(kind.fields)]).toEqual(['aim', 'component', ['a']]);
    expect(registry.describe('component').ids).toEqual(['aim']);
    expect(componentTable(registry).fields('aim')).toEqual(['a']);
  });
});

describe('the hash', () => {
  it('ignores key order and Map order, but not ids, values, -0 or an absent field', () => {
    const one = makeWorld().w;
    one.spawn({ body: { speed: 2, mass: 3 }, team: { side: 1 } });
    one.spawn({ team: { side: 2 } });
    const two = makeWorld().w;
    two.spawn({ team: { side: 1 }, body: { mass: 3, speed: 2 } });
    two.spawn({ team: { side: 2 } });
    expect(two.hash()).toBe(one.hash());
    const shifted = makeWorld().w;
    shifted.despawn(shifted.spawn({}));
    shifted.spawn({ body: { speed: 2, mass: 3 }, team: { side: 1 } });
    shifted.spawn({ team: { side: 2 } });
    expect(shifted.hash()).not.toBe(one.hash()); // same components, other ids
    const base = one.hash();
    one.get(1)!.body!.speed = -0;
    const negativeZero = one.hash();
    one.get(1)!.body!.speed = 0;
    expect(new Set([base, negativeZero, one.hash()]).size).toBe(3);
    one.get(1)!.body!.note = 'hi';
    expect(one.hash()).not.toBe(base);
  });

  it("feeds numbers and component names with exactly the bytes of Fnv64.value (the fast path's assumption)", () => {
    for (const x of [0, -0, 1.5, -1e300, Number.NaN]) {
      expect(new Fnv64().byte(3).number(x).hex()).toBe(new Fnv64().value(x).hex());
    }
    expect(new Fnv64().byte(4).uint32(8).string('position').hex()).toBe(new Fnv64().value('position').hex());
    const registry = makeRegistry();
    const view = {
      ...makeWorld(registry).w.state(),
      entities: [{ id: 1, body: { mass: 2, speed: -0, note: 'é', dir: [1, 2] } }],
    };
    const slow = new Fnv64().value('my3dge-state/1').value('world').number(view.seed).number(view.nextId);
    slow.value('entities').uint32(1).number(1).uint32(1).value('body');
    for (const value of [2, -0, 'é', [1, 2]]) slow.value(value);
    slow
      .value('timers')
      .value(view.timers as never)
      .value('settings')
      .value(view.settings as never);
    slow.value('rng').value(view.rng);
    expect(hashState(view, componentTable(registry))).toBe(slow.hex());
  });

  it('reads fields in declared order, so swapping two values changes it', () => {
    const { w } = makeWorld();
    w.spawn({ body: { mass: 1, speed: 2 } });
    const before = w.hash();
    Object.assign(w.get(1)!.body!, { mass: 2, speed: 1 });
    expect(w.hash()).not.toBe(before);
  });

  it('refuses undeclared components and fields and non-canonical values, naming the entity', () => {
    const { w } = makeWorld();
    w.spawn({ body: {} });
    const entity = w.get(1)! as unknown as Record<string, unknown> & { body: Record<string, unknown> };
    entity.body.sped = 1;
    expect(() => w.hash()).toThrow(/entity 1 has body\.sped.*did you mean "speed"/);
    delete entity.body.sped;
    entity.body.dir = new Map();
    expect(() => w.hash()).toThrow(/entity 1's body\.dir is a Map/);
    entity.body.dir = new Vector3(0, 1, 0); // three.js math classes are canonical
    const withVector = w.hash();
    entity.body.dir = [0, 1, 0];
    expect(w.hash()).toBe(withVector);
    entity.armor = { plates: 2 };
    expect(codeOf(() => w.hash())).toBe('SIM_UNKNOWN_COMPONENT');
  });

  it('leaves out view settings and visual streams, and covers sim settings and sim streams', () => {
    const { w, settings } = makeWorld();
    w.spawn({ body: {} });
    const base = w.hash();
    settings.set('demo.bloom', 4);
    for (let i = 0; i < 50; i++) w.fxRng('sparks', i % 3).next();
    expect(w.hash()).toBe(base);
    expect(w.state().settings).toEqual({ 'demo.gravity': -30 }); // no time.hz: this registry lacks it
    settings.set('demo.gravity', -9.8);
    const gravity = w.hash();
    expect(gravity).not.toBe(base);
    w.rng('ai').next();
    expect(w.hash()).not.toBe(gravity);
  });

  it('equals hashState of state(), whose copy shares nothing with the world', () => {
    const registry = makeRegistry();
    const { w } = makeWorld(registry);
    w.spawn({ body: { dir: [1, 0, 0] }, team: {} });
    w.timers.after(1, () => {});
    const state = w.state();
    expect(hashState(state, componentTable(registry))).toBe(w.hash());
    (state.entities[0].body as { dir: number[] }).dir[0] = 9;
    expect(w.get(1)!.body!.dir).toEqual([1, 0, 0]);
    expect(state.timers).toEqual({ ticks: 0, nextId: 2, timers: [[1, 60, 0]] });
  });
});

describe('trace and diff', () => {
  it('name the part, the entity and the field where two states part', () => {
    const registry = makeRegistry();
    const a = makeWorld(registry).w;
    const b = makeWorld(registry).w;
    for (const w of [a, b]) [1, 2, 3].forEach((side) => w.spawn({ team: { side }, body: {} }));
    b.get(2)!.body!.speed = 0.5;
    const [ta, tb] = [a.trace(), b.trace()];
    expect(ta.hash).toBe(a.hash());
    expect(Object.keys(ta.parts)).toEqual(['world', 'entities', 'timers', 'settings', 'rng']);
    expect(Object.keys(ta.parts).filter((part) => ta.parts[part] !== tb.parts[part])).toEqual(['entities']);
    expect(Object.keys(ta.entities).filter((id) => ta.entities[+id] !== tb.entities[+id])).toEqual(['2']);
    expect(diffStates(a.state(), b.state())).toEqual([{ path: 'entities.2.body.speed', a: 0, b: 0.5 }]);
    b.despawn(3);
    expect(diffStates(a.state(), b.state()).map((d) => d.path)).toEqual(['entities.2.body.speed', 'entities.3']);
    expect(traceState(a.state(), 0, componentTable(registry)).hash).toBe(a.hash());
  });

  it('diffs settings keys, timers and lists by path', () => {
    const view = {
      seed: 1,
      nextId: 1,
      entities: [],
      timers: { ticks: 0, nextId: 1, timers: [] as [number, number, number][] },
      settings: { 'time.hz': 60 },
      rng: {},
    };
    const other = { ...view, settings: { 'time.hz': 30 }, timers: { ticks: 0, nextId: 2, timers: [[1, 5, 0]] } };
    expect(diffStates(view, other as typeof view).map((d) => d.path)).toEqual([
      'timers.nextId',
      'timers.timers[0]',
      'settings["time.hz"]',
    ]);
  });
});
