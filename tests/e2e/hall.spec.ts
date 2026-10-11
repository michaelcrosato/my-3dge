/**
 * @file T2 for the hall's level meshes and its cutaway (PLAN.md WP 4.4) on the hall page (tests/pages/hall.html): the
 * hall (labs/box/levels/hall.txt), compiled and drawn in the page with the engine's materials, one shadow-casting
 * light and its cutaway, renders within its draw-call budget as r182 counts it (`BUDGET`: its 24 level calls with
 * one shadow map, tests/baselines/qa-geo-hall.json, and the twins' 8 at most), the count the meshes and twins give
 * themselves; every level mesh and every twin holding pieces shows in the ID pass; and turning the camera, round the
 * whole hall in 45° steps (orthographic and perspective) and with the engine's views and an orbit following the hero,
 * builds 0 pipelines after the warm-up while the cutaway cuts the walls toward the camera and stumps the pillars in
 * front of the hero.
 *
 * Invariants: the level's text is read in Node and passed to the page (`__hallPage.show`), which fetches nothing;
 * frames are drawn by calling the page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { FrameView, Gfx } from '../../engine/gfx/renderer';
import type { ShotOptions, ShotResult } from '../../engine/gfx/shot';
import type { Looked, Overview, Shown } from '../pages/hall';
import { expect, test } from './fixtures';

/** What the page publishes as `window.__hallPage` (tests/pages/hall.ts), as far as this suite uses it. */
interface HallPage {
  gfx: Gfx;
  view: FrameView;
  show(text: string, file: string, first: Overview, focus: number[]): Promise<Shown>;
  look(camera: string | Overview, focus: number[]): Promise<Looked>;
}
type HallWindow = { __hallPage: HallPage };
type ShotModule = { shot(gfx: Gfx, view: FrameView, options?: ShotOptions): Promise<ShotResult> };

const PAGE = 'tests/pages/hall.html';
const SHOT = '/engine/gfx/shot.ts';
const FILE = 'labs/box/levels/hall.txt';
const ROOT = join(import.meta.dirname, '..', '..');
/** The hall's draw calls with one shadow map: its 24 level calls (tests/baselines/qa-geo-hall.json) and 8 for the twins. */
const BUDGET = 32;
/** The hero's spawn on the dais (engine/world/level: spawn:hero), what the cameras follow and the cutaway keeps in view. */
const HERO = [32.5, 0.5, 24.5];
const NAMES = ['brazier', 'dais', 'floor', 'gallery', 'lowWall', 'pillar', 'stairs', 'wall'].map(
  (r) => `level:hall/${r}`,
);
const TWINS = ['level:hall/pillar:cut', 'level:hall/wall:cut'];

/** Shows the hall in the page through the overview `first`. */
function show(page: Page, first: Overview): Promise<Shown> {
  const text = readFileSync(join(ROOT, FILE), 'utf8');
  return page.evaluate(
    ([text, file, first, focus]) => (window as unknown as HallWindow).__hallPage.show(text, file, first, focus),
    [text, FILE, first, HERO] as const,
  );
}

/** Draws a frame through `camera` and reports it. */
function look(page: Page, camera: string | Overview): Promise<Looked> {
  return page.evaluate(([camera, focus]) => (window as unknown as HallWindow).__hallPage.look(camera, focus), [
    camera,
    HERO,
  ] as const);
}

/** How many pieces of part `name` the frame's cutaway cut. */
const cutOf = (looked: Looked, name: string) => looked.cut.find((part) => part.name === name)!.cut;

test('the hall renders within its draw-call budget, every mesh and twin in the ID pass, building 0 pipelines after the warm-up', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  const hall = await show(page, { azimuth: 45, elevation: 30, projection: 'orthographic' });
  expect(hall.names).toEqual(NAMES);
  expect(hall.twins).toEqual(TWINS);
  expect(hall.frame, 'the warm-up built every pipeline the hall needs').toMatchObject({ drawn: true, built: 0 });
  expect(hall.pipelinesAfterWarmUp).toBe(0);
  expect(hall.empty).toBe(1);
  // The whole hall is in view, so r182 draws every mesh: its count is the meshes' and twins' own.
  expect(hall.drawCalls, "r182's count of the hall's draw calls is the meshes' own").toBe(hall.counted);
  expect(hall.counted).toBe(BUDGET);
  // From the south-east the south and east walls are cut, and the pillars before the hero are stumps.
  expect(cutOf(hall, 'level:hall/wall')).toBe(105);
  expect(cutOf(hall, 'level:hall/pillar')).toBeGreaterThan(0);
  expect((await harness.readFrame()).blank).toBe(false);

  const ids = await page.evaluate(async (url) => {
    const { shot } = (await import(url)) as ShotModule;
    const { gfx, view } = (window as unknown as HallWindow).__hallPage;
    const result = await shot(gfx, view, { metrics: false, thumbnail: false });
    return result.ids!;
  }, SHOT);
  const seen = new Map(ids.visible.map((entry) => [entry.name, entry.px]));
  for (const name of [...NAMES, ...TWINS]) expect(seen.get(name) ?? 0, `${name} in the ID pass`).toBeGreaterThan(20);
  expect(ids.unseen).toEqual([]);
});

test('turning the camera round the hall builds 0 pipelines, the cutaway following it, within the budget', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  await show(page, { azimuth: 45, elevation: 30, projection: 'orthographic' });

  // Round the whole hall in 45° steps, orthographic and perspective: everything in view, the cut walls turning.
  const walls: Record<string, number> = {};
  for (const projection of ['orthographic', 'perspective'] as const) {
    for (let azimuth = 0; azimuth < 360; azimuth += 45) {
      const looked = await look(page, { azimuth, elevation: 30, projection });
      const at = `${projection} ${azimuth}°`;
      expect(looked.frame, at).toMatchObject({ drawn: true, built: 0 });
      expect(looked.pipelinesAfterWarmUp, at).toBe(0);
      expect(looked.drawCalls, at).toBe(looked.counted);
      expect(looked.drawCalls, at).toBeLessThanOrEqual(BUDGET);
      walls[at] = cutOf(looked, 'level:hall/wall');
    }
  }
  // Square on to a side (0°: from the south) its wall and the corners at its ends are cut, 64 tiles; at 45° the two
  // sides between the corners that face across the view, 105; from the east, 44.
  expect([walls['orthographic 0°'], walls['orthographic 45°'], walls['orthographic 90°']]).toEqual([64, 105, 44]);
  expect(Object.values(walls).every((cut) => cut > 0)).toBe(true);
  // From straight above the camera sees over every wall: none is cut.
  const above = await look(page, { azimuth: 0, elevation: 89, projection: 'orthographic' });
  expect([above.frame.built, cutOf(above, 'level:hall/wall')]).toEqual([0, 0]);

  // The engine's cameras following the hero: the views turned in 45° steps, and an orbit round him.
  for (let turn = 0; turn < 360; turn += 45) {
    for (const code of [`cam=iso,${turn},1`, `cam=threequarter,${turn},1`, `cam3=orbit,${turn},25,10`]) {
      const looked = await look(page, code);
      expect(looked.frame, code).toMatchObject({ drawn: true, built: 0 });
      expect(looked.pipelinesAfterWarmUp, code).toBe(0);
      // Meshes out of view are culled: the frame costs at most what the meshes count.
      expect(looked.drawCalls, code).toBeLessThanOrEqual(Math.min(looked.counted, BUDGET));
      if (!code.startsWith('cam3')) expect(cutOf(looked, 'level:hall/wall'), code).toBeGreaterThan(0);
    }
  }
  expect((await harness.readFrame()).blank).toBe(false);
});
