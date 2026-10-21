/**
 * @file T2 for the level meshes (PLAN.md WP 2.4) on the level-meshes page (tests/pages/level-meshes.html): the room
 * fixture (fixtures/levels/room.txt), compiled and drawn in the page with the engine's materials, one shadow-casting
 * light and nothing else in the scene, renders in 20 draw calls or fewer as r182 counts them (13: the floor, and the
 * walls, low wall and pillar in two groups each, again into the shadow map for those that cast; the frame adds the
 * renderer's output pass, which the empty scene draws too), the count the meshes give themselves; the warm-up builds every pipeline, so the frames after it build none; every level mesh shows in
 * the ID pass; and the frame is not blank. The 64 × 44 hall fixture then draws in the same 13 calls: instancing keeps
 * the cost flat however many pieces a level has. The storey house (fixtures/levels/storeys/house.txt, WP 13.14) draws
 * its walls, slabs, roof and openings as parts the ID pass tells apart (outside: the roof, the walls, the frames and
 * the heads; storey by storey with what stands above hidden: its floor, walls, railings and flight; from the cellar:
 * the ground floor's ceiling), builds 0 pipelines after the warm-up, in the lambert style and in the toon style both
 * playground looks draw with.
 *
 * Invariants: the level's text is read in Node and passed to the page (`__levelPage.show`), which fetches nothing;
 * frames are drawn by calling the page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { FrameView, Gfx } from '../../engine/gfx/renderer';
import type { ShotOptions, ShotResult } from '../../engine/gfx/shot';
import type { Shown } from '../pages/level-meshes';
import { expect, test } from './fixtures';

/** What the page publishes as `window.__levelPage` (tests/pages/level-meshes.ts), as far as this suite uses it. */
interface LevelPage {
  gfx: Gfx;
  view: FrameView;
  show(text: string, file: string): Promise<Shown>;
  settle(): Promise<{ drawn: boolean; built: number }>;
  style(style: string): Promise<{ drawn: boolean; built: number }>;
  meshes: { parts: { name: string; storey?: number; mesh: { visible: boolean } }[] };
  camera: { position: { set(x: number, y: number, z: number): void }; lookAt(x: number, y: number, z: number): void };
}
type LevelWindow = { __levelPage: LevelPage };
type ShotModule = { shot(gfx: Gfx, view: FrameView, options?: ShotOptions): Promise<ShotResult> };

const PAGE = 'tests/pages/level-meshes.html';
const SHOT = '/engine/gfx/shot.ts';
const ROOT = join(import.meta.dirname, '..', '..');
/** The budget of WP 2.4's Done-when. */
const BUDGET = 20;

/** Shows fixture `name` in the page and reports what it cost. */
function show(page: Page, name: string): Promise<Shown> {
  const file = `fixtures/levels/${name}.txt`;
  const text = readFileSync(join(ROOT, file), 'utf8');
  return page.evaluate(([text, file]) => (window as unknown as LevelWindow).__levelPage.show(text, file), [text, file]);
}

test("the room fixture's level meshes render in 20 draw calls or fewer, each in the ID pass, building 0 pipelines after the warm-up", async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  const room = await show(page, 'room');
  expect(room.names).toEqual(['level:room/floor', 'level:room/lowWall', 'level:room/pillar', 'level:room/wall']);
  expect(room.frame, 'the warm-up built every pipeline the level needs').toMatchObject({ drawn: true, built: 0 });
  expect(room.pipelinesAfterWarmUp).toBe(0);
  // r182 counts the frame's draw calls: the level's, and the renderer's own output pass, drawn without a level too.
  expect(room.empty).toBe(1);
  expect(room.drawCalls - room.empty, "r182's count of the level's draw calls is the meshes' own").toBe(room.counted);
  expect(room.counted).toBe(13);
  expect(room.drawCalls - room.empty).toBeLessThanOrEqual(BUDGET);
  expect((await harness.readFrame()).blank).toBe(false);

  // Every level mesh covers pixels in the ID pass.
  const ids = await page.evaluate(async (url) => {
    const { shot } = (await import(url)) as ShotModule;
    const { gfx, view } = (window as unknown as LevelWindow).__levelPage;
    const result = await shot(gfx, view, { metrics: false, thumbnail: false });
    return result.ids!;
  }, SHOT);
  const seen = new Map(ids.visible.map((entry) => [entry.name, entry.px]));
  for (const name of room.names) expect(seen.get(name) ?? 0, `${name} in the ID pass`).toBeGreaterThan(200);
  expect(ids.unseen).toEqual([]);

  // Later frames draw the same and build nothing.
  const again = await page.evaluate(() => (window as unknown as LevelWindow).__levelPage.settle());
  expect(again).toMatchObject({ drawn: true, built: 0 });
});

test('the 64 × 44 hall draws in the same 13 calls: instancing keeps the cost flat', async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
  const hall = await show(page, 'hall-v1');
  expect(hall.frame).toMatchObject({ drawn: true, built: 0 });
  expect(hall.pipelinesAfterWarmUp).toBe(0);
  expect([hall.drawCalls - hall.empty, hall.counted]).toEqual([13, 13]);
  expect((await harness.readFrame()).blank).toBe(false);
});

/** The ID pass's pixels by part, the level's name dropped: `{ 'attic/roof': 4210, … }`. */
async function idPixels(page: Page): Promise<Record<string, number>> {
  const ids = await page.evaluate(async (url) => {
    const { shot } = (await import(url)) as ShotModule;
    const { gfx, view } = (window as unknown as LevelWindow).__levelPage;
    return (await shot(gfx, view, { metrics: false, thumbnail: false })).ids!;
  }, SHOT);
  return Object.fromEntries(ids.visible.map((entry) => [entry.name.replace(/^level:house\//, ''), entry.px]));
}

/** Shows only storey `k` and those below (the roof hidden past the top one), the camera at `eye` looking at `at`. */
function look(page: Page, k: number, eye: [number, number, number], at: [number, number, number]) {
  return page.evaluate(
    ([k, eye, at]) => {
      const level = (window as unknown as LevelWindow).__levelPage;
      for (const part of level.meshes.parts) part.mesh.visible = (part.storey ?? 0) <= k && !(k < 3 && part.name.endsWith('/roof')); // prettier-ignore
      level.camera.position.set(...eye);
      level.camera.lookAt(...at);
      return level.settle();
    },
    [k, eye, at] as const,
  );
}

test('the storey house: walls, slabs, roof and openings apart in the ID pass, storey by storey, 0 pipelines after the warm-up in two styles', async ({
  page,
  harness,
}) => {
  // prettier-ignore
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();
  const house = await show(page, 'storeys/house');
  expect(house.frame, 'the warm-up built every pipeline the house needs').toMatchObject({ drawn: true, built: 0 });
  expect(house.pipelinesAfterWarmUp).toBe(0);
  expect(house.drawCalls - house.empty).toBe(house.counted);
  expect(house.counted).toBeLessThanOrEqual(BUDGET * 4);

  const outside = await idPixels(page);
  for (const part of ['attic/roof', 'ground/wall#2', 'upper/wall#2', 'ground/frames', 'upper/frames', 'upper/heads']) {
    expect(outside[part] ?? 0, `${part} from outside`).toBeGreaterThan(30);
  }
  expect(await look(page, 1, [4, 9, 6.5], [4, 0, 3])).toMatchObject({ drawn: true, built: 0 });
  const ground = await idPixels(page);
  for (const part of [
    'ground/floor',
    'ground/floor',
    'ground/flight',
    'ground/railing',
    'ground/wall#2',
    'ground/heads',
  ]) {
    expect(ground[part] ?? 0, `${part}, the upper floor and the roof hidden`).toBeGreaterThan(30);
  }
  expect(await look(page, 2, [4, 12, 6.5], [4, 3, 3])).toMatchObject({ drawn: true, built: 0 });
  const upper = await idPixels(page);
  for (const part of ['upper/floor', 'upper/railing', 'upper/wall#2'])
    expect(upper[part] ?? 0, part).toBeGreaterThan(30);
  expect(await look(page, 3, [4, -2.4, 3.6], [4, 0, 2.5])).toMatchObject({ drawn: true, built: 0 }); // in the cellar
  expect((await idPixels(page))['ground/ceiling'] ?? 0, "the ground floor's slab, seen from the cellar").toBeGreaterThan(200); // prettier-ignore

  const toon = await page.evaluate(() => (window as unknown as LevelWindow).__levelPage.style('toon'));
  expect(toon, 'every style warmed up: the toon frame builds nothing').toMatchObject({ drawn: true, built: 0 });
  expect((await harness.readFrame()).blank).toBe(false);
});
