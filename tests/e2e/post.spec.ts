/**
 * @file T2 for post-processing (PLAN.md WP 7.4) on the post page (tests/pages/post.html: the Stress Box's room with
 * two characters and a glowing orb, drawn through the chain):
 * 1. the clean look draws the plain frame; every scoped filter (cel, pixel, palette, outline, stylize, grade,
 *    scanlines, grain, chroma) changes the pixels of the parts its scope names and leaves the rest alone, for the
 *    scopes all, characters, objects and environment, the parts read back from the chain's own parts view; the
 *    whole-screen filters (bloom, edge smoothing, curvature, vignette, low resolution) change the picture; and the ID
 *    pass of every one of those frames is the clean frame's;
 * 2. switching to every look builds 0 pipelines after the warm-up and recompiles no material, the ID pass staying the
 *    clean frame's, and switching looks every 20 steps while the room's session steps leaves its hashes those of the
 *    same session stepped in Node;
 * 3. pixel art snaps the camera to its block grid: sliding the camera by fractions of a block changes the picture
 *    only when it crosses half a block, then by a whole block; without the snap every slide shimmers;
 * 4. bloom is off at the `low` quality tier, with advice `GFX_POST_NO_BLOOM`;
 * 5. the edge smoothing that measures better (engine/gfx/post/aa.ts records it): FXAA and SMAA against the frame
 *    drawn at 4 × 4 the size and averaged down.
 *
 * Invariants: frames are drawn by calling the page; the Node session is the same scene and seed, stepped with no
 * intents; colours compare by channel, a pixel "changed" when a channel moved by more than `DIFF` levels.
 */
import type { Page } from '@playwright/test';
import '../../labs/box/scenes/room';
import type { IdEntry } from '../../engine/gfx/idpass';
import { AA_CHOICE } from '../../engine/gfx/post/aa';
import { createSession } from '../../engine/sim/scene';
import { expect, test, type Harness } from './fixtures';

/** A shot as the page returns it. */
interface Shot {
  width: number;
  height: number;
  pixels?: string;
  ids?: { visible: IdEntry[] };
}

/** What a look switch reports. */
interface Shown {
  frame: { drawn: boolean; built: number };
  builds: number;
  recompiled: number;
  style: string;
}

/** What the page publishes as `window.__postPage` (tests/pages/post.ts), as far as this suite uses it. */
interface PostPage {
  looks(): string[];
  settings: { set(path: string, value: unknown): unknown };
  setLook(id: string, filters?: object): Promise<Shown>;
  shoot(options?: { ids?: boolean; pixels?: boolean }): Promise<Shot>;
  shootPlain(): Promise<Shot>;
  parts(): Promise<Shot>;
  run(steps: number, every: number, looks: string[]): Promise<{ hashes: Record<string, string>; built: number[] }>;
  slide(fractions: number[], snap: boolean): Promise<string[]>;
  measureAa(): Promise<Record<'none' | 'fxaa' | 'smaa' | 'reference', Shot>>;
}

declare const __postPage: PostPage;

const PAGE = 'tests/pages/post.html';
/** A channel moving by more than this many levels changes a pixel. */
const DIFF = 8;
/** Pixels this close to another part's are left out of "outside": neighbourhood filters reach that far. */
const BORDER = 13;

/** Opens the page, ready on WebGPU. */
async function open(page: Page, harness: Harness): Promise<void> {
  await page.goto(PAGE);
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
}

/** A shot's pixels. */
function rgba(shot: Shot | string): Uint8Array {
  return new Uint8Array(Buffer.from(typeof shot === 'string' ? shot : shot.pixels!, 'base64'));
}

/** Whether pixel `p` differs between `a` and `b` by more than `diff` in some channel. */
function differs(a: Uint8Array, b: Uint8Array, p: number, diff = DIFF): boolean {
  return [0, 1, 2].some((c) => Math.abs(a[p * 4 + c] - b[p * 4 + c]) > diff);
}

/** The share of pixels that differ. */
function changedShare(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < a.length / 4; p++) if (differs(a, b, p)) n++;
  return n / (a.length / 4);
}

/** The parts view as a part per pixel: 0 a character, 1 an object, 2 the environment (the background included). */
function partsOf(shot: Shot): Uint8Array {
  const px = rgba(shot);
  const out = new Uint8Array(shot.width * shot.height);
  for (let p = 0; p < out.length; p++) out[p] = px[p * 4] > 128 ? 0 : px[p * 4 + 1] > 128 ? 1 : 2;
  return out;
}

/** Whether each pixel has another part within `r` pixels. */
function borderOf(parts: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const near = new Uint8Array(parts.length);
  const mark = (x: number, y: number) => {
    for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++)
      near.fill(1, yy * width + Math.max(0, x - r), yy * width + Math.min(width, x + r + 1));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if ((x > 0 && parts[p - 1] !== parts[p]) || (y > 0 && parts[p - width] !== parts[p])) mark(x, y);
    }
  }
  return near;
}

/** The ID pass's visible list, as compared: name, pixels and bounding box. */
function idsOf(shot: Shot): string[] {
  return shot.ids!.visible.map((entry) => `${entry.name}:${entry.px}:${entry.bbox.join(',')}`).sort();
}

/** The scoped filters, each with numbers that change what they touch plainly, and the share each must change. */
const SCOPED: { name: string; filters: Record<string, unknown>; inside: number }[] = [
  { name: 'cel', filters: { bands: 3, punch: 1.8, ink: 1 }, inside: 0.25 },
  { name: 'pixel', filters: { size: 6, levels: 8, outline: false, snap: false }, inside: 0.2 },
  { name: 'palette', filters: { palette: 'gameboy', dither: 0.6 }, inside: 0.6 },
  { name: 'outline', filters: { width: 2, darken: 0 }, inside: 0.02 },
  { name: 'stylize', filters: { style: 'halftone', size: 4, color: 1 }, inside: 0.5 },
  { name: 'grade', filters: { temperature: 1, brightness: 1.6, saturation: 0 }, inside: 0.5 },
  { name: 'scanlines', filters: { strength: 1, period: 2 }, inside: 0.25 },
  { name: 'grain', filters: { amount: 1 }, inside: 0.3 },
  { name: 'chroma', filters: { amount: 1 }, inside: 0.01 },
];

/** The scopes tried, each with the parts (0 characters, 1 objects, 2 environment) it covers. */
const SCOPES: [string, number[]][] = [
  ['all', [0, 1, 2]],
  ['characters', [0]],
  ['objects', [1]],
  ['environment', [2]],
];

/** The whole-screen filters, each with the share of the picture it must change. */
const SCREEN: { filters: Record<string, unknown>; changed: number }[] = [
  { filters: { bloom: { scope: 'all', strength: 1.5, threshold: 0.1 } }, changed: 0.05 },
  { filters: { aa: { scope: 'all' } }, changed: 0.01 },
  { filters: { screen: { scope: 'all', curvature: 0.2 } }, changed: 0.3 },
  { filters: { screen: { scope: 'all', vignette: 1 } }, changed: 0.2 },
  { filters: { screen: { scope: 'all', pixelate: 4 } }, changed: 0.3 },
];

test('every filter and scope works, a clean look is the plain frame, and the ID pass is unchanged by filters', async ({
  page,
  harness,
}) => {
  test.setTimeout(300_000);
  await open(page, harness);
  const clean = await page.evaluate(() => __postPage.setLook('look:clean'));
  expect(clean.frame).toMatchObject({ drawn: true, built: 0 });
  const base = await page.evaluate(() => __postPage.shoot({ ids: true }));
  const plain = await page.evaluate(() => __postPage.shootPlain());
  expect(changedShare(rgba(base), rgba(plain)), 'the clean look against the plain frame').toBe(0);
  const parts = partsOf(await page.evaluate(() => __postPage.parts()));
  const counts = [0, 1, 2].map((part) => parts.filter((p) => p === part).length);
  expect(counts[0], 'character pixels').toBeGreaterThan(800);
  expect(counts[1], 'object pixels').toBeGreaterThan(800);
  const border = borderOf(parts, base.width, base.height, BORDER);
  const ids = idsOf(base);
  expect(ids.length, 'objects the ID pass sees').toBeGreaterThan(10);
  const before = rgba(base);

  for (const { name, filters, inside } of SCOPED) {
    for (const [scope, covered] of SCOPES) {
      const spec = { [name]: { ...filters, scope } };
      const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), spec);
      expect(shown.frame, `${name} on ${scope}`).toMatchObject({ drawn: true, built: 0 });
      const shot = await page.evaluate(() => __postPage.shoot({ ids: true }));
      expect(idsOf(shot), `the ID pass with ${name} on ${scope}`).toEqual(ids);
      const after = rgba(shot);
      const tally = { in: 0, inChanged: 0, out: 0, outChanged: 0 };
      for (let p = 0; p < parts.length; p++) {
        const changed = differs(before, after, p);
        if (covered.includes(parts[p])) {
          tally.in++;
          if (changed) tally.inChanged++;
        } else if (!border[p]) {
          tally.out++;
          if (changed) tally.outChanged++;
        }
      }
      const where = `${name} on ${scope}: ${tally.inChanged}/${tally.in} inside changed, ${tally.outChanged}/${tally.out} outside`;
      expect(tally.inChanged / tally.in, where).toBeGreaterThanOrEqual(inside);
      if (tally.out > 0) expect(tally.outChanged / tally.out, where).toBeLessThanOrEqual(0.002);
    }
  }

  for (const { filters, changed } of SCREEN) {
    const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), filters);
    expect(shown.frame, JSON.stringify(filters)).toMatchObject({ drawn: true, built: 0 });
    const shot = await page.evaluate(() => __postPage.shoot({ ids: true }));
    expect(idsOf(shot), `the ID pass with ${JSON.stringify(filters)}`).toEqual(ids);
    const share = changedShare(before, rgba(shot));
    expect(share, JSON.stringify(filters)).toBeGreaterThanOrEqual(changed);
  }
});

test('every look builds 0 pipelines after the warm-up and recompiles nothing, and switching looks never changes the hash', async ({
  page,
  harness,
}) => {
  test.setTimeout(400_000);
  await open(page, harness);
  const looks = await page.evaluate(() => __postPage.looks());
  expect(looks.length).toBe(86);
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const ids = idsOf(await page.evaluate(() => __postPage.shoot({ ids: true, pixels: false })));
  const styles = new Set<string>();
  for (const id of [...looks, 'look:clean']) {
    const shown = await page.evaluate((look) => __postPage.setLook(look), id);
    expect(shown.frame, id).toMatchObject({ drawn: true, built: 0 });
    expect(shown.recompiled, `materials ${id} recompiled`).toBe(0);
    expect(shown.builds, `${id}: the chain's output graph builds`).toBe(1);
    styles.add(shown.style);
    const shot = await page.evaluate(() => __postPage.shoot({ ids: true, pixels: false }));
    expect(idsOf(shot), `the ID pass with ${id}`).toEqual(ids);
  }
  expect([...styles].sort(), 'the styles the looks switched to').toEqual(['flat', 'lambert', 'pbr', 'toon']);

  const played = await page.evaluate(
    (all) => __postPage.run(240, 20, all),
    ['look:hd-2d', 'look:cartoon', 'look:oil-painting', 'look:game-boy', 'look:arcade-crt', 'look:flat-paper'],
  );
  expect(played.built.length).toBe(240);
  expect(Math.max(...played.built), 'pipelines built by any frame of the run').toBe(0);
  const session = createSession('box:room', { seed: 1 });
  const node: Record<string, string> = { 0: session.world.hash() };
  for (let k = 1; k <= 240; k++) {
    session.step();
    if (k % 60 === 0) node[k] = session.world.hash();
  }
  expect(played.hashes).toEqual(node);
});

test('pixel art snaps the camera to its block grid, so the picture moves only by whole blocks', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const fractions = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const snapped = (await page.evaluate((f) => __postPage.slide(f, true), fractions)).map((s) => rgba(s));
  const loose = (await page.evaluate((f) => __postPage.slide(f, false), fractions)).map((s) => rgba(s));
  const changes = (frames: Uint8Array[]) => frames.slice(1).map((frame, i) => changedShare(frames[i], frame));
  const snapping = changes(snapped);
  expect(snapping.filter((share) => share > 0).length, `snapped: ${snapping.join(', ')}`).toBe(1);
  expect(
    changes(loose).every((share) => share > 0),
    `loose: ${changes(loose).join(', ')}`,
  ).toBe(true);
  // The one change is a whole block: the last frame is the first moved one block across.
  const [width, height, block] = [480, 270, 6];
  const [first, last] = [snapped[0], snapped[5]];
  let same = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = block; x < width - block; x++) {
      total++;
      const p = y * width + x;
      const q = y * width + x + block;
      if (![0, 1, 2].some((c) => Math.abs(last[p * 4 + c] - first[q * 4 + c]) > DIFF)) same++;
    }
  }
  expect(same / total, 'the slid frame is the first moved by one block').toBeGreaterThan(0.97);
});

test('bloom is off at the low quality tier, with advice', async ({ page, harness }) => {
  await open(page, harness);
  const glow = { bloom: { scope: 'all', strength: 1.5, threshold: 0.1 } };
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const off = rgba(await page.evaluate(() => __postPage.shoot()));
  await page.evaluate((f) => __postPage.setLook('look:clean', f), glow);
  const high = rgba(await page.evaluate(() => __postPage.shoot()));
  expect(changedShare(off, high), 'bloom at the high tier').toBeGreaterThan(0.05);
  await page.evaluate(() => __postPage.settings.set('quality', 'low'));
  const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), glow);
  expect(shown.frame).toMatchObject({ drawn: true, built: 0 });
  const low = rgba(await page.evaluate(() => __postPage.shoot()));
  expect(changedShare(off, low), 'bloom at the low tier').toBe(0);
  expect(harness.advice().map((advice) => advice.code)).toContain('GFX_POST_NO_BLOOM');
});

/** Mean absolute luma error against the reference, over the pixels where `none` misses it by more than 8. */
function edgeError(shot: Uint8Array, none: Uint8Array, reference: Uint8Array): number {
  const luma = (px: Uint8Array, p: number) => 0.2126 * px[p * 4] + 0.7152 * px[p * 4 + 1] + 0.0722 * px[p * 4 + 2];
  let sum = 0;
  let n = 0;
  for (let p = 0; p < none.length / 4; p++) {
    if (Math.abs(luma(none, p) - luma(reference, p)) <= 8) continue;
    sum += Math.abs(luma(shot, p) - luma(reference, p));
    n++;
  }
  return sum / Math.max(1, n);
}

test('the edge smoothing that measures better is the one the chain uses', async ({ page, harness }) => {
  test.setTimeout(240_000);
  await open(page, harness);
  const shots = await page.evaluate(() => __postPage.measureAa());
  const { width, height } = shots.none;
  const big = rgba(shots.reference);
  const reference = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < 4; dy++)
          for (let dx = 0; dx < 4; dx++) sum += big[((y * 4 + dy) * width * 4 + x * 4 + dx) * 4 + c];
        reference[(y * width + x) * 4 + c] = Math.round(sum / 16);
      }
    }
  }
  const none = rgba(shots.none);
  const errors = {
    none: edgeError(none, none, reference),
    fxaa: edgeError(rgba(shots.fxaa), none, reference),
    smaa: edgeError(rgba(shots.smaa), none, reference),
  };
  console.log(`edge smoothing, mean luma error on edges: ${JSON.stringify(errors)}`);
  const other = AA_CHOICE === 'fxaa' ? 'smaa' : 'fxaa';
  expect(errors[AA_CHOICE], JSON.stringify(errors)).toBeLessThan(errors.none);
  expect(errors[AA_CHOICE], JSON.stringify(errors)).toBeLessThanOrEqual(errors[other]);
});
