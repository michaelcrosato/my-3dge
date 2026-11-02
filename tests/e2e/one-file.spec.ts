/**
 * @file T2 for the one-file playground (playground.html, tools/lib/oneFile.ts; ADR-0023 amendment 5): the file, opened
 * from disk as a double-click opens it, starts the playground on WebGPU and runs it, with every request it makes a
 * data URL or the file itself. Whether the committed file matches its sources is `node x html --check`, a step of the
 * quick gate; what the playground does is its own specs' (tests/e2e/playground*.spec.ts), on the same code.
 *
 * Invariants: the page is read through `__engine` only; a request to any host fails the test.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  await page.goto(`${pathToFileURL(join(process.cwd(), ONE_FILE)).href}?playground.title=off`);
  await harness.ready({ timeout: 90_000 });
  await harness.assertWebGPU();
  const before = await page.evaluate(() => __engine.hash());
  await page.evaluate(() => __engine.step(60));
  await harness.tick(1);
  expect(await page.evaluate(() => __engine.hash())).not.toBe(before);
  expect(await harness.errors()).toEqual([]);
  expect(strays).toEqual([]);
});
