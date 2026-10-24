/**
 * @file T2 for GPU particles (PLAN.md WP 11.3; ADR-0025 amendment 32): engine/gfx/enhanced/particles.ts's ring, drawn
 * by the post chain's layer (engine/gfx/post/particles.ts), as the playground's rain (labs/playground/weather.ts) on
 * its street from cam iso, the sim paused so that only the rain moves:
 * - A downpour on the ring: past 20,000 drops live and none in the CPU pool, the picture changed, nothing built after
 *   the warm-up, and the ID pass and the normals view the same pixel for pixel with rain or without: the drops stay out
 *   of the ID pass and write no normal. The GPU time dry and wet is logged (WP 11.2; on SwiftShader a CPU's, so it
 *   ranks and budgets nothing, ADR-0022).
 * - The ring draws what the CPU pool draws: a light rain (within the pool's 4,096) through the same frames in the
 *   clean look, by the ring and, with `feature:gpuParticles` off, by the CPU pool's sprites: the two pictures differ
 *   in at most `PARITY` of their pixels.
 * - The chain's hand-made depth test hides what the screen's hides: a rain in the clean look, drawn plain (after the
 *   scene, against the screen's depth) and through the chain (a neutral filter laid on: the particle pass, against
 *   the scene pass's depth), the same picture to within `PARITY`.
 * - With the feature off: its advice once, a downpour thinned to the CPU pool's 4,096 and the drops past it counted,
 *   its frames building nothing (the CPU's sprites are in the ID pass: a shot of them builds its pipeline there).
 * - The hash: the street replay, a frame drawn every 10 steps through a downpour on the ring, gives its goldens.
 *
 * Invariants: the replay's text is read in Node and handed to the page; goldens come from its file, never this run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

/** The street from above, the GPU's particles on (or off, with `OFF`). */
const STREET = 'labs/playground/?scene=site-street&cam=iso';
const OFF = `&gfx.featuresOff=${encodeURIComponent(JSON.stringify(['feature:gpuParticles']))}`;
const REPLAY = readFileSync(join(import.meta.dirname, '../replays/playground-street.replay.json'), 'utf8');
/** The replay's goldens to step `UNTIL`. */
const UNTIL = 240;
const GOLDEN = Object.fromEntries(Object.entries((JSON.parse(REPLAY) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64']).filter(([step]) => Number(step) <= UNTIL)); // prettier-ignore
/** The most of their pixels the ring's picture and the CPU pool's may differ in (by more than 2 of 255 a channel). */
const PARITY = 0.01;

/** What `fx.stats()` reports, as far as this suite reads it. */
interface Counts {
  live: number;
  born: number;
  dropped: number;
}

/** The page's engine, inside `evaluate`. */
declare const __engine: {
  info(): { features: string[]; downgrades: string[] };
  pause(): void;
  set(key: string, value: unknown): unknown;
  render(frames: number): Promise<unknown>;
  stats(): { pipelines: number; computeCalls: number; drawCalls: number; gpuMs?: number | null };
  shot(options: object): Promise<Shot>;
  fx: { stats(): { particles: Counts; gpuParticles: (Counts & { recycled: number }) | null } };
  replay(text: string, options: object): Promise<{ hashes: Record<string, string> }>;
};

/** A shot as this suite reads it: its pixels (base64 RGBA), the ID pass and the look's luma. */
interface Shot {
  pixels?: string;
  ids?: { visible: unknown[]; empty: number };
  metrics: { lumaMean: number };
}

test.describe.configure({ mode: 'parallel', timeout: 600_000 });

/** Opens the street (`query` laid on), ready, the sim paused: from here only the view and its effects move. */
async function open(page: Page, harness: Harness, query = ''): Promise<void> {
  await page.goto(`${STREET}${query}`);
  await harness.ready({ timeout: 480_000 });
  await harness.assertWebGPU();
  await page.evaluate(() => __engine.pause());
}

/** Draws `frames` frames of 1/60 s, then shoots the view as `show` shows it, with its pixels. */
function shoot(page: Page, show: string, frames = 2): Promise<Shot> {
  return page.evaluate(
    async ({ s, n }) => {
      __engine.set('post.show', s);
      await __engine.render(n);
      return __engine.shot({ ids: true, metrics: true, thumbnail: false, pixels: true });
    },
    { s: show, n: frames },
  );
}

/** The share of pixels two shots' pictures differ in, by more than 2 of 255 in a channel. */
function differing(a: Shot, b: Shot): number {
  const [p, q] = [Buffer.from(a.pixels!, 'base64'), Buffer.from(b.pixels!, 'base64')];
  expect(p.length).toBe(q.length);
  let changed = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) > 2) changed++;
  }
  return changed / (p.length / 4);
}

test('a downpour on the ring: drawn in a pass of its own, building nothing, out of the ID pass and the normals', async ({
  page,
  harness,
}) => {
  await open(page, harness, '&post.look=look:playground-cel');
  expect((await page.evaluate(() => __engine.info())).features).toContain('feature:gpuParticles');
  for (const show of ['picture', 'normals']) await shoot(page, show); // a shot builds its own passes, once each
  const stats = () => page.evaluate(() => __engine.stats());
  const before = (await stats()).pipelines;
  const dry = { picture: await shoot(page, 'picture', 60), normals: await shoot(page, 'normals') };
  const gpu = { dry: (await stats()).gpuMs ?? null, wet: null as number | null };
  await page.evaluate(() => __engine.set('playground.rain', 1));
  const wet = { picture: await shoot(page, 'picture', 90), normals: await shoot(page, 'normals') };
  gpu.wet = (await stats()).gpuMs ?? null;
  const fx = await page.evaluate(() => __engine.fx.stats());
  const changed = differing(dry.picture, wet.picture);
  console.log(`a downpour on the ring: ${JSON.stringify({ ring: fx.gpuParticles, changed, luma: [dry.picture.metrics.lumaMean, wet.picture.metrics.lumaMean], gpuMs: gpu })}`); // prettier-ignore
  expect(fx.gpuParticles!.live).toBeGreaterThan(20_000); // far past the CPU pool's 4,096
  expect([fx.particles.live, fx.gpuParticles!.dropped]).toEqual([0, 0]);
  expect(changed).toBeGreaterThan(0.01); // the rain shows
  expect([(await stats()).pipelines, (await stats()).computeCalls >= 2]).toEqual([before, true]); // the step: a compute call
  expect(wet.picture.ids).toEqual(dry.picture.ids); // out of the ID pass
  expect(differing(dry.normals, wet.normals)).toBe(0); // no normal written
  expect(harness.advice()).toEqual([]);
});

test('the ring draws what the CPU pool draws: the same light rain, the same frames, the same picture', async ({
  page,
  harness,
}) => {
  const light = async (query: string) => {
    await open(page, harness, `&post.look=look:clean${query}`);
    await page.evaluate(() => __engine.set('playground.rain', 0.1)); // 3,000 a second: within the pool's 4,096 live
    const shot = await shoot(page, 'picture', 75);
    return { shot, fx: await page.evaluate(() => __engine.fx.stats()) };
  };
  const ring = await light('');
  const pool = await light(OFF);
  const changed = differing(ring.shot, pool.shot);
  console.log(`the ring against the CPU pool: ${JSON.stringify({ ring: ring.fx.gpuParticles, pool: pool.fx.particles, changed })}`); // prettier-ignore
  const [onRing, inPool] = [ring.fx.gpuParticles!.live, pool.fx.particles.live]; // the same births and lives, but for rounding
  expect([onRing > 1000, Math.abs(onRing - inPool) <= Math.ceil(inPool * 0.01)]).toEqual([true, true]);
  expect([pool.fx.gpuParticles, pool.fx.particles.dropped, ring.fx.particles.live]).toEqual([null, 0, 0]);
  expect(changed).toBeLessThanOrEqual(PARITY);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_GPU_PARTICLES']); // the CPU pool's page
});

test("the chain tests the drops against the scene's depth as the screen does: the same rain plain and through it", async ({
  page,
  harness,
}) => {
  const draw = async (query: string) => {
    await open(page, harness, `&post.look=look:clean${query}`);
    const drawCalls = await page.evaluate(async () => {
      __engine.set('playground.rain', 0.3);
      await __engine.render(75);
      return __engine.stats().drawCalls;
    });
    return { shot: await shoot(page, 'picture', 1), drawCalls };
  };
  const plain = await draw(''); // a clean look draws plain: the drops after the scene, against the screen's depth
  const chained = await draw(`&post.filters=${encodeURIComponent(JSON.stringify({ grade: { scope: 'all' } }))}`); // neutral
  const changed = differing(plain.shot, chained.shot);
  console.log(
    `plain against the chain: ${JSON.stringify({ changed, drawCalls: [plain.drawCalls, chained.drawCalls] })}`,
  );
  expect(chained.drawCalls).not.toBe(plain.drawCalls); // the filter took the frame through the chain's passes
  expect(changed).toBeLessThanOrEqual(PARITY);
  expect(harness.advice()).toEqual([]);
});

test('with the feature off: its advice once, a downpour thinned to the CPU pool, nothing built', async ({
  page,
  harness,
}) => {
  await open(page, harness, `&post.look=look:playground-cel${OFF}`);
  const info = await page.evaluate(() => __engine.info());
  expect([info.features.includes('feature:gpuParticles'), info.downgrades]).toEqual([false, ['GFX_NO_GPU_PARTICLES']]);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_GPU_PARTICLES']);
  await shoot(page, 'picture');
  const before = (await page.evaluate(() => __engine.stats())).pipelines;
  await page.evaluate(async () => {
    __engine.set('playground.rain', 1);
    await __engine.render(60); // no shot: one would build the ID pass's for the CPU's sprites, which it draws
  });
  const fx = await page.evaluate(() => __engine.fx.stats());
  console.log(`a downpour on the CPU pool: ${JSON.stringify(fx.particles)}`);
  expect([fx.gpuParticles, fx.particles.live <= 4096, fx.particles.dropped > 0]).toEqual([null, true, true]);
  expect((await page.evaluate(() => __engine.stats())).pipelines).toBe(before);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_GPU_PARTICLES']); // once
});

test('the hash: the street replay, drawn through a downpour on the ring, gives its goldens', async ({
  page,
  harness,
}) => {
  await open(page, harness, '&post.look=look:playground-cel');
  const run = await page.evaluate(
    ({ text, until }) => __engine.replay(text, { until, draw: 10, views: [[0, { set: { 'playground.rain': 1 } }]] }),
    { text: REPLAY, until: UNTIL },
  );
  const fx = await page.evaluate(() => __engine.fx.stats());
  expect(fx.gpuParticles!.born).toBeGreaterThan(0); // it rained on the ring while the replay stepped
  expect(run.hashes).toEqual(GOLDEN);
  expect(harness.advice()).toEqual([]);
});
