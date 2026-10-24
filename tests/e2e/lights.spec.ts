/**
 * @file T2 for lights, shadows, atmosphere and sky (PLAN.md WP 7.1) on the lights page (tests/pages/lights.html): the
 * hall (labs/box/levels/hall.txt) under `sky:hall`, its 30 torch spots lighting a pool of 12 point lights.
 * - Moving the focus across the hall, west to east and north to south, through an orthographic and a perspective
 *   camera, reassigns the pool's lights (the shadow casters always on the two torches nearest the focus, as Node
 *   ranks them) and builds 0 pipelines after the warm-up, the scene's lights never changing; each quality tier
 *   (2, 1, then 0 casters) warms up once and then walks at 0 pipelines too.
 * - Every sky preset renders: drawn after its warm-up with 0 pipelines built, neither blank, dark nor blown out; the
 *   hall's vault stays dark above its walls, and the daylight dome shows blue above its backdrop.
 * - Switching presets while a replay steps, frames drawn as it goes and the flicker drawn from the world's visual
 *   stream, never changes the hash: the kernel replay gives its goldens.
 * - The playground's block by the hour (WP 13.23: the scene's clock, engine/sim/lights.ts, and the sky it shows,
 *   engine/gfx/daylight.ts), from the street at noon, dusk and night in both its looks: neither blank, dark nor blown
 *   out, night darker than dusk and dusk than noon, building nothing as the hours pass (a shot in each look first, to
 *   build the shot's own passes); the street's four lamps shine in the light pool at dusk and night and not at noon,
 *   the moon casts at night through its cascades and the nearest lamp casts too; and its group switched off by hand
 *   (the scene's dev action `lights`) puts them out.
 *
 * Invariants: the level's and replay's text are read in Node and passed to the lights page, which fetches nothing;
 * goldens come from the replay file, never from this run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createRegistry } from '../../engine/core/registry';
import { lightSources, rankSources } from '../../engine/gfx/lights';
import { judgeLook, LOOK_LIMITS, lookMetrics } from '../../engine/gfx/lookMetrics';
import { defineSkies } from '../../engine/gfx/sky';
import type { Replay } from '../../engine/sim/replay';
import { compileLevel } from '../../engine/world/level/compile';
import type { HashRunOptions, LookOptions, Looked } from '../pages/lights';
import { expect, test, type Harness } from './fixtures';

/** The page's engine, inside `evaluate` (the playground's page). */
declare const __engine: Record<string, (...args: unknown[]) => unknown> & {
  scene: { dump(o: object): string };
  actions: { run(name: string, args?: unknown): unknown };
};

/** What the page publishes as `window.__lightsPage` (tests/pages/lights.ts), as far as this suite uses it. */
interface LightsPage {
  show(text: string, file: string): Promise<{ lights: string[]; sources: number }>;
  look(options: LookOptions): Promise<Looked>;
  hashRun(text: string, options: HashRunOptions): Promise<Record<string, string>>;
}
type LightsWindow = { __lightsPage: LightsPage };

const ROOT = join(import.meta.dirname, '..', '..');
const FILE = 'labs/box/levels/hall.txt';
const TEXT = readFileSync(join(ROOT, FILE), 'utf8');
const HALL = compileLevel(TEXT, { file: FILE });
const SOURCES = lightSources(HALL);
const REPLAY = readFileSync(join(ROOT, 'tests/replays/kernel-movers.replay.json'), 'utf8');
/** The hero's spawn on the dais, where the cameras look first. */
const DAIS = [32.5, 0.5, 24.5] as const;

/** Opens the page and shows the hall under `sky:hall`. */
async function open(page: Page, harness: Harness, query = '') {
  await page.goto(`tests/pages/lights.html${query}`);
  await harness.ready();
  await harness.assertWebGPU();
  return page.evaluate(([text, file]) => (window as unknown as LightsWindow).__lightsPage.show(text, file), [
    TEXT,
    FILE,
  ] as const);
}

/** Draws a frame through the page; see `LookOptions`. */
function look(page: Page, options: LookOptions): Promise<Looked> {
  return page.evaluate((options) => (window as unknown as LightsWindow).__lightsPage.look(options), options);
}

/** The focus points of a walk across the hall: west to east along z = 22, then north to south along x = 32. */
const WALK: [number, number, number][] = [
  ...Array.from({ length: 15 }, (_, i) => [4 + 4 * i, 0.5, 22] as [number, number, number]),
  ...Array.from({ length: 10 }, (_, i) => [32, 0.5, 3 + 4 * i] as [number, number, number]),
];

test('moving the focus across the hall reassigns lights with 0 pipelines built', async ({ page, harness }) => {
  test.setTimeout(240_000);
  const shown = await open(page, harness);
  expect(shown.sources).toBe(30);
  // The pool (12), the ambient light and the sun, in id order; the first two of the pool cast shadows.
  expect(shown.lights).toHaveLength(14);
  expect(shown.lights.filter((key) => key.endsWith('s'))).toEqual(shown.lights.slice(0, 2));

  for (const [quality, casters] of [
    ['high', 2],
    ['medium', 1],
    ['low', 0],
  ] as const) {
    const first = await look(page, { focus: WALK[0], quality, camera: 'cam=iso' });
    const { warmUps, lights } = first;
    expect(
      lights.filter((key) => key.endsWith('s')),
      quality,
    ).toHaveLength(casters);
    const seen = new Set<number>();
    let changes = 0;
    let last = '';
    for (const camera of ['cam=iso', 'cam3=orbit,30,25,12']) {
      for (const [i, focus] of WALK.entries()) {
        const looked = await look(page, { focus, camera, time: i / 10 });
        const at = `${quality} ${camera} at ${focus.join(',')}`;
        expect(looked.frame, at).toMatchObject({ drawn: true, built: 0 });
        expect(looked.pipelinesAfterWarmUp, at).toBe(0);
        expect([looked.warmUps, looked.lights], at).toEqual([warmUps, lights]);
        const slots = looked.sky.slots;
        // The first slots hold the torches that matter most, as Node ranks them, the casters among them.
        expect(
          slots.slice(0, 2).map((slot) => slot.source),
          at,
        ).toEqual(rankSources(SOURCES, focus, 2).order);
        expect(slots.map((slot) => slot.castShadow).filter(Boolean), at).toHaveLength(casters);
        slots.forEach((slot) => seen.add(slot.source));
        const now = slots.map((slot) => slot.source).join(',');
        if (now !== last) changes++;
        last = now;
      }
    }
    expect(seen.size, quality).toBe(30);
    expect(changes, quality).toBeGreaterThan(20);
  }
  expect((await harness.readFrame()).blank).toBe(false);
});

test('every sky preset renders, built before it draws, neither blank, dark nor blown out', async ({
  page,
  harness,
}) => {
  test.setTimeout(240_000);
  await open(page, harness);
  const registry = createRegistry();
  defineSkies(registry);
  const presets = registry.list('sky').map((entry) => entry.id);
  expect(presets).toEqual(['sky:daylight', 'sky:hall']);
  const tops: Record<string, number[]> = {};
  for (const preset of presets) {
    for (const camera of ['cam=iso', 'cam3=orbit,180,8,14']) {
      const looked = await look(page, { focus: [...DAIS], preset, camera, time: 1 });
      const at = `${preset} ${camera}`;
      expect(looked.sky.preset, at).toBe(preset);
      expect(looked.frame, at).toMatchObject({ drawn: true, built: 0 });
      expect(looked.pipelinesAfterWarmUp, at).toBe(0);
      const frame = await harness.readFrame();
      const metrics = lookMetrics(frame.rgba, frame.width, frame.height);
      const notes = judgeLook(metrics, at).map((note) => note.id);
      expect(notes, at).not.toContain('LOOK_BLANK');
      expect(metrics.dark, at).toBeLessThan(LOOK_LIMITS.dark);
      expect(metrics.blown, at).toBeLessThan(LOOK_LIMITS.blown);
      if (camera.startsWith('cam3')) {
        // The top tenth of the frame, above the hall's walls: the mean colour there.
        const sum = [0, 0, 0];
        let count = 0;
        for (let y = 0; y < frame.height / 10; y++) {
          for (let x = 0; x < frame.width; x += 2) {
            frame
              .pixel(x, y)
              .slice(0, 3)
              .forEach((v, i) => (sum[i] += v));
            count++;
          }
        }
        tops[preset] = sum.map((v) => Math.round(v / count));
      }
    }
  }
  // Above the walls: the hall's dark vault, the daylight dome's blue.
  expect(Math.max(...tops['sky:hall'])).toBeLessThan(20);
  const [r, g, b] = tops['sky:daylight'];
  expect(b).toBeGreaterThan(r + 40);
  expect(g).toBeGreaterThan(r);
});

test('switching presets while a replay steps never changes the hash', async ({ page, harness }) => {
  test.setTimeout(240_000);
  await open(page, harness);
  const options: HashRunOptions = { presets: ['sky:daylight', 'sky:hall'], every: 120, draw: 30 };
  const hashes = await page.evaluate(
    ([text, options]) => (window as unknown as LightsWindow).__lightsPage.hashRun(text, options),
    [REPLAY, options] as const,
  );
  expect(hashes).toEqual((JSON.parse(REPLAY) as Replay).hashes['linux-x64']);
});

/** The playground's street (WP 13.23), its four streetlights' heads (where their lamps shine), its looks and hours. */
const STREET = 'labs/playground/?scene=site-street&cam=iso';
const STREET_LAMPS = [45, 59, 73, 87].map((x) => [x, 4.35, 85.3] as const);
const PLAYGROUND_LOOKS = ['look:playground-cel', 'look:playground-pixel'];
const HOURS = { noon: 12, dusk: 18.75, night: 22 } as const;

/** The pool's lights the page's dump shows shining at a streetlight's head, and the dump's casting lines. */
async function streetLamps(page: Page): Promise<{ shining: number; casting: string[] }> {
  const lines = (await page.evaluate(() => __engine.scene.dump({ filter: 'lights:pool/' }) + '\n' + __engine.scene.dump({ filter: 'sky/sun' }))).split('\n'); // prettier-ignore
  const shining = lines.filter((line) => {
    const m = / at (-?[\d.]+),(-?[\d.]+),(-?[\d.]+) lit ([\d.]+)/.exec(line);
    return m && Number(m[4]) > 0 && STREET_LAMPS.some(([x, y, z]) => Math.hypot(Number(m[1]) - x, Number(m[2]) - y, Number(m[3]) - z) < 0.05); // prettier-ignore
  }).length;
  return { shining, casting: lines.filter((line) => / shadow/.test(line)).map((line) => line.trim().split(' ')[0]) };
}

test("the block by the hour: noon, dusk and night in both looks, the street's lamps lit after dusk", async ({
  page,
  harness,
}) => {
  test.setTimeout(900_000);
  await page.goto(`${STREET}&post.look=${PLAYGROUND_LOOKS[0]}`);
  await harness.ready({ timeout: 600_000 });
  await harness.assertWebGPU();
  const metrics: Record<string, { lumaMean: number; dark: number; blown: number; notes: string[] }> = {};
  const lamps: Record<string, { shining: number; casting: string[] }> = {};
  const built = () => page.evaluate(() => (__engine.stats() as { pipelines: number }).pipelines);
  const shoot = (look: string) =>
    page.evaluate(async (l) => {
      __engine.set('post.look', l);
      await __engine.render(3);
      return __engine.shot({ metrics: true, ids: false, thumbnail: false });
    }, look) as Promise<{ metrics: Parameters<typeof judgeLook>[0] }>;
  for (const look of PLAYGROUND_LOOKS) await shoot(look); // a shot builds its own passes, once a look
  const before = await built();
  for (const [name, hour] of Object.entries(HOURS)) {
    await page.evaluate((h) => {
      __engine.pause();
      __engine.actions.run('daytime', { hour: h });
      __engine.step(1); // the clock's rule puts the lamps as the hour has them on the step after
    }, hour);
    for (const look of PLAYGROUND_LOOKS) {
      const shot = await shoot(look);
      const at = `${name} in ${look}`;
      metrics[at] = { ...shot.metrics, notes: judgeLook(shot.metrics, at).map((note) => note.id) };
    }
    lamps[name] = await streetLamps(page);
    expect([name, await built()]).toEqual([name, before]); // the hours and the looks build nothing
  }
  console.log(`the block by the hour: ${JSON.stringify({ metrics, lamps })}`);
  for (const [at, m] of Object.entries(metrics)) {
    expect(m.notes, at).not.toContain('LOOK_BLANK');
    expect(m.dark, at).toBeLessThan(LOOK_LIMITS.dark);
    expect(m.blown, at).toBeLessThan(LOOK_LIMITS.blown);
  }
  for (const look of PLAYGROUND_LOOKS) {
    const mean = (name: string) => metrics[`${name} in ${look}`].lumaMean;
    expect([look, mean('night') < mean('dusk'), mean('dusk') < mean('noon')]).toEqual([look, true, true]);
  }
  expect(Object.values(lamps).map((l) => l.shining)).toEqual([0, 4, 4]);
  expect(lamps.night.casting).toContain('sky/sun'); // the moon casts, through its cascades
  expect(lamps.night.casting.some((name) => name.startsWith('lights:pool/'))).toBe(true); // and the nearest lamp
  await page.evaluate(async () => {
    __engine.actions.run('lights', { group: 'street', on: false });
    await __engine.render(2);
  });
  expect((await streetLamps(page)).shining).toBe(0);
  const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
  expect(advice).not.toContain('GFX_COLD_PIPELINE');
  expect(harness.advice()).toEqual([]);
});
