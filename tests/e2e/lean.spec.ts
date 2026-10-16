/**
 * @file T2 for the lean package (lean/, tools/lib/lean.ts; ADR-0024 amendment 1): lean/game.html, opened as a file, as
 * a double-click opens it, loads the engine, three.js and Rapier through its import map's jsDelivr URLs, starts on
 * WebGPU, shows the round in its HUD, and ends it when the clock runs out. This spec serves those URLs from lean/ and
 * node_modules, so it needs no network: the bytes are the ones the CDN serves, since the URLs name the versions
 * package.json pins (tools/lib/lean.test.ts checks that each mapped file is there at that version).
 *
 * Invariants: the page is read through `[data-ui=hud]` elements and `__engine` only, as tests/e2e/game.spec.ts reads
 * the starter's page; a request to any other host fails the test.
 */
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { LEAN_URL } from '../../tools/lib/lean';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: { step(n: number): number; seed(n?: number): number; camera: { get(): { code: string } } };

/** The repository root: Playwright runs from it. */
const ROOT = process.cwd();

/** The types the routed files are served with: a module script loads only with a JavaScript one. */
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

/** The local file behind a jsDelivr URL: the lean package's own from lean/, an npm package's from node_modules. */
function localFile(url: string): string | null {
  if (url.startsWith(LEAN_URL)) return join(ROOT, 'lean', url.slice(LEAN_URL.length));
  const npm = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/.exec(url);
  return npm ? join(ROOT, 'node_modules', npm[1], npm[2]) : null;
}

/** Serves the page's CDN requests from this checkout, and records any request that leaves it. */
async function serveCdn(page: Page, strays: string[]): Promise<void> {
  await page.route(/^https?:\/\//, async (route: Route) => {
    const url = route.request().url();
    const file = url.startsWith('https://cdn.jsdelivr.net/') ? localFile(url) : null;
    if (!file || !existsSync(file)) {
      strays.push(url);
      return route.abort();
    }
    const headers = { 'access-control-allow-origin': '*' };
    await route.fulfill({ path: file, contentType: TYPES[extname(file)] ?? 'application/octet-stream', headers });
  });
}

/** The HUD's lines, by id. */
function hud(page: Page): Promise<Record<string, string>> {
  return page
    .locator('[data-ui=hud]')
    .evaluateAll((lines) => Object.fromEntries(lines.map((line) => [line.getAttribute('data-id'), line.textContent])));
}

test('the lean package: game.html, opened as a file, plays from its CDN URLs', async ({ page, harness }) => {
  test.setTimeout(180_000);
  const strays: string[] = [];
  await serveCdn(page, strays);
  await page.goto(pathToFileURL(join(ROOT, 'lean/game.html')).href);
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
  expect(strays).toEqual([]);
});
