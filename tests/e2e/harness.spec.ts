/**
 * @file Checks the e2e fixture itself on `tests/pages/harness.html` (PLAN.md WP 0.2): WebGPU really ran on
 * SwiftShader and drew the expected frame, the clock is virtual and the randomness seeded, and a page error thrown
 * from a `.ts` module names that file and line.
 *
 * Invariants: the expected colours are those `tests/pages/harness.ts` draws, as 8-bit values (±2 for rounding).
 * The random oracle below is written independently of the fixture's init script.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { parseStack } from '../../tools/lib/browser';
import { fnv1a } from '../../tools/lib/hash';
import { expect, test } from './fixtures';

const PAGE = 'tests/pages/harness.html';

/** The 1-based line of `harness.ts` that throws, found by its marker comment. */
const THROW_LINE =
  readFileSync('tests/pages/harness.ts', 'utf8')
    .split('\n')
    .findIndex((line) => line.includes('// thrown here')) + 1;

/** mulberry32, the generator the fixture seeds: the first `count` values for `seed`. */
function mulberry32(seed: number, count: number): number[] {
  let state = seed >>> 0;
  return Array.from({ length: count }, () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/** How many frames the page has drawn (its own count, published on `__engine`). */
const framesDrawn = (page: Page) =>
  page.evaluate(() => (window as unknown as { __engine: { frames: number } }).__engine.frames);

/** Asserts an RGBA pixel's colour within ±2 per channel, ignoring alpha. */
function expectColour(actual: number[], expected: number[], what: string): void {
  const near = expected.every((value, i) => Math.abs(actual[i] - value) <= 2);
  expect(near, `${what}: expected about rgb(${expected.join(', ')}), got rgba(${actual.join(', ')})`).toBe(true);
}

test('WebGPU ran on SwiftShader and drew the expected frame', async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
  const gpu = await harness.assertWebGPU();
  expect(gpu.adapter.vendor).toBe('google');
  expect(gpu.adapter.architecture).toBe('swiftshader');
  expect(gpu.backend).toBe('WebGPU');
  const frame = await harness.readFrame();
  expect([frame.width, frame.height]).toEqual([64, 48]);
  expect(frame.blank).toBe(false);
  expectColour(frame.pixel(32, 26), [255, 128, 0], 'the triangle at the centre');
  expectColour(frame.pixel(2, 2), [26, 51, 77], 'the clear colour in the corner');
});

test('the clock is virtual and the randomness seeded', async ({ page, harness, seed }) => {
  await page.goto(PAGE);
  await harness.ready();
  const start = await page.evaluate(() => ({ now: performance.now(), date: Date.now(), ticks: window.__clock.frames }));
  expect(start).toEqual({ now: 1000, date: 1.7e12 + 1000, ticks: 0 });
  expect(await framesDrawn(page)).toBe(1);

  // A screenshot takes real time while the browser paints, yet no animation frame runs without the clock.
  await harness.readFrame();
  expect(await framesDrawn(page)).toBe(1);
  expect(await page.evaluate(() => performance.now())).toBe(1000);

  await harness.tick(3);
  expect(await framesDrawn(page)).toBe(4);
  const after = await page.evaluate(() => ({ now: performance.now(), date: Date.now(), ticks: window.__clock.frames }));
  expect(after).toEqual({ now: 1000 + 3000 / 60, date: 1.7e12 + 1000 + 3000 / 60, ticks: 3 });

  const random = await page.evaluate(() => ({
    math: [Math.random(), Math.random(), Math.random()],
    spawn: [0, 1, 2].map(() => window.__clock.rng('spawn')()),
    ai: window.__clock.rng('ai')(),
  }));
  expect(random.math).toEqual(mulberry32(seed, 3));
  expect(random.spawn).toEqual(mulberry32(fnv1a('spawn') ^ seed, 3));
  expect(random.ai).toEqual(mulberry32(fnv1a('ai') ^ seed, 1)[0]);
});

test('a page error names its .ts file and line', async ({ page, harness }) => {
  expect(THROW_LINE).toBeGreaterThan(0);
  await page.goto(`${PAGE}?throw`);
  await expect(harness.ready()).rejects.toThrow(`(tests/pages/harness.ts:${THROW_LINE}:`);
  const [error] = await harness.errors();
  expect(error.message).toBe('Error: harness: thrown on purpose');
  expect({ file: error.file, line: error.line }).toEqual({ file: 'tests/pages/harness.ts', line: THROW_LINE });
  expect(error.frames[0]).toMatchObject({ fn: 'explode', mapped: true });
  // The browser's own position is elsewhere in the served JavaScript, so the source map did the work.
  expect(parseStack(error.stack)[0].line).not.toBe(THROW_LINE);
});
