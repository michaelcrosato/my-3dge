/**
 * @file T2 for the playground's page (labs/playground/main.ts, PLAN.md WP 13.1), by DOM queries and `window.__engine`:
 * 1. the gym opens on WebGPU in the shooter camera and the cel look, its HUD names them and the keys, and the signs of
 *    the features near the player show while the far ones hide;
 * 2. T cycles the five camera modes and P switches the two looks, live, while the player runs, building 0 pipelines
 *    after the warm-up: in the gym, on the hill, and on the site from each of its areas' spawns (WP 13.18: the site's
 *    scenes are one block, each placing the player at an area's spawn, so one page placing it at each stands for
 *    them all);
 * 3. the gym's replay keeps its goldens in the page while it renders through every camera mode and both looks;
 * 4. the player, `body:player` on `build:adult` (WP 13.2), is what the ID pass sees from every camera but first person
 *    in both looks, its accent showing on it in each (`accentOnPlayer`: the isometric and top-down cameras draw it 11
 *    to 15 px tall), the sky's dome and backdrop left out as background, and the MRT reads the sky as the background
 *    too (the parts view is black where the ID pass finds nothing), so no outline inks the dome's edges;
 * 5. the menu for humans (`?playground.menu=on`) lists every scene, the five cameras, the two looks and every replay;
 * 6. the keyboard reaches the player through the playground's action map (WP 13.3): W runs and Shift sprints, the
 *    shooter model's gaits read off the player's `motion`, the page's frame loop sampling the keys on the virtual
 *    clock's frames (`harness.tick`);
 * 7. the feel panel (`?playground.feel=on`, WP 13.4) tunes the run live: its run slider set, the player runs that fast
 *    (holstered, ×1.15), and Copy as profile shows a `defineMovement` call holding the new number;
 * 8. the HUD names what the player would use with the key that uses it (WP 13.16): nothing on the front yard's path, 14 m
 *    from the house's front door (WP 13.18), `E: Open` on the porch before it, `E: Close` once it is used;
 * 9. the range's replay (WP 13.20: the pistol and the rifle drawn and fired, the targets down and up again) keeps its
 *    goldens while it renders through every camera mode and both looks, the guns drawn in the hands and in first
 *    person's arms, the tracers, flashes, impacts and holes, with 0 pipelines after the warm-up; the HUD counts it.
 *
 * Invariants: the page is read through `[data-ui]` elements, the menu's links and `__engine` only; the sim is stepped
 * with `__engine.step`, then frames are drawn (`__engine.render`), so the HUD and the signs show what the run holds.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { SITE_AREAS, type SiteArea } from '../../labs/playground/levels/site';
import { areaStart } from '../../labs/playground/scenes/site';
import { PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS } from '../../labs/playground/views';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** The gym's replay, and the range's (WP 13.20). */
const GYM = readFileSync(join(import.meta.dirname, '../replays/playground-gym.replay.json'), 'utf8');
const RANGE = readFileSync(join(import.meta.dirname, '../replays/playground-range.replay.json'), 'utf8');

/** Calls the `__engine` member at `path` (`camera.get`) with `args`. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** The HUD's lines, by id. */
function hud(page: Page): Promise<Record<string, string>> {
  return page
    .locator('[data-ui=hud]')
    .evaluateAll((lines) => Object.fromEntries(lines.map((line) => [line.getAttribute('data-id'), line.textContent])));
}

/** Whether the sign of the feature `id` shows. */
function signShown(page: Page, id: string): Promise<boolean> {
  return page.locator(`[data-ui=label][data-id="sign:${id}"]`).evaluate((label) => !(label as HTMLElement).hidden);
}

/** The advice codes the page raised. */
function adviceCodes(page: Page): Promise<string[]> {
  return page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
}

/** A shot's size and pixels, as `__engine.shot({ pixels: true })` returns them (base64 RGBA, top row first). */
type Pixels = { width: number; height: number; pixels: string };

/** The fewest pixels of the player's accent each view must show on the player (WP 13.2's review). */
const ACCENT_PX = 6;

/**
 * The accent's pixels on the player that read as orange: pixels of `picture` in the accent's lit or middle band where
 * `parts`, the parts view of the same frame, shows a character (red). The accent (`#ff7f2a`: hue 24°, saturation 0.84)
 * keeps its hue and saturation through the bands and the pixel look's shades: hue 12–36°, saturation above 0.75, value
 * at least 0.45, which leaves out its dark band and the ink's tint of it (dark brown, WP 13.2's review). The skin
 * (0.37), the hair (0.49) and the boots (0.53) are less saturated. The value floor, measured on WP 13.24's ramps (the
 * gym at noon, every camera): the pixel look's four steps of the accent stand at 0.91–1, 0.74–0.78, 0.48–0.52 and
 * 0.27 on its 24 levels a channel, its ink and rims at 0.44 and below; the cel look's dark band at 0.36–0.38. At WP
 * 13.2's 0.55 the floor left out the pixel look's third step, a middle band, and its isometric view read 5.
 */
function accentOnPlayer(picture: Pixels, parts: Pixels): number {
  const [rgb, mask] = [Buffer.from(picture.pixels, 'base64'), Buffer.from(parts.pixels, 'base64')];
  let n = 0;
  for (let p = 0; p < rgb.length; p += 4) {
    if (mask[p] < 128 || mask[p + 1] > 64 || mask[p + 2] > 64) continue;
    const [r, g, b] = [rgb[p], rgb[p + 1], rgb[p + 2]];
    const low = Math.min(g, b);
    if (r < g || r < b || r < 0.45 * 255 || r - low <= 0.75 * r) continue;
    const hue = (60 * (g - b)) / (r - low);
    if (hue >= 12 && hue <= 36) n++;
  }
  return n;
}

/** How many pixels of `parts` (the parts view) are black: the background, where no object draws. */
function blackIn(parts: Pixels): number {
  const rgba = Buffer.from(parts.pixels, 'base64');
  let black = 0;
  for (let p = 0; p < rgba.length; p += 4) if (rgba[p] + rgba[p + 1] + rgba[p + 2] < 24) black++;
  return black;
}

/**
 * How long a page may take to warm up (ms): the gym's and the hill's, and the site's, which warms 85 pipelines over
 * its view's two cameras in about 215 s on SwiftShader (WP 13.18).
 */
const [READY, SITE_READY] = [120_000, 420_000];

/** Opens the playground at `query` and waits for it. */
async function open(page: Page, harness: { ready(o: { timeout: number }): Promise<unknown> }, query = '') {
  await page.goto(`labs/playground/${query}`);
  await harness.ready({ timeout: query.includes('scene=site') ? SITE_READY : READY });
  await call(page, 'pause');
  await call(page, 'render', 2);
}

/**
 * Presses T through the five camera modes in the look on screen, the other and the first again, P between them, the
 * player running a few steps in each.
 */
async function throughEveryView(page: Page): Promise<void> {
  const name = (id: string) => id.replace('look:playground-', '');
  const first = (await hud(page)).mode.includes(`Look: ${name(PLAYGROUND_LOOKS[0])}`);
  const [a, b] = first ? PLAYGROUND_LOOKS : [PLAYGROUND_LOOKS[1], PLAYGROUND_LOOKS[0]];
  for (const look of [a, b, a]) {
    expect((await hud(page)).mode).toContain(`Look: ${name(look)}`);
    for (const mode of [...PLAYGROUND_CAMERAS.slice(1), PLAYGROUND_CAMERAS[0]]) {
      await page.keyboard.press('KeyT');
      expect((await call<{ code: string }>(page, 'camera.get')).code.split(',')[0]).toBe(mode.code);
      await call(page, 'step', 6, { move: [-0.6, 0.8] });
      await call(page, 'render', 2);
      expect((await hud(page)).mode).toBe(`Camera: ${mode.name} · Look: ${name(look)}`);
    }
    await page.keyboard.press('KeyP');
    await call(page, 'render', 2);
  }
}

/** That the page built no pipeline after its warm-ups and raised no advice. */
async function expectWarm(page: Page, harness: { advice(): unknown[] }): Promise<void> {
  expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
  expect(await adviceCodes(page)).not.toContain('GFX_COLD_PIPELINE');
  expect(harness.advice()).toEqual([]);
}

test.describe('the playground', () => {
  test.setTimeout(300_000);

  test('opens the gym in the shooter camera and the cel look, with the HUD and the signs near the player', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await harness.assertWebGPU();
    expect((await call<{ code: string }>(page, 'camera.get')).code).toMatch(/^cam3=shoulder(,|$)/);
    expect(await hud(page)).toMatchObject({
      mode: 'Camera: shooter · Look: cel',
      keys: expect.stringContaining('T: camera · X: shoulder · P: look'),
    });
    expect(await signShown(page, 'mantle-1')).toBe(true); // 12 m south of the spawn, in front of the camera
    expect(await signShown(page, 'tower-6')).toBe(false); // 59 m away
    expect(harness.advice()).toEqual([]);
  });

  test('T cycles the five cameras and P the two looks while the player runs, building 0 pipelines after the warm-up', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await throughEveryView(page);
    await expectWarm(page, harness);
  });

  test('does the same on the hill, and on the site from each area’s spawn (WP 13.18)', async ({ page, harness }) => {
    test.setTimeout(1_500_000);
    await open(page, harness, '?scene=hill');
    await throughEveryView(page);
    await expectWarm(page, harness);
    await open(page, harness, '?scene=site');
    for (const area of Object.keys(SITE_AREAS) as SiteArea[]) {
      await call(page, 'actions.run', 'place', { at: areaStart(area), speed: 0, yaw: SITE_AREAS[area].yaw });
      await throughEveryView(page);
      expect((await hud(page)).room, area).toMatch(/^(Room: |Indoors|Outdoors)/);
    }
    await expectWarm(page, harness);
  });

  test('keeps the gym replay’s goldens while it renders through every camera mode and both looks', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const views: [number, { cam?: string; set?: Record<string, string> }][] = [
      ...PLAYGROUND_CAMERAS.map((mode, i): [number, { cam: string }] => [i * 100, { cam: mode.code }]),
      [250, { set: { 'post.look': PLAYGROUND_LOOKS[1] } }],
    ];
    const run = await call<{ hashes: Record<string, string> }>(page, 'replay', GYM, { views });
    const goldens = (JSON.parse(GYM) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
    expect(run.hashes).toEqual(goldens);
    expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
    expect(await adviceCodes(page)).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });

  test('plays the range in every camera and both looks: its goldens kept, the HUD counting, 0 pipelines after the warm-up', async ({
    page,
    harness,
  }) => {
    test.setTimeout(1_500_000);
    await open(page, harness, '?scene=site-range');
    const views: [number, { cam?: string; set?: Record<string, string> }][] = [
      ...PLAYGROUND_CAMERAS.map((mode, i): [number, { cam: string }] => [20 + i * 160, { cam: mode.code }]), // the shooter first
      [100, { set: { 'post.look': PLAYGROUND_LOOKS[1] } }],
      [420, { set: { 'post.look': PLAYGROUND_LOOKS[0] } }],
    ];
    views.sort(([a], [b]) => a - b);
    const run = await call<{ hashes: Record<string, string> }>(page, 'replay', RANGE, { views });
    const goldens = (JSON.parse(RANGE) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
    expect(run.hashes).toEqual(goldens);
    await call(page, 'render', 2);
    expect((await hud(page)).weapon).toBe('Holstered: 1 2 draw · Hits 10 of 20 (50%)'); // half its rounds struck
    await expectWarm(page, harness);
  });

  test('draws the player, body:player on build:adult, where the ID pass sees it from every camera but first person', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    type Ids = { ids: { empty: number; visible: { name: string; px: number }[]; unseen: { name: string; reason: string }[] } }; // prettier-ignore
    const options = { pixels: true, metrics: false, thumbnail: false };
    const [seen, accent]: Record<string, number>[] = [{}, {}];
    for (const look of PLAYGROUND_LOOKS) {
      await call(page, 'set', 'post.look', look);
      for (const mode of PLAYGROUND_CAMERAS.filter((each) => each.name !== 'first')) {
        const view = `${look} ${mode.name}`;
        await call(page, 'camera.set', mode.code);
        await call(page, 'render', 2);
        const shot = await call<Ids & Pixels>(page, 'shot', { ...options, ids: true });
        await call(page, 'set', 'post.show', 'parts');
        await call(page, 'render', 2);
        const parts = await call<Pixels>(page, 'shot', { ...options, ids: false });
        await call(page, 'set', 'post.show', 'picture');
        seen[view] = shot.ids.visible.find((entry) => entry.name === 'actor#1')?.px ?? 0;
        accent[view] = accentOnPlayer(shot, parts);
        expect(shot.ids.unseen.filter((entry) => entry.name.startsWith('sky/')).map((entry) => entry.reason), view).toEqual(['background', 'background']); // prettier-ignore
        const total = shot.width * shot.height;
        expect(Math.abs(blackIn(parts) - shot.ids.empty) / total, `${view}: black in the parts view where the ID pass is empty`).toBeLessThan(0.01); // prettier-ignore
        if (look === PLAYGROUND_LOOKS[0] && mode === PLAYGROUND_CAMERAS[0]) expect(shot.ids.empty / total, 'the sky shows').toBeGreaterThan(0.1); // prettier-ignore
      }
    }
    for (const [view, px] of Object.entries(seen)) expect(px, view).toBeGreaterThan(50);
    for (const [view, px] of Object.entries(accent)) expect(px, `${view}: the accent on the player`).toBeGreaterThanOrEqual(ACCENT_PX); // prettier-ignore
    const dump = await call<string>(page, 'scene.dump', { filter: 'actor#1' });
    const [, height] = /actor#1 SkinnedMesh .* size [\d.]+×([\d.]+)×/.exec(dump) ?? [];
    expect(Number(height)).toBeGreaterThan(1.7); // the adult, 1.80 m standing, not the chibi or heroic stand-in
    expect(Number(height)).toBeLessThan(1.95);
    expect(harness.advice()).toEqual([]);
  });

  test('names what the player would use, with its key: the house’s front door, to open, then to close', async ({
    page,
    harness,
  }) => {
    test.setTimeout(900_000);
    await open(page, harness, '?scene=site');
    expect((await hud(page)).use || '').toBe(''); // on the front yard's path, 14 m south of the door: nothing in reach
    await call(page, 'actions.run', 'place', { at: [51.5, 0.01, 61], speed: 0, yaw: Math.PI }); // on the porch, facing the door
    await call(page, 'step', 2, { look: [Math.PI, 0] });
    await call(page, 'render', 2);
    expect((await hud(page)).use).toBe('E: Open');
    await call(page, 'step', 1, { look: [Math.PI, 0], b: ['interact'] });
    await call(page, 'render', 2);
    expect((await hud(page)).use).toBe('E: Close');
    expect(harness.advice()).toEqual([]);
  });

  test('shows the menu for humans when asked: every scene, five cameras, two looks and every replay', async ({
    page,
    harness,
  }) => {
    await open(page, harness, '?playground.menu=on');
    const links = (section: string) =>
      page.locator(`#playground-menu [data-menu=${section}] a`).evaluateAll((all) => all.map((a) => a.textContent));
    // Every scene its modules export (the gym, the default, first) and every playground replay, as the page finds them.
    const dir = join(import.meta.dirname, '../../labs/playground/scenes');
    const modules = readdirSync(dir).filter((file) => /^[a-z]+\.ts$/.test(file));
    const exported = (await Promise.all(modules.map((file) => import(join(dir, file))))).flatMap((module) => Object.values(module as Record<string, { kind?: string; id?: string }>)); // prettier-ignore
    const scenes = [...new Set(exported.filter((value) => value?.kind === 'scene').map((scene) => scene.id!.replace(/^playground:/, '')))]; // prettier-ignore
    const replays = readdirSync(join(import.meta.dirname, '../replays')).filter((file) =>
      file.startsWith('playground-'),
    );
    expect(await links('scenes')).toEqual(['gym', ...scenes.filter((name) => name !== 'gym').sort()]);
    expect(await links('cameras')).toEqual(PLAYGROUND_CAMERAS.map((mode) => mode.name));
    expect(await links('looks')).toEqual(['cel', 'pixel']);
    expect(await links('replays')).toEqual(replays.map((file) => file.replace(/^playground-|\.replay\.json$/g, '')).sort()); // prettier-ignore
    expect(await page.locator('#playground-menu [data-menu=controls] tr').count()).toBeGreaterThanOrEqual(8);
    await page.keyboard.press('KeyM');
    expect(await page.locator('#playground-menu').isHidden()).toBe(true);
    expect(harness.advice()).toEqual([]);
  });

  test('runs on W and sprints on Shift: the keyboard reaches the player through the playground’s action map', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    type Player = { actor: { vx: number; vz: number }; motion: { gait: string } };
    const player = () => call<Player>(page, 'get', 1);
    await call(page, 'resume');
    await page.keyboard.down('KeyW'); // south, along the view the shooter sends (WP 13.9): open floor for 10 m
    await harness.tick(31); // the first frame sets the virtual clock's origin, then half a second of steps
    expect((await player()).motion.gait).toBe('run');
    await page.keyboard.down('ShiftLeft');
    await harness.tick(30);
    const { actor, motion } = await player();
    expect(motion.gait).toBe('sprint');
    expect(Math.hypot(actor.vx, actor.vz)).toBeGreaterThan(5.2); // past the holstered run's 5.07 m/s
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    await call(page, 'pause');
    expect(harness.advice()).toEqual([]);
  });

  test('tunes the run live from the feel panel, and copies the tuning as a profile', async ({ page, harness }) => {
    await open(page, harness, '?playground.feel=on');
    const panel = page.locator('[data-ui=feel]');
    await expect(panel).toBeVisible();
    const run = panel.locator('[data-path="movement.gaits.run"] input');
    await run.evaluate((input: HTMLInputElement) => {
      input.value = '5';
      input.dispatchEvent(new Event('input'));
    });
    const rows = await call<{ path: string; value: number }[]>(page, 'tune.settings');
    expect(rows.find((row) => row.path === 'movement.gaits.run')?.value).toBe(5);
    await call(page, 'step', 60, { move: [-1, 0] }); // west along the north wall: clear for 10 m
    const { actor } = await call<{ actor: { vx: number; vz: number } }>(page, 'get', 1);
    expect(Math.hypot(actor.vx, actor.vz)).toBeCloseTo(5 * 1.15, 2); // the tuned run, empty-handed
    await panel.locator('[data-feel=copy]').click();
    await expect(panel.locator('[data-feel=profile]')).toHaveValue(
      /defineMovement\("movement:playtest"[\s\S]*"run": 5/,
    );
    expect(harness.advice()).toEqual([]);
  });
});
