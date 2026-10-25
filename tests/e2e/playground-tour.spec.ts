/**
 * @file T2 for the playground's tour and its attract mode (PLAN.md WP 13.26, docs/PLAYGROUND.md §9.2), by
 * `window.__engine` and DOM queries:
 * 1. In each look, the tour (tests/replays/playground-tour.replay.json, labs/playground/tour.ts) plays in the page
 *    through the five cameras, twice round (`__engine.replay`, a frame drawn every `DRAW` steps), its goldens holding,
 *    no pipeline built after the warm-up and no advice; the frames it shoots on the way (`SHOTS`) are the look's
 *    film: a contact sheet, out/film/playground-tour-<look>/sheet.png, with film.json (each frame's step and camera).
 * 2. The attract mode (`?replay=playground-tour&playground.attract=on`, labs/playground/ui/attract.ts): its banner
 *    shows over the tour, the view steps to the next camera after `ATTRACT.cycle` seconds and the look after two, and a
 *    key gives the page back (the playground, without the replay).
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
/** A frame drawn every this many steps while the tour plays. */
const DRAW = 6;
/** The frames each look's film shoots, evenly over the tour. */
const SHOTS = 12;

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
      for (let k = 0; k < SHOTS; k++) views.push([Math.floor(every / 2) + k * every, { shot: { pixels: true, ids: false, metrics: false, thumbnail: false } }]); // prettier-ignore
      views.sort(([a], [b]) => a - b);
      const run = await call<{ hashes: Record<string, string>; shots: { step: number; shot: Shot }[] }>(page, 'replay', TOUR, { draw: DRAW, views }); // prettier-ignore
      expect(run.hashes).toEqual(hashes['linux-x64']);
      expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
      expect(harness.advice()).toEqual([]);
      // the look's film: the shots on a contact sheet, labelled with their step and camera
      const camera = (step: number) => views.filter(([at, v]) => at <= step && v.cam).at(-1)?.[1].cam as string;
      const frames = run.shots.map(({ step, shot }, n) => ({ n, tick: step, label: `${step} ${camera(step).split(',')[0]}`, width: shot.width, height: shot.height, rgba: new Uint8Array(Buffer.from(shot.pixels, 'base64')), visible: [] })); // prettier-ignore
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
    await page.goto('labs/playground/?replay=playground-tour&playground.attract=on&playground.title=off');
    await harness.ready({ timeout: SITE_READY });
    await expect(page.locator('[data-ui=attract]')).toBeVisible();
    const code = async () => (await call<{ code: string }>(page, 'camera.get')).code.split(',')[0];
    const mode = () => page.locator('[data-ui=hud][data-id=mode]').textContent();
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
