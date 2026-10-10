/**
 * @file Unit tests for engine/sim/world.ts (T1): monotonic ids, iteration in id order, spawn, despawn and event
 * queues applied at the boundary (spawns, then despawns, then events in emit order), `add`/`remove`/`query`, the
 * systems' order with the timers before `rules`, sim and visual RNG streams, every entry point inside the fdlibm swap
 * (native `Math` again afterwards), entity streams dropped on despawn, and the coded errors.
 * @see engine/sim/world.ts
 */
import { describe, expect, it } from 'vitest';
import { createLog, EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
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

  it('reads settings the sim-side way, and the step rate from time.hz', () => {
    const { w } = makeWorld();
    expect(codeOf(() => w.settings.get('demo.look'))).toBe('CORE_VIEW_SETTING');
    expect(createWorld().hz).toBe(60);
    expect(createWorld({ hz: 30 }).dt).toBe(1 / 30);
    expect(codeOf(() => createWorld({ seed: Number.NaN }))).toBe('SIM_BAD_ARGUMENT');
    expect(codeOf(() => createWorld({ hz: 0.5 }))).toBe('SIM_BAD_ARGUMENT');
  });
});
