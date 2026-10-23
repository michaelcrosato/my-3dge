/**
 * @file T2 for the Stress Box, stage 6 (PLAN.md §9.0, WP 7.8): the box's looks (labs/box/looks/) on WebGPU, in the
 * hall with its props (labs/box/?scene=hall-props), the sim paused, every toggle drawn:
 * 1. the torch-lit hall (`look:torch-lit`): the stage's own lights give way to the sky `sky:hall`, its light pool lit
 *    from the hall's torch spots (64 lights with tiled lighting); the torches flicker (frames drawn a third of a second
 *    apart differ over much of the picture, where the clean look's differ only at the braziers' flames); the floor is
 *    the hall's bake, its runes glowing on the dais;
 * 2. the quality tiers: each casts fewer shadows (fewer draw calls) and builds its pipelines in a warm-up before its
 *    first frame; so does the switch back to the stage's own lights (`look:clean`), and the first look in a material
 *    style (`look:torch-toon`), which joins the style set to the warm-up (at the medium tier, as what follows);
 * 3. each of the box's looks, a test of its own, drawn from the start: it warms up before it draws, renders (none
 *    blank, dark or blown out) and sees what the torch-lit hall sees (the same ID pass); switching between the
 *    torch-lit looks, styles included, builds no pipeline, before and after a visit to the day, whose casting sun a
 *    switch to and from warms up for first, a second round trip no dearer than the first; each in turn, the day's
 *    among them, while the knock replay (tests/replays/box-3-knock.replay.json) plays its first 180 steps, a frame
 *    drawn after each, its goldens hold.
 * No frame builds a pipeline after a warm-up (Done-when 1's toggles). One test per look (after G9): a failure names
 * its look, and each has its own time limit. The scene and the looks it covers are the test's
 * annotations in out/e2e/report.json (`looks`): the hall with its props, every box look. The goldens with a look of
 * each material style in the box page are tests/e2e/parity.spec.ts's (Box 3, props); every one of the engine's 98
 * looks with no pipeline built and the hash unchanged, and what each filter does to the pixels, are
 * tests/e2e/post.spec.ts's.
 *
 * Invariants: the page is driven through `window.__engine`, as an agent drives it; images are read as numbers
 * (look metrics, the ID pass, the share of pixels that changed), never looked at.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

/** The knock replay (Box 3, the hall with its props): its first 180 steps play through the box's looks. */
const KNOCK = readFileSync(join(import.meta.dirname, '../replays/box-3-knock.replay.json'), 'utf8');

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** The box's looks (labs/box/looks/): the torch-lit hall's, and the plain day's (WP 11.5) with its cascaded sun. */
const BOX_LOOKS = ['torch-toon', 'torch-lit', 'torch-cel', 'torch-pixel', 'torch-bloom', 'torch-fxaa', 'daylight'].map(
  (name) => `look:${name}`,
);
/** The day's look, the one with a sun that casts. */
const DAY = 'look:daylight';

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

/** Opens the hall with its props from the iso camera in `look`, ready on WebGPU. */
async function open(page: Page, harness: Harness, look: string, query = ''): Promise<void> {
  await page.goto(`labs/box/?scene=hall-props&cam=iso&post.look=${look}${query}`);
  await harness.ready({ timeout: 240_000 });
  await harness.assertWebGPU();
}

/** A shot of what the page draws now, with its ID pass and look metrics. */
const shoot = (page: Page) =>
  page.evaluate(() => __engine.shot({ ids: true, metrics: true, thumbnail: false })) as Promise<Shot>;
/** The names a shot's ID pass sees, sorted. */
const names = (shot: Shot) => shot.ids.visible.map((object) => object.name).sort();

test('look:torch-lit: the hall flickers on its rune floor, and every tier and the clean look warm up before they draw', async ({
  page,
  harness,
}) => {
  test.setTimeout(420_000); // three tiers' warm-ups and the toon style's under the sky on a loaded SwiftShader
  test.info().annotations.push({ type: 'looks', description: 'box:hall-props: look:torch-lit, look:clean, look:torch-toon' }); // prettier-ignore
  await open(page, harness, 'look:torch-lit');
  /** How much of the picture changes over a third of a second, the sim paused. */
  const flicker = async () => {
    const before = (await harness.readFrame()).rgba;
    await page.evaluate(() => __engine.render(20));
    return changed(before, (await harness.readFrame()).rgba);
  };

  // 1. The torch-lit hall.
  const lights = await dumped(page, 'light');
  const pool = lights.filter((line) => /lights:pool\/\d+ PointLight/.test(line) && !line.includes('hidden'));
  expect(pool).toHaveLength(64); // tiled lighting's pool (WP 11.5); tests/e2e/enhanced.spec.ts has the 12 without it
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
  expect(harness.advice()).toEqual([]);
});

// 3a. Each box look on its own: drawn from the start (the medium tier), it warms up before it draws, renders, and sees
// what the torch-lit hall sees.
for (const look of BOX_LOOKS) {
  test(`${look}: it warms up before it draws, renders (not blank, dark or blown out), over the torch-lit hall's ID pass`, async ({
    page,
    harness,
  }) => {
    test.setTimeout(240_000);
    test.info().annotations.push({ type: 'looks', description: `box:hall-props: ${look}, look:torch-lit` });
    await open(page, harness, look, '&quality=medium');
    expect((await show(page, {})).pipelinesAfterWarmUp).toBe(0);
    const shot = await shoot(page);
    expect([look, shot.metrics.blank]).toEqual([look, false]);
    expect(shot.metrics.lumaMean, look).toBeGreaterThan(0.08); // not dark
    expect(shot.metrics.lumaMean, look).toBeLessThan(0.8); // not blown out
    expect(shot.metrics.spread, look).toBeGreaterThan(0.1); // a picture, not a wash
    expect(names(shot)).toEqual(expect.arrayContaining(['level:hall/floor', 'actor#1']));
    await show(page, { 'post.look': 'look:torch-lit' });
    expect(names(await shoot(page)), look).toEqual(names(shot));
    const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
    expect(advice).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });
}

// 3b. Every box look in turn: no switch builds in a frame, and among the torch-lit looks none builds at all; to and
// from the day's casting sun a switch warms up, a second round trip no dearer than the first; and while the knock
// replay plays its first 180 steps, a frame after each, through every look in turn, the day's among them, its goldens
// hold and no frame stalls.
test('every box look in turn: no switch builds in a frame, and the knock replay keeps its goldens through them', async ({
  page,
  harness,
}) => {
  test.setTimeout(480_000); // every style's warm-up on its first switch, under the sky, and the day's both ways twice
  test.info().annotations.push({ type: 'looks', description: `box:hall-props: ${BOX_LOOKS.join(', ')}` });
  await open(page, harness, 'look:torch-toon', '&quality=medium');
  const toon = await show(page, {});
  for (const look of BOX_LOOKS.filter((name) => name !== DAY)) {
    const stats = await show(page, { 'post.look': look }); // one sky: a switch among them builds nothing
    expect([look, stats.pipelines, stats.pipelinesAfterWarmUp]).toEqual([look, toon.pipelines, 0]);
  }
  // The day's sun casts: a switch to it, and one back, warms up first, never in a frame (r182 frees the pipelines a sky
  // leaves unused and builds them again when it returns, engine/gfx/pipelines.ts: about 40 to the day here and 25
  // back, each time), so a second round trip costs no more than the first.
  const trip = async (from: number) => {
    const day = await show(page, { 'post.look': DAY });
    const back = await show(page, { 'post.look': BOX_LOOKS[0] });
    expect([day.pipelinesAfterWarmUp, back.pipelinesAfterWarmUp]).toEqual([0, 0]);
    return { built: [day.pipelines - from, back.pipelines - day.pipelines], after: back.pipelines };
  };
  const first = await trip(toon.pipelines);
  for (const look of BOX_LOOKS.filter((name) => name !== DAY)) {
    const stats = await show(page, { 'post.look': look }); // and among the torch-lit looks again, nothing
    expect([look, stats.pipelines, stats.pipelinesAfterWarmUp]).toEqual([look, first.after, 0]);
  }
  const second = await trip(first.after);
  console.log(`pipelines built to the day and back: ${JSON.stringify([first.built, second.built])}`);
  expect(second.built.map((n, i) => n <= first.built[i])).toEqual([true, true]);
  const views = BOX_LOOKS.map((look, i) => [i * 25, { set: { 'post.look': look } }]); // the day's at step 150
  const run = (await page.evaluate(([t, v]) => __engine.replay(t, { until: 180, views: v }), [
    KNOCK,
    views,
  ] as const)) as {
    hashes: Record<string, string>;
  };
  const goldens = (JSON.parse(KNOCK) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
  expect(run.hashes).toEqual(Object.fromEntries(Object.entries(goldens).filter(([step]) => Number(step) <= 180)));
  expect(((await page.evaluate(() => __engine.stats())) as Stats).pipelinesAfterWarmUp).toBe(0);
  const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
  expect(advice).not.toContain('GFX_COLD_PIPELINE');
  expect(harness.advice()).toEqual([]);
});
