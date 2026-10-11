/**
 * @file T2 for the Stress Box, stage 1 (PLAN.md §9.0, WP 2.7): the box page (labs/box) on WebGPU. The room starts
 * ready on WebGPU from the landing page; from cam iso the ID pass lists the floor, every wall run, the low wall, the
 * pillar and the three movers, the look metrics raise no note, and the thumbnail matches its baseline
 * (`x shot labs/box --scene room --cam iso --thumb box-room-iso`); cycling every camera preset and resolution mode
 * builds 0 pipelines after the warm-up; every inspector member works in the page and `help()` matches the object;
 * every setting the page knows is reachable through `__engine.set`; the routes reach the run (`?seed`, settings,
 * `?replay` in real time) and a bad one is one error record on the page; and `x inspect` keeps the page open for
 * `x eval`, `x set`, `x dump` and `x shot`. The CPU-only contract is tests/e2e/parity.spec.ts.
 *
 * Invariants: the page is driven only through `window.__engine` and the virtual clock (tools/lib/browser.ts), as an
 * agent drives it; frames are drawn by `__engine.render()` or `__clock.tick()`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { CAMERA_3D, VIEW_NAMES } from '../../engine/gfx/cameras/codes';
import { RESOLUTION_MODES } from '../../engine/gfx/resolution';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
/** Variables a test runner sets for its own workers; the `x` children start without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;
const REPLAY = readFileSync(join(ROOT, 'tests/replays/box-1-room.replay.json'), 'utf8');
const GOLDEN = (JSON.parse(REPLAY) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];

/** Every camera preset: each classic view in both projections, then each 3D camera (engine/gfx/cameras/codes.ts). */
const CAMERA_PRESETS = [
  ...VIEW_NAMES.flatMap((view) => [`cam=${view}`, `cam=${view},persp`]),
  ...CAMERA_3D.map((type) => `cam3=${type}`),
];

/** `window.__engine` as these tests call it: members by dotted name. */
type Engine = Record<string, unknown>;
/** The page's engine, inside `evaluate`. */
declare const __engine: Engine & { [name: string]: (...args: unknown[]) => unknown };

/** Calls the member `path` with `args` in the page; resolves with its result. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** Runs `node x <args>` from the repository root; returns its exit code and printed text. */
function x(...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const run = spawnSync(process.execPath, ['x', ...args], { cwd: ROOT, encoding: 'utf8', env, timeout: 180_000 });
  return { code: run.status, output: `${run.stdout}${run.stderr}` };
}

/** Opens the box with `query` and waits for ready on WebGPU. */
async function open(page: Page, harness: Harness, query = '') {
  await page.goto(`labs/box/${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

test.describe('the box, stage 1', () => {
  test.setTimeout(180_000);

  test('the landing page opens the room, ready on WebGPU', async ({ page, harness }) => {
    await page.goto('/?seed=2');
    await harness.ready({ timeout: 60_000 });
    await harness.assertWebGPU();
    expect(new URL(page.url()).pathname).toBe('/labs/box/');
    expect(await call(page, 'info')).toMatchObject({ scene: 'box:room', seed: 2, headless: false, runtime: 'browser' });
    expect(await page.locator('#msg').isHidden()).toBe(true);
  });

  test('from cam iso the ID pass lists the floor, every wall run, the low wall, the pillar and the movers', async ({
    page,
    harness,
  }) => {
    await open(page, harness, '?scene=room&cam=iso');
    const shot = await call<{ ids: { visible: { name: string; entity?: number }[] }; notes: unknown[] }>(page, 'shot');
    const names = shot.ids.visible.map((entry) => entry.name);
    for (const name of [
      'level:room/floor',
      'level:room/wall@0,0-15,0',
      'level:room/wall@0,1-0,11',
      'level:room/wall@15,1-15,11',
      'level:room/wall@1,11-14,11',
      'level:room/lowWall',
      'level:room/pillar',
      'pathMover#1',
      'pathMover#2',
      'pathMover#3',
    ]) {
      expect(names, name).toContain(name);
    }
    expect(
      shot.ids.visible
        .filter((entry) => entry.entity !== undefined)
        .map((e) => e.entity)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(shot.notes).toEqual([]);
    const tool = x('shot', 'labs/box', '--scene', 'room', '--cam', 'iso', '--thumb', 'box-room-iso');
    expect(tool.code, tool.output).toBe(0);
    const report = JSON.parse(readFileSync(join(ROOT, 'out/shot/labs-box-room-iso/report.json'), 'utf8'));
    expect(report.metrics).toMatchObject({ thumbCells: 0, visible: 11, 'px.pathMover#3': expect.any(Number) });
    expect(report.warnings).toEqual([]);
  });

  test('cycling every camera preset and resolution mode builds 0 pipelines after the warm-up', async ({
    page,
    harness,
  }) => {
    await open(page, harness, '?scene=room');
    for (const code of CAMERA_PRESETS) {
      await call(page, 'camera.set', code);
      for (const mode of RESOLUTION_MODES) {
        await call(page, 'set', 'gfx.resolution', mode);
        const frame = await call<{ drawn: boolean; built: number }>(page, 'render', 2);
        expect(frame, `${code}, ${mode}`).toMatchObject({ drawn: true, built: 0 });
      }
    }
    const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
    expect(advice).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });

  test('every inspector member works in the page, and help() matches the object', async ({ page, harness }) => {
    await open(page, harness, '?scene=room');
    const api = await page.evaluate(() => {
      const walk = (object: object, prefix = ''): string[] =>
        Object.entries(Object.getOwnPropertyDescriptors(object)).flatMap(([key, d]) => {
          if (d.get) return [prefix + key];
          if (typeof d.value === 'function') return [`${prefix}${key}()`];
          if (d.value && typeof d.value === 'object') return walk(d.value as object, `${prefix}${key}.`);
          return [prefix + key];
        });
      const listed = (__engine.help() as string).split('\n').map((line) => {
        const match = /^([^\s(]+)(\()?/.exec(line)!;
        return `${match[1]}${match[2] ? '()' : ''}`;
      });
      return { own: walk(__engine).sort(), listed: listed.sort() };
    });
    expect(api.own).toEqual(api.listed);
    const results = await page.evaluate(async (replay) => {
      const e = __engine as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const out: Record<string, unknown> = {};
      out.ready = e.ready;
      out.errors = e.errors;
      out.advice = Array.isArray(e.advice);
      out.info = e.info().scene;
      out.describe = e.describe('setting', 'box.room.speed').id;
      out.help = e.help('replay').startsWith('replay(text');
      out['camera.get'] = e.camera.get().code;
      out['camera.set'] = e.camera.set('cam=topdown').code;
      out['scene.dump'] = e.scene.dump({ filter: 'pillar' }).includes('level:room/pillar InstancedMesh');
      out.pause = e.pause();
      out.resume = e.resume();
      out.timeScale = e.timeScale(1);
      out.step = e.step(10);
      out.entities = e.entities('pathMover').length;
      out.get = e.get(1).pathMover.path;
      out.hash = /^[0-9a-f]{16}$/.test(e.hash());
      out.trace = e.trace().tick;
      out.state = e.state('pathMover').entities.length;
      out.set = e.set('box.room.speed', '2').value;
      const capture = e.capture();
      out.capture = capture.nextId;
      e.step(5);
      e.restore(capture);
      out.restore = e.info().tick;
      out['input.press'] = JSON.stringify(e.input.press('jump')).includes('jump');
      out['input.hold'] = JSON.stringify(e.input.hold('jump', false)).includes('held');
      out['input.axis'] = e.input.axis('move', [0, 1]).axes.move;
      out['input.play'] = e.input.play('2').steps;
      out['input.state'] = typeof e.input.state();
      out['input.record'] = e.input.record().steps;
      out.render = (await e.render(1)).drawn;
      out.shot = (await e.shot({ ids: true, metrics: false, thumbnail: false })).ids.objects;
      out.replay = (await e.replay(replay, { draw: 0 })).hashes['600'];
      out.seed = e.seed(9);
      return out;
    }, REPLAY);
    expect(results).toEqual({
      ready: true,
      errors: [],
      advice: true,
      info: 'box:room',
      describe: 'box.room.speed',
      help: true,
      'camera.get': 'cam=iso',
      'camera.set': 'cam=topdown',
      'scene.dump': true,
      pause: undefined,
      resume: undefined,
      timeScale: 1,
      step: 10,
      entities: 3,
      get: 0,
      hash: true,
      trace: 10,
      state: 3,
      set: 2,
      capture: 4,
      restore: 10,
      'input.press': true,
      'input.hold': true,
      'input.axis': [0, 1],
      'input.play': 2,
      'input.state': 'object',
      'input.record': 12,
      render: true,
      shot: 11,
      replay: GOLDEN['600'],
      seed: 9,
    });
    const members = api.listed.map((name) => name.replace('()', ''));
    expect(Object.keys(results).sort()).toEqual(members.sort());
  });

  test('every setting the page knows is reachable through __engine.set', async ({ page, harness }) => {
    await open(page, harness, '?scene=room');
    const rows = await page.evaluate(() => {
      const kind = __engine.describe('setting') as { ids: string[] };
      return kind.ids.map((id) => {
        const { fields } = __engine.describe('setting', id) as { fields: { key: string; value: unknown }[] };
        const fallback = fields.find((field) => field.key === 'default')!.value;
        const text = typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
        return { id, value: (__engine.set(id, text) as { value: unknown }).value, expected: fallback };
      });
    });
    expect(rows.map((row) => row.id)).toEqual(
      expect.arrayContaining(['box.room.speed', 'gfx.resolution', 'time.scale']),
    );
    for (const row of rows) expect(row.value, row.id).toEqual(row.expected);
  });

  test('the routes reach the run, and a bad one is one error record shown on the page', async ({ page, harness }) => {
    await open(page, harness, '?scene=room&seed=5&box.room.speed=3&cam=topdown');
    expect(await call(page, 'info')).toMatchObject({ seed: 5 });
    expect(await call(page, 'camera.get')).toMatchObject({ code: 'cam=topdown' });
    await call(page, 'step', 60);
    expect((await call<{ pathMover: { s: number } }>(page, 'get', 1)).pathMover.s).toBeCloseTo(3, 9);
    await page.goto('labs/box/?scene=rom');
    await expect
      .poll(() => page.evaluate(() => (__engine.errors as unknown as { code: string }[]).map((e) => e.code)))
      .toEqual(['APP_BAD_ROUTE']);
    await expect(page.locator('#msg')).toContainText('APP_BAD_ROUTE');
    await expect(page.locator('#msg')).toContainText('did you mean "room"?');
    expect(await page.evaluate(() => __engine.ready)).toBe(false);
    expect(harness.advice().map((warning) => warning.code)).toEqual(['APP_BAD_ROUTE']); // printed once, on purpose
  });

  test('?replay plays a box replay in real time, a step a frame', async ({ page, harness }) => {
    await open(page, harness, '?replay=box-1-room');
    await page.evaluate(() => window.__clock.tick(61)); // the first frame sets the clock's origin
    expect(await call(page, 'info')).toMatchObject({ tick: 60, seed: 1 });
    expect(await call(page, 'hash')).toBe(GOLDEN['60']);
  });

  test('x inspect keeps the page open for x eval, x set, x dump and x shot', async () => {
    test.setTimeout(400_000);
    try {
      const started = x('inspect', '--scene', 'room');
      expect(started.code, started.output).toBe(0);
      const evaluated = x('eval', '__engine.info().scene');
      expect([evaluated.code, evaluated.output]).toEqual([0, expect.stringContaining('"box:room"')]);
      const set = x('set', 'box.room.speed', '3');
      expect(set.output).toContain('applied in labs/box/?scene=room: 1.5 → 3 (recorded at this step)');
      const dump = x('dump', '--step', '60', '--filter', 'pathMover');
      expect([dump.code, dump.output]).toEqual([0, expect.stringContaining('tick 60')]);
      expect(dump.output).toMatch(/pathMover#1 Mesh at 6\.5,0,4\.5/); // 3 m/s for 1 s along the line east
      const shot = x('shot', 'labs/box', '--scene', 'room');
      expect([shot.code, shot.output]).toEqual([0, expect.stringContaining('reused the inspect session')]);
    } finally {
      x('inspect', '--stop');
    }
  });
});
