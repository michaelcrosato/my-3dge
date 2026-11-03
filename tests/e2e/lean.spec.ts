/**
 * @file T2 for the lean package (lean/, tools/lib/lean.ts; ADR-0024 amendment 1): lean/game.html, opened as a file, as
 * a double-click opens it, loads the engine, three.js and Rapier through its import map's jsDelivr URLs, starts on
 * WebGPU, shows the round in its HUD, and ends it when the clock runs out; it takes a look, a look laid on and a
 * filter's change from its URL, as lean/README.md's "Make it look different" says; and the README's recipes for
 * particles, sound and a prop's light work in it, written into a copy of it (`withRecipes`). This spec serves those URLs from lean/ and
 * node_modules, so it needs no network: the bytes are the ones the CDN serves, since the URLs name the versions
 * package.json pins (tools/lib/lean.test.ts checks that each mapped file is there at that version).
 *
 * Invariants: the page is read through `[data-ui=hud]` elements and `__engine` only, as tests/e2e/game.spec.ts reads
 * the starter's page; a request to any other host fails the test.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { LEAN_URL } from '../../tools/lib/lean';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: {
  step(n: number): number;
  seed(n?: number): number;
  camera: { get(): { code: string } };
  look(): { look: string; filters: Record<string, Record<string, unknown>> };
  fx: { stats(): { events: number; particles: { born: number } } };
  state(name: string): { entities: { propLight: { on: boolean } }[] };
};

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

test("a lean game takes a look, a layer and a filter's change from its URL, as lean/README.md says", async ({
  page,
  harness,
}) => {
  test.setTimeout(180_000);
  const strays: string[] = [];
  await serveCdn(page, strays);
  const query = new URLSearchParams({
    'post.look': 'look:storybook',
    'post.combine': JSON.stringify([{ look: 'look:vignette/soft', amount: 0.6 }]),
    'post.filters': JSON.stringify({ grade: { scope: 'characters', saturation: 0 } }),
  });
  await page.goto(`${pathToFileURL(join(ROOT, 'lean/game.html')).href}?${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
  await harness.tick(2);
  const look = await page.evaluate(() => __engine.look());
  expect(look.look).toBe('look:storybook');
  expect(look.filters.watercolor).toMatchObject({ scope: 'all', amount: 1 });
  expect(look.filters.paper).toMatchObject({ scope: 'all', kind: 'coldpress' });
  // the layer fades in where the look has no vignette: its preset's numbers at 0.6 of its amount
  expect(look.filters.vignette).toMatchObject({ scope: 'all', amount: 0.6, strength: 0.35, softness: 0.7 });
  expect(look.filters.grade).toMatchObject({ scope: 'characters', saturation: 0 });
  expect(strays).toEqual([]);
});

/** lean/README.md's recipes for particles, sound and a prop's light, written into game.html at its anchors. */
const RECIPES: [anchor: string, after: string][] = [
  [
    "      } from 'my3dge';\n",
    "      import { createAudio, defineEmitter, spawnProp } from 'my3dge';\n" +
      "      defineEmitter('emitter:lit', { events: ['lit'], layers: [{ emitter: 'emitter:fireflies', count: 24 }] });\n",
  ],
  [
    "          w.systems.add('game.clock', clock, { phase: 'rules' });\n",
    "          const id = spawnProp(w, { prop: 'prop:lantern', at: [START[0] + 2, 0, START[2] + 2], yaw: 0 }, { on: false });\n" +
      "          w.systems.add('game.light', (w) => {\n" +
      '            if (w.tick !== 30) return;\n' +
      '            w.get(id).propLight.on = true;\n' +
      "            w.emit('lit', { x: START[0] + 2, y: 1.2, z: START[2] + 2, sfx: 'sfx:powerup' });\n" +
      "          }, { phase: 'rules' });\n",
  ],
  [
    '      const search = new URLSearchParams(location.search);\n',
    '      const audio = createAudio();\n      let heard = 0;\n',
  ],
  [
    '        onFrame: showRound,\n',
    '        onFrame: (frame) => { showRound(frame); for (const e of frame.world.events.trace()) if (e.seq > heard) { heard = e.seq; audio.event(e.type, e.payload); } },\n',
  ],
];

/** `page` with the recipes in, each after its anchor; throws naming an anchor game.html no longer has. */
function withRecipes(page: string): string {
  return RECIPES.reduce((text, [anchor, after]) => {
    if (!text.includes(anchor)) throw new Error(`lean/game.html lost the line ${JSON.stringify(anchor)}: move RECIPES' anchor`); // prettier-ignore
    const into = anchor === '        onFrame: showRound,\n' ? after : anchor + after;
    return text.replace(anchor, into);
  }, page);
}

test("lean/README.md's particles, sound and lights recipes work in the starter", async ({ page, harness }) => {
  test.setTimeout(180_000);
  const strays: string[] = [];
  await serveCdn(page, strays);
  const dir = mkdtempSync(join(tmpdir(), 'lean-recipes-'));
  writeFileSync(join(dir, 'game.html'), withRecipes(readFileSync(join(ROOT, 'lean/game.html'), 'utf8')));
  await page.goto(pathToFileURL(join(dir, 'game.html')).href);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
  await page.evaluate(() => __engine.step(40));
  await harness.tick(2);
  // the lit event burst the layered fireflies (24 of them), and the lantern, spawned dark, is lit
  expect((await page.evaluate(() => __engine.fx.stats())).particles.born).toBeGreaterThanOrEqual(24);
  const lights = await page.evaluate(() => __engine.state('propLight').entities.map((e) => e.propLight.on));
  expect(lights).toEqual([true]);
  expect(strays).toEqual([]);
});
