/**
 * @file T2 for sound in the box (PLAN.md §9.0, WP 9.5, I-23). Its Done-when, in two parts:
 * - the fight replay's sound timeline (its sim events read as the box's sounds after every step,
 *   tests/pages/boxAudioTimeline.ts) hashes the same in Chromium (tests/pages/box-audio.html) as in Node, and as its
 *   golden; the run is the recorded one (its last hash is the replay's golden);
 * - the runtime smoke test with the box: in the box page (labs/box/, sound from labs/box/sounds/page.ts, published as
 *   `window.__boxSound`) the sound is locked until a gesture (a key, a click), then running: the demo song plays, the
 *   room's reverb is the level's, the nearest torches crackle, and the fight replayed in real time (`?replay=`) asks
 *   for the very sounds Node's timeline lists, in its order, with none missed and the music a fight's while blows land.
 * The fixture fails a test on any page error or unlisted console warning, so "no errors" holds throughout.
 *
 * Invariants: nothing from engine/ or labs/ is imported here: Node's half runs in a child process (as
 * tests/e2e/box-fight.spec.ts's does), so the kinds the box registers never reach the specs this worker runs next.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const FIGHT_FILE = 'tests/replays/box-5-fight.replay.json';
/** The torches that crackle at once: `TORCH.voices` in labs/box/sounds/page.ts. */
const TORCH_VOICES = 2;

/** What both halves report of the fight's timeline. */
interface Timeline {
  sounds: number;
  hash: string;
  worldHash: string;
  missed: number;
  log: string[];
  FIGHT_TIMELINE: { sounds: number; hash: string };
}

/** The box sound's report (labs/box/sounds/page.ts `BoxSoundInfo`), as far as the spec reads it. */
interface BoxSoundInfo {
  audio: { state: string; voices: string[]; music: { song: string } | null };
  room: string;
  intensity: number;
  torches: number[];
  asked: Record<string, number>;
  played: number;
  log: string[];
  missed: number;
}

/** The box sound's report and the page's engine, inside `evaluate`. */
declare const __boxSound: { info(): BoxSoundInfo };
declare const __engine: { info(): { tick: number } };

/** Variables a test runner sets for its own workers; the Node child starts without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;

/** Node's half: the fight replay's timeline, printed as one line of JSON. */
const TIMELINE_SCRIPT = `
import { readFileSync } from 'node:fs';
import './labs/box/scenes/fight.ts';
import { HALL_LEVEL } from './labs/box/scenes/hall.ts';
import { FIGHT_TIMELINE, soundTimeline } from './tests/pages/boxAudioTimeline.ts';

const { events, hash, worldHash, missed } = soundTimeline(readFileSync(FIGHT_TIMELINE.replay, 'utf8'), HALL_LEVEL);
const log = events.map((e) => e.type + ' ' + e.sfx);
process.stdout.write('\\n' + JSON.stringify({ sounds: events.length, hash, worldHash, missed, log, FIGHT_TIMELINE }) + '\\n');
`;

/** The fight replay's timeline in Node, in a child process (see the file comment). */
function timelineInNode(): Timeline {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', TIMELINE_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    timeout: 180_000,
  });
  if (run.status !== 0) throw new Error(`the fight's Node run failed (${run.status}):\n${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').at(-1)!) as Timeline;
}

/** The box sound's report now. */
const info = (page: Page) => page.evaluate(() => __boxSound.info());

test.describe.configure({ timeout: 240_000 });

test('the fight replay’s sound timeline hashes the same in Chromium as in Node, and as its golden', async ({
  page,
  harness,
}) => {
  const node = timelineInNode();
  await page.goto('tests/pages/box-audio.html');
  await harness.ready();
  const chromium = await page.evaluate(() => window.__boxAudio.timeline());
  const golden = (
    JSON.parse(readFileSync(join(ROOT, FIGHT_FILE), 'utf8')) as {
      hashes: Record<string, Record<string, string>>;
    }
  ).hashes['linux-x64'];
  expect(node.worldHash).toBe(golden['600']);
  expect(chromium.worldHash).toBe(golden['600']);
  expect([node.missed, chromium.missed]).toEqual([0, 0]);
  expect(chromium.log).toEqual(node.log);
  expect([chromium.sounds, chromium.hash]).toEqual([node.sounds, node.hash]);
  expect([node.sounds, node.hash]).toEqual([node.FIGHT_TIMELINE.sounds, node.FIGHT_TIMELINE.hash]);
});

test.describe('the runtime with the box', () => {
  test('locked until a key, then the fight replayed in real time asks for Node’s sounds, with music and torches', async ({
    page,
    harness,
  }) => {
    const node = timelineInNode();
    await page.goto('labs/box/?replay=box-5-fight&cam3=chase');
    await harness.ready({ timeout: 60_000 });
    await harness.assertWebGPU();
    expect((await info(page)).audio).toMatchObject({ state: 'locked', voices: [], music: null });
    await page.keyboard.press('Shift');
    await expect.poll(async () => (await info(page)).audio.state, { timeout: 10_000 }).toBe('running');
    await harness.tick(1); // the clock's origin
    await harness.tick(300);
    const mid = await info(page);
    expect(mid.intensity).toBe(1); // blows landed within the last MUSIC.calm seconds
    await harness.tick(400); // past the replay's 600 steps, its hit-stops included
    expect(await page.evaluate(() => __engine.info().tick)).toBeGreaterThanOrEqual(600);
    const end = await info(page);
    expect(end.missed).toBe(0);
    expect(end.log).toEqual(node.log);
    expect(end.played).toBeGreaterThan(0);
    for (const sfx of ['sfx:boxStep', 'sfx:boxHit', 'sfx:boxLaunch', 'sfx:boxThud', 'sfx:boxDeath'])
      expect(end.asked[sfx]).toBeGreaterThan(0);
    expect(end.room).toBe('hall');
    expect(end.audio.music?.song).toBe('song:boxHall');
    expect(end.torches).toHaveLength(TORCH_VOICES);
    expect(end.audio.voices.filter((id) => id === 'sfx:boxTorch')).toHaveLength(TORCH_VOICES);
    expect(harness.advice()).toEqual([]);
  });

  test('in the room: a click starts it, the room’s reverb, the song, no torches', async ({ page, harness }) => {
    await page.goto('labs/box/?scene=room');
    await harness.ready({ timeout: 60_000 });
    expect((await info(page)).audio.state).toBe('locked');
    await page.locator('canvas').click();
    await expect.poll(async () => (await info(page)).audio.state, { timeout: 10_000 }).toBe('running');
    await harness.tick(10);
    const now = await info(page);
    expect(now).toMatchObject({ room: 'room', torches: [], intensity: 0, missed: 0 });
    expect(now.audio.music?.song).toBe('song:boxHall');
  });
});
