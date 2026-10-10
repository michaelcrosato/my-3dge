/**
 * @file Unit tests for engine/sim/capture.ts and the world's capture, restore and hash (T1), on a demo world whose
 * systems steer with `Math.sin`, `Math.cos` and `Math.pow`, spawn and despawn from seeded streams, and run timers and
 * events: every captured field changes the hash when changed alone (components, timers, settings except view ones,
 * RNG states, seed, next id), and a changed step rate or schedule is refused; capture → restore → steps equal the
 * uninterrupted steps, hash by hash; a capture without timers survives `serialize` into a fresh world; callbacks
 * never travel (`SIM_NO_CALLBACKS`); malformed captures are refused before anything changes; the physics hook is
 * hashed, captured and restored; the golden hash holds; and `cloneData` copies plain data, typed arrays and math
 * classes, refusing the rest. engine/sim/restore.test.ts covers listeners, systems and the checks against the world.
 * @see engine/sim/capture.ts
 */
import { describe, expect, it } from 'vitest';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createLog, EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { Vector3 } from '../core/math';
import { inSimMath } from '../core/simMath';
import { TIME_SETTINGS } from '../core/time';
import { cloneData, type WorldCapture } from './capture';
import { defineComponent, type PhysicsHook } from './state';
import { createWorld, type World } from './world';

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

type Demo = {
  position: { x: number; y: number; z: number };
  mover: { phase: number; speed: number; name: string; path: number[]; mood: { calm: boolean } };
  life: { left: number };
};

/** One field description. */
const num = (description: string, extra = {}) => ({ type: 'number', default: 0, description, ...extra }) as const;

/** The demo's registry: three component kinds, the time settings and four demo settings (one view). */
function demoRegistry() {
  const registry = createRegistry();
  defineSettings(TIME_SETTINGS, registry);
  defineSettings(
    {
      'demo.speed': num('Mover speed.', { default: 1.5 }),
      'demo.label': { type: 'string', default: 'box', description: 'A label.' },
      'demo.wobble': { type: 'boolean', default: true, description: 'Whether movers wobble.' },
      'demo.look': num('A view-only knob.', { view: true }),
    },
    registry,
  );
  const fields = { x: num('East.'), y: num('Up.'), z: num('North.') };
  defineComponent('position', { description: 'Where.', fields }, registry);
  defineComponent(
    'mover',
    {
      description: 'A scripted mover.',
      fields: {
        phase: num('Steering phase.'),
        speed: num('Speed.'),
        name: { type: 'string', default: '', description: 'A name.' },
        path: { type: 'array', items: { type: 'number' }, default: [], description: 'Ticks it pulsed at.' },
        mood: {
          type: 'object',
          properties: { calm: { type: 'boolean', default: true, description: 'Calm.' } },
          default: { calm: true },
          description: 'Its mood.',
        },
      },
    },
    registry,
  );
  defineComponent('life', { description: 'Ticks left.', fields: { left: num('Ticks.') } }, registry);
  return registry;
}

/** Spawns one mover from the `spawn` stream. */
function spawnMover(w: World<Demo>): number {
  const r = w.rng('spawn');
  const position = { x: r.range(-5, 5), y: r.range(0, 2), z: 0 };
  const mover = { phase: r.range(0, 6.28), speed: w.settings.get<number>('demo.speed'), name: `m${r.int(0, 99)}` };
  return w.spawn({ position, mover, life: { left: r.int(30, 240) } });
}

/** The demo world: steering on float64 state through sin, cos and pow, seeded spawns, despawns, timers and events. */
function demo(seed = 7, registry = demoRegistry(), physics?: PhysicsHook) {
  const settings = createSettings({ registry });
  const log = createLog({ console: { warn: () => {}, error: () => {} } });
  const w = createWorld<Demo>({ seed, registry, settings, log, physics });
  w.systems.add(
    'steer',
    (w) => {
      for (const e of w.query('position', 'mover')) {
        e.position.x += Math.sin(e.mover.phase) * e.mover.speed * w.dt;
        e.position.z = Math.cos(e.mover.phase + e.position.x) * 2;
        e.mover.phase += Math.pow(1.01, e.position.y) * w.dt;
        if (w.settings.get('demo.wobble')) e.position.y += (w.rng.entity(e.id, 'wobble').next() - 0.5) * 0.01;
      }
    },
    { phase: 'ai' },
  );
  w.systems.add('age', (w) => {
    for (const e of w.query('life')) if (--e.life.left <= 0) w.despawn(e.id);
  });
  w.systems.add('spawner', (w) => {
    if (w.rng('spawn').chance(0.08)) spawnMover(w);
  });
  w.events.on('pulse', () => {
    const [first] = w.query('mover');
    if (first) first.mover.path.push(w.tick);
  });
  w.run((w) => {
    for (let i = 0; i < 8; i++) spawnMover(w);
    w.timers.every(0.25, () => w.emit('pulse', null));
    w.timers.after(1, () => spawnMover(w));
  });
  return { w, settings, registry };
}

/** Steps `w` `n` times and returns the hash after each step. */
function hashes(w: World<Demo>, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    w.step();
    out.push(w.hash());
  }
  return out;
}

/** Every leaf of `value`: its parent, key and path. */
function leaves(
  value: unknown,
  path = '',
): { parent: Record<string | number, unknown>; key: string | number; path: string }[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const at = Array.isArray(value) ? Number(key) : key;
    const where = `${path}${Array.isArray(value) ? `[${key}]` : `.${key}`}`;
    if (item !== null && typeof item === 'object') return leaves(item, where);
    return [{ parent: value as Record<string | number, unknown>, key: at, path: where }];
  });
}

/** Another value of a leaf's type. */
function changed(value: unknown): unknown {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  return `${String(value)}x`;
}

describe('the hash covers every captured field', () => {
  it('changes when any one captured field changes, and comes back when it is put back', () => {
    const { w } = demo();
    hashes(w, 50);
    const capture = w.capture();
    const base = w.hash();
    const tested = leaves(capture).filter(
      (leaf) => leaf.path !== '.format' && !/^\.entities\[\d+\]\.id$/.test(leaf.path),
    );
    const unchanged: string[] = [];
    const refused: string[] = [];
    for (const { parent, key, path } of tested) {
      const original = parent[key];
      parent[key] = changed(original);
      if (path === '.hz' || path.startsWith('.schedule.')) {
        expect(codeOf(() => w.restore(capture))).toBe('SIM_BAD_CAPTURE'); // the world's own rate and code
        refused.push(path);
      } else {
        w.restore(capture);
        if (w.hash() === base) unchanged.push(path);
      }
      parent[key] = original;
    }
    expect(unchanged).toEqual([]);
    expect(refused).toEqual([
      '.hz',
      '.schedule.systems[0]',
      '.schedule.systems[1]',
      '.schedule.systems[2]',
      '.schedule.listeners[0]',
    ]);
    expect(capture.schedule).toEqual({ systems: ['ai:steer', 'rules:age', 'rules:spawner'], listeners: ['pulse'] });
    const parts = new Set(tested.map((leaf) => leaf.path.split(/[.[]/)[1]));
    expect([...parts].sort()).toEqual(['entities', 'hz', 'nextId', 'rng', 'schedule', 'seed', 'settings', 'timers']);
    expect(tested.length).toBeGreaterThan(100);
    w.restore(capture);
    expect(w.hash()).toBe(base);
  });

  it('covers the step rate: a world made at another time.hz hashes differently', () => {
    const registry = demoRegistry();
    const settings = createSettings({ registry });
    const at60 = createWorld({ registry, settings }).hash();
    settings.set('time.hz', 30);
    const at30 = createWorld({ registry, settings });
    expect(at30.hz).toBe(30);
    expect(at30.hash()).not.toBe(at60);
  });

  it('leaves view settings out of captures and the hash', () => {
    const { w, settings } = demo();
    hashes(w, 10);
    const base = w.hash();
    settings.set('demo.look', 3);
    expect(w.hash()).toBe(base);
    expect(Object.keys(w.capture().settings)).not.toContain('demo.look');
    expect(Object.keys(w.capture().settings)).toContain('time.hz');
  });

  it('is unchanged by drawing from visual streams, step after step', () => {
    const plain = demo().w;
    const noisy = demo().w;
    noisy.systems.add('sparks', (w) => {
      for (const e of w.query('mover')) w.fxRng('sparks', e.id).next();
    });
    expect(hashes(noisy, 120)).toEqual(hashes(plain, 120));
  });

  it('holds its golden value and is the same on every run', () => {
    const runs = [demo().w, demo().w].map((w) => hashes(w, 300).at(-1));
    expect(runs[0]).toBe(runs[1]);
    expect(runs[0]).toBe('505bcec7400b4883'); // my3dge-state/3: timers hold start and firings (else as /2's fdae537c20bfa5c0)
  });
});

describe('capture and restore', () => {
  it('continue exactly like the uninterrupted run, hash by hash', () => {
    const { w } = demo();
    hashes(w, 40);
    const capture = w.capture();
    const first = hashes(w, 80);
    const finalState = w.state();
    w.restore(capture);
    expect(hashes(w, 80)).toEqual(first);
    expect(w.state()).toEqual(finalState);
    const straight = demo().w;
    expect(hashes(straight, 120).slice(40)).toEqual(first);
    w.restore(capture); // a capture restores any number of times
    expect(hashes(w, 80)).toEqual(first);
  });

  it('survive serialize into a fresh world when no timers are pending', () => {
    const registry = demoRegistry();
    const make = () => {
      const settings = createSettings({ registry });
      const w = createWorld<Demo>({ seed: 3, registry, settings });
      w.systems.add('drift', (w) => {
        for (const e of w.query('position')) e.position.x += Math.sin(w.time + e.id) * w.rng('drift').next();
      });
      return { w, settings };
    };
    const { w, settings } = make();
    for (let i = 0; i < 5; i++) spawnMover(w);
    settings.set('demo.speed', 2.25);
    hashes(w, 30);
    const text = serialize(w.capture() as unknown as Canonical);
    const reference = hashes(w, 30);
    const fresh = make();
    fresh.w.restore(deserialize(text) as unknown as WorldCapture);
    expect(fresh.settings.get('demo.speed')).toBe(2.25);
    expect(hashes(fresh.w, 30)).toEqual(reference);
  });

  it('never move timer callbacks: serialized, into another world, or after the timer list changed', () => {
    const registry = demoRegistry();
    const { w } = demo(7, registry);
    const capture = w.capture();
    const copy = deserialize(serialize(capture as unknown as Canonical)) as unknown as WorldCapture;
    expect(() => w.restore(copy)).toThrow(/2 pending timers, whose callbacks are not in it/);
    expect(() => demo(7, registry).w.restore(capture)).toThrow(/belong to the world that made it/);
    (capture.timers.timers as unknown[]).pop();
    expect(codeOf(() => w.restore(capture))).toBe('SIM_NO_CALLBACKS');
  });

  it('refuse a malformed capture before anything changes', () => {
    const { w } = demo();
    hashes(w, 5);
    const good = w.capture();
    const base = w.hash();
    const bad = (change: Record<string, unknown>) => codeOf(() => w.restore({ ...good, ...change } as WorldCapture));
    expect(bad({ format: 'my3dge-capture/0' })).toBe('SIM_BAD_CAPTURE');
    expect(bad({ nextId: 0 })).toBe('SIM_BAD_CAPTURE');
    expect(bad({ entities: [...good.entities].reverse() })).toBe('SIM_BAD_CAPTURE');
    expect(bad({ entities: [{ id: 1, armor: {} }] })).toBe('SIM_UNKNOWN_COMPONENT');
    expect(bad({ entities: [{ id: 1, position: 3 }] })).toBe('SIM_BAD_CAPTURE');
    expect(bad({ rng: { '["ai"]': 0.5 } })).toBe('SIM_BAD_CAPTURE');
    expect(bad({ physics: new Uint8Array(4) })).toBe('SIM_BAD_CAPTURE');
    expect(codeOf(() => w.restore(null as unknown as WorldCapture))).toBe('SIM_BAD_CAPTURE');
    expect(w.hash()).toBe(base);
  });
});

describe('the physics hook', () => {
  it('is hashed, captured and restored inside the swap, and required on both sides', () => {
    const bodies = new Float64Array([0, 1, 0, 0, 0, 0, 1]);
    const calls: string[] = [];
    const hook: PhysicsHook = {
      state: () => bodies,
      capture: () => (calls.push(`capture ${inSimMath()}`), { bytes: bodies.slice() }),
      restore: (data) => {
        calls.push(`restore ${inSimMath()}`);
        bodies.set((data as { bytes: Float64Array }).bytes);
      },
    };
    const { w } = demo(7, demoRegistry(), hook);
    w.systems.add('fall', () => (bodies[1] -= 0.01), { phase: 'physics' });
    hashes(w, 10);
    const capture = w.capture();
    const base = w.hash();
    bodies[3] = 2;
    expect(w.hash()).not.toBe(base);
    w.restore(capture);
    expect(w.hash()).toBe(base);
    expect(calls).toEqual(['capture true', 'restore true']);
    expect(w.state().physics).toEqual(bodies);
    const { physics: _physics, ...without } = capture;
    expect(codeOf(() => w.restore(without as WorldCapture))).toBe('SIM_BAD_CAPTURE');
  });
});

describe('cloneData', () => {
  it('copies plain data, typed arrays and math classes, and refuses the rest', () => {
    const source = { list: [1, { a: 2 }], bytes: new Float64Array([1, 2]), v: new Vector3(1, 2, 3), gone: undefined };
    const copy = cloneData(source);
    expect(copy).toEqual({ list: [1, { a: 2 }], bytes: new Float64Array([1, 2]), v: new Vector3(1, 2, 3) });
    expect(copy.bytes).not.toBe(source.bytes);
    expect(copy.v).not.toBe(source.v);
    expect('gone' in copy).toBe(false);
    expect(() => cloneData({ f: () => 0 })).toThrow(/the value\.f is a function/);
    expect(codeOf(() => cloneData({ s: new Set() }))).toBe('CORE_NOT_CANONICAL');
  });
});
