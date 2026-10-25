/**
 * @file T2 for the lab pages (PLAN.md WP 10.8; `my-3d2dge:tools/labs-test.mjs`, ported): the labs index lists every
 * link of labs/labs.json; every lab's first link opens ready on WebGPU with its panel (its title, the `x` command that
 * does the same job without the page, entries to open) and no advice; and each lab's own controls do their job:
 * the Animation Lab's timeline and bones (drawn over the whole view), the Cameras Lab's blend, the Physics Lab's step,
 * the Library Lab's search, Mirror and Apply. Each lab's other links are the index's (tests/unit and `x lab list`
 * check them as data).
 *
 * Invariants: DOM queries and `__engine` only, never pixels but the bone overlay's own canvas; frames drawn by
 * calling the page.
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { labLinks, type LabsIndex } from '../../labs/index/labs';
import { expect, test } from './fixtures';

const INDEX = JSON.parse(readFileSync(new URL('../../labs/labs.json', import.meta.url), 'utf8')) as LabsIndex;
/** The labs this WP made, each opened at its first link. */
const LABS = INDEX.sections.find((section) => section.id === 'keep')!.entries;

/** The page's engine, inside `evaluate`. */
declare const __engine: {
  render(frames: number): Promise<unknown>;
  info(): { tick: number; scene: string };
  camera: { get(): { code: string } };
};

test.describe.configure({ timeout: 480_000 });

/** Opens `path`, ready, on WebGPU. */
async function open(
  page: Page,
  harness: { ready(o?: object): Promise<void>; assertWebGPU(): Promise<unknown> },
  path: string,
) {
  // prettier-ignore
  await page.goto(path);
  await harness.ready({ timeout: 300_000 });
  await harness.assertWebGPU();
}

test('the labs index lists every link of labs/labs.json, each with its x command', async ({ page }) => {
  await page.goto('labs/index/');
  await expect(page.locator('#list .lab').first()).toBeVisible();
  const hrefs = await page.locator('#list a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(labLinks(INDEX).map((link) => link.href));
  const commands = await page.locator('#list .lab code').allTextContents();
  expect(commands.length).toBe(INDEX.sections.reduce((sum, section) => sum + section.entries.length, 0));
  for (const command of commands) expect(command).toContain('node x');
});

for (const lab of LABS) {
  test(`${lab.title} opens ready with its panel: its x command and entries to open`, async ({ page, harness }) => {
    await open(page, harness, `labs/${lab.page}/${lab.links[0][1]}`);
    await expect(page.locator('#lab h1')).toHaveText(lab.title);
    await expect(page.locator('#lab .lab-command code')).toContainText('node x');
    expect(await page.locator('#lab section a').count(), 'entries to open').toBeGreaterThan(1);
    await expect(page.locator('#lab .lab-status')).not.toContainText('did not start');
    expect(harness.advice()).toEqual([]);
  });
}

test("the Animation Lab scrubs a move's phases and draws the row's bones", async ({ page, harness }) => {
  await open(page, harness, 'labs/anim/?lab.anim.play=move:jab&lab.anim.time=0.2');
  expect(await page.locator('#lab [data-phase]').count(), 'wind-up, strike, recovery').toBe(3);
  await page.locator('#bones').check();
  await page.evaluate(() => __engine.render(2));
  const box = await page.locator('#overlay').evaluate((canvas: HTMLCanvasElement) => [canvas.clientWidth, canvas.clientHeight, innerWidth, innerHeight]); // prettier-ignore
  expect(box.slice(0, 2), 'the overlay over the whole view, as the figures are drawn').toEqual(box.slice(2));
  const drawn = await page.locator('#overlay').evaluate((canvas: HTMLCanvasElement) => {
    const g = canvas.getContext('2d')!;
    const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) lit += data[i] > 0 ? 1 : 0;
    return lit;
  });
  expect(drawn, 'the bones over the figures').toBeGreaterThan(200);
  expect(harness.advice()).toEqual([]);
});

test('the Cameras Lab blends to another camera', async ({ page, harness }) => {
  await open(page, harness, 'labs/cameras/');
  const before = await page.evaluate(() => __engine.camera.get().code);
  await page.locator('#lab section[data-section="Blend to"] button', { hasText: 'orbit' }).click();
  await page.evaluate(() => __engine.render(30));
  const after = await page.evaluate(() => __engine.camera.get().code);
  expect([before.startsWith('cam=iso'), after.startsWith('cam3=orbit')]).toEqual([true, true]);
  expect(harness.advice()).toEqual([]);
});

test("the Physics Lab steps its ragdolls' sim a tick at a time", async ({ page, harness }) => {
  await open(page, harness, 'labs/physics/');
  const time = page.locator('#lab section[data-section="Time"]');
  await time.locator('button', { hasText: 'Pause' }).click();
  const tick = await page.evaluate(() => __engine.info().tick);
  await time.locator('button', { hasText: 'Step' }).click();
  expect(await page.evaluate(() => __engine.info().tick)).toBe(tick + 1);
  await page.evaluate(() => __engine.render(1));
  await expect(page.locator('#lab .lab-readout')).toContainText('ragdolls');
  expect(harness.advice()).toEqual([]);
});

test('the Library Lab searches the catalog, mirrors a clip and plays an edit', async ({ page, harness }) => {
  await open(page, harness, 'labs/library/');
  await page.locator('#search').fill('cartwheel');
  await expect(page.locator('#hits a').first()).toHaveText(/Cartwheel/);
  const text = await page.locator('#clip-text').inputValue();
  await page.locator('#lab button', { hasText: 'Mirror' }).click();
  expect(await page.locator('#clip-text').inputValue()).not.toBe(text);
  await expect(page.locator('#lab section[data-section="On every build"] a')).toHaveAttribute('href', '../anim/?lab.anim.play=clip:quaternius%2FDance_Loop'); // prettier-ignore
  await page.locator('#lab button', { hasText: 'Apply' }).click();
  await expect(page.locator('#lab .lab-status')).toContainText('playing your edit, lab1/');
  await page.evaluate(() => __engine.render(2));
  expect(harness.advice()).toEqual([]);
});
