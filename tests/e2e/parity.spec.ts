/**
 * @file The CPU-only gameplay contract (PLAN.md §6.7, §6.5 item 9, I-07; doctrine: WebGPU only), from Box 1 on: each
 * stage adds its scenes. In the scene's own page (labs/box), rendering as it steps:
 * 1. every box-1 replay gives its golden hashes, a frame drawn after each step (`__engine.replay`, the same player
 *    as `x replay --browser page`), and so it does while every camera preset and resolution mode is switched;
 * 2. live play recorded in the page (devices, a setting changed mid-run) replays in Node to the same hashes, so the
 *    renderer never wrote the sim;
 * 3. turning every optional GPU feature off never changes the hash;
 * 4. the gameplay entities in view appear in the ID pass.
 *
 * Invariants: goldens come from the replay files (one set per platform, recorded in Node and the sim-only page), so
 * these tests compare the rendering page with them, never with themselves.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import '../../labs/box/scenes/room';
import { playReplay, type Replay } from '../../engine/sim/replay';
import { CAMERA_3D, VIEW_NAMES } from '../../engine/gfx/cameras/codes';
import { RESOLUTION_MODES } from '../../engine/gfx/resolution';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const REPLAYS = ['box-1-room', 'box-1-tuned'].map((name) => ({
  name,
  text: readFileSync(join(ROOT, `tests/replays/${name}.replay.json`), 'utf8'),
}));
const goldens = (text: string) => (JSON.parse(text) as Replay).hashes['linux-x64'];

/** Every camera preset: each classic view in both projections, then each 3D camera (engine/gfx/cameras/codes.ts). */
const CAMERA_PRESETS = [
  ...VIEW_NAMES.flatMap((view) => [`cam=${view}`, `cam=${view},persp`]),
  ...CAMERA_3D.map((type) => `cam3=${type}`),
];

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, (...args: unknown[]) => unknown> & {
  input: Record<string, (...a: unknown[]) => unknown>;
  camera: Record<string, (...a: unknown[]) => unknown>;
};

/** What `__engine.replay` resolves with. */
interface PlayResult {
  hashes: Record<string, string>;
  steps: number;
  frames: number;
}

/** Plays a replay's text in the page with `options`. */
function play(page: Page, text: string, options: object = {}): Promise<PlayResult> {
  return page.evaluate(([t, o]) => __engine.replay(t, o) as Promise<PlayResult>, [text, options] as const);
}

/** Opens the box with `query`, ready on WebGPU. */
async function open(page: Page, harness: Harness, query = '?scene=room') {
  await page.goto(`labs/box/${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

test.describe('the CPU-only gameplay contract, Box 1', () => {
  test.setTimeout(240_000);

  test('each replay gives its golden hashes while the scene renders as it steps', async ({ page, harness }) => {
    await open(page, harness);
    for (const { name, text } of REPLAYS) {
      const run = await play(page, text);
      expect(run.hashes, name).toEqual(goldens(text));
      expect([run.steps, run.frames], name).toEqual([600, 600]);
    }
  });

  test('switching every camera preset and resolution mode during a replay leaves its hashes unchanged', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const views: [number, { cam?: string; set?: Record<string, unknown> }][] = [];
    CAMERA_PRESETS.forEach((cam, i) => views.push([10 + i * 38, { cam }]));
    RESOLUTION_MODES.forEach((mode, i) => views.push([25 + i * 170, { set: { 'gfx.resolution': mode } }]));
    for (const { name, text } of REPLAYS) {
      const run = await play(page, text, { views });
      expect(run.hashes, name).toEqual(goldens(text));
    }
    const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
    expect(advice).not.toContain('GFX_COLD_PIPELINE');
  });

  test('turning every optional GPU feature off never changes the hash', async ({ page, harness }) => {
    const off = encodeURIComponent(
      JSON.stringify(['feature:timestamps', 'feature:float32Filtering', 'feature:largeBuffers']),
    );
    await open(page, harness, `?scene=room&gfx.featuresOff=${off}`);
    const downgrades = await page.evaluate(() => (__engine.info() as { downgrades: string[] }).downgrades);
    expect(downgrades.length).toBeGreaterThan(0);
    for (const { name, text } of REPLAYS) expect((await play(page, text)).hashes, name).toEqual(goldens(text));
    harness.advice(); // the downgrades' advice is the point of this test
  });

  test('live play recorded in the page replays in Node to the same hashes', async ({ page, harness }) => {
    await open(page, harness, '?scene=room&cam=threequarter');
    const live = await page.evaluate(() => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1); // the clock's origin
      __engine.input.axis('move', [0, 1]);
      tick(45);
      __engine.set('box.room.speed', '2.5');
      __engine.input.hold('jump');
      tick(30);
      __engine.camera.set('cam=topdown');
      __engine.input.hold('jump', false);
      __engine.input.axis('move', null);
      tick(50);
      return { replay: __engine.input.record() as Replay, hash: __engine.hash() as string };
    });
    expect(live.replay.steps).toBeGreaterThanOrEqual(120); // a step a frame, give or take the clock's rounding
    expect(live.replay.inputs.some(([, change]) => change.set?.['box.room.speed'] === 2.5)).toBe(true);
    expect(live.replay.inputs.some(([, change]) => Array.isArray(change.move))).toBe(true);
    const node = playReplay(live.replay);
    expect(node.hashes[String(live.replay.steps)]).toBe(live.hash);
  });

  test('the gameplay entities in view appear in the ID pass', async ({ page, harness }) => {
    await open(page, harness, '?scene=room&cam=topdown');
    await play(page, REPLAYS[0].text, { until: 300, draw: 0 });
    const seen = await page.evaluate(async () => {
      const shot = (await __engine.shot({ ids: true, metrics: false, thumbnail: false })) as {
        ids: { visible: { entity?: number }[] };
      };
      const entities = (__engine.entities('pathMover') as { id: number }[]).map((e) => e.id);
      return { entities, visible: shot.ids.visible.flatMap((e) => (e.entity === undefined ? [] : [e.entity])) };
    });
    expect(seen.entities).toEqual([1, 2, 3]);
    expect(seen.visible.sort()).toEqual(seen.entities);
  });
});
