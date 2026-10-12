/**
 * @file T2 for the Stress Box, stage 5 (PLAN.md §9.0, WP 6.7): the fight (labs/box/?scene=fight) on WebGPU. The
 * scripted fight (tests/replays/box-5-fight.replay.json), played in the page drawing a frame after every step, gives
 * its goldens, ends with at least three of its 36 foes cut down (their bodies thrown and removed: Done-when 1; Node's
 * labs/box/scenes/fight.test.ts measures the throw, on the same run, since the goldens match), and builds 0 pipelines
 * after the warm-up while the fight's bodies, swings, telegraphs, bolts, effects and damage numbers come and go
 * (Done-when 4). DOM queries find the damage numbers its hits put over the canvas, with the values Node's run of it
 * gives (Done-when 2). Its effects are drawn (the ID pass sees them) and never change its hashes: it gives its goldens
 * with them turned off too (`gfx.effects`, Done-when 3). Played in real time (`?replay=`), the hits' hit-stops hold its
 * steps back by the frame clock's budget (WP 6.3's deferred proof). The CPU-only contract for the fight is
 * tests/e2e/parity.spec.ts's Box 5.
 *
 * Invariants: the page is driven through `window.__engine`, as an agent drives it; goldens come from the replay
 * files, never from the page itself. Nothing from engine/ or labs/ is imported here but types: Node's run of the
 * fight is a child process, so the kinds it registers never reach the specs this worker runs next.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const FIGHT_FILE = 'tests/replays/box-5-fight.replay.json';
const FIGHT = readFileSync(join(ROOT, FIGHT_FILE), 'utf8');
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

/** Variables a test runner sets for its own workers; the Node child starts without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;

/**
 * The Node run `hitsInNode` starts, as a module run from the repository root under tsx: it plays the replay file named
 * by its argument through `box:fight`'s setup and step, with a listener on the `damage` events added, and prints the
 * hits as one line of JSON. It runs in a child process because the engine and the box register their kinds (the
 * puppet, prop and shadow materials) in the registry of the process that imports them: imported here, they would
 * stay in this Playwright worker's registry for the next spec it runs (materials.spec.ts lists that registry).
 */
const HITS_SCRIPT = `
import { readFileSync } from 'node:fs';
import { createHeadless, defineScene } from './engine/index.ts';
import { fight, fightStep, setupFight } from './labs/box/scenes/fight.ts';

const hits = [];
const watched = defineScene('box:fight-watched', {
  level: 'level:hall',
  physics: true,
  settings: fight.settings,
  setup(w) {
    setupFight(w);
    w.events.on('damage', (event) => hits.push({ step: w.tick, amount: event.amount }));
  },
  step: fightStep,
});
const engine = await createHeadless({ scene: watched });
const replay = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const held = {};
for (let k = 0, next = 0; k < replay.steps; k++) {
  let pressed;
  for (; next < replay.inputs.length && replay.inputs[next][0] === k; next++) {
    for (const [key, value] of Object.entries(replay.inputs[next][1])) {
      if (key === 'p') pressed = value;
      else if (value === null) delete held[key];
      else held[key] = value;
    }
  }
  engine.step(1, { ...held, ...(pressed ? { p: pressed } : {}) });
}
process.stdout.write('\\n' + JSON.stringify(hits.filter(({ amount }) => amount > 0)) + '\\n');
`;

/**
 * The hits of the fight in Node, by the step they landed in: a listener on its `damage` events, the run unchanged.
 * The run is a child process (`HITS_SCRIPT`), so this worker never imports the engine or the box.
 */
function hitsInNode(file: string): { step: number; amount: number }[] {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', HITS_SCRIPT, file], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    timeout: 180_000,
  });
  if (run.status !== 0) throw new Error(`the fight's Node run failed (${run.status}):\n${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').at(-1)!) as { step: number; amount: number }[];
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

  test('DOM queries find the damage numbers its hits put over the canvas, with their values', async ({
    page,
    harness,
  }) => {
    const hits = hitsInNode(FIGHT_FILE);
    // a step after a flurry, with no hit in the half second before it: its numbers alone are on screen (0.8 s each)
    const at = hits.find(({ step }) => step > 60 && !hits.some((hit) => hit.step > step - 30 && hit.step < step))!.step;
    const until = at + 20;
    const expected = hits.filter(({ step }) => step >= at && step <= until).map(({ amount }) => String(amount));
    expect(expected.length).toBeGreaterThan(0);
    await open(page, harness);
    await page.evaluate(([text, n]) => __engine.replay(text, { until: n }), [FIGHT, until] as const);
    const numbers = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-ui=damage]')].map((element) => ({
        value: element.dataset.value,
        text: element.textContent,
        shown: element.checkVisibility(),
      })),
    );
    expect(numbers.map(({ value }) => value).sort()).toEqual([...expected].sort());
    for (const number of numbers) expect([number.text, number.shown]).toEqual([number.value, true]);
    expect(harness.advice()).toEqual([]);
  });

  test('its effects are drawn, and turning them off never changes the hash', async ({ page, harness }) => {
    const effects = async (on: boolean) => {
      await open(page, harness, '&cam=iso');
      const views = [[0, { set: { 'gfx.effects': on } }]];
      const run = await page.evaluate(
        ([text, v]) => __engine.replay(text, { until: 240, views: v }) as Promise<{ hashes: Record<string, string> }>,
        [FIGHT, views] as const,
      );
      const shot = await page.evaluate(
        () =>
          __engine.shot({ ids: true, metrics: false, thumbnail: false }) as Promise<{
            ids: { visible: { name: string; px: number }[] };
          }>,
      );
      const drawn = shot.ids.visible.filter(({ name }) => name.startsWith('fx:')).reduce((sum, { px }) => sum + px, 0);
      return { hashes: run.hashes, drawn };
    };
    const goldens = goldensOf(FIGHT);
    const upTo240 = Object.fromEntries(Object.entries(goldens).filter(([step]) => Number(step) <= 240));
    const on = await effects(true);
    expect(on.hashes).toEqual(upTo240);
    expect(on.drawn).toBeGreaterThan(0);
    const off = await effects(false);
    expect(off.hashes).toEqual(upTo240);
    expect(off.drawn).toBe(0);
    expect(harness.advice()).toEqual([]);
  });

  test('played in real time, its hits’ hit-stops hold its steps back', async ({ page, harness }) => {
    await page.goto('labs/box/?replay=box-5-fight');
    await harness.ready({ timeout: 60_000 });
    await harness.tick(1); // the clock's origin
    await harness.tick(480);
    const tick = await page.evaluate(() => (__engine.info() as { tick: number }).tick);
    expect(tick).toBeGreaterThan(400);
    expect(tick).toBeLessThan(480 - 3); // stopped for a few frames, the budget shrinking stops that follow closely
    expect(harness.advice()).toEqual([]);
  });
});
