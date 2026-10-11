/**
 * @file T2 for effects (PLAN.md WP 6.4) on the fx page (tests/pages/fx.html): the fx scene's fight
 * (tests/pages/fxScene.ts) drawn with its effects on the engine's renderer.
 * - **The sim hash is identical with effects on and off:** 300 steps with every frame drawn, effects on (drawing
 *   from the world's visual streams, the camera shaking) and off, give the same hash after every step, and the same
 *   as the fight run in Node without a page.
 * - **Every pool is warmed, the budgets hold:** registered before the first frame, the effects build 0 pipelines in
 *   any frame after the warm-up, through the fight and through a frame asking for more than every budget; that frame
 *   keeps the pools' sizes (particles past 4,096 dropped and counted) and costs at most the draw calls and triangles
 *   tests/baselines/perf/fx.json records.
 * - Each effect is drawn: the ID pass sees the sprites (particles and bolts), the floor decals (telegraphs, rings)
 *   and the ribbons.
 *
 * Invariants: frames are drawn by calling the page; pipelines are the device's (engine/gfx/pipelines.ts), draw calls
 * and triangles the renderer's (`renderer.info`); no advice is raised.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { FX_BUDGET } from '../../engine/gfx/fx/effects';
import { createFxScene } from '../pages/fxScene';
import type { Flooded, Ran, Shown } from '../pages/fx';
import { expect, test, type Harness } from './fixtures';

/** What the page publishes as `window.__fxPage` (tests/pages/fx.ts), as far as this suite uses it. */
interface FxPage {
  run(steps: number, effects: boolean): Promise<Ran>;
  flood(): Promise<Flooded>;
  show(): Promise<Shown>;
}
type FxWindow = { __fxPage: FxPage };

const ROOT = join(import.meta.dirname, '..', '..');
/** The effects' budgets: tests/baselines/perf/fx.json. */
const BUDGETS = JSON.parse(readFileSync(join(ROOT, 'tests/baselines/perf/fx.json'), 'utf8')).page.budgets as Record<
  string,
  number
>;
/** The fight's seed (tests/pages/fx.ts `SEED`) and length. */
const [SEED, STEPS] = [7, 300];

/** Opens the page. */
async function open(page: Page, harness: Harness) {
  await page.goto('tests/pages/fx.html');
  await harness.ready();
  await harness.assertWebGPU();
}

/** The fight's hashes in Node, with no page and no effects. */
function nodeHashes(): string[] {
  const { world } = createFxScene({ seed: SEED });
  return Array.from({ length: STEPS }, () => {
    world.step();
    return world.hash();
  });
}

test('the sim hash is identical with effects on and off, in the page and in Node', async ({ page, harness }) => {
  test.setTimeout(120_000);
  await open(page, harness);
  const run = (effects: boolean) =>
    page.evaluate(([steps, on]) => (window as unknown as FxWindow).__fxPage.run(steps, on), [STEPS, effects] as const);
  const on = await run(true);
  const off = await run(false);
  const node = nodeHashes();
  expect(on.hashes).toHaveLength(STEPS);
  expect(on.hashes, 'effects on against effects off').toEqual(off.hashes);
  expect(on.hashes, 'the page against Node').toEqual(node);
  for (const ran of [on, off]) {
    expect(ran.undrawn, 'every frame drew').toBe(0);
    expect(ran.built, 'pipelines built after the warm-up').toBe(0);
    expect(ran.pipelinesAfterWarmUp).toBe(0);
  }
  // The effects drew the fight: its events, telegraphs, bolts, the trail and the brazier.
  expect(on.events).toBeGreaterThan(10);
  expect(on.most.sprites).toBeGreaterThan(100);
  expect(on.most.decals).toBeGreaterThanOrEqual(2);
  expect(on.most.ribbons).toBe(1);
  expect(on.most.drawCalls).toBeLessThanOrEqual(BUDGETS.drawCalls);
  expect(off.most).toEqual({ sprites: 0, decals: 0, ribbons: 0, drawCalls: 0, live: 0 });
});

test('every pool is warmed, and a frame past every budget keeps to them', async ({ page, harness }) => {
  await open(page, harness);
  const flooded = await page.evaluate(() => (window as unknown as FxWindow).__fxPage.flood());
  expect(flooded.frame).toMatchObject({ drawn: true, built: 0 });
  expect(flooded.pipelinesAfterWarmUp).toBe(0);
  const { stats } = flooded;
  expect(stats.particles.live).toBe(FX_BUDGET.particles);
  expect(stats.particles.live).toBeLessThanOrEqual(BUDGETS.particles);
  expect(stats.particles.dropped, 'particles past the pool').toBeGreaterThan(0);
  expect([stats.sprites, stats.decals, stats.ribbons]).toEqual([
    FX_BUDGET.particles + FX_BUDGET.glows,
    FX_BUDGET.decals,
    FX_BUDGET.ribbons,
  ]);
  expect(stats.drawCalls).toBe(BUDGETS.drawCalls);
  expect(flooded.drawCalls, "r182's count is the effects' own").toBe(stats.drawCalls);
  expect(flooded.triangles).toBeLessThanOrEqual(BUDGETS.triangles);
});

test('the ID pass sees each effect: sprites, decals and ribbons', async ({ page, harness }) => {
  await open(page, harness);
  const shown = await page.evaluate(() => (window as unknown as FxWindow).__fxPage.show());
  expect(shown.frame).toMatchObject({ drawn: true, built: 0 });
  expect(shown.stats.decals, 'four telegraphs and a ring').toBe(5);
  expect(shown.stats.ribbons).toBe(1);
  const seen = new Map(shown.seen.map((entry) => [entry.name, entry.px]));
  for (const name of ['fx:sprites/page0', 'fx:decals/page0', 'fx:ribbons']) {
    expect(seen.get(name) ?? 0, `${name} in the ID pass`).toBeGreaterThan(200);
  }
  expect((await harness.readFrame()).blank).toBe(false);
});
