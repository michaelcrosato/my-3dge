/**
 * @file T2 for the Stress Box, stage 5 (PLAN.md §9.0, WP 6.7): the fight (labs/box/?scene=fight) on WebGPU. The
 * scripted fight (tests/replays/box-5-fight.replay.json), played in the page drawing a frame after every step, gives
 * its goldens, ends with at least three of its 36 foes cut down (their bodies thrown and removed: Done-when 1; Node's
 * labs/box/scenes/fight.test.ts measures the throw, on the same run, since the goldens match), and builds 0 pipelines
 * after the warm-up while the fight's bodies, swings, telegraphs and bolts come and go (Done-when 4). The CPU-only
 * contract for the fight is tests/e2e/parity.spec.ts's Box 5.
 *
 * Invariants: the page is driven through `window.__engine`, as an agent drives it; goldens come from the replay
 * files, never from the page itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const FIGHT = readFileSync(join(ROOT, 'tests/replays/box-5-fight.replay.json'), 'utf8');
/** How many foes the fight starts with: `box.crowd.count` in labs/box/scenes/fight.ts. */
const FOES = 36;

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** The golden hashes of a replay's text. */
const goldensOf = (text: string) =>
  (JSON.parse(text) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];

/** Opens the fight with `query`, ready on WebGPU. */
async function open(page: Page, harness: Harness, query = '') {
  await page.goto(`labs/box/?scene=fight${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

/** The foes still standing in the page. */
function standing(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (__engine.entities('fightFoe') as { id: number }[]).filter(
        ({ id }) => (__engine.get(id) as { fightHealth: { hp: number } }).fightHealth.hp > 0,
      ).length,
  );
}

test.describe('the box, stage 5: the fight', () => {
  test.setTimeout(240_000);

  test('the scripted fight gives its goldens drawn in the page, cuts down 3 or more, and builds no pipeline after the warm-up', async ({
    page,
    harness,
  }) => {
    await open(page, harness, '&cam3=chase');
    const run = await page.evaluate(
      (text) => __engine.replay(text) as Promise<{ hashes: Record<string, string>; steps: number; frames: number }>,
      FIGHT,
    );
    expect(run.hashes).toEqual(goldensOf(FIGHT));
    expect([run.steps, run.frames]).toEqual([600, 600]);
    expect(FOES - (await standing(page))).toBeGreaterThanOrEqual(3);
    const stats = await page.evaluate(() => __engine.stats() as { pipelinesAfterWarmUp: number | null });
    expect(stats.pipelinesAfterWarmUp).toBe(0);
    const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
    expect(advice).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });
});
