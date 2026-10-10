/**
 * @file T2 for the DSP core (PLAN.md WP 9.1, §6.5; doctrine: Reproducible): the same sound definition and seed give
 * the same buffer, and so the same hash, in Node and in Chromium, so one golden per sound holds in both. Node's half
 * runs in this spec's own process, Chromium's in tests/pages/audio-dsp.html; both render the reference sounds and the
 * seeded random sounds of tests/pages/audioDspCases.ts with engine/audio/dsp/render.ts.
 *
 * What fails: a reference sound whose Chromium hash differs from Node's (the message names the first sample that
 * differs, with both values) or from its golden on this platform; any of 200 random definitions, seeds and rates
 * that hashes differently in the two runtimes; `Math` left swapped after a render in Chromium, also after one that
 * throws. On a platform without goldens, the Node-against-Chromium checks still run and the golden check is noted
 * as "golden: other platform".
 */
import { render } from '../../engine/audio/dsp/render';
import { caseHashes, GOLDEN, randomSound, SOUND_CASES } from '../pages/audioDspCases';
import { expect, test } from './fixtures';

const PAGE = 'tests/pages/audio-dsp.html';
const PLATFORM = `${process.platform}-${process.arch}`;

/** How many random sounds the sweep renders in each runtime. */
const RANDOM_SOUNDS = 200;

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
});

/** Decodes the page's base64 float32 bytes. */
const decode = (text: string) => {
  const bytes = Buffer.from(text, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

test('every reference sound hashes the same in Chromium as in Node, and as its golden', async ({ page }) => {
  const node = caseHashes();
  const chromium = await page.evaluate(() => window.__audioDsp.caseHashes());
  const differ = SOUND_CASES.filter((c) => chromium[c.name] !== node[c.name]);
  for (const c of differ) {
    const mine = render(c.def, c.seed, c.rate);
    const theirs = decode(await page.evaluate((name) => window.__audioDsp.samples(name), c.name));
    const first = mine.findIndex((value, i) => !Object.is(value, theirs[i]));
    test.info().annotations.push({
      type: 'differs',
      description: `${c.name}: ${mine.length} samples in Node, ${theirs.length} in Chromium; first difference at ${first}: Node ${mine[first]}, Chromium ${theirs[first]}`,
    });
  }
  expect(differ.map((c) => c.name)).toEqual([]);
  expect(Object.keys(node)).toHaveLength(SOUND_CASES.length);
  if (GOLDEN[PLATFORM]) expect(node).toEqual(GOLDEN[PLATFORM]);
  else test.info().annotations.push({ type: 'golden', description: `golden: other platform (${PLATFORM})` });
});

test('a sweep of 200 random definitions, seeds and rates hashes the same in Node and Chromium', async ({ page }) => {
  const seeds = Array.from({ length: RANDOM_SOUNDS }, (_, i) => i + 1);
  const chromium = await page.evaluate((list) => window.__audioDsp.randomHashes(list), seeds);
  const node = Object.fromEntries(
    seeds.map((seed) => {
      const c = randomSound(seed);
      return [c.name, caseHashes([c])[c.name]];
    }),
  );
  expect(Object.keys(chromium)).toHaveLength(RANDOM_SOUNDS);
  expect(chromium).toEqual(node);
});

test('a render leaves Math native in Chromium, also after one that throws a coded error', async ({ page }) => {
  const seen = await page.evaluate(() =>
    window.__audioDsp.restores({ wave: 'sine', freq: 'C4', to: 900, dur: 0.05 }, { wave: 'sine', vol: -1 }),
  );
  expect(seen).toEqual({ before: true, after: true, afterThrow: true, code: 'AUDIO_BAD_VALUE' });
});
