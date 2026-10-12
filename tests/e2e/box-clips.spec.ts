/**
 * @file T2 for clip mode in the Stress Box (PLAN.md WP 8.9): the box page ships the animation library's clips, so it
 * shows 100STYLE's credit (CC BY 4.0, data/anim/SOURCES.md) on screen, whatever the scene: the title and the dataset's
 * link, the authors, the year, the license with its link, and the note of the changes (a DOM query).
 */
import { expect, test } from './fixtures';

/** The credit, as the plan words it (PLAN.md WP 8.9, WP 8.10). */
const CREDIT =
  'Motion: 100STYLE, by Mason, Starke and Komura (2022), CC BY 4.0; converted to key poses, one loop per style and gait';

test('the box page shows 100STYLE’s credit, with the dataset’s and the license’s links', async ({ page, harness }) => {
  await page.goto('labs/box/?scene=room');
  await harness.ready({ timeout: 60_000 });
  const credit = page.locator('#credit');
  await expect(credit).toBeVisible();
  expect((await credit.textContent())?.replace(/\s+/g, ' ').trim()).toBe(CREDIT);
  const links = await credit.locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
  expect(links).toEqual([
    ['100STYLE', 'https://zenodo.org/records/8127870'],
    ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ]);
  const box = (await credit.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height).toBe(true);
});
