/**
 * @file T2 for the Stress Box, stage 6 (PLAN.md §9.0, WP 7.8): the box's looks (labs/box/looks/) on WebGPU, in the
 * hall with its props (labs/box/?scene=hall-props), the sim paused, every toggle drawn:
 * 1. the torch-lit hall (`look:torch-lit`): the stage's own lights give way to the sky `sky:hall`, its light pool lit
 *    from the hall's torch spots; the torches flicker (frames drawn a third of a second apart differ over much of the
 *    picture, where the clean look's differ only at the braziers' flames); the floor is the hall's bake, its runes
 *    glowing on the dais;
 * 2. the quality tiers: each casts fewer shadows (fewer draw calls) and builds its pipelines in a warm-up before its
 *    first frame; so does the switch back to the stage's own lights (`look:clean`), and the first look in a material
 *    style (`look:torch-toon`), which joins the style set to the warm-up (at the medium tier, as what follows);
 * 3. switching between the box's looks, styles included, builds no pipeline; each in turn while the knock replay
 *    (tests/replays/box-3-knock.replay.json) plays its first 180 steps, a frame drawn after each, its goldens hold;
 *    each renders, none blank, dark or blown out, over the same ID pass.
 * No frame builds a pipeline after a warm-up (Done-when 1's toggles). The goldens in the engine's 86 looks are
 * tests/e2e/parity.spec.ts's (Box 3, props); what each filter does to the pixels is tests/e2e/post.spec.ts's.
 *
 * Invariants: the page is driven through `window.__engine`, as an agent drives it; images are read as numbers
 * (look metrics, the ID pass, the share of pixels that changed), never looked at.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The knock replay (Box 3, the hall with its props): its first 180 steps play through the box's looks. */
const KNOCK = readFileSync(join(import.meta.dirname, '../replays/box-3-knock.replay.json'), 'utf8');

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** The box's looks (labs/box/looks/). */
const BOX_LOOKS = ['torch-toon', 'torch-lit', 'torch-cel', 'torch-pixel', 'torch-bloom', 'torch-fxaa'].map(
  (name) => `look:${name}`,
);

/** What `__engine.stats()` gives that this suite reads. */
interface Stats {
  drawCalls: number;
  /** Pipelines built so far, by the warm-ups and by frames. */
  pipelines: number;
  pipelinesAfterWarmUp: number | null;
}

/** What `__engine.shot` gives that this suite reads. */
interface Shot {
  ids: { visible: { name: string }[] };
  metrics: { blank: boolean; lumaMean: number; spread: number };
}

/** Sets the view settings `values`, the sim paused, and draws `frames` frames; returns the stats after. */
function show(page: Page, values: Record<string, string>, frames = 2): Promise<Stats> {
  return page.evaluate(
    async ([v, n]) => {
      __engine.pause();
      for (const [path, value] of Object.entries(v)) __engine.set(path, value);
      await __engine.render(n);
      return __engine.stats() as Stats;
    },
    [values, frames] as const,
  );
}

/** The scene dump's lines for the objects whose names hold `filter`. */
function dumped(page: Page, filter: string): Promise<string[]> {
  return page.evaluate(
    (f) => (__engine.scene as unknown as { dump(o: object): string }).dump({ filter: f }).split('\n'),
    filter,
  );
}

/** The share of pixels of two frames of the same size whose colour moved by more than 2 in some channel. */
function changed(a: Uint8Array, b: Uint8Array): number {
  let moved = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) moved++;
  }
  return moved / (a.length / 4);
}

test('the box looks: the torch-lit hall flickers on its rune floor, every tier and look warmed before it draws, every look rendered', async ({
  page,
  harness,
}) => {
  test.setTimeout(480_000);
  await page.goto('labs/box/?scene=hall-props&cam=iso&post.look=look:torch-lit');
  await harness.ready({ timeout: 240_000 });
  await harness.assertWebGPU();
  /** How much of the picture changes over a third of a second, the sim paused. */
  const flicker = async () => {
    const before = (await harness.readFrame()).rgba;
    await page.evaluate(() => __engine.render(20));
    return changed(before, (await harness.readFrame()).rgba);
  };

  // 1. The torch-lit hall.
  const lights = await dumped(page, 'light');
  const pool = lights.filter((line) => /lights:pool\/\d+ PointLight/.test(line) && !line.includes('hidden'));
  expect(pool).toHaveLength(12);
  expect(lights.find((line) => line.includes('light:sky HemisphereLight'))).toContain('hidden');
  expect(lights.find((line) => line.includes('light:sun DirectionalLight'))).toContain('hidden');
  expect((await dumped(page, 'level:hall/floor')).join('\n')).toMatch(/level:hall\/floor Mesh .*material:hallFloor/);
  await show(page, {});
  const lit = await flicker();
  expect(lit).toBeGreaterThan(0.05);

  // 2. Each tier casts fewer shadows, its pipelines built in a warm-up before its first frame.
  const high = await show(page, { quality: 'high' });
  const medium = await show(page, { quality: 'medium' });
  const low = await show(page, { quality: 'low' });
  expect(high.drawCalls).toBeGreaterThan(medium.drawCalls);
  expect(medium.drawCalls).toBeGreaterThan(low.drawCalls);
  expect(medium.pipelines).toBeGreaterThan(high.pipelines);
  expect(low.pipelines).toBeGreaterThan(medium.pipelines);
  // The stage's own lights again: no torch left to flicker, only the braziers' flames move. The rest is drawn at the
  // medium tier: its one shadow caster makes the styles' warm-up about half as long on SwiftShader as two do.
  const clean = await show(page, { quality: 'medium', 'post.look': 'look:clean' });
  const back = await dumped(page, 'light');
  expect(back.find((line) => line.includes('light:sun DirectionalLight'))).not.toContain('hidden');
  expect(back.find((line) => line.includes('lights:pool Group'))).toContain('hidden');
  expect(await flicker()).toBeLessThan(lit / 4);
  // The first look in a material style joins the style set to the warm-up.
  const toon = await show(page, { 'post.look': 'look:torch-toon' });
  for (const tier of [high, medium, low, clean, toon]) expect(tier.pipelinesAfterWarmUp).toBe(0);
  expect(toon.pipelines).toBeGreaterThan(clean.pipelines);

  // 3. Every box look: switching builds nothing; then each in turn while the knock replay plays, a frame after each
  // step: its goldens hold, and no frame stalls (the replay starts at the default tier, which warms up first).
  for (const look of BOX_LOOKS) {
    const stats = await show(page, { 'post.look': look });
    expect([look, stats.pipelines, stats.pipelinesAfterWarmUp]).toEqual([look, toon.pipelines, 0]);
  }
  const views = BOX_LOOKS.map((look, i) => [i * 30, { set: { 'post.look': look } }]);
  const run = (await page.evaluate(([t, v]) => __engine.replay(t, { until: 180, views: v }), [
    KNOCK,
    views,
  ] as const)) as {
    hashes: Record<string, string>;
  };
  const goldens = (JSON.parse(KNOCK) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
  expect(run.hashes).toEqual(Object.fromEntries(Object.entries(goldens).filter(([step]) => Number(step) <= 180)));
  expect(((await page.evaluate(() => __engine.stats())) as Stats).pipelinesAfterWarmUp).toBe(0);
  const shots: Record<string, Shot> = {}; // after the switches: a shot's ID pass builds pipelines of its own
  for (const look of BOX_LOOKS) {
    await show(page, { 'post.look': look });
    shots[look] = (await page.evaluate(() => __engine.shot({ ids: true, metrics: true, thumbnail: false }))) as Shot;
  }
  const names = (shot: Shot) => shot.ids.visible.map((object) => object.name).sort();
  const first = shots[BOX_LOOKS[0]];
  expect(names(first)).toEqual(expect.arrayContaining(['level:hall/floor', 'actor#1']));
  for (const look of BOX_LOOKS) {
    const { metrics } = shots[look];
    expect(names(shots[look]), look).toEqual(names(first));
    expect([look, metrics.blank]).toEqual([look, false]);
    expect(metrics.lumaMean, look).toBeGreaterThan(0.08); // not dark
    expect(metrics.lumaMean, look).toBeLessThan(0.8); // not blown out
    expect(metrics.spread, look).toBeGreaterThan(0.1); // a picture, not a wash
  }
  const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
  expect(advice).not.toContain('GFX_COLD_PIPELINE');
  expect(harness.advice()).toEqual([]);
});
