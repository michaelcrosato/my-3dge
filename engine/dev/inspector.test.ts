/**
 * @file Unit tests for engine/dev/inspector.ts and engine/dev/members.ts (T1, PLAN.md §8.3, WP 1.6): a member
 * registered from a test file appears in `__engine` and in `help()`; `help()` matches the object; arguments are
 * checked against their schema; members that need a renderer throw `DEV_NO_RENDERER` headless; the kind refuses
 * malformed members; every core member does its job on a headless run; every setting the repository declares is
 * reachable through `__engine.set` (§3, Agent-operable); the kernel fixture imports only engine/sim-api.ts, and the
 * public-API rule refuses a fixture scene that imports engine/sim/world (WP 1.6's Done-when).
 * @see engine/dev/inspector.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { loadRegistrations } from '../../tools/cmd/describe';
import { caseProblems, lintCases } from '../../tools/eslint/testing';
import { apiOf, checkHelp, helpDrift, helpNames, memberModules } from '../../tools/lib/docsHelp';
import { ROOT } from '../../tools/x';
import { createHeadless, headlessHost } from '../app/headless';
import { createLog, EngineError } from '../core/log';
import { createRegistry, registry as sharedRegistry } from '../core/registry';
import { defineSettings, type SettingRow } from '../core/settings';
import { defineScene } from '../sim/scene';
import { defineComponent } from '../sim/state';
import { createInspector } from './inspector';
import { defineMember, helpText, type InspectorHost } from './members';

/** The code and message of the EngineError `fn` throws. */
function failure(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return `${error.code} ${error.message.replace(`[${error.code}] `, '')}`;
    throw error;
  }
  throw new Error('expected an EngineError');
}

/** A quiet log, so recorded errors and advice never reach the console (the advice trap). */
const quietLog = () => createLog({ console: { warn: () => {}, error: () => {} } });

/** A registry with a `dot` component, two settings (one view) and a scene that spawns `demo.count` dots. */
function demo() {
  const registry = createRegistry();
  defineSettings(
    {
      'demo.count': { type: 'integer', default: 2, minimum: 0, when: 'scene', description: 'Dots at the start.' },
      'demo.look': { type: 'number', default: 0, view: true, description: 'A view knob.' },
      'demo.name': { type: 'string', default: 'dot', description: 'A text setting.' },
    },
    registry,
  );
  const fields = { x: { type: 'number', default: 0, description: 'East.' } } as const;
  defineComponent('dot', { description: 'A dot.', fields }, registry);
  defineComponent('tag', { description: 'A tag.', fields: {} }, registry);
  defineScene<{ dot: { x: number }; tag: Record<string, never> }>(
    'demo',
    {
      setup(w) {
        for (let i = 0; i < w.settings.get<number>('demo.count'); i++) w.spawn({ dot: { x: i } });
        w.spawn({ tag: {} });
        w.systems.add('drift', (sw) => sw.query('dot').forEach((e) => (e.dot.x += sw.rng('drift').next())));
      },
    },
    registry,
  );
  return registry;
}

/** A headless run of the demo scene on its own registry and a quiet log. */
const start = (seed = 1) => createHeadless({ scene: 'demo', seed, registry: demo(), log: quietLog() });

describe('members registered from anywhere', () => {
  it('a member registered from a test file appears in __engine and in help()', async () => {
    defineMember('testPing', {
      help: 'Answers pong, n times.',
      args: { n: { type: 'integer', default: 1, minimum: 1, description: 'How often.' } },
      impl: (h, n: number) => `${'pong'.repeat(n)} at ${h.session.world.tick}`,
    });
    defineMember('testWorld.count', { help: 'Counts entities.', impl: (h) => h.session.world.count });
    const engine = await start();
    expect((engine.testPing as (n?: number) => string)(2)).toBe('pongpong at 0');
    expect((engine.testWorld as { count(): number }).count()).toBe(3);
    expect(engine.help()).toMatch(/^testPing\(n = 1\) +Answers pong, n times\.$/m);
    expect(engine.help()).toMatch(/^testWorld\.count\(\) +Counts entities\.$/m);
    expect(engine.help('testPing')).toBe('testPing(n = 1)  Answers pong, n times.\n  n: integer, ≥ 1. How often.');
  });

  it('help() matches the API: every member, one line each, nothing else on the object', async () => {
    const engine = await start();
    expect(helpDrift(engine)).toEqual([]);
    expect(helpNames(engine.help())).toEqual(apiOf(engine));
    for (const name of ['info()', 'step()', 'set()', 'describe()', 'help()', 'errors', 'advice']) {
      expect(apiOf(engine)).toContain(name);
    }
    expect(engine.help().split('\n')).toHaveLength(apiOf(engine).length);
    (engine as Record<string, unknown>).patched = () => 1;
    expect(helpDrift(engine)).toEqual(['__engine.patched() exists, but help() does not list it']);
  });

  it("help() matches the API with every member module of the repository loaded (x docs --check's check)", async () => {
    expect(memberModules(ROOT)).toContain('engine/dev/inspector.ts');
    const { failures, members } = await checkHelp(ROOT);
    expect(failures).toEqual([]);
    expect(members).toBeGreaterThanOrEqual(18);
  });

  it('checks arguments against their schema before anything runs, naming the signature', async () => {
    const engine = await start();
    expect(failure(() => engine.step(-1))).toBe(
      'DEV_BAD_ARGS __engine.step: n is -1, below its minimum 0: call it as step(n = 1, intents?); __engine.help("step") lists its arguments',
    );
    expect(failure(() => (engine.get as () => unknown)())).toMatch(/^DEV_BAD_ARGS __engine\.get: id is required/);
    expect(failure(() => (engine.hash as (n: number) => string)(1))).toMatch(/it takes 0 argument\(s\), not 1/);
    expect(failure(() => engine.state(7 as unknown as string))).toMatch(/query is 7; it must be a component name/);
    expect(engine.info().tick).toBe(0);
  });

  it('a member that needs a renderer throws DEV_NO_RENDERER headless', async () => {
    defineMember('testShot', { help: 'Takes a shot.', needs: 'renderer', impl: () => 'pixels' });
    const engine = await start();
    expect(failure(() => (engine.testShot as () => unknown)())).toMatch(
      /^DEV_NO_RENDERER __engine\.testShot needs a renderer, and this engine has none \(node, headless\)/,
    );
    expect(engine.help()).toMatch(/^testShot\(\) +Takes a shot\. \(needs a renderer\)$/m);
  });

  it('the kind refuses malformed members, naming each problem', () => {
    const members = createRegistry();
    const impl = () => 0;
    defineMember('scene.dump', { help: 'Dumps.', impl }, members);
    const bad = (name: string, spec: object) =>
      failure(() => defineMember(name, { help: 'H.', impl, ...spec } as never, members));
    expect(bad('Scene', {})).toMatch(/the name "Scene" must be a lower-case word/);
    expect(bad('scene', {})).toMatch(/clashes with the member scene\.dump/);
    expect(bad('a', { args: { x: { type: 'number' } } })).toMatch(/args\.x: it needs a description/);
    const optional = { type: 'number', description: 'O.' };
    const required = { type: 'number', required: true, description: 'R.' };
    expect(bad('b', { args: { o: optional, r: required } })).toMatch(/args\.r is required after an optional argument/);
    expect(bad('c', { value: true, args: { o: optional } })).toMatch(/a value member .* takes no arguments/);
    expect(bad('d', { impl: (_h: unknown, a: number, b: number) => a + b })).toMatch(
      /impl takes 2 argument\(s\) after the host but args declares 0/,
    );
    expect(bad('e', { needs: 'gpu' })).toMatch(/needs is "gpu", not one of "sim", "renderer"/);
    expect(helpText(members)).toBe('scene.dump()  Dumps.');
    const inspector = createInspector({ members } as unknown as InspectorHost);
    expect(apiOf(inspector)).toEqual(['scene.dump()']);
  });
});

describe('the core members', () => {
  it('info: identity, health and the run', async () => {
    const engine = await start(4);
    expect(engine.info()).toEqual({
      version: pkg.version,
      runtime: 'node',
      headless: true,
      adapter: null,
      features: [],
      downgrades: [],
      deps: pkg.dependencies,
      scene: 'demo',
      seed: 4,
      tick: 0,
      hz: 60,
    });
  });

  it('pause, resume and timeScale set the clock; step still runs single steps while paused', async () => {
    const engine = await start();
    const { clock, session } = headlessHost(engine);
    engine.pause();
    expect(clock.paused).toBe(true);
    expect(engine.step(3)).toBe(3);
    engine.resume();
    expect(clock.paused).toBe(false);
    expect(engine.timeScale()).toBe(1);
    expect(engine.timeScale(0.5)).toBe(0.5);
    expect(session.settings.get('time.scale')).toBe(0.5);
    expect(failure(() => engine.timeScale(-1))).toMatch(/^DEV_BAD_ARGS .*below its minimum 0/);
  });

  it('state, entities, get, hash and trace read the world; get returns a copy', async () => {
    const engine = await start();
    engine.step(5);
    const { world } = headlessHost(engine).session;
    expect(engine.hash()).toBe(world.hash());
    expect(engine.trace()).toEqual(world.trace());
    expect(engine.state()).toEqual(world.state());
    expect(engine.state('tag').entities).toEqual([{ id: 3, tag: {} }]);
    expect(engine.entities()).toEqual([
      { id: 1, components: ['dot'] },
      { id: 2, components: ['dot'] },
      { id: 3, components: ['tag'] },
    ]);
    expect(engine.entities(['dot']).map((e) => e.id)).toEqual([1, 2]);
    const dot = engine.get(1) as { id: number; dot: { x: number } };
    dot.dot.x = 99;
    expect(world.get(1)?.dot).not.toEqual({ x: 99 });
    expect(engine.get(42)).toBeNull();
  });

  it('set validates, types text as x set does, records non-view changes and names the closest path', async () => {
    const engine = await start();
    expect(engine.set('demo.count', '5')).toMatchObject({ path: 'demo.count', value: 5, previous: 2, when: 'scene' });
    expect(engine.set('demo.look', 0.5)).toMatchObject({ value: 0.5, view: true });
    expect(engine.set('demo.name', '7')).toMatchObject({ value: '7' });
    expect(engine.set('time.paused', 'true')).toMatchObject({ value: true, view: true });
    // A point is recorded once a step follows it (WP-1.5 review: record() never writes a point at `steps`).
    engine.step(1);
    expect(headlessHost(engine).session.record().inputs).toEqual([[0, { set: { 'demo.count': 5, 'demo.name': '7' } }]]);
    expect(failure(() => engine.set('demo.cuont', 1))).toMatch(/^CORE_UNKNOWN_SETTING .*did you mean "demo\.count"/);
    expect(failure(() => engine.set('demo.count', -1))).toMatch(/^CORE_BAD_SETTING /);
  });

  it('seed starts the scene again with that seed, keeping the settings changed since it started', async () => {
    const engine = await start();
    engine.set('demo.count', 4);
    engine.timeScale(2);
    engine.step(10);
    expect(engine.seed()).toBe(1);
    expect(engine.seed(9)).toBe(9);
    expect(engine.info()).toMatchObject({ seed: 9, tick: 0 });
    expect(engine.entities('dot')).toHaveLength(4);
    expect(engine.timeScale()).toBe(2);
    expect(headlessHost(engine).session.record().settings).toEqual({ 'demo.count': 4 });
  });

  it('capture and restore: the run goes on exactly as before', async () => {
    const engine = await start();
    engine.step(7);
    const saved = engine.capture();
    engine.step(20);
    const later = engine.hash();
    engine.restore(saved);
    engine.step(20);
    expect(engine.hash()).toBe(later);
  });

  it('describe lists the registries as x describe does; errors and advice show the log', async () => {
    const engine = await start();
    expect(engine.describe()).toEqual(headlessHost(engine).registry.describe());
    expect(engine.describe('setting', 'demo.count')).toMatchObject({ kind: 'setting', id: 'demo.count' });
    expect(failure(() => engine.describe('setting', 'demo.cuont'))).toMatch(/^CORE_NO_ENTRY /);
    const { log } = headlessHost(engine);
    log.warnOnce('CORE_CLOCK_BEHIND', { frames: 10, maxSteps: 6 });
    log.error('SIM_BUSY', { what: 'step()' });
    expect(engine.advice).toMatchObject([{ code: 'CORE_CLOCK_BEHIND', count: 1 }]);
    expect(engine.errors).toMatchObject([{ code: 'SIM_BUSY', message: 'step() was called during a step' }]);
    expect(engine.errors).not.toBe(log.errors);
  });
});

describe('every setting is reachable through __engine.set (PLAN.md §3, Agent-operable)', () => {
  /** A valid value other than the current one, for a setting row. */
  function another(row: SettingRow): unknown {
    if (row.enum) return row.enum.find((value) => value !== row.value) ?? row.value;
    if (row.type === 'boolean') return !row.value;
    if (row.type === 'string') return `${String(row.value)}-x`;
    if (row.type === 'number' || row.type === 'integer') {
      const v = row.value as number;
      const { minimum = -Infinity, maximum = Infinity } = row;
      const middle = Number.isFinite(minimum + maximum) ? (minimum + maximum) / 2 : v;
      const tries = [v + 1, v - 1, row.type === 'integer' ? Math.round(middle) : middle, minimum, maximum];
      return tries.find((n) => n !== v && n >= minimum && n <= maximum && Number.isFinite(n)) ?? v;
    }
    return row.value;
  }

  it('sets each one typed and as text, as x set and URL parameters give it', async () => {
    const { warnings } = await loadRegistrations(ROOT);
    expect(warnings).toEqual([]);
    const scene = defineScene('settings:all', { setup: () => {} }, createRegistry());
    const engine = await createHeadless({ scene, log: quietLog() });
    const { settings } = headlessHost(engine).session;
    const rows = settings.describe();
    expect(rows.map((row) => row.path)).toEqual(sharedRegistry.list('setting').map((entry) => entry.id));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const value = another(row);
      expect(engine.set(row.path, value).value, row.path).toEqual(value);
      const text = typeof row.default === 'string' ? row.default : JSON.stringify(row.default);
      expect(engine.set(row.path, text).value, `${row.path} as text`).toEqual(row.default);
      expect(settings.get(row.path)).toEqual(row.default);
    }
  });
});

describe('the public API (WP 1.6)', () => {
  it('the kernel fixture imports only engine/sim-api.ts; the rule refuses a fixture that imports engine/sim/world', async () => {
    const text = readFileSync(join(ROOT, 'fixtures/scenes/kernel/index.ts'), 'utf8');
    const sources = [...text.matchAll(/^(?:import|export)\b[^;]*?from\s+'([^']+)'/gms)].map((match) => match[1]);
    expect(sources).toEqual(['../../../engine/sim-api']);
    const [result] = await lintCases([
      {
        name: 'a fixture scene importing the world module',
        file: 'fixtures/scenes/drift.ts',
        bad: "import { createWorld } from '../../engine/sim/world';\nexport const w = createWorld;",
        good: "import { defineScene } from '../../engine/sim-api';\nexport const s = defineScene;",
        rule: 'public-api/no-restricted-imports',
      },
    ]);
    expect(caseProblems(result)).toEqual([]);
  }, 60_000);
});
