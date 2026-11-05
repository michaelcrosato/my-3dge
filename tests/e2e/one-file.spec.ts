/**
 * @file T2 for the one-file playground (playground.html, tools/lib/oneFile.ts; ADR-0023 amendment 5): the file, opened
 * from disk as a double-click opens it, starts the playground on WebGPU and runs it, with every request it makes a data
 * URL or the file itself; from it, Tools' engine pages and an owner's check of another page say to run npm run dev
 * first (labs/playground/ui/pages.ts). Whether the committed file matches its sources is `node x html --check`, a step
 * of the quick gate; what the playground does is its own specs' (tests/e2e/playground*.spec.ts), on the same code.
 *
 * Invariants: the page is read through `__engine` and its `[data-ui]` elements only; a request to any host fails the
 * test.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE_PAGES } from '../../labs/playground/ui/pages';
import { ONE_FILE } from '../../tools/lib/oneFile';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: { step(n: number): number; hash(): string };

test('the one-file playground: opened from disk, it starts on WebGPU and fetches nothing', async ({
  page,
  harness,
}) => {
  test.setTimeout(180_000);
  const strays: string[] = [];
  page.on('request', (request) => {
    if (!/^(data|file):/.test(request.url())) strays.push(request.url());
  });
  await page.goto(`${pathToFileURL(join(process.cwd(), ONE_FILE)).href}?scene=gym&playground.title=off`); // the gym: the block, the default, warms up for minutes on SwiftShader (playground.spec.ts opens it)
  await harness.ready({ timeout: 90_000 });
  await harness.assertWebGPU();
  const before = await page.evaluate(() => __engine.hash());
  await page.evaluate(() => __engine.step(60));
  await harness.tick(1);
  expect(await page.evaluate(() => __engine.hash())).not.toBe(before);

  // From the file, the engine's other pages are the dev server's, each saying to run npm run dev first (WP 13.38).
  const menu = (id: string) => page.locator(`[data-ui=menu][data-id="${id}"] [data-ui=item]`);
  const pick = async (from: string, id: string) => {
    await page.locator(`[data-ui=menu][data-id="${from}"] [data-ui=item][data-id="${id}"]`).click();
    await harness.tick(2);
  };
  await page.keyboard.press('Escape');
  await harness.tick(2);
  await pick('pause', 'tools');
  await pick('tools', 'pages');
  expect(await menu('pages').allTextContents()).toEqual([expect.stringMatching(/npm run dev/), ...ENGINE_PAGES.map((one) => one.label), 'Back']); // prettier-ignore
  await pick('pages', 'back');
  await pick('tools', 'back');
  await pick('pause', 'checks');
  const panel = page.locator('[data-ui=checks]');
  await panel.locator('[data-ui=item][data-id="check:labs"]').click();
  await expect(panel).toContainText(/run npm run dev/);
  await expect(panel.locator('[data-ui=item][data-id=go]')).toHaveText('Open it (needs npm run dev)');
  expect(await harness.errors()).toEqual([]);
  expect(strays).toEqual([]);
});
