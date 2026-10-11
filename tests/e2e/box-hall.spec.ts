/**
 * @file T2 for the Stress Box, stage 3 (PLAN.md §9.0, WP 4.6): the hall with a hero (labs/box/?scene=hall) on WebGPU.
 * The hall's ID pass and look metrics are recorded (Done-when 4): from cam iso the ID pass lists the hall's floor, the
 * dais, pillars and brazier stands, and the hero as the protagonist; the thumbnail matches its baseline (`x shot
 * labs/box --scene hall --cam iso --thumb box-hall-iso`), and the look's one note is the known low contrast (the hall's
 * stone under the stage's sun alone; its torches' lights arrive with the light pool, WP 7.1). The climb replay played
 * in the page, rendering as it steps, gives its goldens and ends with the hero on the west gallery, more than 0.9 m
 * above the floor (Done-when 2), where every camera sees him in the ID pass with the gallery and the stairs, the walls
 * and pillars before him cut away. The hall with its props (labs/box/?scene=hall-props) draws its 100 crates and
 * barrels and its 30 fires through one instanced batch per prop part, each seen by the ID pass; its knock replay,
 * played in the page, gives its goldens, and the crate the hero shoves moves more than 0.25 m there (Done-when 3): read
 * once the replay has played to the shove's press, then again once the page has stepped on with that press to the
 * checkpoint after it, drawing after every step, where the hash is the replay's golden. In both scenes, cycling every
 * camera and resolution mode while he walks builds 0 pipelines after the warm-up (Done-when 4). The CPU-only contract
 * for the hall is tests/e2e/parity.spec.ts.
 *
 * Invariants: the page is driven through `window.__engine` and the virtual clock, as an agent drives it; goldens come
 * from the replay files, never from the page itself. Each test opens its own page and shares nothing, so they run in
 * parallel: in order, on one worker, this file was T2's longest chain after parity.spec.ts went parallel.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { CAMERA_3D, VIEW_NAMES } from '../../engine/gfx/cameras/codes';
import { FOLLOW_CAMERAS } from '../../engine/gfx/cameras/place';
import { RESOLUTION_MODES } from '../../engine/gfx/resolution';
import { expect, test, type Harness } from './fixtures';

test.describe.configure({ mode: 'parallel' });

const ROOT = join(import.meta.dirname, '..', '..');
/** Variables a test runner sets for its own workers; the `x` children start without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;
const CLIMB = readFileSync(join(ROOT, 'tests/replays/box-3-climb.replay.json'), 'utf8');
const KNOCK = readFileSync(join(ROOT, 'tests/replays/box-3-knock.replay.json'), 'utf8');
/**
 * The knock replay's first shove: the step its press comes at, the checkpoint after it, and the crate it knocks (its
 * spot, after the level's 30 fires).
 */
const SHOVE = { at: 190, after: 240, prop: 30 + 40 };
/** Every camera but first person: each classic view in both projections, then each 3D camera, then chase and rail. */
const CAMERAS = [
  ...VIEW_NAMES.flatMap((view) => [`cam=${view}`, `cam=${view},persp`]),
  ...CAMERA_3D.map((type) => `cam3=${type}`),
  ...FOLLOW_CAMERAS.filter((type) => type !== 'first').map((type) => `cam3=${type}`),
];
/** The west gallery's tiles (columns 3–22, rows 1–4 of labs/box/levels/hall.txt) and its floor's height (m). */
const GALLERY = { x: [3, 23], z: [1, 5], top: 1 };

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** One object the ID pass sees. */
interface Seen {
  name: string;
  px: number;
  share: number;
  entity?: number;
  protagonist?: boolean;
}

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

/** The ID pass's view from the camera now: what it sees, largest first. */
async function seen(page: Page): Promise<Seen[]> {
  const shot = await call<{ ids: { visible: Seen[] } }>(page, 'shot', { ids: true, metrics: false, thumbnail: false });
  return shot.ids.visible;
}

/** The hero's feet, m. */
async function feet(page: Page): Promise<[number, number, number]> {
  const { actor } = await call<{ actor: { x: number; y: number; z: number } }>(page, 'get', 1);
  return [actor.x, actor.y, actor.z];
}

/** The golden hashes of a replay's text. */
const goldensOf = (text: string) =>
  (JSON.parse(text) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];

/** Opens `scene` (the hall by default) with `query`, ready on WebGPU. */
async function open(page: Page, harness: Harness, query = '', scene = 'hall') {
  await page.goto(`labs/box/?scene=${scene}${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

test.describe('the box, stage 3: the hall', () => {
  test.setTimeout(300_000);

  test("the hall's ID pass and look metrics are recorded from cam iso, its thumbnail matching the baseline", async ({
    page,
    harness,
  }) => {
    await open(page, harness, '&cam=iso');
    const shot = await call<{ ids: { visible: Seen[] }; notes: { id: string }[] }>(page, 'shot', {
      ids: true,
      metrics: true,
      thumbnail: false,
    });
    const names = shot.ids.visible.map((object) => object.name);
    expect(names).toContain('level:hall/floor');
    for (const part of ['dais', 'pillar', 'brazier']) {
      expect(
        names.some((name) => name.startsWith(`level:hall/${part}@`)),
        part,
      ).toBe(true);
    }
    expect(shot.ids.visible.find((object) => object.entity === 1)).toMatchObject({
      name: 'actor#1',
      protagonist: true,
    });
    expect(shot.notes.map((note) => note.id)).toEqual(['LOOK_LOW_CONTRAST']); // see the file comment
    const tool = x('shot', 'labs/box', '--scene', 'hall', '--cam', 'iso', '--thumb', 'box-hall-iso');
    expect(tool.code, tool.output).toBe(0);
    const report = JSON.parse(readFileSync(join(ROOT, 'out/shot/labs-box-hall-iso/report.json'), 'utf8'));
    expect(report.metrics).toMatchObject({
      thumbCells: 0,
      protagonist: true,
      blank: false,
      'px.actor#1': expect.any(Number),
      'px.level:hall/floor': expect.any(Number),
    });
    expect(report.metrics.visible).toBeGreaterThanOrEqual(20);
    expect(report.warnings.map((warning: { id: string }) => warning.id)).toEqual(['LOOK_LOW_CONTRAST']);
  });

  test('the climb ends on the west gallery, more than 0.9 m up, where every camera sees the hero', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const run = await call<{ hashes: Record<string, string>; frames: number }>(page, 'replay', CLIMB);
    expect(run.hashes).toEqual(goldensOf(CLIMB));
    expect(run.frames).toBe(600);
    const [x0, y, z0] = await feet(page);
    expect(y).toBeGreaterThan(0.9);
    expect(y).toBeCloseTo(GALLERY.top, 3);
    expect([x0 > GALLERY.x[0] && x0 < GALLERY.x[1], z0 > GALLERY.z[0] && z0 < GALLERY.z[1]]).toEqual([true, true]);
    for (const code of CAMERAS) {
      await call(page, 'camera.set', code);
      await call(page, 'render', 30); // the lagging cameras settle on him
      const visible = await seen(page);
      const hero = visible.find((object) => object.entity === 1);
      expect(hero, code).toMatchObject({ name: 'actor#1', protagonist: true });
      expect(hero!.px, code).toBeGreaterThanOrEqual(50); // in view, not a speck
      expect(Math.max(...visible.map((object) => object.share)), code).toBeLessThan(0.9); // not inside anything
    }
    await call(page, 'camera.set', 'cam=iso');
    await call(page, 'render', 30);
    const names = (await seen(page)).map((object) => object.name);
    expect(names.some((name) => name.startsWith('level:hall/gallery'))).toBe(true);
    expect(names.some((name) => name.startsWith('level:hall/stairs'))).toBe(true);
  });

  test('the hall with its props draws them in batches, and a shoved crate moves more than 0.25 m in the page', async ({
    page,
    harness,
  }) => {
    await open(page, harness, '&cam=iso', 'hall-props');
    const visible = await seen(page);
    for (const batch of ['prop:crate/mesh', 'prop:barrel/mesh', 'prop:brazier/flames']) {
      expect(visible.find((object) => object.name === `${batch}/page0`)?.px ?? 0, batch).toBeGreaterThan(50);
    }
    // One batch per prop part: 70 crates, 30 barrels, and 30 fires of three tongues round three cores.
    const dump = await call<string>(page, 'scene.dump', { filter: 'prop:' });
    expect(dump).toMatch(/prop:crate\/mesh\/page0 InstancedMesh .* ×70\n/);
    expect(dump).toMatch(/prop:barrel\/mesh\/page0 InstancedMesh .* ×30\n/);
    expect(dump).toMatch(/prop:brazier\/flames\/page0 InstancedMesh .* ×180\n/);
    const run = await call<{ hashes: Record<string, string>; frames: number }>(page, 'replay', KNOCK);
    expect(run.hashes).toEqual(goldensOf(KNOCK));
    expect(run.frames).toBe(600);
    /** The shoved crate now. */
    const crate = async () => {
      const id = (await call<{ id: number }[]>(page, 'entities', 'sceneProp'))[SHOVE.prop].id;
      return (await call<{ sceneProp: { prop: string; x: number; z: number } }>(page, 'get', id)).sceneProp;
    };
    // One more play, to the shove's press, then on to the checkpoint after it, a frame drawn after every step.
    await call(page, 'replay', KNOCK, { until: SHOVE.at });
    const before = await crate();
    const changes = (JSON.parse(KNOCK) as { inputs: [number, object][] }).inputs.filter(
      ([at]) => at >= SHOVE.at && at < SHOVE.after,
    );
    expect(changes).toEqual([[SHOVE.at, { p: ['attack'] }]]); // the press alone, so step(1, press) then step(1, {})
    await page.evaluate(
      async ([press, steps]) => {
        for (let k = 0; k < steps; k++) {
          __engine.step(1, k === 0 ? press : {});
          await __engine.render(1);
        }
      },
      [changes[0][1], SHOVE.after - SHOVE.at] as const,
    );
    expect(await call(page, 'hash')).toBe(goldensOf(KNOCK)[SHOVE.after]); // stepped on exactly as the replay plays
    const after = await crate();
    expect(before.prop).toBe('prop:crate');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.25);
    const frame = await call<{ drawn: boolean; built: number }>(page, 'render', 2);
    expect(frame).toMatchObject({ drawn: true, built: 0 });
  });

  for (const scene of ['hall', 'hall-props']) {
    test(`${scene}: cycling every camera and resolution mode while he walks builds 0 pipelines after the warm-up`, async ({
      page,
      harness,
    }) => {
      await open(page, harness, '', scene);
      for (const code of [...CAMERAS, 'cam3=first']) {
        await call(page, 'camera.set', code);
        for (const mode of RESOLUTION_MODES) {
          await call(page, 'set', 'gfx.resolution', mode);
          await call(page, 'step', 6, { move: [-0.3, 0.2] });
          const frame = await call<{ drawn: boolean; built: number }>(page, 'render', 2);
          expect(frame, `${code}, ${mode}`).toMatchObject({ drawn: true, built: 0 });
        }
      }
      const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
      expect(advice).not.toContain('GFX_COLD_PIPELINE');
      expect(harness.advice()).toEqual([]);
    });
  }
});
