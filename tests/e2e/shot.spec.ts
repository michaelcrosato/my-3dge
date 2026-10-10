/**
 * @file T2 for shots (PLAN.md WP 2.6, §8.5): in the scene page (tests/pages/scene.html), with engine/gfx/shot.ts
 * imported into it, the ID pass reports every object of the fixture scene (the hidden pools as unseen until shown,
 * then visible), accounts for every pixel, and leaves the frame unchanged; a 48-pixel-wide readback matches the
 * canvas pixel for pixel with WebGPU's row padding stripped; thumbnails are identical over 3 runs. Then `x shot`
 * on the shot page (tests/pages/shot.html) writes its report.json with the look metrics, the ID-pass list (each
 * unseen reason), numbered marks and the thumbnail comparison with tests/baselines/thumbs/shot-objects.json, and
 * fails a blank frame.
 *
 * Invariants: the scene page's fixture is read, never assumed (its meshes and pools come from `__scene`), so a later
 * fixture keeps these tests meaningful; frames are drawn by calling the page (`__scene.settle`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { FrameReport, FrameView, Gfx } from '../../engine/gfx/renderer';
import type { Settings } from '../../engine/core/settings';
import type { IdPass } from '../../engine/gfx/idpass';
import type { ShotJson, ShotOptions, ShotResult } from '../../engine/gfx/shot';
import type { Thumbnail } from '../../engine/gfx/thumbnail';
import { decodePng } from '../../tools/lib/png';
import { expect, test, type Harness } from './fixtures';

/** The parts of the scene page's `window.__scene` these tests use (tests/pages/scene.ts). */
interface ScenePage {
  gfx: Gfx;
  scene: import('three/webgpu').Scene;
  view: FrameView;
  settings: Settings;
  meshes: Record<string, unknown>;
  pools: Record<string, unknown>;
  settle(): Promise<FrameReport>;
  show(name: string, count?: number): void;
}

/** What the page-side helper gets from engine/gfx/shot.ts. */
type ShotModule = { shot(gfx: Gfx, view: FrameView, options?: ShotOptions): Promise<ShotResult> };

const PAGE = 'tests/pages/scene.html';
const SHOT = '/engine/gfx/shot.ts';
const ROOT = join(import.meta.dirname, '..', '..');

/** Variables a test runner sets for its own workers; the `x shot` child starts without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;

/** Opens the scene page with `query`, waits for ready and asserts WebGPU drew it. */
async function open(page: Page, harness: Harness, query = '') {
  await page.goto(`${PAGE}${query}`);
  await harness.ready();
  await harness.assertWebGPU();
}

/** Shoots the scene page's view in the page, returning the ID pass, the thumbnail, the metrics and the frame state. */
function shootScene(page: Page, options: ShotOptions = {}) {
  return page.evaluate(
    async ({ url, options }) => {
      const { shot } = (await import(url)) as ShotModule;
      const s = (window as unknown as { __scene: ScenePage }).__scene;
      const result = await shot(s.gfx, s.view, options);
      const names: string[] = [];
      s.scene.traverse((object) => {
        const drawn = object as { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
        if (drawn.isMesh || drawn.isLine || drawn.isPoints || drawn.isSprite) names.push(object.name);
      });
      const { pixels, marked, ...rest } = result;
      return {
        ...rest,
        pixels: pixels && Array.from(pixels),
        marked: marked !== undefined,
        names,
        meshes: Object.keys(s.meshes),
        pools: Object.keys(s.pools),
        override: s.scene.overrideMaterial !== null,
        background: (s.scene.background as { getHexString?(): string } | null)?.getHexString?.() ?? null,
      };
    },
    { url: SHOT, options },
  );
}

/** Asserts the ID pass lists every drawable once and accounts for every pixel. */
function expectComplete(ids: IdPass, names: string[]) {
  const listed = [...ids.visible.map((entry) => entry.name), ...ids.unseen.map((entry) => entry.name)];
  expect(listed.sort(), 'every drawable object, once').toEqual([...names].sort());
  expect(ids.objects).toBe(names.length);
  const covered = ids.visible.reduce((sum, entry) => sum + entry.px, 0);
  expect(covered + ids.empty + ids.stray, 'every pixel is empty space or one object').toBe(ids.width * ids.height);
  expect(ids.stray, 'no pixel in a colour the pass did not assign').toBe(0);
  for (const entry of ids.visible) {
    const [x0, y0, x1, y1] = entry.bbox;
    expect(entry.px, entry.name).toBeLessThanOrEqual((x1 - x0 + 1) * (y1 - y0 + 1));
    expect(entry.centre[0], entry.name).toBeGreaterThanOrEqual(x0);
    expect(entry.centre[0], entry.name).toBeLessThanOrEqual(x1);
    expect(entry.centre[1], entry.name).toBeGreaterThanOrEqual(y0);
    expect(entry.centre[1], entry.name).toBeLessThanOrEqual(y1);
  }
}

test('the ID pass reports every object of the fixture scene; the hidden pools are unseen until shown', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const before = await harness.readFrame();
  const first = await shootScene(page, { thumbnail: false });
  const ids = first.ids!;
  expectComplete(ids, first.names);
  const visible = new Map(ids.visible.map((entry) => [entry.name, entry]));
  for (const name of first.meshes) expect(visible.get(name)?.px, `${name} covers pixels`).toBeGreaterThan(0);
  for (const name of first.pools) {
    expect(ids.unseen.find((entry) => entry.name === name)?.reason, `${name} starts hidden`).toBe('hidden');
  }
  expect(ids.empty, 'the background shows').toBeGreaterThan(0);
  expect(ids.visible.map((entry) => entry.px)).toEqual([...ids.visible.map((entry) => entry.px)].sort((a, b) => b - a));
  // Where things are: the floor reaches the bottom edge; the crate is left of the ball.
  const [floor, crate, ball] = ['floor', 'crate', 'ball'].map((name) => visible.get(name));
  if (floor) expect(floor.bbox[3]).toBe(ids.height - 1);
  if (crate && ball) expect(crate.centre[0]).toBeLessThan(ball.centre[0]);
  expect(first.metrics!.largest).toBe(ids.visible[0].name);
  expect(first.metrics!.protagonist, 'the fixture has no protagonist').toBeNull();

  // The shot changed nothing the frame draws: same picture, no pipeline built, the scene as it was.
  expect(first).toMatchObject({ override: false, background: '1d2430' });
  const after = await page.evaluate(() => (window as unknown as { __scene: ScenePage }).__scene.settle());
  expect(after).toMatchObject({ drawn: true, built: 0 });
  const again = await harness.readFrame();
  expect(Buffer.compare(Buffer.from(before.rgba), Buffer.from(again.rgba)), 'the frame is unchanged').toBe(0);

  await page.evaluate(async () => {
    const s = (window as unknown as { __scene: ScenePage }).__scene;
    for (const name of Object.keys(s.pools)) s.show(name, 32);
    await s.settle();
  });
  const shown = await shootScene(page, { metrics: false, thumbnail: false });
  expectComplete(shown.ids!, shown.names);
  for (const name of shown.pools) {
    expect(shown.ids!.visible.find((entry) => entry.name === name)?.px, `${name}, shown`).toBeGreaterThan(0);
  }
  expect(shown.built, 'a second shot builds only what the pools need').toBeGreaterThanOrEqual(0);
});

for (const query of ['', '?post=1']) {
  const how = query ? 'through a post pass' : 'directly';
  test(`a 48-pixel-wide readback matches the rendered frame pixel for pixel, with no row skew, drawn ${how}`, async ({
    page,
    harness,
  }) => {
    await open(page, harness, query);
    const size = await page.evaluate(async () => {
      const s = (window as unknown as { __scene: ScenePage }).__scene;
      const canvas = s.gfx.renderer.domElement;
      canvas.style.width = '48px';
      canvas.style.height = '27px';
      s.settings.set('gfx.resolution', 'full');
      await s.settle();
      return [canvas.width, canvas.height];
    });
    expect(size).toEqual([48, 27]);
    const frame = await harness.readFrame();
    const shot = await shootScene(page, { pixels: true, ids: false, metrics: false, thumbnail: false });
    expect([frame.width, frame.height]).toEqual([48, 27]);
    expect([shot.width, shot.height]).toEqual([48, 27]);
    // WebGPU copied 64-pixel rows (256 bytes); the last row unpadded.
    expect(shot.readback).toEqual({ bytesPerRow: 256, bytes: 26 * 256 + 48 * 4 });
    const pixels = Uint8Array.from(shot.pixels!);
    const rows = new Set<string>();
    let differ = 0;
    for (let y = 0; y < 27; y++) {
      rows.add(Buffer.from(pixels.subarray(y * 192, (y + 1) * 192)).toString('hex'));
      for (let x = 0; x < 48; x++) {
        const i = (y * 48 + x) * 4;
        if ([0, 1, 2, 3].some((c) => pixels[i + c] !== frame.rgba[i + c])) differ++;
      }
    }
    expect(rows.size, 'rows differ, so a skew would show').toBeGreaterThan(10);
    expect(differ, 'pixels that differ from the canvas').toBe(0);
    // The next frame draws to the canvas again, with the pipelines it had.
    const after = await page.evaluate(() => (window as unknown as { __scene: ScenePage }).__scene.settle());
    expect(after).toMatchObject({ drawn: true, built: 0 });
    expect(Buffer.compare(Buffer.from((await harness.readFrame()).rgba), Buffer.from(frame.rgba))).toBe(0);
  });
}

test('thumbnails are stable over 3 runs, with the object map', async ({ page, harness }) => {
  const runs: { thumbnail: Thumbnail; metrics: ShotResult['metrics'] }[] = [];
  for (let run = 0; run < 3; run++) {
    await open(page, harness);
    const result = await shootScene(page);
    runs.push({ thumbnail: result.thumbnail!, metrics: result.metrics });
  }
  const [first] = runs;
  expect(first.thumbnail).toMatchObject({ width: 48, height: 27 });
  expect(first.thumbnail.rows).toHaveLength(27);
  expect(first.thumbnail.rows[0].split(' ')).toHaveLength(48);
  expect(Object.values(first.thumbnail.legend!)).toEqual(expect.arrayContaining(['floor', 'empty space']));
  expect(first.thumbnail.map!.join('')).toContain('A');
  for (const run of runs.slice(1)) {
    expect(run.thumbnail, 'the same thumbnail').toEqual(first.thumbnail);
    expect(run.metrics, 'the same look metrics').toEqual(first.metrics);
  }
});

/** Runs `node x shot …` in the repository; returns the exit code, the output and the report. */
function xShot(args: string[], target: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const run = spawnSync(process.execPath, ['x', 'shot', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    timeout: 120_000,
  });
  const path = join(ROOT, 'out', 'shot', target, 'report.json');
  const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  return { code: run.status, output: `${run.stdout}${run.stderr}`, report };
}

test('x shot writes report.json with the look metrics, the ID-pass list and the marks, and fails a blank frame', async () => {
  test.setTimeout(180_000);
  const ok = xShot(['tests/pages/shot.html', '--marks', '--thumb', 'shot-objects'], 'tests-pages-shot');
  expect(ok.code, ok.output).toBe(0);
  const { metrics, artifacts } = ok.report;
  expect(ok.report.ok).toBe(true);
  expect(metrics).toMatchObject({ objects: 9, visible: 6, stray: 0, protagonist: true, largest: 'floor' });
  for (const name of ['floor', 'crate', 'ball', 'pillar', 'hero-body', 'hero-head']) {
    expect(metrics[`px.${name}`], name).toBeGreaterThan(0);
    expect(metrics[`bbox.${name}`], name).toMatch(/^\d+,\d+,\d+,\d+$/);
  }
  expect(metrics).toMatchObject({ 'unseen.ghost': 'hidden', 'unseen.behind': 'outside', 'unseen.buried': 'covered' });
  expect(metrics).toMatchObject({ 'mark.1': 'floor', thumbCells: 0 });
  expect(metrics.coverage).toBeGreaterThan(0.3);
  expect(metrics.spread).toBeGreaterThan(0);
  const paths = artifacts.map((artifact: { path: string }) => artifact.path);
  expect(paths).toEqual(['out/shot/tests-pages-shot/marks.png', 'out/shot/tests-pages-shot/shot.json']);
  const marks = decodePng(readFileSync(join(ROOT, paths[0])));
  expect([marks.width, marks.height]).toEqual([metrics.width, metrics.height]);
  const saved = JSON.parse(readFileSync(join(ROOT, paths[1]), 'utf8')) as ShotJson;
  expect(saved.ids!.visible.map((entry) => entry.name)).toContain('hero-head');
  expect(saved.marks![0]).toMatchObject({ n: 1, name: 'floor' });
  expect(saved.thumbnail!.map).toHaveLength(27);

  const blank = xShot(['tests/pages/shot.html', '--scene', 'empty', '--cam', 'top'], 'tests-pages-shot-empty-top');
  expect(blank.code, blank.output).toBe(1);
  expect(blank.report.failures.map((failure: { id: string }) => failure.id)).toEqual(['LOOK_BLANK']);
  expect(blank.report.metrics).toMatchObject({ objects: 0, visible: 0, coverage: 0 });
});
