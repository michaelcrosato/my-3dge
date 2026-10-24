/**
 * @file T2 for the playground's sound (PLAN.md WP 13.22). Its Done-when's half that needs a browser, and the page:
 * - the house replay's sound timeline (its sim events read as the playground's sounds after every step,
 *   tests/pages/playgroundAudioTimeline.ts) hashes the same in Chromium (tests/pages/playground-audio.html) as in
 *   Node, and as its golden; the run is the recorded one (its last hash is the replay's golden);
 * - the runtime with the playground (labs/playground/, its sound from labs/playground/sounds/page.ts, published as
 *   `window.__playgroundSound`): locked until a key, then running; the house replay played in the page, a frame drawn
 *   every 20 steps, keeps its goldens and asks for the very sounds Node's timeline lists, in its order, none missed;
 *   at its end the reverb is the room the player stands in, as Node works it out, and that place's bed plays.
 * The fixture fails a test on any page error or unlisted console warning, so "no errors" holds throughout.
 *
 * Invariants: nothing from engine/ or labs/ is imported here: Node's half runs in a child process (as
 * tests/e2e/box-audio.spec.ts's does), so the kinds the playground registers never reach the specs this worker runs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const SITE_FILE = 'tests/replays/playground-site.replay.json';
const SITE_TEXT = readFileSync(join(ROOT, SITE_FILE), 'utf8');
/** How long the block's page may take to be ready on SwiftShader (tests/e2e/playground.spec.ts's). */
const SITE_READY = 420_000;

/** What both halves report of the house replay's timeline; Node's adds the reverb and the bed it ends in. */
interface Timeline {
  sounds: number;
  hash: string;
  worldHash: string;
  missed: number;
  log: string[];
  SITE_TIMELINE: { sounds: number; hash: string };
  room?: { decay: number; predelay: number; damping: number; wet: number };
  bed?: string;
}

/** The playground sound's report (labs/playground/sounds/page.ts `PlaygroundSoundInfo`), as far as the spec reads it. */
interface SoundInfo {
  audio: { state: string; voices: string[]; mixer: { room: Timeline['room'] } | null };
  room: string;
  played: number;
  log: string[];
  missed: number;
}

/** The page's sound and engine, inside `evaluate`. */
declare const __playgroundSound: { info(): SoundInfo };
declare const __engine: { pause(): void; replay(text: string, options: object): Promise<{ hashes: Record<string, string> }> }; // prettier-ignore

/** Variables a test runner sets for its own workers; the Node child starts without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;

/** Node's half: the house replay's timeline and the reverb and bed it ends in, printed as one line of JSON. */
const TIMELINE_SCRIPT = `
import { readFileSync } from 'node:fs';
import { roomAcoustics, ROOMS } from './engine/index.ts';
import './labs/playground/bodies/player.ts';
import './labs/playground/scenes/site.ts';
import { SITE_GROUND } from './labs/playground/sounds/ground.ts';
import { BEDS } from './labs/playground/sounds/page.ts';
import { SITE_TIMELINE, soundTimeline } from './tests/pages/playgroundAudioTimeline.ts';

const { events, hash, worldHash, missed, player } = soundTimeline(readFileSync(SITE_TIMELINE.replay, 'utf8'), SITE_GROUND);
const inside = player && SITE_GROUND.room(...player);
const [room, bed] = inside ? [roomAcoustics(inside), BEDS.indoors] : [ROOMS.outdoor, BEDS.outdoors];
const log = events.map((e) => e.type + ' ' + e.sfx);
process.stdout.write('\\n' + JSON.stringify({ sounds: events.length, hash, worldHash, missed, log, SITE_TIMELINE, room, bed }) + '\\n');
`;

/** The house replay's timeline in Node, in a child process (see the file comment). */
function timelineInNode(): Timeline {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', TIMELINE_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    timeout: 240_000,
  });
  if (run.status !== 0) throw new Error(`the house's Node run failed (${run.status}):\n${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').at(-1)!) as Timeline;
}

/** The replay's goldens. */
const GOLDEN = (JSON.parse(SITE_TEXT) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];

/** The playground sound's report now. */
const info = (page: Page) => page.evaluate(() => __playgroundSound.info());

test.describe.configure({ timeout: 900_000 });

test('the house replay’s sound timeline hashes the same in Chromium as in Node, and as its golden', async ({
  page,
  harness,
}) => {
  const node = timelineInNode();
  await page.goto('tests/pages/playground-audio.html');
  await harness.ready();
  const chromium = await page.evaluate(() => window.__playgroundAudio.timeline());
  expect(node.worldHash).toBe(GOLDEN['780']);
  expect(chromium.worldHash).toBe(GOLDEN['780']);
  expect([node.missed, chromium.missed]).toEqual([0, 0]);
  expect(chromium.log).toEqual(node.log);
  expect([chromium.sounds, chromium.hash]).toEqual([node.sounds, node.hash]);
  expect([node.sounds, node.hash]).toEqual([node.SITE_TIMELINE.sounds, node.SITE_TIMELINE.hash]);
});

test('the playground’s page: locked until a key, then the house replay asks for Node’s sounds, in its room’s reverb', async ({
  page,
  harness,
}) => {
  const node = timelineInNode();
  await page.goto('labs/playground/?scene=site-house');
  await harness.ready({ timeout: SITE_READY });
  await harness.assertWebGPU();
  await page.evaluate(() => __engine.pause());
  expect((await info(page)).audio).toMatchObject({ state: 'locked', voices: [] });
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await info(page)).audio.state, { timeout: 10_000 }).toBe('running');
  const run = await page.evaluate((text) => __engine.replay(text, { draw: 20 }), SITE_TEXT);
  expect(run.hashes).toEqual(GOLDEN); // the sound changes nothing
  const end = await info(page);
  expect(end.missed).toBe(0);
  expect(end.log).toEqual(node.log);
  expect(end.played).toBeGreaterThan(0);
  for (const [key, value] of Object.entries(node.room!)) expect(end.audio.mixer?.room?.[key as 'decay'], key).toBeCloseTo(value, 9); // prettier-ignore
  expect(end.audio.voices).toContain(node.bed);
  expect(harness.advice()).toEqual([]);
});
