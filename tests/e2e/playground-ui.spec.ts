/**
 * @file T2 for the playground's front end (labs/playground/ui/, PLAN.md WP 13.25), by DOM queries, `window.__engine`
 * and `window.__playgroundUi`:
 * 1. the start menu opens with the page when asked (`?playground.title=on`) over a paused run; settings lists every
 *    row and every action's key; a slider, a list and a level change the view, a rebind takes a free key in every
 *    camera's map and refuses one another action holds, naming it; Play resumes; Escape pauses, and a key the menu reads
 *    reaches no intent (Space picks Resume and the player never jumps); photo mode flies the free camera on the move
 *    keys with the HUD hidden and puts the camera back on leaving; after a reload the settings and the rebind are kept;
 *    the menus' footers name the keys, and a pad walks Settings and steps a slider, the footer and the controls naming
 *    its buttons;
 * 2. the Tune panel (WP 13.32) lists every filter; turning one on, sliding its numbers, laying a look on and sliding the
 *    strength reach the look drawn (`__engine.look()`) with no pipeline built after the first frame through the chain;
 *    Copy as look gives a `defineLook` of the filters drawn; Reset puts the look back; Tools' feel panel opens in the
 *    theme (the type and the accent), headed, and its Close button closes it; Tools lists the recorded runs by their
 *    plain names and the engine's pages beside the block;
 * 3. the movement profile from settings starts the scene again on it, and the run's replay holds it and plays back to
 *    its hash in Node; Restart starts it again on its seed;
 * 4. Go to, from the gym, opens the block at the area picked; on the block it puts the player in the room
 *    picked through the recorded dev action `place`, the HUD naming the room; the run replays to its hash in Node; the
 *    I shows the area's card and puts it away, and so does pause's This area's card; Settings' Time of day sets the block's clock once let go, its value read
 *    beside it; the HUD of each camera mode: the crosshair in the shooter with a gun out, the feel readout in isometric;
 * 5. the owner's checks (WP 13.28): the start menu lists them with how many are left; the keys work the panel as a menu; a
 *    check's view names the player's keys, takes a verdict and a note (keys typed in it reach nothing else) and keeps
 *    them; the answers come out as text; Go there opens the check's page at its spot through the recorded `place` (the
 *    mantle walls of the gym on the block), the HUD naming the check, and pause answers it.
 *
 * Invariants: the page is read through `[data-ui]` elements, `__engine` and `__playgroundUi` only; frames are run with
 * the virtual clock (`harness.tick`), so the front end reads each key at a frame as the page's loop samples it.
 */
import type { Page } from '@playwright/test';
import { FILTER_NAMES } from '../../engine/gfx/post/filters';
import { playReplay } from '../../engine/sim/replay';
import '../../labs/playground/cast/player';
import '../../labs/playground/scenes/gym';
import '../../labs/playground/scenes/site';
import { CONTROL_ACTIONS, SETTING_ROWS } from '../../labs/playground/ui/settings';
import { spawnPlaces } from '../../labs/playground/ui/spawns';
import { OWNER_CHECKS, ownerCheck } from '../../labs/playground/ui/checks';
import { AREAS } from '../../labs/playground/ui/areas';
import { ENGINE_PAGES } from '../../labs/playground/ui/pages';
import { RECORDED_RUNS } from '../../labs/playground/ui/runs';
import { expect, test } from './fixtures';
// prettier-ignore
import { call, checksItem, hud, menuLabels, PAD, plugPad, pick, player, press, READY, recording, screens, shown, SITE_READY, slide, tapPad } from './playground-page';

/** The page's engine and front end, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };
declare const __playgroundUi: {
  state(): { screens: string[]; paused: boolean };
  checks(): { id: string; verdict: string; note: string }[];
};

test.describe('the playground’s front end', () => {
  test.setTimeout(900_000);

  test('title, settings, pause and photo mode, by DOM queries; the settings and a rebind survive a reload', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/playground/?scene=gym&playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    expect(await screens(page)).toEqual({ screens: ['title'], paused: true });
    const title = page.locator('[data-ui=menu][data-id=title]');
    await expect(title).toBeVisible();
    expect(await title.locator('[data-ui=item]').allTextContents()).toEqual(['Play', 'Go to…', 'Settings', 'Controls', 'Photo mode', 'Watch the tour', checksItem(OWNER_CHECKS.length), 'Tools…']); // prettier-ignore
    const footer = (kind: string) => page.locator(`.pg-screen[data-kind=${kind}] .pg-footer[data-keyboard]`); // a key hint: none on touch
    await expect(footer('title')).toHaveText('Enter: select · Esc: play');
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
    // the first toon look warms up the toon style, and a key pressed while a warm-up runs never reaches the front end,
    // which reads keys on drawn frames (docs/PROGRESS.md): a frame drawn after it, so the keys below are read
    await call(page, 'render', 1);
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
    await press(page, harness, 'Escape'); // back to the title
    expect((await screens(page)).screens).toEqual(['title']);
    await pick(page, harness, 'title', 'play');
    expect(await screens(page)).toEqual({ screens: [], paused: false });
    expect((await hud(page)).mode).toBe('Camera: shooter · Look: pixel');

    await press(page, harness, 'Escape');
    expect((await screens(page)).screens).toEqual(['pause']);
    expect(await menuLabels(page, 'pause')).toEqual(['Resume', 'Go to…', 'Settings', 'Controls', 'Photo mode', checksItem(OWNER_CHECKS.length), 'Tools…', 'Restart', 'Main menu']); // prettier-ignore
    await expect(footer('menu')).toHaveText('Enter: select · Esc: back');
    const before = await player(page);
    await press(page, harness, 'Space'); // the menu's accept picks Resume; never the player's jump, though it is his key
    expect(await screens(page)).toEqual({ screens: [], paused: false });
    await harness.tick(20);
    expect((await player(page)).actor.y).toBeCloseTo(before.actor.y, 2);

    await press(page, harness, 'Escape');
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
    await press(page, harness, 'Escape');
    expect((await screens(page)).screens).toEqual(['pause']);
    expect((await call<{ code: string }>(page, 'camera.get')).code).toMatch(/^cam3=shoulder/);
    await pick(page, harness, 'pause', 'play');

    await page.addInitScript(plugPad); // a pad in slot 0, untouched until a test presses it
    await page.reload();
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'settings');
    expect([await shown(page, 'cam.fov'), await shown(page, 'post.look'), await shown(page, 'volume:music')]).toEqual(['104', 'look:playground-pixel', '0.25']); // prettier-ignore
    await expect(page.locator('[data-ui=binding][data-id=jump]')).toHaveAttribute('data-value', /KeyK/);
    // A pad works the panel (labs/playground/ui/walk.ts, WP 13.38): its d-pad walks to the field of view and steps it,
    // and the footer and the controls name its buttons.
    for (const button of [PAD.down, PAD.down, PAD.right]) await tapPad(page, harness, button); // the camera, the field of view, +1
    expect(await shown(page, 'cam.fov')).toBe('105');
    await expect(footer('panel')).toHaveText('B: back');
    await expect(page.locator('[data-ui=item][data-id="rebind:jump"]')).toHaveText('A');
    expect(harness.advice()).toEqual([]);
  });

  test('the Tune panel tunes the look live: a filter, a look laid on, the strength, Copy as look, Reset', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/playground/?scene=gym&playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'tools');
    await pick(page, harness, 'tools', 'tune');
    expect((await screens(page)).screens).toEqual(['title', 'tools', 'tune']);
    const panel = page.locator('[data-ui=tune]');
    await expect(panel).toBeVisible();
    const folds = await panel.locator('[data-ui=tune-filter]').evaluateAll((all) => all.map((one) => one.getAttribute('data-id'))); // prettier-ignore
    expect(folds).toEqual([...FILTER_NAMES]);
    type Look = {
      look: string;
      combine: unknown[];
      strength: number;
      filters: Record<string, Record<string, unknown>>;
    };
    const look = () => call<Look>(page, 'look');
    const pipelines = async () => (await call(page, 'render', 2), (await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp); // prettier-ignore
    const range = (at: ReturnType<Page['locator']>, value: number) =>
      at.evaluate((input: HTMLInputElement, v) => ((input.value = String(v)), input.dispatchEvent(new Event('input'))), value); // prettier-ignore
    const before = await look();

    const vignette = panel.locator('[data-ui=tune-filter][data-id=vignette]');
    await vignette.locator('summary').click();
    await vignette.locator('[data-field=scope]').selectOption('all');
    const built = await pipelines(); // the first frame through the chain; every change after it is a uniform write
    await range(vignette.locator('[data-field=strength]'), 0.8);
    expect((await look()).filters.vignette).toMatchObject({ scope: 'all', amount: 1, strength: 0.8 });
    await expect(vignette).toHaveAttribute('data-on', 'true');
    await panel.locator('[data-ui=tune-add]').selectOption('look:cinematic');
    await expect(panel.locator('[data-ui=tune-layer]')).toHaveCount(1);
    expect((await look()).combine).toEqual([{ look: 'look:cinematic', amount: 1, only: [], filters: {} }]);
    expect((await look()).filters.letterbox).toMatchObject({ scope: 'all', aspect: 2.39 });
    await range(panel.locator('[data-ui=tune-strength] input'), 0.5);
    const tuned = await look();
    expect([tuned.strength, tuned.filters.letterbox.amount, tuned.filters.vignette.strength]).toEqual([0.5, 0.5, 0.8]);
    expect(await pipelines(), 'pipelines built by the changes').toBe(built);

    await panel.locator('[data-ui=item][data-id=copy]').click();
    const text = await panel.locator('[data-ui=tune-copy]').inputValue();
    expect(text.startsWith("defineLook('look:my-look', {")).toBe(true);
    expect(Object.keys(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).filters)).toEqual(Object.keys(tuned.filters)); // prettier-ignore
    await panel.locator('[data-ui=item][data-id=remove]').click();
    await expect(panel.locator('[data-ui=tune-layer]')).toHaveCount(0);
    await panel.locator('[data-ui=item][data-id=reset]').click();
    expect(await look()).toEqual(before);
    await press(page, harness, 'Escape');
    expect((await screens(page)).screens).toEqual(['title', 'tools']);
    // Tools' recorded runs by their plain names, and the engine's pages beside the block (WP 13.38)
    await pick(page, harness, 'tools', 'replays');
    expect(await menuLabels(page, 'replays')).toEqual([...RECORDED_RUNS.map((run) => run.label), 'Back']);
    await pick(page, harness, 'replays', 'back');
    await pick(page, harness, 'tools', 'pages');
    expect(await menuLabels(page, 'pages')).toEqual([...ENGINE_PAGES.map((one) => one.label), 'Back']); // on the dev server: no note
    await pick(page, harness, 'pages', 'back');
    expect((await screens(page)).screens).toEqual(['title', 'tools']);
    await pick(page, harness, 'tools', 'feel'); // the feel panel, beside the overlay, in the theme (WP 13.38)
    const feel = page.locator('[data-ui=feel]');
    await expect(feel.getByRole('heading', { name: 'Tune the feel' })).toBeVisible();
    expect(await feel.evaluate((el) => [getComputedStyle(el).fontFamily, getComputedStyle(el.querySelector('input')!).accentColor])).toEqual([expect.stringMatching(/^Inter,/), 'rgb(255, 181, 71)']); // prettier-ignore
    await feel.locator('[data-feel=close]').click();
    await expect(feel).toBeHidden();
    expect(harness.advice()).toEqual([]);
  });

  test('the movement profile from settings starts the scene again on it, recorded; Restart starts it on its seed', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/playground/?scene=gym&playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'settings');
    await page.locator('[data-ui=setting][data-id="playground.movement"] select').selectOption('movement:platformer');
    await harness.tick(2);
    expect((await player(page)).motion).toBeUndefined(); // the box hero's controller: no shooter model
    expect((await call<{ tick: number }>(page, 'info')).tick).toBe(0); // started again, paused under the screen
    await press(page, harness, 'Escape');
    await pick(page, harness, 'title', 'play');
    await call(page, 'pause');
    await call(page, 'step', 60, { move: [-1, 0] });
    const { replay, hash } = await recording(page);
    expect(replay.settings).toMatchObject({ 'playground.movement': 'movement:platformer' });
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(hash);
    await press(page, harness, 'Escape');
    await pick(page, harness, 'pause', 'restart');
    expect((await call<{ tick: number }>(page, 'info')).tick).toBeLessThan(5);
    expect((await player(page)).motion).toBeUndefined(); // the setting kept over the restart
    expect(harness.advice()).toEqual([]);
  });

  test('Go to opens the block at an area from the gym, and puts the player in a room on it, recorded', async ({
    page,
    harness,
  }) => {
    test.setTimeout(1_500_000);
    await page.goto('labs/playground/?scene=gym&playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'spawns');
    const items = await menuLabels(page, 'spawns');
    const [areas, rooms] = ['area', 'room'].map((group) => spawnPlaces().filter((place) => place.group === group).map((place) => place.label)); // prettier-ignore
    expect(items).toEqual(['Areas of the block', ...areas, 'Rooms of the house', ...rooms, 'Back']);
    expect(areas).toEqual(Object.values(AREAS).map((card) => card.name)); // each area by its card's name
    expect(rooms.filter((name) => !/^[A-Z][a-z]+( [a-z]+)*$/.test(name))).toEqual([]); // each room as a player reads it
    await page.locator('[data-ui=menu][data-id=spawns] [data-ui=item][data-id="area:range"]').click();
    await page.waitForURL(/scene=site/);
    await harness.ready({ timeout: SITE_READY });
    await harness.tick(2);
    const range = spawnPlaces().find((place) => place.id === 'area:range')!;
    const at = (await player(page)).actor;
    expect(Math.hypot(at.x - range.args.at[0], at.z - range.args.at[2])).toBeLessThan(0.5);

    await pick(page, harness, 'title', 'spawns'); // the block's page opens on the start menu too (`playground.title` kept)
    await pick(page, harness, 'spawns', 'room:house/kitchen');
    expect(await screens(page)).toEqual({ screens: [], paused: false });
    await call(page, 'pause');
    await call(page, 'step', 30);
    await call(page, 'render', 2);
    expect((await hud(page)).room).toBe('House · kitchen');
    const { replay, hash } = await recording(page);
    expect(replay.inputs[0]).toMatchObject([0, { dev: 'place', args: range.args }]); // the pick on opening, under the title: recorded at step 0, held until a step follows (engine/sim/session.ts)
    expect(replay.inputs.filter(([, change]) => JSON.stringify(change).includes('"place"'))).toHaveLength(2);
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(hash);

    // I shows the area's card again, a second press putting it away (WP 13.38)
    const card = page.locator('[data-ui=area-card]');
    const cardNow = async () => (await call(page, 'render', 1), (await card.getAttribute('data-value')) ?? '');
    const before = await cardNow();
    await press(page, harness, 'KeyI');
    const toggled = await cardNow();
    await press(page, harness, 'KeyI');
    expect([toggled, await cardNow()]).toEqual([before === 'shown' ? '' : 'shown', before]);
    await press(page, harness, 'Escape'); // pause's This area's card: I's, for a pad
    await pick(page, harness, 'pause', 'card');
    expect([(await screens(page)).screens, await cardNow()]).toEqual([[], toggled]);
    // Settings' Time of day sets the block's clock, once the slider is let go (WP 13.38)
    await press(page, harness, 'Escape');
    await pick(page, harness, 'pause', 'settings');
    await page.locator('[data-ui=setting][data-id="playground.hour"] input').evaluate((input: HTMLInputElement) => {
      input.value = '22';
      input.dispatchEvent(new Event('input')); // a step of the drag: read beside it
      input.dispatchEvent(new Event('change')); // let go: reported
    });
    await expect(page.locator('[data-ui=setting][data-id="playground.hour"] [data-ui=setting-shown]')).toHaveText(
      '22:00',
    );
    await press(page, harness, 'Escape');
    await press(page, harness, 'Escape');
    await call(page, 'pause');
    await call(page, 'step', 2);
    const clock = await page.evaluate(() => (__engine.state('daytime') as { entities: { daytime: { hour: number } }[] }).entities[0].daytime.hour); // prettier-ignore
    expect(Math.floor(clock)).toBe(22);

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
  test('the owner’s checks: listed, answered and kept, and a check opened at its spot, recorded', async ({
    page,
    harness,
  }) => {
    test.setTimeout(1_500_000); // Go there opens the gym on the block: the block's page warms up as Go to's does
    await page.goto('labs/playground/?scene=gym&playground.title=on');
    await harness.ready({ timeout: READY });
    await harness.tick(2);
    await pick(page, harness, 'title', 'checks');
    const panel = page.locator('[data-ui=checks]');
    await expect(panel).toHaveAttribute('data-value', 'list');
    for (const check of OWNER_CHECKS) await expect(panel.locator(`[data-ui=item][data-id="check:${check.id}"]`)).toHaveCount(1); // prettier-ignore
    for (const key of ['ArrowDown', 'ArrowDown', 'Enter', 'Enter']) {
      await page.keyboard.press(key); // the keys work it as a menu: down twice, the second check, its first choice
      await harness.tick(2);
    }
    await expect(panel).toHaveAttribute('data-value', 'check:esc-0003');
    await expect(panel.locator('[data-ui=item][data-id="verdict:without"]')).toHaveAttribute('data-value', 'selected');
    await press(page, harness, 'Escape');
    await expect(panel).toHaveAttribute('data-value', 'list');
    await panel.locator('[data-ui=item][data-id="check:mantle"]').click();
    await expect(panel).toHaveAttribute('data-value', 'check:mantle');
    await expect(panel).toContainText('press Space to climb'); // the player's key for {jump}
    await panel.locator('[data-ui=item][data-id="verdict:needs-work"]').click();
    await panel.locator('[data-ui=check-note]').pressSequentially('pause'); // P, the look's key, reaches nothing
    await harness.tick(2);
    expect((await hud(page)).mode).toBe('Camera: shooter · Look: clean'); // the look kept
    expect(await page.evaluate(() => __playgroundUi.checks().find((check) => check.id === 'mantle'))).toMatchObject({ verdict: 'needs-work', note: 'pause' }); // prettier-ignore
    await panel.locator('[data-ui=item][data-id=back]').click();
    await expect(panel.locator('[data-ui=item][data-id="check:mantle"]')).toHaveAttribute('data-value', 'needs-work');
    await panel.locator('[data-ui=item][data-id=answers]').click();
    await expect(panel.locator('[data-ui=answers-text]')).toHaveValue(/- mantle \(docs\/PLAYGROUND\.md §9\.3, item 3\), Mantle, vault and climb: Needs work \(say what in the note\)\. Note: pause/); // prettier-ignore
    await press(page, harness, 'Escape'); // back to the list
    await expect(panel).toHaveAttribute('data-value', 'list');
    await panel.locator('[data-ui=item][data-id="check:mantle"]').click();
    await panel.locator('[data-ui=item][data-id=go]').click();
    await page.waitForURL(/playground\.check=mantle/);
    await harness.ready({ timeout: SITE_READY });
    await harness.tick(2);
    expect(await screens(page)).toEqual({ screens: [], paused: false }); // no start menu on a check's page
    await call(page, 'pause');
    const spot = ownerCheck('mantle')!.go!.place!.at;
    const at = (await player(page)).actor;
    expect(Math.hypot(at.x - spot[0], at.z - spot[2])).toBeLessThan(0.25);
    await call(page, 'render', 2);
    expect((await hud(page)).check).toBe('Checking: Mantle, vault and climb · Esc, then Answer this check');
    const { replay, hash } = await recording(page);
    const places = replay.inputs.filter(([, change]) => (change as { dev?: string }).dev === 'place');
    expect(places).toMatchObject([[expect.any(Number), { dev: 'place', args: { at: [...spot], yaw: 0 } }]]);
    expect(playReplay(replay).hashes[String(replay.steps)]).toBe(hash);
    await call(page, 'resume');
    await press(page, harness, 'Escape');
    const items = await menuLabels(page, 'pause');
    expect(items.slice(0, 2)).toEqual(['Resume', 'Answer this check…']);
    expect(items).toContain(checksItem(OWNER_CHECKS.length - 2)); // esc-0003 and mantle answered
    await pick(page, harness, 'pause', 'check');
    await expect(panel).toHaveAttribute('data-value', 'check:mantle');
    await expect(panel.locator('[data-ui=item][data-id="verdict:needs-work"]')).toHaveAttribute('data-value', 'selected'); // prettier-ignore
    await expect(panel.locator('[data-ui=check-note]')).toHaveValue('pause');
    await panel.locator('[data-ui=item][data-id="verdict:good"]').click();
    await panel.locator('[data-ui=item][data-id=back]').click();
    await harness.tick(2);
    expect((await screens(page)).screens).toEqual(['pause']);
    expect(await page.evaluate(() => __playgroundUi.checks().find((check) => check.id === 'mantle')?.verdict)).toBe('good'); // prettier-ignore
    expect(harness.advice()).toEqual([]);
  });
});
