/**
 * @file Unit tests for engine/sim/world.ts (T1): monotonic ids, iteration in id order, spawn, despawn and event
 * queues applied at the boundary (spawns, then despawns, then events in emit order), `add`/`remove`/`query`, the
 * systems' order with the timers before `rules` (a timer made in any phase fires in the next step), sim and visual RNG
 * streams, every entry point inside the fdlibm swap (native `Math` again afterwards), entity streams dropped on
 * despawn (and refused afterwards), components as plain data (class instances and typed arrays refused, values copied
 * on entry, kept in name and declared order), `events` without `emit`, frozen intents, the coded errors, and the cost
 * of per-entity streams at 5,000 entities (measured against the same world without them, so the bounds hold on a
 * loaded machine).
 * @see engine/sim/world.ts
 */
import { describe, expect, it } from 'vitest';
import { createLog, EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { Vector3 } from '../core/math';
import { inSimMath, SIM_MATH } from '../core/simMath';
import { defineComponent } from './state';
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

type Parts = { position: { x: number; y: number }; tag: { name: string } };

/** A world over its own registry, with `position` and `tag` declared. */
function makeWorld(seed = 3) {
  const registry = createRegistry();
  const number = (description: string) => ({ type: 'number', default: 0, description }) as const;
  defineComponent('position', { description: 'Where.', fields: { x: number('East.'), y: number('Up.') } }, registry);
  defineComponent(
    'tag',
    { description: 'A name.', fields: { name: { type: 'string', default: '', description: 'It.' } } },
    registry,
  );
  defineSettings({ 'demo.look': { type: 'number', default: 1, view: true, description: 'A look.' } }, registry);
  const settings = createSettings({ registry });
  const log = createLog({ console: { warn: () => {}, error: () => {} } });
  return { w: createWorld<Parts>({ seed, registry, settings, log }), settings, log };
}

describe('entities', () => {
  it('get monotonic ids, never reused, and iterate in id order', () => {
    const { w } = makeWorld();
    const ids = [1, 2, 3, 4].map((i) => w.spawn({ position: { x: i } }));
    expect(ids).toEqual([1, 2, 3, 4]);
    w.despawn(2);
    expect(w.spawn({ tag: { name: 'late' } })).toBe(5);
    w.add(1, 'tag', { name: 'first' });
    expect(w.query().map((e) => e.id)).toEqual([1, 3, 4, 5]);
    expect(w.query('position').map((e) => e.id)).toEqual([1, 3, 4]);
    expect(w.query('position', 'tag').map((e) => e.id)).toEqual([1]);
    expect(w.count).toBe(4);
    expect(w.get(3)?.position).toEqual({ x: 3, y: 0 });
    expect(w.has(2)).toBe(false);
  });

  it('fill defaults, check values, keep ids read-only and remove components', () => {
    const { w } = makeWorld();
    const id = w.spawn({ position: { y: 2 } });
    const entity = w.get(id)!;
    expect(entity.position).toEqual({ x: 0, y: 2 });
    expect(() => ((entity as { id: number }).id = 9)).toThrow(TypeError);
    expect(codeOf(() => w.spawn({ position: { x: 'far' as unknown as number } }))).toBe('CORE_BAD_SPEC');
    expect(codeOf(() => w.add(id, 'tag', { nmae: 'x' } as never))).toBe('CORE_BAD_SPEC');
    w.remove(id, 'position');
    expect(w.get(id)).toEqual({ id });
    expect(codeOf(() => w.spawn({ positon: {} } as never))).toBe('SIM_UNKNOWN_COMPONENT');
    expect(() => w.query('postion' as never)).toThrow(/did you mean "position"/);
    expect(codeOf(() => w.spawn({ id: 4 } as never))).toBe('SIM_BAD_ARGUMENT');
  });

  it('name why an id has no entity', () => {
    const { w } = makeWorld();
    const id = w.spawn({});
    w.despawn(id);
    expect(() => w.add(id, 'tag')).toThrow(/entity 1: it was despawned/);
    expect(() => w.despawn(7)).toThrow(/no spawn made it/);
    w.despawn(id); // already gone: harmless
    w.systems.add('spawner', (w) => {
      const fresh = w.spawn({});
      w.add(fresh, 'tag');
    });
    expect(() => w.step()).toThrow(/joins the world at its end/);
    expect(w.count).toBe(0); // the failed step's queue was dropped
  });
});

describe('components are plain data', () => {
  it('refuse class instances and typed arrays in declarations and values, naming the field and the fix', () => {
    const registry = createRegistry();
    const any = (fallback: unknown) => ({ type: 'any', default: fallback, description: 'A value.' }) as const;
    const declare = (fallback: unknown) => () =>
      defineComponent('aim', { description: 'x', fields: { dir: any(fallback) } }, registry);
    expect(declare(new Vector3(0, 0, 1))).toThrow(/dir's default holds a Vector3.*plain data/);
    expect(declare([new Float32Array(2)])).toThrow(/dir's default holds a Float32Array at \[0\]/);
    const note = { type: 'string', description: 'No default.' } as const;
    expect(() => defineComponent('aim', { description: 'x', fields: { note } }, registry)).toThrow(
      /note needs a default/,
    );
    defineComponent('aim', { description: 'x', fields: { dir: any([0, 0, 1]) } }, registry);
    const w = createWorld({ registry });
    expect(codeOf(() => w.spawn({ aim: { dir: new Vector3() } }))).toBe('SIM_NOT_DATA');
    expect(() => w.spawn({ aim: { dir: { at: new Float32Array(1) } } })).toThrow(
      /spawn\(\) of entity 1: component "aim": dir\.at is a Float32Array; component fields hold plain data/,
    );
    const id = w.spawn({ aim: {} });
    expect(codeOf(() => w.add(id, 'aim', { dir: new Vector3() }))).toBe('SIM_NOT_DATA');
  });

  it('copy what spawn and add are given, and every default', () => {
    const { w } = makeWorld();
    const given = { x: 1, y: 2 };
    const id = w.spawn({ position: given });
    given.x = 9;
    expect(w.get(id)!.position).toEqual({ x: 1, y: 2 });
    const tag = { name: 'a' };
    w.add(id, 'tag', tag).name = 'b';
    expect(tag.name).toBe('a');
  });

  it('keep components in name order and fields in declared order, from spawn and add', () => {
    const registry = createRegistry();
    const number = (description: string) => ({ type: 'number', default: 0, description }) as const;
    defineComponent('mods', { description: 'm', fields: { z: number('z'), a: number('a'), m: number('m') } }, registry);
    defineComponent(
      'tag',
      { description: 't', fields: { name: { type: 'string', default: '', description: 'n' } } },
      registry,
    );
    defineComponent('armor', { description: 'a', fields: { plates: number('p') } }, registry);
    const w = createWorld({ registry });
    const id = w.spawn({ tag: {}, mods: { m: 1, a: 2 } });
    expect(Object.keys(w.get(id)!)).toEqual(['id', 'mods', 'tag']);
    expect(Object.keys(w.get(id)!.mods!)).toEqual(['z', 'a', 'm']);
    w.add(id, 'armor', {});
    expect(Object.keys(w.get(id)!)).toEqual(['id', 'armor', 'mods', 'tag']);
    const entity = w.get(id)! as Record<string, unknown>;
    entity.mods = { a: 1, z: 2, m: 3 }; // assigned out of declared order
    expect(() => w.hash()).toThrow(/entity 1's mods holds z after a/);
    entity.mods = { z: 2, a: 1, m: 3 };
    delete entity.armor;
    entity.armor = { plates: 1 }; // assigned, not added: after tag
    expect(() => w.hash()).toThrow(/entity 1 holds armor out of name order/);
  });
});

describe('the step', () => {
  it('runs the systems by phase, the timers before rules, then spawns, despawns and events at the boundary', () => {
    const { w } = makeWorld();
    const log: string[] = [];
    const victim = w.spawn({ tag: { name: 'victim' } });
    w.systems.add('rule', (w) => {
      log.push(`rule sees ${w.query().map((e) => e.id)}`);
      w.spawn({ tag: { name: 'new' } });
      w.despawn(victim);
      w.emit('hit', { by: 'rule' });
      log.push(`rule still sees ${w.query().map((e) => e.id)}`);
    });
    w.systems.add('think', () => log.push('think'), { phase: 'ai' });
    w.timers.after(0, () => log.push('timer'));
    w.events.on('hit', () => {
      log.push(`hit sees ${w.query().map((e) => e.id)}`);
      w.emit('echo', null);
    });
    w.events.on('echo', () => log.push('echo'));
    w.step();
    expect(log).toEqual(['think', 'timer', 'rule sees 1', 'rule still sees 1', 'hit sees 2', 'echo']);
    expect(w.tick).toBe(1);
    expect(w.time).toBe(1 / 60);
    expect(w.events.trace().map((record) => record.type)).toEqual(['hit', 'echo']);
  });

  it('holds tick and time still within a step: every phase, timer and listener sees the step number', () => {
    const { w } = makeWorld();
    const seen: string[] = [];
    const note = (where: string) => seen.push(`${where} ${w.tick} ${w.time * 60}`);
    w.systems.add('early', () => note('ai'), { phase: 'ai' });
    w.systems.add('late', (w) => (note('rules'), w.emit('done', null)));
    w.timers.every(1 / 60, () => note('timer'));
    w.events.on('done', () => note('listener'));
    w.step();
    w.step();
    expect(seen).toEqual([
      'ai 1 1',
      'timer 1 1',
      'rules 1 1',
      'listener 1 1',
      'ai 2 2',
      'timer 2 2',
      'rules 2 2',
      'listener 2 2',
    ]);
    expect(w.tick).toBe(2);
  });

  it('fires a timer made during a step in the next one, whichever phase made it, never in the same one', () => {
    const { w } = makeWorld();
    const fired: string[] = [];
    const PHASES = ['intents', 'ai', 'anim', 'physics', 'readback', 'rules'] as const;
    for (const phase of PHASES) {
      w.systems.add(
        `make-${phase}`,
        (w) => {
          if (w.tick !== 3) return;
          w.timers.after(0, () => fired.push(`${phase} after(0) at ${w.tick}`));
          w.timers.after(1 / 60, () => fired.push(`${phase} after(1/60) at ${w.tick}`));
        },
        { phase },
      );
    }
    for (let k = 0; k < 3; k++) w.step();
    expect(fired).toEqual([]);
    w.step();
    expect(fired).toEqual(PHASES.flatMap((phase) => [`${phase} after(0) at 4`, `${phase} after(1/60) at 4`]));
  });

  it('applies spawn, despawn and emit at once between steps', () => {
    const { w } = makeWorld();
    const heard: number[] = [];
    w.events.on('ping', (n) => heard.push(n as number));
    const id = w.spawn({});
    expect(w.has(id)).toBe(true);
    w.emit('ping', 5);
    expect(heard).toEqual([5]);
    w.despawn(id);
    expect(w.has(id)).toBe(false);
  });

  it('queues inside run() and applies at its end', () => {
    const { w } = makeWorld();
    const seen = w.run((w) => {
      w.spawn({});
      return w.count;
    });
    expect([seen, w.count, w.tick]).toEqual([0, 1, 0]);
  });

  it('refuses entry points inside a step, and stops a listener storm', () => {
    const { w } = makeWorld();
    const tried: string[] = [];
    w.systems.add('nested', (w) => {
      tried.push(
        codeOf(() => w.step()),
        codeOf(() => w.capture()),
        codeOf(() => w.run(() => 0)),
      );
      w.hash(); // reading is fine
    });
    w.step();
    expect(tried).toEqual(['SIM_BUSY', 'SIM_BUSY', 'SIM_BUSY']);
    w.events.on('loop', () => w.emit('loop', null));
    expect(codeOf(() => w.emit('loop', null))).toBe('SIM_EVENT_STORM');
  });

  it('runs every entry point inside the fdlibm swap, and native Math afterwards', () => {
    const { w } = makeWorld();
    const seen: Record<string, boolean> = {};
    const swapped = (where: string) => (seen[where] = Math.sin === SIM_MATH.sin.port && inSimMath());
    w.systems.add('probe', () => swapped('system'));
    w.timers.after(0, () => swapped('timer'));
    w.events.on('probe', () => swapped('listener'));
    w.run(() => swapped('run'));
    const values = {
      get x() {
        swapped('spawn');
        return 1;
      },
    };
    w.spawn({ position: values });
    w.emit('probe', null);
    w.step();
    expect(seen).toEqual({ system: true, timer: true, listener: true, run: true, spawn: true });
    expect(Math.sin).toBe(SIM_MATH.sin.native);
    expect(Math.cos).toBe(SIM_MATH.cos.native);
    expect(Math.pow).toBe(SIM_MATH.pow.native);
    expect(inSimMath()).toBe(false);
  });
});

describe('the world surface', () => {
  it('lists listeners without emit: events reach listeners only through w.emit, inside the swap', () => {
    const { w } = makeWorld();
    expect(typeof (w.events as unknown as Record<string, unknown>).emit).toBe('undefined');
    expect(Object.keys(w.events).sort()).toEqual(['off', 'on', 'once', 'scope', 'trace']);
    let swapped = false;
    w.events.on('x', () => (swapped = inSimMath()));
    w.emit('x', null);
    expect(swapped).toBe(true);
  });

  it("freezes the intents a step hands its systems, and leaves the caller's object alone", () => {
    const { w } = makeWorld();
    const intents: { 'game:fire': boolean; move: [number, number] } = { 'game:fire': true, move: [1, 0] };
    w.systems.add('consume', (_w, given) => {
      (given as { 'game:fire': boolean })['game:fire'] = false;
    });
    expect(() => w.step(intents)).toThrow(TypeError);
    expect(intents['game:fire']).toBe(true);
  });
});

describe('randomness and settings', () => {
  it('derives sim streams from the seed, drops entity streams on despawn, and keeps fx streams apart', () => {
    const a = makeWorld(11).w;
    const b = makeWorld(11).w;
    expect(a.rng('ai').next()).toBe(b.rng('ai').next());
    expect(a.rng('ai').next()).not.toBe(makeWorld(12).w.rng('ai').next());
    const id = a.spawn({});
    a.rng.entity(id, 'anim').next();
    a.rng.entity(id).next();
    expect(Object.keys(a.state().rng)).toEqual(['["ai"]', '["entity",1,"anim"]', '["entity",1]']);
    a.despawn(id);
    expect(Object.keys(a.state().rng)).toEqual(['["ai"]']);
    a.fxRng('sparks').next();
    expect(Object.keys(a.state().rng)).toEqual(['["ai"]']);
    expect(a.fxRng('ai').next()).not.toBe(makeWorld(11).w.rng('ai').next());
  });

  it('refuses an entity stream for an entity that is gone, so a death listener cannot bring one back', () => {
    const { w, log } = makeWorld();
    w.spawn({});
    w.events.on('died', (id) => w.rng.entity(id as number, 'loot').next());
    w.systems.add('kill', (w) => {
      if (!w.has(1)) return;
      w.rng.entity(1, 'loot').next();
      w.despawn(1);
      w.emit('died', 1);
    });
    w.step();
    expect(Object.keys(w.state().rng)).toEqual([]);
    expect(log.errors.map((record) => record.cause?.message.slice(0, 15))).toEqual(['[SIM_NO_ENTITY]']);
    expect(() => w.rng.entity(1)).toThrow(/there is no entity 1: it was despawned/);
    w.systems.add('born', (w) => w.rng.entity(w.spawn({}), 'birth').next()); // a pending spawn has its streams
    w.step();
    expect(Object.keys(w.state().rng)).toEqual(['["entity",2,"birth"]']);
  });

  it('reads settings the sim-side way, and the step rate from time.hz', () => {
    const { w } = makeWorld();
    expect(codeOf(() => w.settings.get('demo.look'))).toBe('CORE_VIEW_SETTING');
    expect(createWorld().hz).toBe(60);
    expect(createWorld({ hz: 30 }).dt).toBe(1 / 30);
    expect(codeOf(() => createWorld({ seed: Number.NaN }))).toBe('SIM_BAD_ARGUMENT');
    expect(codeOf(() => createWorld({ hz: 0.5 }))).toBe('SIM_BAD_ARGUMENT');
  });
});

describe('performance at 5,000 entities', () => {
  it('keeps per-entity streams cheap: a step and a despawn cost a few times what they cost without them', () => {
    const make = (streams: boolean) => {
      const registry = createRegistry();
      const number = (fallback: number) => ({ type: 'number', default: fallback, description: 'n' }) as const;
      defineComponent('mover', { description: 'm', fields: { x: number(0), left: number(0) } }, registry);
      const w = createWorld<{ mover: { x: number; left: number } }>({ seed: 1, registry });
      w.run(() => {
        for (let i = 0; i < 5000; i++) w.spawn({ mover: { left: 50 + (i % 100) } });
      });
      w.systems.add('move', (w) => {
        for (const e of w.query('mover')) {
          e.mover.x += streams ? w.rng.entity(e.id, 'jit').next() : 0.5;
          if (--e.mover.left > 0) continue;
          w.despawn(e.id);
          w.spawn({ mover: { left: 100 } });
        }
      });
      return w;
    };
    /** Milliseconds per call of `fn`, the best of three rounds of `n`. */
    const time = (fn: () => void, n: number) => {
      fn();
      const rounds = [0, 1, 2].map(() => {
        const start = performance.now();
        for (let i = 0; i < n; i++) fn();
        return (performance.now() - start) / n;
      });
      return Math.min(...rounds);
    };
    const [plain, streamed] = [make(false), make(true)];
    const step = time(() => streamed.step(), 10) / time(() => plain.step(), 10);
    const despawn = (w: ReturnType<typeof make>) => () => w.run((w) => w.despawn(w.query('mover')[0].id));
    const drop = time(despawn(streamed), 20) / time(despawn(plain), 20);
    expect(Object.keys(streamed.state().rng).length).toBeGreaterThan(4900);
    expect(step).toBeLessThan(6); // ≈ 1.7 measured; 16 before the entity index and the fast names
    expect(drop).toBeLessThan(5); // ≈ 1 measured; ≈ 100 when a despawn walked every stream
  });
});
