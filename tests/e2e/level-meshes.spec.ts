/**
 * @file T2 for the level meshes (PLAN.md WP 2.4) on the level-meshes page (tests/pages/level-meshes.html): the room
 * fixture (fixtures/levels/room.txt), compiled and drawn in the page with the engine's materials, one shadow-casting
 * light and nothing else in the scene, renders in 20 draw calls or fewer as r182 counts them (13: the floor, and the
 * walls, low wall and pillar in two groups each, again into the shadow map for those that cast; the frame adds the
 * renderer's output pass, which the empty scene draws too), the count the meshes give themselves; the warm-up builds every pipeline, so the frames after it build none; every level mesh shows in
 * the ID pass; and the frame is not blank. The 64 × 44 hall fixture then draws in the same 13 calls: instancing keeps
 * the cost flat however many pieces a level has.
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
