/**
 * @file T2 for the instancing service (PLAN.md WP 3.8, Done-when 1 and 2) on the instancing page
 * (tests/pages/instancing.html): a 2,000-instance batch on two pages of 1,024 slots, seen from above so each instance
 * covers exactly 36 pixels of a 400 × 320 shot. The ID pass's counts follow the moved instances: each page covers 36
 * pixels per instance in view, the counts drop by 36 for each instance moved out of view, its box shrinks to the
 * rows still there, and both come back when the instances return; each instance has an ID colour of its own, so each
 * page counts the instances it shows (after G9, gate G2's note). No shader is built per page: growing the batch to
 * five pages after the warm-up builds no pipeline (the device's counter, engine/gfx/pipelines.ts), the later pages
 * show their instance colours and per-instance tints (set before their first render: magenta times yellow draws red,
 * which neither factor alone gives), while a plain InstancedMesh of 1,000 slots or fewer builds pipelines of its own
 * each time, and one above 1,000 does not once the path is built.
 *
 * Invariants: frames are drawn by calling the page; the pipeline counts are the device's (every pipeline the GPU
 * built); the controls' GFX_COLD_PIPELINE advice is read, and is the only advice.
 */
import type { Page } from '@playwright/test';
import type { IdEntry } from '../../engine/gfx/idpass';
import type { Placed } from '../pages/instancing';
import { expect, test } from './fixtures';

/** What the page publishes as `window.__instancingPage` (tests/pages/instancing.ts), as far as this suite uses it. */
interface InstancingPage {
  place(spec: { count: number; away?: [number, number] }): Promise<Placed>;
  ids(points?: [number, number][]): Promise<{ visible: IdEntry[]; colours: number[][] }>;
  control(slots: number): Promise<number>;
}
type InstancingWindow = { __instancingPage: InstancingPage };

const PAGE = 'tests/pages/instancing.html';
/** Pixels per instance in view: its 6 × 6 top face. */
const PX = 36;

/** Places instances in the page. */
const place = (page: Page, spec: { count: number; away?: [number, number] }) =>
  page.evaluate((spec) => (window as unknown as InstancingWindow).__instancingPage.place(spec), spec);

/** The ID pass's entries by name, and the colours at `points`. */
async function ids(page: Page, points: [number, number][] = []) {
  const shot = await page.evaluate(
    (points) => (window as unknown as InstancingWindow).__instancingPage.ids(points),
    points,
  );
  return { byName: new Map(shot.visible.map((entry) => [entry.name, entry])), colours: shot.colours };
}

test('a 2,000-instance batch updates: the ID-pass counts follow the moved instances', async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  const all = await place(page, { count: 2000 });
  expect(all.pages).toEqual([
    { name: 'crowd/page0', count: 1024 },
    { name: 'crowd/page1', count: 976 },
  ]);
  expect(all.frame).toMatchObject({ drawn: true, built: 0 });
  let seen = await ids(page);
  expect(seen.byName.get('crowd/page0')).toMatchObject({ px: 1024 * PX, bbox: [1, 1, 398, 166] });
  expect(seen.byName.get('crowd/page1')).toMatchObject({ px: 976 * PX, bbox: [1, 161, 398, 318] });
  // each instance in its own ID colour (after G9): the pages count the instances they show
  expect([seen.byName.get('crowd/page0')?.instances, seen.byName.get('crowd/page1')?.instances]).toEqual([1024, 976]);

  // The first 500 slots (rows 0–9, page 0) leave the view: page 0 loses 500 × 36 pixels and its top 10 rows.
  const moved = await place(page, { count: 2000, away: [0, 500] });
  expect(moved.uploadedPages, 'only the page that changed uploads').toBe(1);
  seen = await ids(page);
  expect(seen.byName.get('crowd/page0')).toMatchObject({ px: 524 * PX, bbox: [1, 81, 398, 166], instances: 524 });
  expect(seen.byName.get('crowd/page1')?.px).toBe(976 * PX);

  // The last 500 slots (page 1's) leave instead: page 0 is whole again, page 1 keeps 476 instances. The frame drawn
  // right after the move shows it (no frame of lag): the last cell is empty, the first one filled.
  await place(page, { count: 2000, away: [1500, 2000] });
  const frame = await harness.readFrame();
  const at = (x: number, y: number) =>
    frame.pixel(Math.floor((x / 400) * frame.width), Math.floor((y / 320) * frame.height)).slice(0, 3);
  expect([at(396, 316), at(4, 4)]).toEqual([
    [0, 0, 0],
    [255, 255, 255],
  ]);
  seen = await ids(page);
  expect(seen.byName.get('crowd/page0')?.px).toBe(1024 * PX);
  expect(seen.byName.get('crowd/page1')).toMatchObject({ px: 476 * PX, bbox: [1, 161, 398, 238], instances: 476 });

  // Fewer instances: page 1 empties and leaves the ID pass; all back: both pages as at first.
  await place(page, { count: 1000 });
  seen = await ids(page);
  expect([seen.byName.get('crowd/page0')?.px, seen.byName.has('crowd/page1')]).toEqual([1000 * PX, false]);
  await place(page, { count: 2000 });
  seen = await ids(page);
  expect([seen.byName.get('crowd/page0')?.px, seen.byName.get('crowd/page1')?.px]).toEqual([1024 * PX, 976 * PX]);
});

test('no shader is built per page: five pages build no pipeline after the warm-up, and show their colours', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();

  const two = await place(page, { count: 2000 });
  expect(two.frame.built, 'the second page builds nothing').toBe(0);
  const five = await place(page, { count: 5000 });
  expect(five.pages.map((entry) => entry.count)).toEqual([1024, 1024, 1024, 1024, 904]);
  expect(five.frame.built, 'three more pages build nothing').toBe(0);
  expect(five.built).toBe(two.built);
  expect(five.pipelinesAfterWarmUp).toBe(0);
  expect(five.drawCalls - two.drawCalls, "r182's count: one draw call per page").toBe(3);
  expect(five.counted).toBe(5);

  // Slots 4,000 and 4,999 (pages 3 and 4, made after the first frame) lie on top: a magenta colour times a yellow
  // tint. Red needs both: a colour that never uploaded (the page's white) would draw yellow, a tint that never
  // uploaded (zero) black.
  const { colours, byName } = await ids(page, [
    [4, 4],
    [396, 156],
    [0, 0],
  ]);
  expect(colours, 'red (colour and tint both shown) where the later pages lie; the gaps between cells empty').toEqual([
    [255, 0, 0],
    [255, 0, 0],
    [0, 0, 0],
  ]);
  expect(byName.get('crowd/page4')?.px).toBe(904 * PX);

  // The controls: r182 compiles a shader for each instanced mesh of 1,000 slots or fewer, not above.
  const controls = [];
  for (const slots of [500, 600, 1100, 1500]) {
    controls.push(
      await page.evaluate((n) => (window as unknown as InstancingWindow).__instancingPage.control(n), slots),
    );
  }
  expect(controls[0], '500 slots: its own shader').toBeGreaterThan(0);
  expect(controls[1], '600 slots: another shader of its own').toBeGreaterThan(0);
  expect(controls[3], '1,500 slots: the attribute path 1,100 built').toBe(0);
  expect(new Set(harness.advice().map((advice) => advice.code))).toEqual(new Set(['GFX_COLD_PIPELINE']));
});
