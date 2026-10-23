/**
 * @file T2 for the lighting and shading upgrades (PLAN.md WP 11.5; engine/gfx/enhanced/, reached through
 * engine/gfx/features.ts). Each technique drawn where it shows, and again with its feature off (`gfx.featuresOff`):
 * 1. tiled lighting, in the box's hall under `look:torch-lit`: the light pool holds 64 lights (all 30 torch spots lit,
 *    the two nearest casting shadows), the hall comes out brighter than with the pool's 12, the same entities are in
 *    the ID pass, and no pipeline is built after the warm-up, through the resolution modes' resizes included (r182's
 *    tiled lights rebuilt every lit pipeline on a resize);
 * 2. cascaded shadows, in the crowd arena under `look:daylight`: the sky's sun casts through three cascades (the scene
 *    dump says so; one map with the feature off), the picture renders, the same entities are in the ID pass, and no
 *    pipeline is built after the warm-up.
 * That a feature off never changes play is tests/e2e/features.spec.ts's for every feature; each one's cost is
 * `x perf --feature` (the WP's ledger row).
 *
 * Invariants: images are read as numbers (look metrics, the share of lit pixels, the ID pass), never looked at; the
 * fixture fails a test on any unlisted advice or console warning, a shader's compile log included.
 */
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, (...args: unknown[]) => unknown> & { scene: { dump(o: object): string } };

/** What a frame gives the spec: its look metrics, the share of pixels lit past luma 60, and the entities seen. */
interface Seen {
  lumaMean: number;
  blank: boolean;
  lit: number;
  visible: string[];
  pipelinesAfterWarmUp: number | null;
}

test.describe.configure({ timeout: 300_000 });

/** Opens `query` on the box with `off` among the features turned off, the sim paused. */
async function open(page: Page, harness: Harness, query: string, off: string[] = []): Promise<void> {
  const features = off.length ? `&gfx.featuresOff=${encodeURIComponent(JSON.stringify(off))}` : '';
  await page.goto(`labs/box/?${query}${features}`);
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
  await page.evaluate(() => __engine.pause());
}

/** Draws `frames` frames, reads the stats, then shoots: what the spec reads of the frame. */
const look = (page: Page, frames = 20) =>
  page.evaluate(async (n) => {
    await __engine.render(n);
    const { pipelinesAfterWarmUp } = __engine.stats() as { pipelinesAfterWarmUp: number | null };
    const shot = (await __engine.shot({ metrics: true, pixels: true, ids: true })) as {
      pixels: string;
      metrics: { lumaMean: number; blank: boolean };
      ids: { visible: { name: string }[] };
    };
    const bytes = Uint8Array.from(atob(shot.pixels), (c) => c.charCodeAt(0));
    let lit = 0;
    for (let i = 0; i < bytes.length; i += 4) lit += 0.2126 * bytes[i] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i + 2] > 60 ? 1 : 0; // prettier-ignore
    const visible = [...new Set(shot.ids.visible.map((e) => e.name))].sort();
    return { ...shot.metrics, lit: lit / (bytes.length / 4), visible, pipelinesAfterWarmUp };
  }, frames) as Promise<Seen>;

/** The scene dump's lines, filtered by `filter`, that hold `line`. */
const dumped = (page: Page, filter: string, line = filter) =>
  page.evaluate(([f, l]) => __engine.scene.dump({ filter: f }).split('\n').filter((each) => each.includes(l)), [filter, line] as const); // prettier-ignore

test('tiled lighting: the hall lit by all its torches, brighter than the pool of 12, building nothing on resizes', async ({
  page,
  harness,
}) => {
  const hall = 'scene=hall&post.look=look:torch-lit';
  await open(page, harness, hall);
  const pool = await dumped(page, 'lights:pool/');
  expect(pool).toHaveLength(64);
  expect(pool.filter((line) => line.endsWith(' shadow'))).toHaveLength(2);
  // The resolution modes resize the targets before anything is shot (a shot builds its own passes' pipelines).
  for (const mode of ['balanced', 'full', 'pixels']) {
    const built = await page.evaluate(async (m) => {
      __engine.set('gfx.resolution', m);
      await __engine.render(3);
      return (__engine.stats() as { pipelinesAfterWarmUp: number }).pipelinesAfterWarmUp;
    }, mode);
    expect([mode, built]).toEqual([mode, 0]);
  }
  const tiled = await look(page);
  expect(tiled.pipelinesAfterWarmUp).toBe(0);
  expect(harness.advice()).toEqual([]);

  await open(page, harness, hall, ['feature:tiledLighting']);
  expect(await dumped(page, 'lights:pool/')).toHaveLength(12);
  const pooled = await look(page);
  expect(tiled.lumaMean).toBeGreaterThan(pooled.lumaMean);
  expect(tiled.lit).toBeGreaterThan(pooled.lit);
  expect(tiled.visible).toEqual(pooled.visible); // the same scene: lit otherwise, never played otherwise
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_TILED_LIGHTING']);
});

test('cascaded shadows: the day sun casts through three cascades over the crowd arena, building nothing', async ({
  page,
  harness,
}) => {
  const arena = 'scene=crowd-100&post.look=look:daylight';
  await open(page, harness, arena);
  expect(await dumped(page, 'sky/sun', 'sky/sun DirectionalLight')).toEqual([expect.stringMatching(/^ +sky\/sun DirectionalLight .* shadow ×3 cascades$/)]); // prettier-ignore
  const cascaded = await look(page);
  expect([cascaded.blank, cascaded.pipelinesAfterWarmUp]).toEqual([false, 0]);
  expect(harness.advice()).toEqual([]);

  await open(page, harness, arena, ['feature:cascadedShadows']);
  expect(await dumped(page, 'sky/sun', 'sky/sun DirectionalLight')).toEqual([
    expect.stringMatching(/^ +sky\/sun DirectionalLight .* shadow$/),
  ]);
  const single = await look(page);
  expect(single.blank).toBe(false);
  expect(cascaded.visible).toEqual(single.visible);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_CASCADED_SHADOWS']);
});
