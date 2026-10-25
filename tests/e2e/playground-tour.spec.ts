/**
 * @file T2 for the playground's tour and its attract mode (PLAN.md WP 13.26, docs/PLAYGROUND.md §9.2), by
 * `window.__engine` and DOM queries:
 * 1. In each look, the tour (tests/replays/playground-tour.replay.json, labs/playground/tour.ts) plays in the page
 *    through the five cameras, twice round (`__engine.replay`, a frame drawn every `DRAW` steps), its goldens holding,
 *    no pipeline built over it (a shot's own passes built first, by one shot) and no advice; the frames it shoots on
 *    the way (`SHOTS`) are the look's film: a contact sheet, out/film/playground-tour-<look>/sheet.png, with film.json
 *    (each frame's step and camera).
 * 2. The attract mode (`?replay=playground-tour&playground.attract=on`, labs/playground/ui/attract.ts): its banner
 *    shows over the tour, the view steps to the next camera after `ATTRACT.cycle` seconds and the look after two, and a
 *    key gives the page back (the playground, without the replay). Its page draws at the `low` tier: the cycle is real
 *    time, so it runs a frame for every sixtieth of a second, about a thousand.
 *
 * Invariants: the page is read through `__engine` and `[data-ui]` elements only; the films are written under out/,
 * never compared (the goldens are the check; a human or the visual reviewer reads the sheets).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ATTRACT } from '../../labs/playground/ui/attract';
import { PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS } from '../../labs/playground/views';
import { encodePng } from '../../tools/cmd/shot';
import { contactSheet } from '../../tools/lib/filmSheet';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

const ROOT = join(import.meta.dirname, '..', '..');
/** The tour, and its goldens on this platform. */
const TOUR = readFileSync(join(ROOT, 'tests/replays/playground-tour.replay.json'), 'utf8');
const { steps: STEPS, hashes } = JSON.parse(TOUR) as { steps: number; hashes: Record<string, Record<string, string>> };
/** How long the street's page may take to warm up (ms): the site's, playground.spec.ts's. */
const SITE_READY = 420_000;
/** A frame drawn every this many steps while the tour plays: a second of play, about a dozen frames in each camera
 * twice round (a frame every 6 steps, 1,257 a look, passed the 40 minutes the test allows on this platform). */
const DRAW = 60;
/** The frames each look's film shoots, evenly over the tour, and how (the pixels alone). */
const [SHOTS, SHOT] = [12, { pixels: true, ids: false, metrics: false, thumbnail: false }];

/** Calls the `__engine` member at `path` with `args`. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** A shot as the film reads it. */
type Shot = { width: number; height: number; pixels: string };

/** `rgba` (`width` × `height`) at half its size, each pixel the mean of four: the sheet's frames (a shot of another size
 * would draw the frame again at that size, engine/gfx/shot.ts). */
function half(rgba: Uint8Array, width: number, height: number): { width: number; height: number; rgba: Uint8Array } {
  const [w, h] = [Math.floor(width / 2), Math.floor(height / 2)];
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const at = (dx: number, dy: number) => rgba[((2 * y + dy) * width + 2 * x + dx) * 4 + c];
        out[(y * w + x) * 4 + c] = Math.round((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4);
      }
  return { width: w, height: h, rgba: out };
}

test.describe('the playground’s tour', () => {
  test.setTimeout(2_400_000);

  for (const look of PLAYGROUND_LOOKS) {
    const name = look.replace('look:playground-', '');
    test(`plays in the ${name} look through every camera, its goldens kept, and films it`, async ({
      page,
      harness,
    }) => {
      await page.goto(`labs/playground/?scene=site-street&playground.title=off&post.look=${look}`);
      await harness.ready({ timeout: SITE_READY });
      await call(page, 'pause');
      const turn = Math.floor(STEPS / (PLAYGROUND_CAMERAS.length * 2)); // each camera twice round
      const views: [number, Record<string, unknown>][] = [];
      for (let k = 0; k < PLAYGROUND_CAMERAS.length * 2; k++) views.push([k * turn, { cam: PLAYGROUND_CAMERAS[k % PLAYGROUND_CAMERAS.length].code, blend: k > 0 }]); // prettier-ignore
      const every = Math.floor(STEPS / SHOTS);
      for (let k = 0; k < SHOTS; k++) views.push([Math.floor(every / 2) + k * every, { shot: SHOT }]); // prettier-ignore
      views.sort(([a], [b]) => a - b);
      // a shot draws the look's passes into a target of its own, building their pipelines the first time (8 in the box's
      // toon look): one shot first, so what the counter adds over the tour is its frames' alone
      await call(page, 'shot', SHOT);
      const cold = async () => (await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp;
      const shot = await cold();
      const run = await call<{ hashes: Record<string, string>; shots: { step: number; shot: Shot }[] }>(page, 'replay', TOUR, { draw: DRAW, views }); // prettier-ignore
      expect(run.hashes).toEqual(hashes['linux-x64']);
      expect((await cold()) - shot, 'pipelines built over the tour').toBe(0);
      expect(harness.advice()).toEqual([]);
      // the look's film: the shots on a contact sheet, labelled with their step and camera
      const camera = (step: number) => views.filter(([at, v]) => at <= step && v.cam).at(-1)?.[1].cam as string;
      const frames = run.shots.map(({ step, shot }, n) => ({ n, tick: step, label: `${step} ${camera(step).split(',')[0]}`, ...half(new Uint8Array(Buffer.from(shot.pixels, 'base64')), shot.width, shot.height), visible: [] })); // prettier-ignore
      expect(frames).toHaveLength(SHOTS);
      const sheet = contactSheet(frames, { cols: 4 });
      const out = join(ROOT, 'out/film', `playground-tour-${name}`);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'sheet.png'), encodePng(sheet.width, sheet.height, sheet.rgba));
      writeFileSync(join(out, 'film.json'), `${JSON.stringify({ replay: 'tests/replays/playground-tour.replay.json', look, frames: frames.map(({ tick, label }) => ({ step: tick, label })) }, null, 2)}\n`); // prettier-ignore
    });
  }

  test('the attract mode: the tour behind its banner, the views stepping round, a key giving the page back', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/playground/?replay=playground-tour&playground.attract=on&playground.title=off&quality=low');
    await harness.ready({ timeout: SITE_READY });
    await harness.tick(2); // a frame runs only on a tick: the HUD and the attract mode read the run in their frames
    await expect(page.locator('[data-ui=attract]')).toBeVisible();
    const code = async () => (await call<{ code: string }>(page, 'camera.get')).code.split(',')[0];
    const mode = () => page.locator('[data-ui=hud][data-id=mode]').textContent({ timeout: 10_000 });
    const [camera, before] = [await code(), await mode()];
    await harness.tick(ATTRACT.cycle * 60 + 2);
    expect(await code()).not.toBe(camera); // the next camera, blending in
    await harness.tick(ATTRACT.cycle * 60 + 2);
    expect((await mode())?.replace(/^Camera: [^·]*/, '')).not.toBe(before?.replace(/^Camera: [^·]*/, '')); // the other look
    await page.keyboard.press('KeyK');
    await page.waitForURL((url) => url.pathname.endsWith('/labs/playground/') && !url.search.includes('replay'));
    expect(harness.advice()).toEqual([]);
  });
});
