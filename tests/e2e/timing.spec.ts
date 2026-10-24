/**
 * @file T2 for the GPU timing (PLAN.md WP 11.2; engine/gfx/enhanced/timing.ts). This platform's SwiftShader adapter
 * has timestamp queries, so the renderer tracks them:
 * 1. in the box's room (labs/box/), `__engine.stats().gpuMs` becomes a positive number of milliseconds, the GPU's mean
 *    time a frame, and stays one through shots between frames; no advice, no warning from three.js;
 * 2. on the scene page (tests/pages/scene.html), which hands the spec its renderer: after more passes than three.js
 *    r182's render-query pool holds, the pool was read along the way (no pass lost, no warning) and its record of
 *    every pass's time is emptied after each read, so it never grows with the frames;
 * 3. there too, as many frames drawn in one task, the way the virtual clock's `tick(n)` draws them, before any read
 *    can come back: the renderer queries none of them while a read is out, so the pool never fills (no warning);
 * 4. with `feature:timestamps` off (`gfx.featuresOff`), the renderer tracks none: `stats()` has no `gpuMs`, and
 *    `GFX_NO_TIMESTAMPS`, raised once, says why.
 * The fixture fails a test on any unlisted advice or console warning, three.js's "Maximum number of queries exceeded"
 * among them.
 *
 * Invariants: the times are a CPU's emulating a GPU (PLAN.md §4.7): the spec checks that they are measured, never
 * how fast a frame is.
 */
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: {
  info(): { features: string[]; downgrades: string[] };
  render(frames: number): Promise<unknown>;
  shot(options: object): Promise<unknown>;
  stats(): { gpuMs?: number | null; frames: number };
};

/** r182's query pool as the spec reads it (tests/pages/scene.ts hands over the renderer). */
interface Pool {
  maxQueries: number;
  currentQueryIndex: number;
  timestamps: Map<string, number>;
}

/** The scene page's handle, as far as the spec reads it (tests/pages/scene.ts). */
declare const window: Window & {
  __scene: {
    gfx: {
      renderer: { info: { render: { calls: number } }; backend: { trackTimestamp: boolean; timestampQueryPool: { render: Pool | null } } }; // prettier-ignore
      frame(view: { scene: unknown; camera: unknown }): { drawn: boolean };
      stats(): { gpuMs?: number | null };
    };
    scene: unknown;
    camera: unknown;
    settle(): Promise<unknown>;
  };
};

test.describe.configure({ timeout: 300_000 });

/** Opens the box's room, with `off` among the features turned off. */
async function openRoom(page: Page, harness: Harness, off: string[] = []): Promise<void> {
  const query = off.length ? `&gfx.featuresOff=${encodeURIComponent(JSON.stringify(off))}` : '';
  await page.goto(`labs/box/?scene=room${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

/** Draws 10 frames, then reads `stats().gpuMs`. */
const gpuMsAfterFrames = (page: Page) =>
  page.evaluate(async () => {
    await __engine.render(10);
    return __engine.stats().gpuMs;
  });

test('in the box’s room, stats().gpuMs is the GPU’s mean time a frame, and stays one through shots', async ({
  page,
  harness,
}) => {
  await openRoom(page, harness);
  expect((await page.evaluate(() => __engine.info())).features).toContain('feature:timestamps');
  await expect.poll(() => gpuMsAfterFrames(page), { timeout: 120_000 }).toBeGreaterThan(0);
  for (let k = 0; k < 3; k++) await page.evaluate(() => __engine.shot({ ids: true, metrics: false, thumbnail: false }));
  await expect.poll(() => gpuMsAfterFrames(page), { timeout: 120_000 }).toBeGreaterThan(0);
  const gpuMs = (await page.evaluate(() => __engine.stats())).gpuMs!;
  expect(Number.isFinite(gpuMs)).toBe(true);
  expect(harness.advice()).toEqual([]);
});

test('on the scene page, r182’s render-query pool is read before it fills, and its record is emptied', async ({
  page,
  harness,
}) => {
  await page.goto('tests/pages/scene.html');
  await harness.ready();
  await harness.assertWebGPU();
  const run = await page.evaluate(async () => {
    const { gfx, settle } = window.__scene;
    const before = gfx.renderer.info.render.calls;
    let [frames, pending, record, tracking] = [0, 0, 0, false];
    const pool = () => gfx.renderer.backend.timestampQueryPool.render!;
    // more passes than the pool holds queries for (2 a pass): unread, it would fill and three.js would warn
    while (gfx.renderer.info.render.calls - before <= pool().maxQueries / 2 + 16 && frames < 4000) {
      await settle();
      frames++;
      pending = Math.max(pending, pool().currentQueryIndex);
      record = Math.max(record, pool().timestamps.size);
      tracking ||= gfx.renderer.backend.trackTimestamp; // off only while a read is out
    }
    return {
      tracking,
      frames,
      passes: gfx.renderer.info.render.calls - before,
      maxQueries: pool().maxQueries,
      pending,
      record,
      gpuMs: gfx.stats().gpuMs,
    };
  });
  expect(run.tracking).toBe(true);
  expect(run.passes).toBeGreaterThan(run.maxQueries / 2); // the pool would have filled unread
  expect(run.pending).toBeLessThan(run.maxQueries / 4); // read along the way: never near full
  expect(run.record).toBeLessThan(64); // emptied after each read, so it never grows with the frames
  expect(run.gpuMs).toBeGreaterThan(0);
  expect(harness.advice()).toEqual([]);
});

test('frames drawn in one task, as the virtual clock ticks them, never fill the pool: none is queried while a read is out', async ({
  page,
  harness,
}) => {
  await page.goto('tests/pages/scene.html');
  await harness.ready();
  await harness.assertWebGPU();
  const run = await page.evaluate(async () => {
    const { gfx, scene, camera, settle } = window.__scene;
    await settle();
    const pool = () => gfx.renderer.backend.timestampQueryPool.render!;
    const before = gfx.renderer.info.render.calls;
    let [frames, drawn, pending] = [0, 0, 0];
    // more passes than the pool holds queries for, in one task: no read can come back before the last
    while (gfx.renderer.info.render.calls - before <= pool().maxQueries / 2 + 16 && frames < 4000) {
      if (gfx.frame({ scene, camera }).drawn) drawn++;
      frames++;
      pending = Math.max(pending, pool().currentQueryIndex);
    }
    const passes = gfx.renderer.info.render.calls - before;
    await settle();
    await settle();
    return { frames, drawn, passes, maxQueries: pool().maxQueries, pending, gpuMs: gfx.stats().gpuMs };
  });
  expect(run.drawn).toBe(run.frames);
  expect(run.passes).toBeGreaterThan(run.maxQueries / 2); // the pool would have filled
  expect(run.pending).toBeLessThan(64); // a frame's passes at most: none queried after the read went out
  expect(run.gpuMs).toBeGreaterThan(0);
  expect(harness.advice()).toEqual([]);
});

test('with feature:timestamps off, the renderer tracks none: stats() has no gpuMs, GFX_NO_TIMESTAMPS says why', async ({
  page,
  harness,
}) => {
  await openRoom(page, harness, ['feature:timestamps']);
  const stats = await page.evaluate(async () => {
    await __engine.render(30);
    return __engine.stats();
  });
  expect(stats.frames).toBeGreaterThanOrEqual(30); // drawn and timed, but not on the GPU
  expect('gpuMs' in stats).toBe(false);
  expect((await page.evaluate(() => __engine.info())).downgrades).toEqual(['GFX_NO_TIMESTAMPS']);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_TIMESTAMPS']);
});
