/**
 * @file T2 for the playground's front end (labs/playground/ui/, PLAN.md WP 13.25), by DOM queries, `window.__engine`
 * and `window.__playgroundUi`:
 * 1. the title screen opens with the page when asked (`?playground.title=on`) over a paused run; settings lists every
 *    row and every action's key; a slider, a list and a level change the view, a rebind takes a free key in every
 *    camera's map and refuses one another action holds, naming it; Play resumes; Escape pauses, and a key the menu reads
 *    reaches no intent (Space picks Resume and the player never jumps); photo mode flies the free camera on the move
 *    keys with the HUD hidden and puts the camera back on leaving; after a reload the settings and the rebind are kept;
 * 2. the movement profile from settings starts the scene again on it, and the run's replay holds it and plays back to
 *    its hash in Node; Restart starts it again on its seed;
 * 3. the spawn picker, from the gym, opens the block at the area picked; on the block it puts the player in the room
 *    picked through the recorded dev action `place`, the HUD naming the room; the run replays to its hash in Node; the
 *    HUD of each camera mode: the crosshair in the shooter with a gun out, the feel readout in isometric.
 *
 * Invariants: the page is read through `[data-ui]` elements, `__engine` and `__playgroundUi` only; frames are run with
 * the virtual clock (`harness.tick`), so the front end reads each key at a frame as the page's loop samples it.
 */
import type { Page } from '@playwright/test';
import { playReplay, type Replay } from '../../engine/sim/replay';
import '../../labs/playground/cast/player';
import '../../labs/playground/scenes/gym';
import '../../labs/playground/scenes/site';
import { CONTROL_ACTIONS, SETTING_ROWS } from '../../labs/playground/ui/settings';
import { spawnPlaces } from '../../labs/playground/ui/spawns';
import { expect, test } from './fixtures';

/** The page's engine and front end, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };
declare const __playgroundUi: { state(): { screens: string[]; paused: boolean } };

/** How long the gym's page and the site's may take to warm up (ms): playground.spec.ts's. */
const [READY, SITE_READY] = [120_000, 420_000];

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

/** The open screens, top last, and whether the run is paused by them. */
const screens = (page: Page) => page.evaluate(() => __playgroundUi.state());

/** The HUD's lines that show, by id. */
const hud = (page: Page): Promise<Record<string, string>> =>
  page.locator('[data-ui=hud]').evaluateAll((lines) => Object.fromEntries(lines.filter((line) => !(line as HTMLElement).hidden && line.textContent).map((line) => [line.getAttribute('data-id'), line.textContent]))); // prettier-ignore

/** Picks the item `id` of the open menu `menu` with a click, then runs a frame. */
async function pick(page: Page, harness: { tick(n?: number): Promise<void> }, menu: string, id: string): Promise<void> {
  await page.locator(`[data-ui=menu][data-id="${menu}"] [data-ui=item][data-id="${id}"]`).click();
  await harness.tick(2);
}

/** A setting row's value as the screen shows it. */
const shown = (page: Page, id: string) => page.locator(`[data-ui=setting][data-id="${id}"]`).getAttribute('data-value');

/** Sets a slider of the settings screen, as a hand on it would. */
async function slide(page: Page, id: string, value: number): Promise<void> {
  await page.locator(`[data-ui=setting][data-id="${id}"] input`).evaluate((input: HTMLInputElement, v) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input'));
  }, value);
}

/** The player's entity. */
const player = (page: Page) =>
  call<{ actor: { x: number; y: number; z: number; vx: number; vz: number }; motion?: unknown }>(page, 'get', 1);

/** The run's recording and its hash, in the page. */
const recording = (page: Page) =>
  page.evaluate(() => ({
    replay: (__engine.input as unknown as { record(): unknown }).record() as Replay,
    hash: __engine.hash() as unknown as string,
  }));

test.describe('the playground’s front end', () => {
  test.setTimeout(900_000);

  test('title, settings, pause and photo mode, by DOM queries; the settings and a rebind survive a reload', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/playground/?playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    expect(await screens(page)).toEqual({ screens: ['title'], paused: true });
    const title = page.locator('[data-ui=menu][data-id=title]');
    await expect(title).toBeVisible();
    expect(await title.locator('[data-ui=item]').allTextContents()).toEqual(['Play', 'Spawn…', 'Settings…', 'Photo mode']); // prettier-ignore
    const tick = (await call<{ tick: number }>(page, 'info')).tick;
    await harness.tick(30);
    expect((await call<{ tick: number }>(page, 'info')).tick).toBe(tick); // paused under the title

    await pick(page, harness, 'title', 'settings');
    for (const row of SETTING_ROWS) await expect(page.locator(`[data-ui=setting][data-id="${row.id}"]`)).toHaveCount(1); // prettier-ignore
    for (const action of Object.keys(CONTROL_ACTIONS)) await expect(page.locator(`[data-ui=binding][data-id="${action}"]`)).toHaveCount(1); // prettier-ignore
    expect([await shown(page, 'camera'), await shown(page, 'cam.fov')]).toEqual(['shooter', '90']);
    await slide(page, 'cam.fov', 104);
    await slide(page, 'volume:music', 0.25);
    await page.locator('[data-ui=setting][data-id="post.look"] select').selectOption('look:playground-pixel');
    await harness.tick(2);
    const rebind = async (action: string, code: string) => {
      await page.locator(`[data-ui=item][data-id="rebind:${action}"]`).click();
      await page.keyboard.press(code);
      await harness.tick(2);
      return page.locator(`[data-ui=binding][data-id="${action}"]`);
    };
    await expect(await rebind('jump', 'KeyK')).toHaveAttribute('data-value', /KeyK/);
    const refused = await rebind('crouch', 'KeyW');
    await expect(refused.locator('[data-ui=binding-note]')).toContainText("forward's");
    await expect(refused).not.toHaveAttribute('data-value', /KeyW/);
    const elsewhere = await rebind('jump', 'KeyG'); // free in the shooter's map, isometric's use: refused in every map
    await expect(elsewhere.locator('[data-ui=binding-note]')).toContainText("interact's in the isometric camera");
    await expect(elsewhere).toHaveAttribute('data-value', /KeyK/);
    await page.keyboard.press('Escape'); // back to the title
    await harness.tick(2);
    expect((await screens(page)).screens).toEqual(['title']);
    await pick(page, harness, 'title', 'play');
    expect(await screens(page)).toEqual({ screens: [], paused: false });
    expect((await hud(page)).mode).toBe('Camera: shooter · Look: pixel');

    await page.keyboard.press('Escape');
    await harness.tick(2);
    expect((await screens(page)).screens).toEqual(['pause']);
    expect(await page.locator('[data-ui=menu][data-id=pause] [data-ui=item]').allTextContents()).toEqual(['Resume', 'Spawn…', 'Settings…', 'Photo mode', 'Restart', 'Title screen']); // prettier-ignore
    const before = await player(page);
    await page.keyboard.press('Space'); // the menu's accept picks Resume; never the player's jump, though it is his key
    await harness.tick(2);
    expect(await screens(page)).toEqual({ screens: [], paused: false });
    await harness.tick(20);
    expect((await player(page)).actor.y).toBeCloseTo(before.actor.y, 2);

    await page.keyboard.press('Escape');
    await harness.tick(2);
    const still = await player(page);
    await pick(page, harness, 'pause', 'photo');
    expect((await call<{ code: string }>(page, 'camera.get')).code).toMatch(/^cam3=fly,/);
    await expect(page.locator('[data-ui=photo]')).toBeVisible();
    expect(await hud(page)).toEqual({}); // the HUD hidden
    const from = (await call<{ pose: { position: number[] } }>(page, 'camera.get')).pose.position;
    await page.keyboard.down('KeyW');
    await harness.tick(30);
    await page.keyboard.up('KeyW');
    const to = (await call<{ pose: { position: number[] } }>(page, 'camera.get')).pose.position;
    expect(Math.hypot(to[0] - from[0], to[2] - from[2])).toBeGreaterThan(1); // flown, at 4 m/s for half a second
    expect((await player(page)).actor).toMatchObject({ x: still.actor.x, z: still.actor.z }); // the run still paused
    await page.keyboard.press('Escape');
    await harness.tick(2);
    expect((await screens(page)).screens).toEqual(['pause']);
    expect((await call<{ code: string }>(page, 'camera.get')).code).toMatch(/^cam3=shoulder/);
    await pick(page, harness, 'pause', 'play');

    await page.reload();
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'settings');
    expect([await shown(page, 'cam.fov'), await shown(page, 'post.look'), await shown(page, 'volume:music')]).toEqual(['104', 'look:playground-pixel', '0.25']); // prettier-ignore
    await expect(page.locator('[data-ui=binding][data-id=jump]')).toHaveAttribute('data-value', /KeyK/);
    expect(harness.advice()).toEqual([]);
  });

  test('the movement profile from settings starts the scene again on it, recorded; Restart starts it on its seed', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/playground/?playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'settings');
    await page.locator('[data-ui=setting][data-id="playground.movement"] select').selectOption('movement:platformer');
    await harness.tick(2);
    expect((await player(page)).motion).toBeUndefined(); // the box hero's controller: no shooter model
    expect((await call<{ tick: number }>(page, 'info')).tick).toBe(0); // started again, paused under the screen
    await page.keyboard.press('Escape');
    await harness.tick(2);
    await pick(page, harness, 'title', 'play');
    await call(page, 'pause');
    await call(page, 'step', 60, { move: [-1, 0] });
    const { replay, hash } = await recording(page);
    expect(replay.settings).toMatchObject({ 'playground.movement': 'movement:platformer' });
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(hash);
    await page.keyboard.press('Escape');
    await harness.tick(2);
    await pick(page, harness, 'pause', 'restart');
    expect((await call<{ tick: number }>(page, 'info')).tick).toBeLessThan(5);
    expect((await player(page)).motion).toBeUndefined(); // the setting kept over the restart
    expect(harness.advice()).toEqual([]);
  });

  test('the spawn picker opens the block at an area from the gym, and puts the player in a room on it, recorded', async ({
    page,
    harness,
  }) => {
    test.setTimeout(1_500_000);
    await page.goto('labs/playground/?playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'spawns');
    const items = await page.locator('[data-ui=menu][data-id=spawns] [data-ui=item]').allTextContents();
    expect(items).toEqual([...spawnPlaces().map((place) => place.label), 'Back']);
    await page.locator('[data-ui=menu][data-id=spawns] [data-ui=item][data-id="area:range"]').click();
    await page.waitForURL(/scene=site/);
    await harness.ready({ timeout: SITE_READY });
    await harness.tick(2);
    const range = spawnPlaces().find((place) => place.id === 'area:range')!;
    const at = (await player(page)).actor;
    expect(Math.hypot(at.x - range.args.at[0], at.z - range.args.at[2])).toBeLessThan(0.5);
    expect((await recording(page)).replay.inputs[0][1]).toHaveProperty('dev'); // the pick: its first operation

    await pick(page, harness, 'title', 'spawns'); // the block's page opens on the title screen too
    await pick(page, harness, 'spawns', 'room:house/kitchen');
    expect(await screens(page)).toEqual({ screens: [], paused: false });
    await call(page, 'pause');
    await call(page, 'step', 30);
    await call(page, 'render', 2);
    expect((await hud(page)).room).toBe('Room: kitchen');
    const { replay, hash } = await recording(page);
    expect(replay.inputs.filter(([, change]) => JSON.stringify(change).includes('"place"'))).toHaveLength(2);
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(hash);

    await page.keyboard.press('Digit1'); // the pistol out: the shooter's crosshair
    await call(page, 'resume');
    await harness.tick(40);
    await call(page, 'pause');
    await expect(page.locator('[data-ui=crosshair]')).toBeVisible();
    expect((await hud(page)).readout).toBeUndefined();
    for (let k = 0; k < 3; k++) await page.keyboard.press('KeyT'); // shooter → first → platformer → isometric
    await harness.tick(30);
    await call(page, 'render', 2);
    expect((await hud(page)).mode).toMatch(/^Camera: isometric/);
    await expect(page.locator('[data-ui=crosshair]')).toHaveCount(0);
    expect((await hud(page)).readout).toMatch(/m\/s/);
    expect(harness.advice()).toEqual([]);
  });
});
