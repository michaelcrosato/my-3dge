/**
 * @file T2 for the audio runtime (PLAN.md WP 9.3, I-23): the browser smoke test and the `OfflineAudioContext` smoke
 * test of its Done-when, on tests/pages/audio.html.
 *
 * The context's states: the page's runtime is `locked`, with no context, until a gesture; a touch's pointerdown is
 * not one, its end is, and so are a key (not Escape) and a click; then it is `running`, and the song asked for while
 * locked plays. Suspended by the browser, a key resumes it; closed, it stays closed and plays nothing. The fixture
 * fails a test on any page error or unlisted console warning, so "no errors" holds throughout.
 *
 * The offline renders, within the tolerances named below: levels through the buses and the master; HRTF panning to
 * the listener's right and the inverse distance law; occlusion muffling the highs and lowering the lows by
 * `OCCLUSION.gain`, also when a wall comes between mid-sound; music layers by intensity, a stinger bound to an event
 * on the beat, a section change on the bar line, ducking and its release; the hall's reverb tail and its decay; the
 * voice limits; footsteps by surface tag.
 */
import type { Page } from '@playwright/test';
import { DUCK, BUS_VOLUMES } from '../../engine/audio/runtime/mixer';
import { ROOMS } from '../../engine/audio/runtime/reverb';
import { OCCLUSION } from '../../engine/audio/runtime/spatial';
import { expect, test } from './fixtures';

const PAGE = 'tests/pages/audio.html';

/** A level's tolerance, relative. */
const LEVEL = 0.03;
/** A ratio's tolerance, absolute. */
const RATIO = 0.05;
/** An onset's tolerance, s: the onset finder's 10 ms window and the 128-sample render quantum. */
const TIMING = 0.012;

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
});

/** The page runtime's state, polled until it is `state`. */
const stateBecomes = (page: Page, state: string) =>
  expect.poll(() => page.evaluate(() => window.__audio.live.info().state), { timeout: 5000 }).toBe(state);

test.describe('the context', () => {
  test.use({ hasTouch: true });

  test('waits for a gesture: a touch starts it when it ends, not when it begins; a key resumes it', async ({
    page,
  }) => {
    const info = () => page.evaluate(() => window.__audio.live.info());
    expect(await info()).toMatchObject({ state: 'locked', rate: null, music: null });
    expect(await page.evaluate(() => window.__audio.live.play())).toBeNull();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 100 }] });
    await page.evaluate(() => new Promise((done) => setTimeout(done, 200)));
    expect((await info()).state).toBe('locked');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await stateBecomes(page, 'running');
    expect((await info()).music?.song).toBe('song:title');
    expect(await page.evaluate(() => window.__audio.live.play())).toBe('sfx:jump');
    expect(await page.evaluate(() => window.__audio.live.suspend())).toBe('suspended');
    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise((done) => setTimeout(done, 200)));
    expect((await info()).state).toBe('suspended');
    await page.keyboard.press('KeyA');
    await stateBecomes(page, 'running');
    expect(await page.evaluate(() => window.__audio.live.close())).toBe('closed');
    await page.keyboard.press('KeyA');
    expect((await info()).state).toBe('closed');
    expect(await page.evaluate(() => window.__audio.live.play())).toBeNull();
  });
});

test('a key starts the context, Escape does not', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise((done) => setTimeout(done, 200)));
  expect(await page.evaluate(() => window.__audio.live.info().state)).toBe('locked');
  await page.keyboard.press('KeyA');
  await stateBecomes(page, 'running');
});

test('a click starts the context', async ({ page }) => {
  await page.mouse.click(200, 200);
  await stateBecomes(page, 'running');
});

test.describe('offline', () => {
  test('levels: a bus at its volume, through the master, in both ears', async ({ page }) => {
    const got = await page.evaluate(() => window.__audio.levels());
    const effects = 0.5 * BUS_VOLUMES.effects * BUS_VOLUMES.master;
    expect(Math.abs(got.left / effects - 1)).toBeLessThan(LEVEL);
    expect(Math.abs(got.right / effects - 1)).toBeLessThan(LEVEL);
    expect(Math.abs(got.ui / (0.5 * 0.5 * BUS_VOLUMES.ui * BUS_VOLUMES.master) - 1)).toBeLessThan(LEVEL);
  });

  test('spatial: a sound on the right is heard on the right; twice as far is half as loud', async ({ page }) => {
    const got = await page.evaluate(() => window.__audio.spatial());
    expect(got.rightOverLeft).toBeGreaterThan(3);
    expect(Math.abs(got.fourOverTwo - 0.5)).toBeLessThan(RATIO / 2);
    expect(got.listener).toEqual({ position: [0, 0, 0], yaw: 0, pitch: 0 });
  });

  test('occlusion: a wall muffles the highs and lowers the lows, also when it comes between', async ({ page }) => {
    const got = await page.evaluate(() => window.__audio.occlusion());
    expect(got.flags).toEqual([false, false, true, true]);
    expect(got.high).toBeLessThan(0.06);
    expect(Math.abs(got.low - OCCLUSION.gain)).toBeLessThan(RATIO);
  });

  test('music: layers by intensity, a stinger on the beat, a new song on the bar line, ducking', async ({ page }) => {
    const got = await page.evaluate(() => window.__audio.music());
    const start = got.start ?? NaN;
    expect(got.leadBefore).toBeLessThan(0.01);
    expect(Math.abs(got.leadAfter - 1)).toBeLessThan(RATIO * 2);
    expect(Math.abs(got.stinger - (start + 1))).toBeLessThan(TIMING); // the next beat after 0.6 s
    expect(got.position).toMatchObject({ song: 'song:test.b', start: start + 4, bar: 0, beat: 0, intensity: 1 });
    expect(Math.abs(got.section - (start + 4))).toBeLessThan(TIMING); // the next bar line after 2.6 s
    expect(got.aAfterB).toBeLessThan(0.01);
    expect(got.bBefore).toBeLessThan(0.01);
    expect(Math.abs(got.ducked - DUCK.level)).toBeLessThan(RATIO);
    expect(Math.abs(got.released - 1)).toBeLessThan(RATIO);
  });

  test("reverb: the hall's tail at its wet level, wide, decaying at its RT60", async ({ page }) => {
    const got = await page.evaluate(() => window.__audio.reverb());
    expect(got.room).toEqual(ROOMS.hall);
    expect(got.dry).toBeLessThan(1e-6);
    for (const ratio of got.wetOverDry) expect(Math.abs(ratio / ROOMS.hall.wet ** 2 - 1)).toBeLessThan(0.2);
    expect(Math.abs(got.correlation)).toBeLessThan(0.1);
    const expected = Math.pow(10, -(60 * 0.8) / ROOMS.hall.decay / 20); // 0.8 s later on a 60 dB-per-decay slope
    expect(Math.abs(got.later / expected - 1)).toBeLessThan(0.15);
  });

  test('voice limits: the gap, perSound and max', async ({ page }) => {
    expect(await page.evaluate(() => window.__audio.limits())).toEqual([
      'sfx:test.tone',
      null,
      'sfx:test.tone sfx:test.tone',
      'sfx:test.tone sfx:test.tone',
      'sfx:test.tone sfx:test.tone sfx:test.low',
      'sfx:test.tone sfx:test.low sfx:test.high',
    ]);
  });

  test('footsteps: the surface tag picks the effect', async ({ page }) => {
    expect(await page.evaluate(() => window.__audio.footsteps())).toEqual({
      iron: 'sfx:test.iron',
      mud: 'sfx:test.tone',
      fallback: 'sfx:step',
    });
  });
});
