/**
 * @file T2 for the playground's page (labs/playground/main.ts, PLAN.md WP 13.1), by DOM queries and `window.__engine`:
 * 1. the gym opens on WebGPU in the shooter camera and the cel look, its HUD names them and the keys, and the signs of
 *    the features near the player show while the far ones hide;
 * 2. T cycles the five camera modes and P switches the two looks, live, while the player runs, building 0 pipelines
 *    after the warm-up;
 * 3. the gym's replay keeps its goldens in the page while it renders through every camera mode and both looks;
 * 4. the menu for humans (`?playground.menu=on`) lists the scene, the five cameras, the two looks and the replay.
 *
 * Invariants: the page is read through `[data-ui]` elements, the menu's links and `__engine` only; the sim is stepped
 * with `__engine.step`, then frames are drawn (`__engine.render`), so the HUD and the signs show what the run holds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS } from '../../labs/playground/views';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** The gym's replay. */
const GYM = readFileSync(join(import.meta.dirname, '../replays/playground-gym.replay.json'), 'utf8');

/** Calls the `__engine` member at `path` (`camera.get`) with `args`. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** The HUD's lines, by id. */
function hud(page: Page): Promise<Record<string, string>> {
  return page
    .locator('[data-ui=hud]')
    .evaluateAll((lines) => Object.fromEntries(lines.map((line) => [line.getAttribute('data-id'), line.textContent])));
}

/** Whether the sign of the feature `id` shows. */
function signShown(page: Page, id: string): Promise<boolean> {
  return page.locator(`[data-ui=label][data-id="sign:${id}"]`).evaluate((label) => !(label as HTMLElement).hidden);
}

/** The advice codes the page raised. */
function adviceCodes(page: Page): Promise<string[]> {
  return page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
}

/** Opens the playground at `query` and waits for it. */
async function open(page: Page, harness: { ready(o: { timeout: number }): Promise<unknown> }, query = '') {
  await page.goto(`labs/playground/${query}`);
  await harness.ready({ timeout: 120_000 });
  await call(page, 'pause');
  await call(page, 'render', 2);
}

test.describe('the playground', () => {
  test.setTimeout(300_000);

  test('opens the gym in the shooter camera and the cel look, with the HUD and the signs near the player', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await harness.assertWebGPU();
    expect((await call<{ code: string }>(page, 'camera.get')).code).toMatch(/^cam3=chase(,|$)/);
    expect(await hud(page)).toMatchObject({
      mode: 'Camera: shooter · Look: cel',
      keys: expect.stringContaining('T: camera · P: look'),
    });
    expect(await signShown(page, 'mantle-1')).toBe(true); // 12 m south of the spawn, in front of the camera
    expect(await signShown(page, 'tower-6')).toBe(false); // 59 m away
    expect(harness.advice()).toEqual([]);
  });

  test('T cycles the five cameras and P the two looks while the player runs, building 0 pipelines after the warm-up', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const name = (id: string) => id.replace('look:playground-', '');
    for (const look of [PLAYGROUND_LOOKS[0], PLAYGROUND_LOOKS[1], PLAYGROUND_LOOKS[0]]) {
      expect((await hud(page)).mode).toContain(`Look: ${name(look)}`);
      for (const mode of [...PLAYGROUND_CAMERAS.slice(1), PLAYGROUND_CAMERAS[0]]) {
        await page.keyboard.press('KeyT');
        expect((await call<{ code: string }>(page, 'camera.get')).code.split(',')[0]).toBe(mode.code);
        await call(page, 'step', 6, { move: [-0.6, 0.8] });
        await call(page, 'render', 2);
        expect((await hud(page)).mode).toBe(`Camera: ${mode.name} · Look: ${name(look)}`);
      }
      await page.keyboard.press('KeyP');
      await call(page, 'render', 2);
    }
    expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
    expect(await adviceCodes(page)).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });

  test('keeps the gym replay’s goldens while it renders through every camera mode and both looks', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const views: [number, { cam?: string; set?: Record<string, string> }][] = [
      ...PLAYGROUND_CAMERAS.map((mode, i): [number, { cam: string }] => [i * 100, { cam: mode.code }]),
      [250, { set: { 'post.look': PLAYGROUND_LOOKS[1] } }],
    ];
    const run = await call<{ hashes: Record<string, string> }>(page, 'replay', GYM, { views });
    const goldens = (JSON.parse(GYM) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
    expect(run.hashes).toEqual(goldens);
    expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
    expect(await adviceCodes(page)).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });

  test('shows the menu for humans when asked: the scene, five cameras, two looks and the replay', async ({
    page,
    harness,
  }) => {
    await open(page, harness, '?playground.menu=on');
    const links = (section: string) =>
      page.locator(`#playground-menu [data-menu=${section}] a`).evaluateAll((all) => all.map((a) => a.textContent));
    expect(await links('scenes')).toEqual(['gym']);
    expect(await links('cameras')).toEqual(PLAYGROUND_CAMERAS.map((mode) => mode.name));
    expect(await links('looks')).toEqual(['cel', 'pixel']);
    expect(await links('replays')).toEqual(['gym']);
    expect(await page.locator('#playground-menu [data-menu=controls] tr').count()).toBeGreaterThanOrEqual(8);
    await page.keyboard.press('KeyM');
    expect(await page.locator('#playground-menu').isHidden()).toBe(true);
    expect(harness.advice()).toEqual([]);
  });
});
