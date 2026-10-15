/**
 * @file T2 for materials v2 (PLAN.md WP 7.2) on the materials-v2 page (tests/pages/materials-v2.html):
 * 1. every style (lambert, toon, flat, pbr) restyles the Stress Box's room, its instanced parts and their outline
 *    shells after the warm-up building 0 pipelines, each changing the picture; switching every 20 steps while the
 *    room's session steps and a frame is drawn after each step builds none either, and the hashes are those of the
 *    same session stepped in Node without drawing;
 * 2. on six instanced box parts, each turned and stretched its own way far from the batch's origin, the outline
 *    shell's ID-pass bounding box contains the part's, 1 to 3 pixels wider on every side (a 2-pixel line), centred
 *    on it within 1 pixel; and so on a plain ball (part -1) with a shell pushed along its normals;
 * 3. the comparison that chose the toon implementation (engine/gfx/materials/toon.ts records it): the toon bands
 *    against the baseline (MeshToonMaterial with the carried gradient map), each against Lambert: how well the
 *    sphere's light follows Lambert's, how many luma levels the point light's pool has, how much brighter the
 *    sphere's outer ring is than the ring inside it; and both thumbnails against tests/baselines/thumbs/
 *    (`materials-v2-toon-bands`, `materials-v2-toon-gradient`; `UPDATE_THUMBS=1` records them, with a reason in the
 *    commit).
 *
 * Invariants: the page draws at `gfx.resolution=full`; frames are drawn by calling the page; the Node session is the
 * same scene and seed, stepped with no intents.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import '../../labs/box/scenes/room';
import type { IdEntry } from '../../engine/gfx/idpass';
import type { ShotJson } from '../../engine/gfx/shot';
import { compareThumbnails, type Thumbnail } from '../../engine/gfx/thumbnail';
import { createSession } from '../../engine/sim/session';
import { expect, test, type Frame, type Harness } from './fixtures';

/** What the page publishes as `window.__materialsPage` (tests/pages/materials-v2.ts), as far as this suite uses it. */
interface MaterialsPage {
  names: readonly string[];
  setStyle(style: string): Promise<{ changed: number; frame: { drawn: boolean; built: number }; types: string[] }>;
  run(steps: number, every: number): Promise<{ hashes: Record<string, string>; built: number[]; styles: number }>;
  part(i: number): Promise<{ part?: IdEntry; shell?: IdEntry }>;
  compare(look: string): Promise<{ shot: ShotJson; pool: [number, number] }>;
}

declare const __materialsPage: MaterialsPage;

const ROOT = join(import.meta.dirname, '..', '..');
const PAGE = 'tests/pages/materials-v2.html?gfx.resolution=full';
/** The three.js type each style draws the room's lit materials with. */
const TYPES: Record<string, string> = {
  lambert: 'MeshLambertMaterial',
  toon: 'MeshBandedToonNodeMaterial',
  flat: 'MeshFlatStyleNodeMaterial',
  pbr: 'MeshStandardNodeMaterial',
};

/** Opens the page, ready on WebGPU. */
async function open(page: Page, harness: Harness): Promise<void> {
  await page.goto(PAGE);
  await harness.ready({ timeout: 90_000 });
  await harness.assertWebGPU();
}

/** The share of pixels whose colour differs between two frames by more than 8 in some channel. */
function differing(a: Frame, b: Frame): number {
  let count = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if ([0, 1, 2].some((c) => Math.abs(a.rgba[i + c] - b.rgba[i + c]) > 8)) count++;
  }
  return count / (a.rgba.length / 4);
}

test('every style restyles the box after the warm-up building 0 pipelines, and switching never changes the hash', async ({
  page,
  harness,
}) => {
  test.setTimeout(240_000);
  await open(page, harness);
  const names = await page.evaluate(() => [...__materialsPage.names]);
  expect(names).toEqual(['lambert', 'toon', 'flat', 'pbr']);
  const frames: Record<string, Frame> = {};
  for (const round of [1, 2]) {
    for (const style of [...names.slice(1), 'lambert']) {
      const shown = await page.evaluate((s) => __materialsPage.setStyle(s), style);
      expect(shown.frame, `${style}, round ${round}`).toMatchObject({ drawn: true, built: 0 });
      expect(shown.changed, `${style} re-pointed the room's and the parts' materials`).toBeGreaterThan(5);
      expect(shown.types, style).toContain(TYPES[style]);
      const frame = await harness.readFrame();
      expect(frame.blank, style).toBe(false);
      frames[style] ??= frame;
    }
  }
  for (const style of names.slice(1)) {
    expect(differing(frames.lambert, frames[style]), `${style} changes the picture`).toBeGreaterThan(0.2);
  }

  const played = await page.evaluate(() => __materialsPage.run(240, 20));
  expect(played.styles, 'the run switched style 12 times').toBeGreaterThanOrEqual(12);
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

test("on instanced box parts, the outline shell's ID-pass bounding box contains the part's, centred within 1 px", async ({
  page,
  harness,
}) => {
  await open(page, harness);
  for (const i of [0, 1, 2, 3, 4, 5, -1]) {
    const { part, shell } = await page.evaluate((k) => __materialsPage.part(k), i);
    expect(part, `part ${i} is seen`).toBeDefined();
    expect(shell, `part ${i}'s shell is seen`).toBeDefined();
    const [px0, py0, px1, py1] = part!.bbox;
    const [sx0, sy0, sx1, sy1] = shell!.bbox;
    const where = `part ${i}: the shell's bounding box ${shell!.bbox} against the part's ${part!.bbox}`;
    for (const side of [px0 - sx0, py0 - sy0, sx1 - px1, sy1 - py1]) {
      expect(side, where).toBeGreaterThanOrEqual(1);
      expect(side, where).toBeLessThanOrEqual(3);
    }
    expect(Math.abs((sx0 + sx1 - px0 - px1) / 2), `${where}: centred across`).toBeLessThanOrEqual(1);
    expect(Math.abs((sy0 + sy1 - py0 - py1) / 2), `${where}: centred down`).toBeLessThanOrEqual(1);
  }
});

/** A shot's pixels, decoded. */
function pixelsOf(shot: ShotJson): Uint8Array {
  return new Uint8Array(Buffer.from(shot.pixels!, 'base64'));
}

/** Rec. 709 luma of pixel `i`, 0–255. */
function luma(rgba: Uint8Array, i: number): number {
  return 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
}

/** The pixel indices of a ring round `(cx, cy)`, radii `[r0, r1)`, inside a `width` × `height` shot. */
function ring(width: number, height: number, [cx, cy]: [number, number], r0: number, r1: number): number[] {
  const out: number[] = [];
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) {
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (x >= 0 && y >= 0 && x < width && y < height && d >= r0 && d < r1) out.push(y * width + x);
    }
  }
  return out;
}

/** Pearson's correlation of two series. */
function correlation(a: number[], b: number[]): number {
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const [ma, mb] = [mean(a), mean(b)];
  let [sab, saa, sbb] = [0, 0, 0];
  a.forEach((x, i) => {
    sab += (x - ma) * (b[i] - mb);
    saa += (x - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  });
  return sab / Math.sqrt(saa * sbb);
}

/** The comparison's numbers for one look (see the file comment), against Lambert's shot. */
function measure(shot: ShotJson, lambert: ShotJson, pool: [number, number]) {
  const { width, height } = shot;
  const [rgba, reference] = [pixelsOf(shot), pixelsOf(lambert)];
  const sphere = shot.ids!.visible.find((entry) => entry.name === 'sphere')!;
  const [x0, y0, x1, y1] = sphere.bbox;
  const centre: [number, number] = [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
  const r = (x1 - x0 + 1) / 2;
  const disc = ring(width, height, centre, 0, 0.92 * r);
  const follow = correlation(
    disc.map((i) => luma(rgba, i)),
    disc.map((i) => luma(reference, i)),
  );
  const levels = new Map<number, number>();
  const pooled = ring(width, height, pool, 0, 40);
  for (const i of pooled) levels.set(Math.round(luma(rgba, i)), (levels.get(Math.round(luma(rgba, i))) ?? 0) + 1);
  const poolLevels = [...levels.values()].filter((n) => n >= 0.005 * pooled.length).length;
  const mean = (indices: number[]) => indices.reduce((s, i) => s + luma(rgba, i), 0) / indices.length / 255;
  // The rim, on the unlit half (Lambert's darker half of the disc): the outer ring against the ring inside it.
  const median = disc.map((i) => luma(reference, i)).sort((a, b) => a - b)[disc.length >> 1];
  const unlit = (indices: number[]) => indices.filter((i) => luma(reference, i) < median);
  const outer = mean(unlit(ring(width, height, centre, 0.93 * r, 0.99 * r)));
  const rim = outer - mean(unlit(ring(width, height, centre, 0.75 * r, 0.88 * r)));
  return { follow: Math.round(follow * 100) / 100, poolLevels, rim: Math.round(rim * 100) / 100 };
}

test('the toon bands follow the light, band the pools and draw a rim where the gradient-map baseline does not', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const shots: Record<string, { shot: ShotJson; pool: [number, number] }> = {};
  for (const look of ['lambert', 'bands', 'gradient']) {
    shots[look] = await page.evaluate((l) => __materialsPage.compare(l), look);
    expect(shots[look].shot.metrics!.blank, look).toBe(false);
  }
  const numbers = Object.fromEntries(
    ['lambert', 'bands', 'gradient'].map((look) => [
      look,
      measure(shots[look].shot, shots.lambert.shot, shots[look].pool),
    ]),
  );
  // The comparison toon.ts records: lambert {1, 64, -0.03}, bands {0.96, 3, 0.02}, gradient {0.74, 61, -0.07}.
  const { bands, gradient } = numbers;
  expect(bands.follow, `${JSON.stringify(numbers)}: the bands follow Lambert's light`).toBeGreaterThanOrEqual(0.9);
  expect(bands.follow - gradient.follow, 'the gradient map follows it less').toBeGreaterThanOrEqual(0.1);
  expect(bands.poolLevels, 'the pool is banded').toBeLessThanOrEqual(6);
  expect(gradient.poolLevels, "the gradient map's pool is a smooth falloff").toBeGreaterThanOrEqual(
    4 * bands.poolLevels,
  );
  expect(bands.rim, 'the bands draw a rim on the unlit side').toBeGreaterThan(0);
  expect(bands.rim - gradient.rim, 'the gradient map has none').toBeGreaterThanOrEqual(0.05);
  for (const look of ['bands', 'gradient']) {
    const name = `materials-v2-toon-${look}`;
    const file = join(ROOT, 'tests', 'baselines', 'thumbs', `${name}.json`);
    const thumb = shots[look].shot.thumbnail!;
    if (process.env.UPDATE_THUMBS === '1') {
      const prettier = await import('prettier');
      const options = (await prettier.resolveConfig(file)) ?? {};
      const text = JSON.stringify({ case: name, ...thumb });
      writeFileSync(file, await prettier.format(text, { ...options, filepath: file }));
    }
    expect(existsSync(file), `${file}: record it with UPDATE_THUMBS=1`).toBe(true);
    const diff = compareThumbnails(JSON.parse(readFileSync(file, 'utf8')) as Thumbnail, thumb);
    expect(diff.cells, `${name}: ${JSON.stringify(diff.worst)}`).toBe(0);
  }
});
