/**
 * @file T2 for the feature framework (PLAN.md WP 11.1, §6.7, I-16; doctrine: WebGPU only): the feature matrix. Each
 * optional GPU feature the page's registry holds (engine/gfx/features.ts: timestamp queries, filtering of 32-bit float
 * textures, large storage buffers; each later technique's as its WP lands) is turned off in turn by the view setting
 * `gfx.featuresOff`, and all of them at once, in the box's hall with its hero, seen from above. In each:
 * 1. `__engine.info()` lists it among the downgrades by its advice code, not among the features, and the code is
 *    raised once: the advice trap catches exactly the codes of the features off;
 * 2. the hall's climbing replay (box-3-climb), a frame drawn every 10 steps, gives its goldens to step 300: a
 *    feature off never changes play;
 * 3. the gameplay entities in view appear in the ID pass: the downgraded look is playable.
 * With none off, this platform's SwiftShader adapter has them all: every feature on, no downgrade.
 *
 * Invariants: the features are the page's registry's, which the first test compares with the spec's own list
 * (`FEATURES`, the engine's entries as the page defines them), so a feature added without its row here fails loudly;
 * goldens come from the replay file, never from a run here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createRegistry } from '../../engine/core/registry';
import { defineFeatures } from '../../engine/gfx/features';
import { expect, test, type Harness } from './fixtures';

/** The engine's features, by id, with their advice codes: what every page's registry holds. */
const FEATURES = (() => {
  const registry = createRegistry();
  defineFeatures(registry);
  return registry.list('feature').map((entry) => ({ id: entry.id, advice: (entry as unknown as { advice: string }).advice })); // prettier-ignore
})();

const REPLAY = readFileSync(join(import.meta.dirname, '../replays/box-3-climb.replay.json'), 'utf8');
/** The replay's goldens to step `UNTIL`. */
const UNTIL = 300;
const GOLDEN = Object.fromEntries(Object.entries((JSON.parse(REPLAY) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64']).filter(([step]) => Number(step) <= UNTIL)); // prettier-ignore

/** The page's engine, inside `evaluate`. */
declare const __engine: {
  info(): { features: string[]; downgrades: string[] };
  describe(kind: string): { ids: string[] };
  replay(text: string, options: object): Promise<{ hashes: Record<string, string> }>;
  render(frames: number): Promise<unknown>;
  shot(options: object): Promise<{ ids: { visible: { entity?: number }[] } }>;
  entities(kind: string): { id: number }[];
};

test.describe.configure({ mode: 'parallel', timeout: 300_000 });

/** Opens the hall from above with `off` turned off. */
async function open(page: Page, harness: Harness, off: readonly string[]): Promise<void> {
  const query = off.length ? `&gfx.featuresOff=${encodeURIComponent(JSON.stringify(off))}` : '';
  await page.goto(`labs/box/?scene=hall&cam=topdown${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

/** Plays the replay to `UNTIL`, drawing every 10th step, then settles the camera; what the ID pass sees of the actors. */
async function play(page: Page) {
  return page.evaluate(
    async ({ text, until }) => {
      const run = await __engine.replay(text, { until, draw: 10 });
      await __engine.render(30); // the camera that follows the hero settles on him: the hall is larger than a view
      const shot = await __engine.shot({ ids: true, metrics: false, thumbnail: false });
      const actors = __engine.entities('actor').map((e) => e.id);
      return { hashes: run.hashes, actors, visible: shot.ids.visible.flatMap((e) => (e.entity === undefined ? [] : [e.entity])) }; // prettier-ignore
    },
    { text: REPLAY, until: UNTIL },
  );
}

test('with none off, every feature is on: the page’s registry holds the spec’s features, and play holds', async ({
  page,
  harness,
}) => {
  await open(page, harness, []);
  const { info, ids } = await page.evaluate(() => ({ info: __engine.info(), ids: __engine.describe('feature').ids }));
  expect(ids).toEqual(FEATURES.map((feature) => feature.id)); // a new feature needs its row in FEATURES
  expect(info).toMatchObject({ features: ids, downgrades: [] });
  const seen = await play(page);
  expect(seen.hashes).toEqual(GOLDEN);
  expect(seen.actors.length).toBeGreaterThan(0);
  expect([...new Set(seen.visible)].sort()).toEqual(seen.actors);
  expect(harness.advice()).toEqual([]);
});

for (const off of [...FEATURES.map((feature) => [feature]), FEATURES]) {
  const name = off.length === FEATURES.length ? 'every feature' : off[0].id;
  test(`with ${name} off: its advice once, the replay’s goldens, the entities in the ID pass`, async ({
    page,
    harness,
  }) => {
    await open(
      page,
      harness,
      off.map((feature) => feature.id),
    );
    const info = await page.evaluate(() => __engine.info());
    const codes = [...new Set(off.map((feature) => feature.advice))].sort();
    expect(info.features).toEqual(FEATURES.filter((feature) => !off.includes(feature)).map((feature) => feature.id));
    expect(info.downgrades).toEqual(codes);
    const raised = harness.advice(); // every code since the page opened
    expect(raised.map((advice) => advice.code).sort()).toEqual(off.map((feature) => feature.advice).sort());
    const seen = await play(page);
    expect(seen.hashes).toEqual(GOLDEN); // a feature off never changes play
    expect(seen.actors.length).toBeGreaterThan(0);
    expect([...new Set(seen.visible)].sort()).toEqual(seen.actors); // the downgraded look is playable
    expect(harness.advice()).toEqual(raised); // nothing more since the start
  });
}
