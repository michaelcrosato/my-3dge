/**
 * @file T2 for the playground's two looks (PLAN.md WP 13.24; docs/PLAYGROUND.md §5.2 and §9.1's look metrics), on its
 * street (labs/playground/?scene=site-street), the sim paused:
 * - Look metrics and thumbnails per look and camera: each of the five cameras in both looks, at noon and at 22:00,
 *   shot with its look metrics: never blank or empty, the player in view in the four that show him, night darker than
 *   noon; the noon shots' text thumbnails as recorded (tests/baselines/thumbs/playground-<look>-<camera>.json, written
 *   with UPDATE_THUMBS=1); every metric, note and thumbnail in out/e2e/playground-looks/report.json; nothing built
 *   through the night after the noon round (a shot builds its own passes once from each camera).
 * - The shimmer metric: in the pixel look, isometric and top-down panned by fractions of a pixel (a fixed target
 *   moved 2 mm at a time in the camera's image plane: a pan, never a dolly, which an orthographic picture leaves alone
 *   but its cascades and far plane do not) change no pixel of the picture but by whole pixels (each frame the last one
 *   moved by at most a pixel each way); the remainder goes to the page's glide (the canvas's CSS transform, within
 *   half a drawn pixel). In the cel look the same pans shimmer, so the metric measures something. Top-down is
 *   pixel-exact by itself (WP 13.8): its pans move neither look, and nothing glides.
 * - The cel look's shells round the props and the bodies, shown there and hidden in the pixel look, the ID pass the
 *   same objects in both; the pixel look draws one art pixel a drawn pixel at the page's lines (the canvas's height),
 *   its perspective variant in first person: unsnapped, no glide.
 *
 * Invariants: frames are drawn by calling the page (`render`, 1/60 s each); goldens and baselines come from their files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { LookMetrics, LookNote } from '../../engine/gfx/lookMetrics';
import { compareThumbnails, type Thumbnail } from '../../engine/gfx/thumbnail';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
/** The street from above, where every camera sees the player, the props and the block. */
const STREET = 'labs/playground/?scene=site-street&cam=iso';
const LOOKS = ['look:playground-cel', 'look:playground-pixel'] as const;
const CAMERAS = ['cam3=first', 'cam3=shoulder', 'cam3=follow', 'cam=iso', 'cam=overhead'] as const;
const HOURS = [12, 22] as const;
/** How far a pan moves the fixed target each frame: about a twentieth of a pixel on the street from iso. */
const PAN = 0.002;

/** The page's engine, inside `evaluate`. */
declare const __engine: {
  pause(): void;
  step(n: number): unknown;
  set(key: string, value: unknown): unknown;
  render(frames: number): Promise<unknown>;
  stats(): { pipelines: number };
  shot(options: object): Promise<Shot>;
  get(id: number): { actor: { x: number; y: number; z: number } };
  camera: { set(code: string): { code: string; pose: unknown }; get(): { code: string } };
  actions: { run(name: string, args?: unknown): unknown };
  scene: { dump(options: object): string };
};

/** A shot as this suite reads it. */
interface Shot {
  pixels?: string;
  width: number;
  height: number;
  metrics: LookMetrics;
  notes: LookNote[];
  thumbnail?: Thumbnail;
  ids?: { visible: { name: string; px: number }[]; protagonist?: { name: string; px: number } | null };
}

test.describe.configure({ mode: 'parallel', timeout: 900_000 });

/** Opens the street, ready, the sim paused. */
async function open(page: Page, harness: Harness): Promise<void> {
  await page.goto(STREET);
  await harness.ready({ timeout: 480_000 });
  await harness.assertWebGPU();
  await page.evaluate(() => __engine.pause());
}

/** Shows `look` from `camera` at `hour`, draws `frames` frames and shoots it as `options` ask. */
function shoot(page: Page, look: string, camera: string, hour: number | null, options: object, frames = 3) {
  return page.evaluate(
    async ({ look, camera, hour, options, frames }) => {
      __engine.set('post.look', look);
      __engine.camera.set(camera);
      if (hour !== null) {
        __engine.actions.run('daytime', { hour });
        __engine.step(1); // the clock's hour reaches the sky with the step
      }
      await __engine.render(frames);
      return __engine.shot(options);
    },
    { look, camera, hour, options, frames },
  );
}

/** The share of pixels two pictures differ in (more than 2 of 255 a channel) when `b` is moved by (dx, dy). */
function differs(a: Buffer, b: Buffer, width: number, height: number, dx = 0, dy = 0): number {
  let [changed, seen] = [0, 0];
  for (let y = Math.max(0, dy); y < Math.min(height, height + dy); y++) {
    for (let x = Math.max(0, dx); x < Math.min(width, width + dx); x++) {
      const [i, j] = [(y * width + x) * 4, ((y - dy) * width + (x - dx)) * 4];
      const far = Math.abs(a[i] - b[j]) > 2 || Math.abs(a[i + 1] - b[j + 1]) > 2 || Math.abs(a[i + 2] - b[j + 2]) > 2;
      changed += far ? 1 : 0;
      seen++;
    }
  }
  return changed / seen;
}

/** The page's glide, in drawn pixels (right, down): the canvas's CSS transform over one drawn pixel's CSS size. */
function glide(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const pixel = parseFloat(canvas.style.getPropertyValue('--my3dge-pixel')) || 1;
    const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\)/.exec(canvas.style.transform);
    return m ? [Number(m[1]) / pixel, Number(m[2]) / pixel] : [0, 0];
  });
}

/** `a` and `b` as plain arithmetic. */
const plus = (a: number[], b: number[], k = 1) => a.map((v, i) => v + k * b[i]);
const unit = (a: number[]) => a.map((v) => v / Math.hypot(...a));
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The shimmer between two frames: the least share they differ in over every whole-pixel move of at most 1 each way. */
function shimmer(a: Shot, b: Shot): number {
  const [p, q] = [Buffer.from(a.pixels!, 'base64'), Buffer.from(b.pixels!, 'base64')];
  let least = 1;
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) least = Math.min(least, differs(q, p, a.width, a.height, dx, dy)); // prettier-ignore
  return least;
}

test('every look from every camera, by day and by night: within its bounds, its thumbnails as recorded, nothing built', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const report: Record<string, unknown> = {};
  let before = 0; // the pipelines after the noon round: a shot builds its own passes once from each camera
  for (const hour of HOURS) {
    if (hour !== HOURS[0]) before ||= (await page.evaluate(() => __engine.stats())).pipelines;
    for (const camera of CAMERAS) {
      for (const look of LOOKS) {
        const shot = await shoot(page, look, camera, hour, { ids: true, metrics: true, thumbnail: true });
        const name = `playground-${look.replace('look:playground-', '')}-${camera.replace(/^cam3?=/, '')}`;
        const where = `${name} at ${hour}:00`;
        const { metrics, notes, thumbnail, ids } = shot;
        report[where] = {
          metrics,
          notes: notes.map((note) => note.id),
          protagonist: ids?.protagonist ?? null,
          thumbnail,
        };
        console.log(`${where}: luma ${metrics.lumaMean} spread ${metrics.spread} palette ${metrics.palette} edges ${metrics.edges} notes ${notes.map((note) => note.id).join(',')}`); // prettier-ignore
        expect(
          notes.map((note) => note.id),
          where,
        ).not.toContain('LOOK_BLANK');
        expect(
          notes.map((note) => note.id),
          where,
        ).not.toContain('LOOK_EMPTY');
        if (camera !== 'cam3=first')
          expect(ids?.protagonist?.px ?? 0, `${where}: the player in view`).toBeGreaterThan(0);
        if (hour !== 12) continue;
        const file = join(ROOT, 'tests', 'baselines', 'thumbs', `${name}.json`);
        if (process.env.UPDATE_THUMBS === '1') {
          const prettier = await import('prettier');
          const options = (await prettier.resolveConfig(file)) ?? {};
          writeFileSync(file, await prettier.format(JSON.stringify({ case: name, ...thumbnail }), { ...options, filepath: file })); // prettier-ignore
        }
        expect(existsSync(file), `${file}: record it with UPDATE_THUMBS=1`).toBe(true);
        const diff = compareThumbnails(JSON.parse(readFileSync(file, 'utf8')) as Thumbnail, thumbnail!);
        expect(diff.cells, `${name}: ${JSON.stringify(diff.worst)}`).toBe(0);
      }
    }
  }
  const out = join(ROOT, 'out', 'e2e', 'playground-looks');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const camera of CAMERAS) {
    for (const look of LOOKS) {
      const name = `playground-${look.replace('look:playground-', '')}-${camera.replace(/^cam3?=/, '')}`;
      const [noon, night] = HOURS.map((hour) => (report[`${name} at ${hour}:00`] as { metrics: LookMetrics }).metrics);
      expect(night.lumaMean, `${name}: night darker than noon`).toBeLessThan(noon.lumaMean);
    }
  }
  expect((await page.evaluate(() => __engine.stats())).pipelines, 'built after the noon round').toBe(before);
  expect(harness.advice()).toEqual([]);
});

test('the pixel look does not shimmer: sub-pixel pans move its picture by whole pixels, the page gliding the rest', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const { x, y, z } = await page.evaluate(() => __engine.get(1).actor);
  const feet = [x, y, z];
  const pan = async (look: string, view: string) => {
    // The view as the page has it (its turn and its whole zoom), fixed on the player's feet: where it stands from them.
    const code = await page.evaluate((v) => __engine.camera.set(`cam=${v}`).code, view);
    const head = code.split(',').length >= 3 ? code.split(',').slice(0, 3).join(',') : `${code},0,1`;
    const fixed = (at: number[]) => `${head},${at.map((v) => v.toFixed(3)).join(',')}`;
    const eye = await page.evaluate((c) => (__engine.camera.set(c) as { pose: { position: number[] } }).pose.position, fixed(feet)); // prettier-ignore
    // A pan along the image plane's across axis in whole millimetres (camera codes keep 1 mm), so it never dollies:
    // iso's across is a ground diagonal, top-down's +X.
    const forward = unit(plus(feet, eye, -1));
    const across = Math.hypot(forward[0], forward[2]) > 1e-3 ? cross(forward, [0, 1, 0]) : [1, 0, 0];
    const step = across.map((v) => (Math.abs(v) > 1e-3 ? Math.sign(v) : 0) / 1000); // 1 mm on each axis it uses
    const shots: Shot[] = [];
    const glides: [number, number][] = [];
    for (let k = 0; k < 8; k++) {
      const at = plus(feet, step, k * PAN * 1000);
      shots.push(await shoot(page, look, fixed(at), k === 0 ? 12 : null, { ids: false, metrics: false, thumbnail: false, pixels: true }, 2)); // prettier-ignore
      glides.push(await glide(page));
    }
    return { shimmers: shots.slice(1).map((shot, i) => shimmer(shots[i], shot)), glides };
  };
  for (const view of ['iso', 'overhead']) {
    const pixel = await pan('look:playground-pixel', view);
    const cel = await pan('look:playground-cel', view);
    console.log(`${view}: pixel ${JSON.stringify(pixel)}, cel ${JSON.stringify(cel)}`);
    expect(pixel.shimmers, `${view}: the pixel look under sub-pixel pans`).toEqual(pixel.shimmers.map(() => 0));
    for (const shift of pixel.glides) expect(Math.max(...shift.map(Math.abs))).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(cel.glides.every((shift) => shift[0] === 0 && shift[1] === 0), `${view}: the cel look never glides`).toBe(true); // prettier-ignore
    if (view === 'overhead') continue; // top-down is pixel-exact by itself (WP 13.8): its pans move nothing in either look
    expect(new Set(pixel.glides.map((shift) => shift.join())).size, `${view}: the glide carries the remainder`).toBeGreaterThan(4); // prettier-ignore
    expect(Math.max(...cel.shimmers), `${view}: the cel look shimmers under the same pans`).toBeGreaterThan(0);
  }
  expect(harness.advice()).toEqual([]);
});

test("the cel look's shells round the props and bodies, the pixel look's art pixel, its perspective variant", async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const shells = () =>
    page.evaluate(() => {
      const lines = __engine.scene
        .dump({ filter: '/outline' })
        .split('\n')
        .filter((line) => line.includes('/outline '));
      return { shown: lines.filter((line) => !/ hidden\b/.test(line)).length, all: lines.length };
    });
  const options = { ids: true, metrics: false, thumbnail: false };
  const cel = await shoot(page, 'look:playground-cel', 'cam=iso', 12, options);
  const inCel = await shells();
  const pixel = await shoot(page, 'look:playground-pixel', 'cam=iso', null, options);
  const inPixel = await shells();
  const lines = await page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement).height);
  console.log(`shells: cel ${JSON.stringify(inCel)}, pixel ${JSON.stringify(inPixel)}, lines ${lines}`);
  expect(inCel.shown, 'the cel look shows its shells').toBeGreaterThan(10);
  expect([inPixel.shown, inPixel.all]).toEqual([0, inCel.all]);
  // Every object of note in one look is seen in the other (the snap moves the pixel look's camera by up to half a
  // pixel, so a thin one's count moves a little); never a shell.
  const seen = (shot: Shot, least: number) => shot.ids!.visible.filter((entry) => entry.px >= least).map((entry) => entry.name); // prettier-ignore
  for (const [a, b] of [[cel, pixel], [pixel, cel]]) expect(seen(b, 1), 'the same objects in both looks').toEqual(expect.arrayContaining(seen(a, 60))); // prettier-ignore
  expect(cel.ids!.visible.some((entry) => entry.name.endsWith('/outline'))).toBe(false);
  expect(lines, 'the page draws its own art pixels: 240 to 360 lines').toBeGreaterThanOrEqual(240);
  expect(lines).toBeLessThanOrEqual(360);
  await shoot(page, 'look:playground-pixel', 'cam3=first', null, options);
  expect(await glide(page), 'first person draws the variant: no glide').toEqual([0, 0]);
  expect(harness.advice()).toEqual([]);
});
