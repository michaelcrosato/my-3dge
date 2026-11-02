/**
 * @file T2 for what a page's warm-up compiles (engine/gfx/warmup.ts, ADR-0008 amendment 11), on the Stress Box's room
 * in a look drawn through the post chain (`look:torch-fxaa`) from the iso camera:
 * - `gfx.warmUp: asked` starts on fewer pipelines than `all`, the default, which compiles both cameras and the plain
 *   frame's pass too;
 * - asked, a first frame from a perspective camera, then a first plain frame (`look:torch-lit`: the same sky, no
 *   filter, so only the plain frame is new), each warms up before it draws, building nothing in a frame; going back
 *   to the iso camera, and to the chain, builds nothing and warms up nothing.
 *
 * Invariants: frames are drawn by calling the page (`__engine.render`), the sim paused; pipelines are the device's
 * (engine/gfx/pipelines.ts); no advice is raised.
 */
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

/** The page's inspector, as far as this suite drives it. */
declare const __engine: {
  pause(): void;
  set(path: string, value: string): unknown;
  render(frames: number): Promise<unknown>;
  stats(): unknown;
  camera: { set(code: string): unknown };
};

/** What `__engine.stats()` gives that this suite reads. */
interface Stats {
  pipelines: number;
  pipelinesAfterWarmUp: number | null;
  warmUps: number;
}

/** Opens the room from the iso camera in `look:torch-fxaa`, `query` added, ready on WebGPU; returns its stats. */
async function open(page: Page, harness: Harness, query = ''): Promise<Stats> {
  await page.goto(`labs/box/?scene=room&cam=iso&post.look=look:torch-fxaa${query}`);
  await harness.ready({ timeout: 240_000 });
  await harness.assertWebGPU();
  return (await page.evaluate(() => __engine.stats())) as Stats;
}

/** Sets the camera `code` and the view settings `values`, the sim paused, draws `frames` frames; returns the stats. */
function show(page: Page, code: string | null, values: Record<string, string> = {}, frames = 2): Promise<Stats> {
  return page.evaluate(
    async ([c, v, n]) => {
      __engine.pause();
      if (c) __engine.camera.set(c);
      for (const [path, value] of Object.entries(v)) __engine.set(path, value);
      await __engine.render(n);
      return __engine.stats() as Stats;
    },
    [code, values, frames] as const,
  );
}

test('warming what is asked: fewer pipelines at the start, each new camera and the plain frame warmed before they draw', async ({
  page,
  harness,
}) => {
  test.setTimeout(300_000); // two starts of the room and three warm-ups on SwiftShader
  const all = await open(page, harness);
  expect(all.pipelinesAfterWarmUp).toBe(0);
  const asked = await open(page, harness, '&gfx.warmUp=asked');
  expect(asked.pipelinesAfterWarmUp).toBe(0);
  expect(asked.pipelines, 'one camera and the chain alone at the start').toBeLessThan(all.pipelines);
  test.info().annotations.push({ type: 'pipelines', description: `at the start: all ${all.pipelines}, asked ${asked.pipelines}` }); // prettier-ignore

  const chase = await show(page, 'cam3=chase');
  expect(chase.warmUps, 'a first frame from a perspective camera warms up first').toBeGreaterThan(asked.warmUps);
  expect(chase.pipelinesAfterWarmUp).toBe(0);
  const iso = await show(page, 'cam=iso');
  expect([iso.warmUps, iso.pipelines, iso.pipelinesAfterWarmUp], 'back to iso: both cameras warm').toEqual([chase.warmUps, chase.pipelines, 0]); // prettier-ignore

  const plain = await show(page, null, { 'post.look': 'look:torch-lit' });
  expect(plain.warmUps, 'a first plain frame, under the same sky, warms up first').toBeGreaterThan(iso.warmUps);
  expect(plain.pipelines, "the plain frame's own pipelines").toBeGreaterThan(iso.pipelines);
  expect(plain.pipelinesAfterWarmUp).toBe(0);
  const chain = await show(page, null, { 'post.look': 'look:torch-fxaa' });
  expect([chain.warmUps, chain.pipelines, chain.pipelinesAfterWarmUp], 'back to the chain').toEqual([plain.warmUps, plain.pipelines, 0]); // prettier-ignore
  expect(harness.advice()).toEqual([]);
});
