/**
 * @file T2 for the box page's menu for humans (labs/box/menu.ts), by DOM queries. Under automation (navigator.webdriver,
 * which Playwright sets) the page builds none of it, so no test's screenshot holds it. With `?box.menu=on` it shows,
 * open, above the credit, and lists as links every scene of labs/box/scenes/ that the README's demo index lists, each
 * at `?scene=<name>`; every box replay at `?replay=<name>`; registered looks and the cameras, both keeping the scene;
 * and the controls, a row for each action of the page's action map. Its key is bound by no registered action map, the
 * system layer or the reserved codes, and it, like the button, hides and shows the panel. The page remembers the last
 * toggle: closed, it opens closed with its button showing; opened again, it opens open. Touch mode has no test, by
 * the owner's order (ADR-0021).
 *
 * Invariants: the page is read through DOM queries and `window.__engine` only; the room keeps the run cheap.
 */
import { globSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { RESERVED_CODES, SYSTEM_ACTIONS } from '../../engine/input/actionMaps';
import { expect, test } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const README = readFileSync(join(ROOT, 'labs/box/README.md'), 'utf8');
/** The README's demo index, up to the next heading. */
const INDEX = README.slice(
  README.indexOf('## The demo index'),
  README.indexOf('\n## ', README.indexOf('## The demo index')),
);
/** The scenes of labs/box/scenes/ the demo index lists, by name. */
const INDEXED = [...new Set([...INDEX.matchAll(/`labs\/box\/scenes\/([\w-]+)\.ts`/g)].map(([, name]) => name))].sort();
/** The box's replays, by name. */
const REPLAYS = globSync('tests/replays/box-*.replay.json', { cwd: ROOT })
  .map((file) => basename(file, '.replay.json'))
  .sort();
/** The box's own looks, by id. */
const BOX_LOOKS = globSync('labs/box/looks/torch-*.ts', { cwd: ROOT })
  .filter((file) => !file.endsWith('.test.ts'))
  .map((file) => `look:${basename(file, '.ts')}`);

/** The page's engine, inside `evaluate`. */
declare const __engine: { describe(kind: string, id?: string): unknown };

/** The hrefs of the links in the menu's section `name`. */
function hrefs(page: Page, name: string): Promise<string[]> {
  return page
    .locator(`#box-menu [data-menu=${name}] a`)
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

test('the box menu: none under automation; with box.menu=on, every scene, replay, look, camera and control', async ({
  page,
  harness,
}) => {
  test.setTimeout(180_000);
  await page.goto('labs/box/?scene=room');
  await harness.ready({ timeout: 60_000 });
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
  expect(await page.locator('#box-menu, #box-menu-toggle, #box-menu-style').count()).toBe(0);

  await page.goto('labs/box/?scene=room&box.menu=on');
  await harness.ready({ timeout: 60_000 });
  const panel = page.locator('#box-menu');
  const toggle = page.locator('#box-menu-toggle');
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const [box, credit] = [(await panel.boundingBox())!, (await page.locator('#credit').boundingBox())!];
  expect(box.y + box.height).toBeLessThanOrEqual(credit.y);

  // Scenes: every one the demo index lists, each a link to ?scene=<name> keeping the menu's setting; the room current.
  expect(INDEXED.length).toBeGreaterThanOrEqual(10);
  const scenes = await hrefs(page, 'scenes');
  expect(scenes.map((href) => new URLSearchParams(href).get('scene')).sort()).toEqual(INDEXED);
  for (const name of INDEXED) expect(scenes).toContain(`?scene=${name}&box.menu=on`);
  await expect(page.locator('#box-menu [data-menu=scenes] a[aria-current]')).toHaveAttribute('href', /^\?scene=room&/);

  // Replays, then looks and cameras that keep the scene.
  expect((await hrefs(page, 'replays')).sort()).toEqual(REPLAYS.map((name) => `?replay=${name}&box.menu=on`).sort());
  const registered = await page.evaluate(() => (__engine.describe('look') as { ids: string[] }).ids);
  const looks = (await hrefs(page, 'looks')).map((href) => new URLSearchParams(href));
  expect(looks.map((query) => query.get('post.look') ?? 'look:clean')).toEqual(
    expect.arrayContaining([...BOX_LOOKS, 'look:clean', 'look:cartoon', 'look:game-boy']),
  );
  for (const query of looks) {
    expect(registered).toContain(query.get('post.look') ?? 'look:clean');
    expect(query.get('scene')).toBe('room');
  }
  const cameras = (await hrefs(page, 'cameras')).map((href) => new URLSearchParams(href));
  expect(cameras.map((query) => `${query.get('cam') ?? ''}|${query.get('cam3') ?? ''}`)).toEqual([
    '|chase',
    '|first',
    '|orbit',
    'iso|',
    'topdown|',
  ]);
  for (const query of cameras) expect(query.get('scene')).toBe('room');

  // The controls: a row for moving, then one for each other action of the page's map, with its keys.
  const map = await page.evaluate(() => {
    const field = (id: string, key: string) =>
      (__engine.describe('actionMap', id) as { fields: { key: string; value: unknown }[] }).fields.find(
        (entry) => entry.key === key,
      )!.value;
    const ids = (__engine.describe('actionMap') as { ids: string[] }).ids;
    const codes = ids.flatMap((id) => Object.values(field(id, 'actions') as Record<string, string[]>).flat());
    const box = 'actionMap:thirdPerson';
    return { codes, actions: Object.keys(field(box, 'actions') as object), move: field(box, 'move') as string[] };
  });
  const rows = page.locator('#box-menu [data-menu=controls] tr[data-action]');
  const others = map.actions.filter((action) => !map.move.includes(action));
  expect(await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-action')))).toEqual(['move', ...others]);
  await expect(rows.first()).toContainText('W A S D');
  await expect(page.locator('#box-menu tr[data-action=jump]')).toContainText('Space');

  // The key: bound by nothing; it and the button hide and show the panel.
  const key = (await toggle.getAttribute('data-key'))!;
  expect(key).toBe('KeyM');
  expect([...map.codes, ...Object.values(SYSTEM_ACTIONS).flat(), ...RESERVED_CODES]).not.toContain(key);
  await page.keyboard.press(key);
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press(key);
  await expect(panel).toBeVisible();
  await toggle.click();
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(panel).toBeVisible();

  // The last toggle is remembered: closed, the next page opens with the panel closed and its button showing.
  await toggle.click();
  await page.goto('labs/box/?scene=room&box.menu=on');
  await harness.ready({ timeout: 60_000 });
  await expect(toggle).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press(key);
  await expect(panel).toBeVisible();
  await page.goto('labs/box/?scene=room&box.menu=on');
  await harness.ready({ timeout: 60_000 });
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await harness.errors()).toEqual([]);
  expect(harness.advice()).toEqual([]);
});
