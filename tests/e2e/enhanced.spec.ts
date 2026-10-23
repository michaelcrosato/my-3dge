/**
 * @file T2 for the lighting and shading upgrades (PLAN.md WP 11.5; engine/gfx/enhanced/, reached through
 * engine/gfx/features.ts). Each technique drawn where it shows, and again with its feature off (`gfx.featuresOff`):
 * 1. tiled lighting, in the box's hall under `look:torch-lit`: the light pool holds 64 lights (all 30 torch spots lit,
 *    the two nearest casting shadows), the hall comes out brighter than with the pool's 12, the same entities are in
 *    the ID pass, and no pipeline is built after the warm-up, through the resolution modes' resizes included (r182's
 *    tiled lights rebuilt every lit pipeline on a resize); and on the lights page, which lights the hall from a pool of
 *    12, the tiles draw what the pool draws without them (a light dropped from a tile would darken it);
 * 2. cascaded shadows, in the crowd arena under `look:daylight`: the sky's sun casts through three cascades (the scene
 *    dump counts those made; one map with the feature off), the picture renders, the same entities are in the ID pass,
 *    and no pipeline is built after the warm-up; and the cascades are made when the sun first casts after the sky was
 *    shown, from the torch-lit hall's sky and from the low tier, which casts none (they were not, and every sunlit
 *    material failed to build: the advice trap fails r182's `THREE.TSL:` errors);
 * 3. the chain's shading (engine/gfx/post/shading.ts) in the box's room, through an orthographic camera and a
 *    perspective one: the sections `ao`, `gi` and `air` laid on by `post.filters` each change the picture against the
 *    chain with them off (occlusion only darkens it), and `ssr` changes nothing, the box drawing no metal; the same
 *    entities are in the ID pass, and switching camera and section builds no pipeline; with the four features off,
 *    each section draws nothing and each feature's advice is raised;
 * 4. the shading page (tests/pages/shading.html), for what the box cannot show: reflections change the steel ball and
 *    plate, through either lens, and no pixel outside them; the air's shafts and halos each add light, and the sun's
 *    shadow map cuts the shafts (in a low mist they add half as much light over floor in a pillar's shadow as beside
 *    it); at the `medium` tier bounce light and shafts draw nothing, and the look is told once (`GFX_POST_TIER`).
 * That a feature off never changes play is tests/e2e/features.spec.ts's for every feature; each one's cost is
 * `x perf --feature` (the WP's ledger row).
 *
 * Invariants: images are read as numbers (look metrics, the share of lit pixels, the ID pass), never looked at; the
 * fixture fails a test on any unlisted advice or console warning, a shader's compile log included.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { LookOptions } from '../pages/lights';
import { expect, test, type Harness } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, (...args: unknown[]) => unknown> & {
  scene: { dump(o: object): string };
  camera: { set(code: string): unknown };
  metal(): [number, number, number, number][];
  shadow(): { shade: [number, number][]; sun: [number, number][] };
};

/** What a frame gives the spec: its look metrics, the share of pixels lit past luma 60, and the entities seen. */
interface Seen {
  lumaMean: number;
  blank: boolean;
  lit: number;
  visible: string[];
  pipelinesAfterWarmUp: number | null;
}

test.describe.configure({ timeout: 300_000 });

/** Opens `query` on the box with `off` among the features turned off, the sim paused. */
async function open(page: Page, harness: Harness, query: string, off: string[] = []): Promise<void> {
  const features = off.length ? `&gfx.featuresOff=${encodeURIComponent(JSON.stringify(off))}` : '';
  await page.goto(`labs/box/?${query}${features}`);
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
  await page.evaluate(() => __engine.pause());
}

/** Draws `frames` frames, reads the stats, then shoots: what the spec reads of the frame. */
const look = (page: Page, frames = 20) =>
  page.evaluate(async (n) => {
    await __engine.render(n);
    const { pipelinesAfterWarmUp } = __engine.stats() as { pipelinesAfterWarmUp: number | null };
    const shot = (await __engine.shot({ metrics: true, pixels: true, ids: true })) as {
      pixels: string;
      metrics: { lumaMean: number; blank: boolean };
      ids: { visible: { name: string }[] };
    };
    const bytes = Uint8Array.from(atob(shot.pixels), (c) => c.charCodeAt(0));
    let lit = 0;
    for (let i = 0; i < bytes.length; i += 4) lit += 0.2126 * bytes[i] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i + 2] > 60 ? 1 : 0; // prettier-ignore
    const visible = [...new Set(shot.ids.visible.map((e) => e.name))].sort();
    return { ...shot.metrics, lit: lit / (bytes.length / 4), visible, pipelinesAfterWarmUp };
  }, frames) as Promise<Seen>;

/** The scene dump's lines, filtered by `filter`, that hold `line`. */
const dumped = (page: Page, filter: string, line = filter) =>
  page.evaluate(([f, l]) => __engine.scene.dump({ filter: f }).split('\n').filter((each) => each.includes(l)), [filter, line] as const); // prettier-ignore

test('tiled lighting: the hall lit by all its torches, brighter than the pool of 12, building nothing on resizes', async ({
  page,
  harness,
}) => {
  const hall = 'scene=hall&post.look=look:torch-lit';
  await open(page, harness, hall);
  const pool = await dumped(page, 'lights:pool/');
  expect(pool).toHaveLength(64);
  expect(pool.filter((line) => line.endsWith(' shadow'))).toHaveLength(2);
  // The resolution modes resize the targets before anything is shot (a shot builds its own passes' pipelines).
  for (const mode of ['balanced', 'full', 'pixels']) {
    const built = await page.evaluate(async (m) => {
      __engine.set('gfx.resolution', m);
      await __engine.render(3);
      return (__engine.stats() as { pipelinesAfterWarmUp: number }).pipelinesAfterWarmUp;
    }, mode);
    expect([mode, built]).toEqual([mode, 0]);
  }
  const tiled = await look(page);
  expect(tiled.pipelinesAfterWarmUp).toBe(0);
  expect(harness.advice()).toEqual([]);

  await open(page, harness, hall, ['feature:tiledLighting']);
  expect(await dumped(page, 'lights:pool/')).toHaveLength(12);
  const pooled = await look(page);
  expect(tiled.lumaMean).toBeGreaterThan(pooled.lumaMean);
  expect(tiled.lit).toBeGreaterThan(pooled.lit);
  expect(tiled.visible).toEqual(pooled.visible); // the same scene: lit otherwise, never played otherwise
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_TILED_LIGHTING']);
});

test('cascaded shadows: the day sun casts through three cascades over the crowd arena, building nothing', async ({
  page,
  harness,
}) => {
  const arena = 'scene=crowd-100&post.look=look:daylight';
  await open(page, harness, arena);
  expect(await dumped(page, 'sky/sun', 'sky/sun DirectionalLight')).toEqual([expect.stringMatching(/^ +sky\/sun DirectionalLight .* shadow ×3 cascades$/)]); // prettier-ignore
  const cascaded = await look(page);
  expect([cascaded.blank, cascaded.pipelinesAfterWarmUp]).toEqual([false, 0]);
  expect(harness.advice()).toEqual([]);

  await open(page, harness, arena, ['feature:cascadedShadows']);
  expect(await dumped(page, 'sky/sun', 'sky/sun DirectionalLight')).toEqual([
    expect.stringMatching(/^ +sky\/sun DirectionalLight .* shadow$/),
  ]);
  const single = await look(page);
  expect(single.blank).toBe(false);
  expect(cascaded.visible).toEqual(single.visible);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_CASCADED_SHADOWS']);
});

test('cascaded shadows after a switch: from the torch-lit sky to daylight, and from the low tier to the high', async ({
  page,
  harness,
}) => {
  const sun = () => dumped(page, 'sky/sun', 'sky/sun DirectionalLight');
  const show = (path: string, value: string) =>
    page.evaluate(
      async ([p, v]) => {
        __engine.set(p, v);
        await __engine.render(20);
      },
      [path, value] as const,
    );
  await open(page, harness, 'scene=crowd-100&post.look=look:torch-lit'); // the hall's sky: its sun does not cast
  await show('post.look', 'look:daylight');
  expect(await sun()).toEqual([expect.stringMatching(/ shadow ×3 cascades$/)]);
  expect((await look(page)).blank).toBe(false);
  await show('quality', 'low'); // no shadow casters at all
  expect(await sun()).toEqual([expect.not.stringMatching(/shadow/)]);
  const low = await look(page);
  await show('quality', 'high');
  expect(await sun()).toEqual([expect.stringMatching(/ shadow ×3 cascades$/)]);
  const high = await look(page);
  // The sun's shadows darken what it shades, and only that: a material that failed to build draws near black.
  expect(high.lumaMean).toBeLessThan(low.lumaMean);
  expect(high.lumaMean).toBeGreaterThan(low.lumaMean * 0.8);
  expect(harness.advice()).toEqual([]);
});

/** A frame drawn with `filters` over the look: its pixels, luma and entities, and the pipelines its switch built. */
interface Shaded {
  rgba: Buffer;
  width: number;
  lumaMean: number;
  visible: string[];
  switched: number;
}

/** Through camera `cam`, lays `filters` over the look (`post.filters`), draws 20 frames, then shoots. */
const shade = (page: Page, cam: string, filters: object): Promise<Shaded> =>
  page
    .evaluate(
      async ([code, f]) => {
        const built = () => (__engine.stats() as { pipelinesAfterWarmUp: number }).pipelinesAfterWarmUp;
        const before = built();
        __engine.camera.set(code as string);
        __engine.set('post.filters', f);
        await __engine.render(20);
        const switched = built() - before;
        const shot = (await __engine.shot({ metrics: true, pixels: true, ids: true })) as {
          width: number;
          pixels: string;
          metrics: { lumaMean: number };
          ids?: { visible: { name: string }[] };
        };
        const visible = [...new Set((shot.ids?.visible ?? []).map((e) => e.name))].sort();
        return { width: shot.width, pixels: shot.pixels, lumaMean: shot.metrics.lumaMean, visible, switched };
      },
      [cam, filters] as const,
    )
    .then(({ pixels, ...rest }) => ({ ...rest, rgba: Buffer.from(pixels, 'base64') }));

/** Whether pixel `i` (its byte offset) differs between `a` and `b` by more than 2 in a channel (of 255). */
const differs = (a: Buffer, b: Buffer, i: number) =>
  Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 2;

/** The share of pixels that differ between `a` and `b`. */
function changed(a: Buffer, b: Buffer): number {
  expect(a.length).toBe(b.length);
  let count = 0;
  for (let i = 0; i < a.length; i += 4) count += differs(a, b, i) ? 1 : 0;
  return count / (a.length / 4);
}

/** Whether pixel (x, y) lies inside the convex `polygon` (screen points, either winding). */
function inside(polygon: [number, number][], x: number, y: number): boolean {
  const sides = polygon.map(([ax, ay], i) => {
    const [bx, by] = polygon[(i + 1) % polygon.length];
    return Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
  });
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

/** A colour channel's byte (sRGB-encoded) as linear light, 0–1. */
const linear = (c: number) => (c <= 10.31475 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);

/**
 * The mean linear luminance `after` adds to `before` over the pixels inside `polygon` (0–1). Light adds up linearly
 * before the display encodes it (no look here tone-maps), and the same light added in sRGB levels counts more over a
 * dark surface than a bright one.
 */
function addedIn(polygon: [number, number][], before: Shaded, after: Shaded): number {
  const luma = (b: Buffer, i: number) => 0.2126 * linear(b[i]) + 0.7152 * linear(b[i + 1]) + 0.0722 * linear(b[i + 2]); // prettier-ignore
  let [sum, n] = [0, 0];
  for (let i = 0; i < after.rgba.length; i += 4) {
    const [x, y] = [((i / 4) % after.width) + 0.5, Math.floor(i / 4 / after.width) + 0.5];
    if (!inside(polygon, x, y)) continue;
    sum += luma(after.rgba, i) - luma(before.rgba, i);
    n++;
  }
  expect(n, 'pixels in the patch').toBeGreaterThan(20);
  return sum / n;
}

/** The chain's shading sections, each on at its defaults; the base is the chain with them all off. */
const SECTIONS = {
  ao: { ao: { scope: 'all' } },
  gi: { gi: { scope: 'all' } },
  air: { air: { scope: 'all' } },
  ssr: { ssr: { scope: 'all' } },
};
const BASE = { ao: { scope: 'all', strength: 0 } };
const ROOM = 'scene=room&post.look=look:clean';
/** The box's iso view through its orthographic lens and through a perspective one: both stand still. */
const CAMERAS = ['cam=iso', 'cam=iso,persp'];

/** Each section's share of pixels changed against the base, by camera, building nothing, the same entities seen. */
async function sections(page: Page) {
  const shares: Record<string, number> = {};
  for (const cam of CAMERAS) {
    const base = await shade(page, cam, BASE);
    expect([cam, changed(base.rgba, (await shade(page, cam, BASE)).rgba)]).toEqual([cam, 0]); // the control: the same frame twice
    for (const [name, filters] of Object.entries(SECTIONS)) {
      const shaded = await shade(page, cam, filters);
      expect([cam, name, shaded.switched]).toEqual([cam, name, 0]);
      expect(shaded.visible).toEqual(base.visible);
      shares[`${cam} ${name}`] = changed(base.rgba, shaded.rgba);
      if (name === 'ao') expect(shaded.lumaMean).toBeLessThanOrEqual(base.lumaMean);
    }
  }
  return shares;
}

test("the chain's shading: occlusion, bounce light and air change the room, reflections nothing, building nothing", async ({
  page,
  harness,
}) => {
  await open(page, harness, ROOM);
  const shares = await sections(page);
  console.log(`shading, share of pixels changed: ${JSON.stringify(shares)}`);
  for (const cam of CAMERAS) {
    expect(shares[`${cam} ao`], cam).toBeGreaterThan(0.01);
    expect(shares[`${cam} gi`], cam).toBeGreaterThan(0.05);
    expect(shares[`${cam} air`], cam).toBeGreaterThan(0.3);
    expect(shares[`${cam} ssr`], cam).toBe(0); // the box draws no metal: no pixel reflects
  }
  expect(harness.advice()).toEqual([]);

  await open(page, harness, ROOM, ['feature:ao', 'feature:gi', 'feature:air', 'feature:ssr']);
  expect(Object.values(await sections(page))).toEqual(CAMERAS.flatMap(() => [0, 0, 0, 0]));
  expect(harness.advice().map((advice) => advice.code).sort()).toEqual(['GFX_NO_AIR', 'GFX_NO_AO', 'GFX_NO_GI', 'GFX_NO_SSR']); // prettier-ignore
});

test('the shading page: reflections on the steel alone, shafts and halos in the air, the tiers off', async ({
  page,
  harness,
}) => {
  await page.goto('tests/pages/shading.html');
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
  const reflected: Record<string, [number, number]> = {};
  for (const lens of ['perspective', 'orthographic']) {
    const base = await shade(page, lens, BASE);
    const ssr = await shade(page, lens, SECTIONS.ssr);
    expect([lens, base.switched, ssr.switched]).toEqual([lens, 0, 0]);
    const boxes = await page.evaluate(() => __engine.metal());
    const counts = [0, 0, 0, 0]; // changed inside, inside, changed outside, outside
    for (let i = 0; i < ssr.rgba.length; i += 4) {
      const [x, y] = [(i / 4) % ssr.width, Math.floor(i / 4 / ssr.width)];
      const k = boxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1) ? 0 : 2;
      counts[k] += differs(base.rgba, ssr.rgba, i) ? 1 : 0;
      counts[k + 1]++;
    }
    reflected[lens] = [counts[0] / counts[1], counts[2]];
  }
  console.log(`reflections: share of the steel's boxes changed, and pixels changed outside them: ${JSON.stringify(reflected)}`); // prettier-ignore
  for (const [lens, [inside, outside]] of Object.entries(reflected)) {
    expect(inside, lens).toBeGreaterThan(0.05);
    expect(outside, lens).toBe(0);
  }

  const air = (shafts: number, halos: number) => shade(page, 'perspective', { air: { scope: 'all', shafts, halos } });
  const [clear, shafts, halos] = [await air(0, 0), await air(2.4, 0), await air(0, 1.8)];
  expect(shafts.lumaMean).toBeGreaterThan(clear.lumaMean);
  expect(halos.lumaMean).toBeGreaterThan(clear.lumaMean);
  // The sun's shadow map cuts the shafts. In a mist lying low on the floor, most of the light the shafts add to a view
  // of the floor scatters off the last metre or so of the camera's ray, and over a patch in pillar/north's shadow that
  // part of the ray runs through the shadow: the shafts add about half the light there that they add beside it, in the
  // sun (measured 0.036 against 0.073; with the haze 4 m high, as by default, 0.091 against 0.099).
  const mist = (shafts: number) => shade(page, 'perspective', { air: { scope: 'all', haze: 1.4, height: 0.6, shafts, halos: 0 } }); // prettier-ignore
  const [still, lit] = [await mist(0), await mist(2.4)];
  const regions = await page.evaluate(() => __engine.shadow());
  const [inShade, inSun] = [regions.shade, regions.sun].map((patch) => addedIn(patch, still, lit));
  console.log(`light shafts, linear luminance added over the floor in shade and in sun: ${JSON.stringify([inShade, inSun])}`); // prettier-ignore
  expect(inSun).toBeGreaterThan(0.03);
  expect(inShade).toBeLessThan(inSun * 0.7);
  expect(harness.advice()).toEqual([]);

  await page.evaluate(() => __engine.set('quality', 'medium'));
  const base = await shade(page, 'perspective', BASE);
  expect(changed(base.rgba, (await shade(page, 'perspective', SECTIONS.gi)).rgba)).toBe(0);
  expect(changed(clear.rgba, (await air(2.4, 0)).rgba)).toBe(0);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_POST_TIER', 'GFX_POST_TIER']);
});

/** The hall as the lights page draws it (tests/pages/lights.ts), its pool of 12, the camera on the dais. */
const HALL = { file: 'labs/box/levels/hall.txt', focus: [32.5, 0.5, 24.5] as LookOptions['focus'] };

test('tiled lighting draws the pool of 12 as the pool draws it alone: no light lost to the tiles', async ({
  page,
  harness,
}) => {
  const text = readFileSync(join(import.meta.dirname, '../..', HALL.file), 'utf8');
  type LightsPage = { show(text: string, file: string): Promise<unknown>; look(o: LookOptions): Promise<unknown> };
  const frame = async (off: string[]) => {
    const features = off.length ? `?gfx.featuresOff=${encodeURIComponent(JSON.stringify(off))}` : '';
    await page.goto(`tests/pages/lights.html${features}`);
    await harness.ready();
    await harness.assertWebGPU();
    await page.evaluate(
      async ([t, file, focus]) => {
        const lights = (window as unknown as { __lightsPage: LightsPage }).__lightsPage;
        await lights.show(t as string, file as string);
        await lights.look({ focus: focus as LookOptions['focus'], camera: 'cam=iso', quality: 'high', time: 0 });
      },
      [text, HALL.file, HALL.focus] as const,
    );
    return Buffer.from((await harness.readFrame()).rgba);
  };
  const tiled = await frame([]);
  expect(harness.advice()).toEqual([]);
  const pooled = await frame(['feature:tiledLighting']);
  const share = changed(tiled, pooled);
  console.log(`tiled against untiled, the pool of 12: share of pixels changed ${share}`);
  expect(share).toBeLessThan(0.005);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_NO_TILED_LIGHTING']);
});
