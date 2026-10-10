/**
 * @file Unit tests for what a restore puts back beyond the hashed data (T1; PLAN.md §6.5 item 7, the WP-1.4 review):
 * listener registrations (a used-up `once`, one added or removed mid-play, scopes) and the systems schedule come
 * back with a capture restored into its own world, and a capture restored elsewhere must find the same schedule; the
 * step rate is the world's (`capture.hz`, hashed), never the `time.hz` setting; the settings and component fields of
 * a capture must match the world's exactly; a serialized capture restores components in name order and fields in
 * declared order, so it continues hash by hash; seeds compare with `Object.is`; RNG handles survive restores; shared
 * objects between entities are refused at capture.
 * @see engine/sim/capture.ts
 */
import { describe, expect, it } from 'vitest';
import { deserialize, serialize, type Canonical } from '../core/hash';
import { createLog, EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { TIME_SETTINGS } from '../core/time';
import type { WorldCapture } from './capture';
import { defineComponent } from './state';
import { createWorld } from './world';

/** The EngineError `fn` throws. */
function errorOf(fn: () => unknown): EngineError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error('expected an EngineError');
}

/** A log that prints nothing. */
const quiet = () => createLog({ console: { warn: () => {}, error: () => {} } });

/** One number field. */
const num = (fallback: number) => ({ type: 'number', default: fallback, description: 'A number.' }) as const;

type Hp = { hp: { v: number } };

/** A registry with the time settings, `g.a` (and `g.b` when asked) and the component `hp`. */
function registryWith(extra = false) {
  const registry = createRegistry();
  defineSettings(TIME_SETTINGS, registry);
  defineSettings({ 'g.a': { ...num(1), description: 'A.' } }, registry);
  if (extra) defineSettings({ 'g.b': { ...num(1), description: 'B.' } }, registry);
  defineComponent('hp', { description: 'Hit points.', fields: { v: num(10) } }, registry);
  return registry;
}

/** A world over `registry` with a quiet log. */
function world(registry = registryWith(), options: { seed?: number; hz?: number } = {}) {
  const settings = createSettings({ registry });
  return { w: createWorld<Hp>({ seed: 1, registry, settings, log: quiet(), ...options }), settings };
}

/** Steps `w` `n` times and returns the hash after each step. */
function hashes(w: { step(): void; hash(): string }, n: number): string[] {
  return Array.from({ length: n }, () => (w.step(), w.hash()));
}

/** A capture through text and back. */
const roundTrip = (capture: WorldCapture) =>
  deserialize(serialize(capture as unknown as Canonical)) as unknown as WorldCapture;

describe('listeners and systems', () => {
  it('bring back a once() listener used up after the capture', () => {
    const { w } = world();
    w.run(() => {
      w.spawn({ hp: {} });
      w.events.once('boss', () => w.spawn({ hp: { v: 99 } }));
    });
    w.systems.add('trigger', (w) => {
      if (w.tick % 10 === 5) w.emit('boss', null);
    });
    const capture = w.capture();
    const first = hashes(w, 20);
    w.restore(capture);
    expect(hashes(w, 20)).toEqual(first);
    expect(w.count).toBe(2);
  });

  it('drop a listener added after the capture and bring back one removed after it', () => {
    const { w } = world();
    w.run(() => w.spawn({ hp: {} }));
    const heal = () => w.get(1)!.hp!.v++;
    w.events.on('dmg', heal);
    w.systems.add('arm', (w) => {
      if (w.tick === 3) w.events.on('dmg', () => (w.get(1)!.hp!.v -= 2));
      if (w.tick === 4) w.events.off('dmg', heal);
      w.emit('dmg', null);
    });
    const capture = w.capture();
    const first = hashes(w, 10);
    w.restore(capture);
    expect(hashes(w, 10)).toEqual(first);
  });

  it('bring back a scope disposed after the capture, and dispose one made after it', () => {
    const { w } = world();
    w.run(() => w.spawn({ hp: {} }));
    const level = w.events.scope('level');
    level.on('dmg', () => w.get(1)!.hp!.v--);
    const capture = w.capture();
    level.dispose();
    const late = w.events.scope('late');
    w.restore(capture);
    expect([level.disposed, late.disposed]).toEqual([false, true]);
    w.emit('dmg', null);
    expect(w.get(1)!.hp!.v).toBe(9);
    level.dispose();
    w.emit('dmg', null);
    expect(w.get(1)!.hp!.v).toBe(9);
  });

  it('bring back the systems added or removed after the capture', () => {
    const { w } = world();
    w.run(() => w.spawn({ hp: {} }));
    w.systems.add('a', (w) => w.get(1)!.hp!.v++);
    const capture = w.capture();
    const first = hashes(w, 3);
    w.systems.remove('a');
    w.systems.add('b', (w) => (w.get(1)!.hp!.v *= 2));
    hashes(w, 3);
    w.restore(capture);
    expect(w.systems.list().map((system) => system.name)).toEqual(['a']);
    expect(hashes(w, 3)).toEqual(first);
  });

  it('must match in a world that did not make the capture: systems and listeners named', () => {
    const make = () => {
      const { w } = world();
      w.systems.add('tick', (w) => w.rng('t').next());
      w.events.once('boss', () => {});
      return w;
    };
    const origin = make();
    origin.emit('boss', null); // uses up the once listener
    const text = roundTrip(origin.capture());
    expect(errorOf(() => make().restore(text)).message).toMatch(/boss \(once\)/);
    const fresh = make();
    fresh.emit('boss', null);
    fresh.restore(text); // the same schedule: restores
    const other = world().w;
    other.systems.add('tock', () => {});
    other.emit('boss', null);
    expect(errorOf(() => other.restore(text)).message).toMatch(/rules:tock/);
  });
});

describe('the step rate', () => {
  it('is the world rate given by option: hashed, captured and checked on restore', () => {
    const at30 = world(registryWith(), { hz: 30 }).w;
    const at60 = world(registryWith()).w;
    expect(at30.hz).toBe(30);
    expect(at30.hash()).not.toBe(at60.hash());
    expect(at30.capture().hz).toBe(30);
    at30.restore(at30.capture());
    expect(errorOf(() => at60.restore(at30.capture())).message).toMatch(/30 Hz.*60 Hz/);
  });

  it('stays the world rate when time.hz changes mid-scene, and the world restores its own capture', () => {
    const { w, settings } = world();
    hashes(w, 2);
    settings.set('time.hz', 30); // when: scene, so the next scene steps at 30 Hz
    const capture = w.capture();
    w.restore(capture);
    expect([w.hz, capture.hz, capture.settings['time.hz']]).toEqual([60, 60, 30]);
  });
});

describe('a capture is checked against the world', () => {
  it('refuses settings that differ from the world settings, naming the path', () => {
    const text = roundTrip(world(registryWith(false)).w.capture());
    const { w, settings } = world(registryWith(true));
    settings.set('g.b', 5);
    expect(errorOf(() => w.restore(text)).message).toMatch(/lacks the setting "g\.b"/);
    expect(settings.get('g.b')).toBe(5);
    const back = world(registryWith(false));
    expect(errorOf(() => back.w.restore(roundTrip(w.capture()))).message).toMatch(/setting "g\.b".*lacks/);
  });

  it('refuses component fields that differ from the declared ones, before anything changes', () => {
    const { w } = world();
    w.run(() => w.spawn({ hp: {} }));
    const base = w.hash();
    const bad = (change: (entity: Record<string, Record<string, unknown>>) => void) => {
      const capture = JSON.parse(serialize(w.capture() as unknown as Canonical));
      change(capture.entities[0]);
      return errorOf(() => w.restore(capture));
    };
    expect(bad((e) => (e.hp.vv = 3)).message).toMatch(/entity 1's hp\.vv/);
    expect(bad((e) => delete e.hp.v).message).toMatch(/entity 1's hp lacks its field v/);
    expect(bad((e) => (e.hp.v = { at: new Float32Array(1) } as never)).code).toBe('SIM_BAD_CAPTURE');
    expect(w.hash()).toBe(base);
  });

  it('compares seeds with Object.is', () => {
    const negative = world(registryWith(), { seed: -0 }).w;
    negative.rng('a').next();
    const zero = world(registryWith(), { seed: 0 }).w;
    zero.restore(roundTrip(negative.capture()));
    expect(Object.is(zero.seed, -0)).toBe(true);
    expect(zero.hash()).toBe(negative.hash());
    expect(zero.rng('a').next()).toBe(negative.rng('a').next());
  });
});

describe('serialized captures', () => {
  it('restore components in name order and fields in declared order, and continue hash by hash', () => {
    const registry = createRegistry();
    const n = (fallback: number) => ({ type: 'number', default: fallback, description: 'n' }) as const;
    defineComponent('mods', { description: 'm', fields: { z: n(0.1), a: n(1e16), m: n(-1e16) } }, registry);
    defineComponent('out', { description: 'o', fields: { total: n(0) } }, registry);
    type Parts = { mods: { z: number; a: number; m: number }; out: { total: number } };
    const make = () => {
      const w = createWorld<Parts>({ seed: 1, registry, log: quiet() });
      w.systems.add('sum', (w) => {
        for (const e of w.query('mods', 'out')) {
          e.out.total = Object.values(e.mods).reduce((sum, value) => sum + value, 0);
          e.mods.z += 0.1;
        }
      });
      return w;
    };
    const w = make();
    w.run(() => w.spawn({ out: {}, mods: { m: -1e16, a: 1e16 } }));
    const fresh = make();
    fresh.restore(roundTrip(w.capture()));
    for (const entity of [w.get(1)!, fresh.get(1)!]) {
      expect(Object.keys(entity)).toEqual(['id', 'mods', 'out']);
      expect(Object.keys(entity.mods!)).toEqual(['z', 'a', 'm']);
    }
    expect(hashes(fresh, 5)).toEqual(hashes(w, 5));
    expect(fresh.get(1)!.out!.total).toBe(w.get(1)!.out!.total);
  });
});

describe('RNG handles', () => {
  it('keep working across a restore, even when first made after the capture', () => {
    const { w } = world();
    w.run(() => w.spawn({ hp: {} }));
    let late: ReturnType<typeof w.rng> | undefined;
    w.systems.add('roll', (w) => {
      late ??= w.rng('late');
      w.get(1)!.hp!.v = late.next();
    });
    const capture = w.capture();
    const first = hashes(w, 3);
    w.restore(capture);
    expect(hashes(w, 3)).toEqual(first);
  });

  it('leave the hash alone until they draw', () => {
    const { w } = world();
    const before = w.hash();
    const peek = w.rng('peek');
    expect(w.hash()).toBe(before);
    peek.next();
    expect(w.hash()).not.toBe(before);
  });
});

describe('shared objects', () => {
  it('are refused at capture: a capture would bring them back apart', () => {
    const registry = createRegistry();
    const list = { type: 'array', items: { type: 'number' }, default: [0, 0], description: 'v' } as const;
    defineComponent('pos', { description: 'p', fields: { v: list } }, registry);
    const w = createWorld<{ pos: { v: number[] } }>({ seed: 1, registry, log: quiet() });
    w.run(() => [w.spawn({ pos: {} }), w.spawn({ pos: {} })]);
    w.run(() => ((w.get(2) as { pos: unknown }).pos = w.get(1)!.pos));
    expect(errorOf(() => w.capture()).message).toMatch(/entity 2's pos is the same object as entity 1's pos/);
    w.run(() => ((w.get(2) as { pos: unknown }).pos = { v: w.get(1)!.pos!.v }));
    expect(errorOf(() => w.capture()).message).toMatch(/entity 2's pos\.v is the same object as entity 1's pos\.v/);
  });
});
