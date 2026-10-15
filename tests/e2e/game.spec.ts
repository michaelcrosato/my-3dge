/**
 * @file T2 for the starter game's page (labs/game/main.ts, WP 10.7), by DOM queries and `window.__engine`: it starts on
 * WebGPU with the chase camera, its HUD shows the round (the gems, the clock, the keys), the end of the round when the
 * clock runs out, and Enter starts a new round on the next seed. Every game made from the engine begins as this page.
 *
 * Invariants: the page is read through `[data-ui=hud]` elements and `__engine` only; the sim is stepped with
 * `__engine.step`, then one frame is drawn (`harness.tick`), so the HUD shows what the run holds.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: { step(n: number): number; seed(n?: number): number; camera: { get(): { code: string } } };

/** The HUD's lines, by id. */
function hud(page: Page): Promise<Record<string, string>> {
  return page
    .locator('[data-ui=hud]')
    .evaluateAll((lines) => Object.fromEntries(lines.map((line) => [line.getAttribute('data-id'), line.textContent])));
}

test('the starter game: the chase camera, the round in the HUD, its end, and Enter for the next round', async ({
  page,
  harness,
}) => {
  test.setTimeout(180_000);
  await page.goto('labs/game/');
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
  expect(await page.evaluate(() => __engine.camera.get().code)).toMatch(/^cam3=chase(,|$)/);
  await harness.tick(1);
  expect(await hud(page)).toMatchObject({ gems: 'Gems 0 / 10', clock: '30 s', keys: expect.stringContaining('WASD') });

  await page.evaluate(() => __engine.step(30 * 60));
  await harness.tick(1);
  expect(await hud(page)).toMatchObject({ gems: 'Gems 0 / 10', clock: '0 s', end: 'Time! Enter: play again' });

  await page.keyboard.press('Enter');
  await harness.tick(1);
  expect(await page.evaluate(() => __engine.seed())).toBe(2);
  const next = await hud(page);
  expect(next).toMatchObject({ gems: 'Gems 0 / 10', clock: '30 s' });
  expect(next.end).toBeUndefined();
});
