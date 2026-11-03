/**
 * @file T2 for the playground's three looks (PLAN.md WP 13.24, WP 13.29, WP 13.30; docs/PLAYGROUND.md §5.2 and §9.1's
 * look metrics), on its street (labs/playground/?scene=site-street), the sim paused:
 * - Look metrics and thumbnails per look and camera: each of the five cameras in each look, at noon and at 22:00,
 *   shot at the look's resolution (`DRAWN_AT`, `gfx.resolution` left at `auto`: each shot after a switch drawn at the
 *   size its look asks for) with its look metrics: never blank or empty, the player in view in the four that show
 *   him, night darker than noon; the noon shots' text thumbnails as recorded
 *   (tests/baselines/thumbs/playground-<look>-<camera>.json, written with UPDATE_THUMBS=1); every metric, note and
 *   thumbnail in out/e2e/playground-looks/report.json; the night round
 *   builds nothing more than the same round shot again at noon (`ROUNDS`, each from the noon round's world through
 *   `capture` and `restore`, so only the hour differs): a shot builds its own passes once from each camera, and its ID
 *   pass a pipeline again after a switch between the toon looks and the clean look (docs/PROGRESS.md), so the second
 *   noon round is the night's measure.
 * - The shimmer metric: in the pixel look, isometric and top-down panned by fractions of a pixel (a fixed target
 *   moved in the camera's image plane, `PANS`: a pan, never a dolly, which an orthographic picture leaves alone but its
 *   cascades and far plane do not) change no pixel of the picture but by whole pixels (each frame the last one moved by
 *   at most two pixels each way, the camera snapping by whole 2 × 2 quads, engine/gfx/post/grid.ts `QUAD`; the page's
 *   hidden margin of two drawn pixels left out). Isometric's pan crosses whole pixels, so the dithers, the shading's
 *   derivatives and the shadows' filter are seen moving with the world, and its glide (the canvas's CSS transform,
 *   within a drawn pixel) carries the remainder and wraps as the picture moves. In the cel look the same pans shimmer,
 *   so the metric measures something. Top-down's pan, half of its 1/24 m drawn pixel a frame (its target snaps to that
 *   grid, WP 13.8), does the same, its glide wrapping too; beyond each move it may change at most `OVERHEAD_RESIDUAL`
 *   pixels, a soft shadow band's edge (ADR-0025 amendment 35, its cause an open issue for the owner in PROGRESS).
 * - The cel look's shells round the props and the bodies, shown there and hidden in the clean and pixel looks, the ID
 *   pass the same objects in each, the clean look never gliding; the pixel look draws one art pixel a drawn pixel at
 *   the page's lines (the canvas's height), its perspective variant in first person: unsnapped, no glide.
 *
 * Invariants: frames are drawn by calling the page (`render`, 1/60 s each); goldens and baselines come from their files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { LookMetrics, LookNote } from '../../engine/gfx/lookMetrics';
import { PIXEL_LINES } from '../../engine/gfx/resolution';
import { compareThumbnails, type Thumbnail } from '../../engine/gfx/thumbnail';
import { PLAYGROUND_LOOKS } from '../../labs/playground/views';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
/** The street from above, where every camera sees the player, the props and the block. */
const STREET = 'labs/playground/?scene=site-street&cam=iso';
const LOOKS = PLAYGROUND_LOOKS;
const CAMERAS = ['cam3=first', 'cam3=shoulder', 'cam3=follow', 'cam=iso', 'cam=overhead'] as const;
const HOURS = [12, 22] as const;
/**
 * Each round's views in the order it shoots them: the cel and pixel looks camera by camera, then the clean look
 * (WP 13.29) camera by camera. Each shot steps the paused sim once (its hour reaches the sky with the step), so the
 * dog, the neighbours and first person's arms move between shots: the toon looks keep the ticks their thumbnails were
 * recorded at (shot after the clean look, the cel look's first person moved its arms and isometric its shadows).
 */
const VIEWS = [
  ...CAMERAS.flatMap((camera) => LOOKS.slice(1).map((look) => ({ camera, look }))),
  ...CAMERAS.map((camera) => ({ camera, look: LOOKS[0] })),
];
/**
 * The resolution each look is drawn at (its `resolution`, WP 13.30): the clean and cel looks full (every screen line
 * drawn, smoothly enlarged), the pixel look the engine's pixels (at most `PIXEL_LINES` lines, enlarged unsmoothed).
 */
const DRAWN_AT: Record<string, string> = {
  'look:playground-clean': 'full',
  'look:playground-cel': 'full',
  'look:playground-pixel': 'pixels',
};
/** The rounds' hours: noon, noon again (what the views build when shot again) and night, each from the same world. */
const ROUNDS = [HOURS[0], HOURS[0], HOURS[1]] as const;
/**
 * Each view's pan: how far it moves the fixed target each frame on each axis it moves along (m) and how many frames
 * it draws. Iso's, about a sixth of a pixel a frame, crosses two whole pixels; top-down's, 20 mm, about half of its
 * 1/24 m drawn pixel a frame, crosses three.
 */
const PANS = { iso: { step: 0.006, frames: 16 }, overhead: { step: 0.02, frames: 8 } } as const;
/**
 * The pixels a top-down frame of the pixel look may change beyond its whole-pixel move: measured at 7 to 10 on the
 * street at noon (a soft shadow band's edge; 0 with the shadows off, ADR-0025 amendment 35), so a regression past it
 * fails while its cause stays open.
 */
const OVERHEAD_RESIDUAL = 10;
/** The page's margin, in drawn pixels (labs/playground/index.html): drawn for the glide, hidden, never compared. */
const MARGIN = 2;

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
  capture(): unknown;
  restore(capture: unknown): void;
};

/** Where the page keeps the noon round's world: a capture restores only as the object it is, in the page. */
declare const window: { __noonWorld?: unknown };

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

/**
 * The share of pixels two pictures differ in (more than 2 of 255 a channel) when `b` is moved by (dx, dy), within
 * `margin` pixels of neither picture's edge, and how many.
 */
function differs(a: Buffer, b: Buffer, width: number, height: number, dx = 0, dy = 0, margin = 0) {
  let [changed, seen] = [0, 0];
  for (let y = Math.max(margin, margin + dy); y < Math.min(height - margin, height - margin + dy); y++) {
    for (let x = Math.max(margin, margin + dx); x < Math.min(width - margin, width - margin + dx); x++) {
      const [i, j] = [(y * width + x) * 4, ((y - dy) * width + (x - dx)) * 4];
      const far = Math.abs(a[i] - b[j]) > 2 || Math.abs(a[i + 1] - b[j + 1]) > 2 || Math.abs(a[i + 2] - b[j + 2]) > 2;
      changed += far ? 1 : 0;
      seen++;
    }
  }
  return { share: changed / seen, changed };
}

/**
 * The page's drawing buffer now: its lines (the canvas's height), the screen's lines under the canvas (its CSS height
 * at the device pixel ratio) and whether the browser enlarges it unsmoothed (engine/gfx/resolution.ts).
 */
function drawingBuffer(page: Page): Promise<{ lines: number; screen: number; pixelated: boolean }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const screen = Math.round(canvas.clientHeight * devicePixelRatio);
    return { lines: canvas.height, screen, pixelated: canvas.style.imageRendering === 'pixelated' };
  });
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

/**
 * The shimmer between two frames: the least share they differ in, the hidden margin left out, over every whole-pixel
 * move of at most a quad (2 pixels) each way, and the move that gives it (no move first).
 */
function shimmer(a: Shot, b: Shot): { share: number; changed: number; move: [number, number] } {
  const [p, q] = [Buffer.from(a.pixels!, 'base64'), Buffer.from(b.pixels!, 'base64')];
  let best = { share: 1, changed: Infinity, move: [0, 0] as [number, number] };
  for (const dy of [0, -1, 1, -2, 2]) {
    for (const dx of [0, -1, 1, -2, 2]) {
      const { share, changed } = differs(q, p, a.width, a.height, dx, dy, MARGIN);
      if (share < best.share) best = { share, changed, move: [dx, dy] };
    }
  }
  return best;
}

test('every look from every camera, by day and by night: within its bounds, its thumbnails as recorded, nothing built', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  await page.evaluate(() => void (window.__noonWorld = __engine.capture()));
  const report: Record<string, unknown> = {};
  const built: number[] = []; // the pipelines each round built
  for (const [round, hour] of ROUNDS.entries()) {
    // each round from the noon round's world: each shot steps the sim, and the street's dog and neighbours walk into views
    if (round > 0) await page.evaluate(() => __engine.restore(window.__noonWorld));
    const start = (await page.evaluate(() => __engine.stats())).pipelines;
    for (const { camera, look } of VIEWS) {
      const shot = await shoot(page, look, camera, hour, { ids: true, metrics: true, thumbnail: true });
      const buffer = await drawingBuffer(page);
      const full = buffer.lines === buffer.screen && !buffer.pixelated;
      const chunky = buffer.lines <= PIXEL_LINES && buffer.pixelated;
      expect({ full, chunky, shot: shot.height }, `${look} from ${camera}: shot at its resolution`).toEqual({ full: DRAWN_AT[look] === 'full', chunky: DRAWN_AT[look] === 'pixels', shot: buffer.lines }); // prettier-ignore
      if (round === 1) continue; // the noon views again: only what they build counts
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
      if (camera !== 'cam3=first') expect(ids?.protagonist?.px ?? 0, `${where}: the player in view`).toBeGreaterThan(0);
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
    built.push((await page.evaluate(() => __engine.stats())).pipelines - start);
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
  console.log(`pipelines built by the rounds (noon, noon again, night): ${built.join(', ')}`);
  expect(built[2], 'built through the night beyond the noon round shot again').toBe(built[1]);
  expect(harness.advice()).toEqual([]);
});

test('the pixel look does not shimmer: pans move its picture by whole pixels, the page gliding the rest', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const { x, y, z } = await page.evaluate(() => __engine.get(1).actor);
  const feet = [x, y, z];
  const pan = async (look: string, view: keyof typeof PANS) => {
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
    for (let k = 0; k < PANS[view].frames; k++) {
      const at = plus(feet, step, k * PANS[view].step * 1000);
      shots.push(await shoot(page, look, fixed(at), k === 0 ? 12 : null, { ids: false, metrics: false, thumbnail: false, pixels: true }, 2)); // prettier-ignore
      glides.push(await glide(page));
    }
    return { shimmers: shots.slice(1).map((shot, i) => shimmer(shots[i], shot)), glides };
  };
  for (const view of ['iso', 'overhead'] as const) {
    const pixel = await pan('look:playground-pixel', view);
    const cel = await pan('look:playground-cel', view);
    console.log(`${view}: pixel ${JSON.stringify(pixel)}, cel ${JSON.stringify(cel)}`);
    const changed = pixel.shimmers.map((s) => s.changed);
    const bound = view === 'overhead' ? OVERHEAD_RESIDUAL : 0;
    expect(Math.max(...changed), `${view}: the pixel look under pans, beyond its whole-pixel moves`).toBeLessThanOrEqual(bound); // prettier-ignore
    for (const shift of pixel.glides) expect(Math.max(...shift.map(Math.abs))).toBeLessThanOrEqual(1 + 1e-6);
    expect(cel.glides.every((shift) => shift[0] === 0 && shift[1] === 0), `${view}: the cel look never glides`).toBe(true); // prettier-ignore
    expect(
      pixel.shimmers.some((s) => s.move.some(Boolean)),
      `${view}: the pan crosses a whole pixel`,
    ).toBe(true);
    expect(new Set(pixel.glides.map((shift) => shift.join())).size, `${view}: the glide carries the remainder`).toBeGreaterThan(PANS[view].frames / 4); // prettier-ignore
    const wraps = pixel.glides.slice(1).some((shift, i) => shift.some((v, axis) => Math.abs(v - pixel.glides[i][axis]) > 0.5)); // prettier-ignore
    expect(wraps, `${view}: the glide wraps as the picture moves a whole pixel`).toBe(true);
    expect(Math.max(...cel.shimmers.map((s) => s.share)), `${view}: the cel look shimmers under the same pans`).toBeGreaterThan(0); // prettier-ignore
  }
  expect(harness.advice()).toEqual([]);
});

test("the cel look's shells round the props and bodies, none in the others, the pixel look's art pixel, its variant", async ({
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
  // the pixel look's own lines, read while it is drawn: the clean and cel looks draw at full resolution (WP 13.30)
  const lines = await page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement).height);
  const clean = await shoot(page, 'look:playground-clean', 'cam=iso', null, options);
  const inClean = await shells();
  expect(await glide(page), 'the clean look never glides').toEqual([0, 0]);
  console.log(`shells: cel ${JSON.stringify(inCel)}, pixel ${JSON.stringify(inPixel)}, clean ${JSON.stringify(inClean)}, lines ${lines}`); // prettier-ignore
  expect(inCel.shown, 'the cel look shows its shells').toBeGreaterThan(10);
  expect([inPixel.shown, inPixel.all]).toEqual([0, inCel.all]);
  expect([inClean.shown, inClean.all]).toEqual([0, inCel.all]);
  // Every object of note in one look is seen in the other (the snap moves the pixel look's camera by up to a pixel,
  // so a thin one's count moves a little); never a shell.
  const seen = (shot: Shot, least: number) => shot.ids!.visible.filter((entry) => entry.px >= least).map((entry) => entry.name); // prettier-ignore
  for (const [a, b] of [[cel, pixel], [pixel, cel], [cel, clean], [clean, cel]]) expect(seen(b, 1), 'the same objects in every look').toEqual(expect.arrayContaining(seen(a, 60))); // prettier-ignore
  expect(cel.ids!.visible.some((entry) => entry.name.endsWith('/outline'))).toBe(false);
  expect(lines, 'the page draws its own art pixels: 240 to 360 lines').toBeGreaterThanOrEqual(240);
  expect(lines).toBeLessThanOrEqual(360);
  await shoot(page, 'look:playground-pixel', 'cam3=first', null, options);
  expect(await glide(page), 'first person draws the variant: no glide').toEqual([0, 0]);
  expect(harness.advice()).toEqual([]);
});
