/**
 * @file T2 for props as data (PLAN.md WP 4.5) on the props page (tests/pages/props.html): the engine's props, in a
 * yard on the engine's renderer and standing in Rapier, each render with ID-pass coverage above 0 (Done-when 2; the
 * library's nine, WP 10.3's, and the house's fittings, WP 13.16's, every part): the crate on its spawn point and the
 * brazier's fire on the level's stand, both placed by the level, the barrel, the pillar, the library and the fittings
 * from the page's data; the lights of the fire, the sconce, the lantern and the lamp. The frame builds no pipeline after the warm-up and costs what the meshes count. A
 * knocked crate's mesh follows its body (Done-when 3): at rest, in flight and after it lands, its batch's matrix is
 * its body's pose with the base half a crate below, and the ID pass sees it where the body's centre projects, more
 * than 0.25 m and many pixels from where it stood.
 *
 * Invariants: frames are drawn by calling the page; draw calls are the renderer's (`renderer.info`), pipelines the
 * device's (engine/gfx/pipelines.ts); no advice is raised.
 */
import type { Page } from '@playwright/test';
import { FITTING_PROPS } from '../../engine/world/props/fittings';
import { LIBRARY_PROPS } from '../../engine/world/props/library';
import type { Knocked, Shown } from '../pages/props';
import { expect, test } from './fixtures';

/** What the page publishes as `window.__propsPage` (tests/pages/props.ts), as far as this suite uses it. */
interface PropsPage {
  show(): Promise<Shown>;
  knock(ticks: number[]): Promise<Knocked[]>;
}
type PropsWindow = { __propsPage: PropsPage };

const PAGE = 'tests/pages/props.html';
/** The catalog's props' batches, as the ID pass names their first page. */
const BATCHES = ['prop:barrel/mesh', 'prop:brazier/flames', 'prop:crate/mesh', 'prop:pillar/mesh'].map(
  (name) => `${name}/page0`,
);
/** The library's (WP 10.3) and the fittings' (WP 13.16): a batch a part. */
const LIBRARY = Object.entries({ ...LIBRARY_PROPS, ...FITTING_PROPS }).flatMap(([id, spec]) => spec.parts.map((part) => `${id}/${part.name}/page0`)); // prettier-ignore

/** Calls `show` on the page. */
const show = (page: Page) => page.evaluate(() => (window as unknown as PropsWindow).__propsPage.show());

test('every prop renders with ID-pass coverage above 0, placed by the level or the scene, building no pipeline', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  const shown = await show(page);
  expect(shown.frame, 'the warm-up built every pipeline the props need').toMatchObject({ drawn: true, built: 0 });
  expect(shown.pipelinesAfterWarmUp).toBe(0);
  expect(shown.drawCalls, "r182's count is the level's and the props' own").toBe(shown.counted);
  // The crate on the spawn point the page's glyph marks, the fire on the brazier stand's top; then the page's own.
  expect(shown.placements.slice(0, 4)).toEqual([
    { prop: 'prop:crate', at: [3.5, 0, 2.5], yaw: 0 },
    { prop: 'prop:brazier', at: [8.5, 0.75, 4.5], yaw: 0 },
    { prop: 'prop:barrel', at: [2.5, 0, 4.5], yaw: 0 },
    { prop: 'prop:pillar', at: [10, 0, 1.5], yaw: 0.3 },
  ]);
  const library = shown.placements.slice(4).map((place) => place.prop); // the page's order: the tall ones first
  expect(library).toEqual(['prop:door', 'prop:sconce', 'prop:statue', 'prop:banner', 'prop:table', 'prop:bench', 'prop:chest', 'prop:lantern', 'prop:chair', 'prop:pane', 'prop:switch', 'prop:lamp', 'prop:garageDoor']); // prettier-ignore
  expect([...library].sort()).toEqual([...Object.keys(LIBRARY_PROPS), ...Object.keys(FITTING_PROPS)].sort());
  const seen = new Map(shown.seen.map((entry) => [entry.name, entry.px]));
  expect(shown.unseen.filter((name) => name.startsWith('prop:'))).toEqual([]);
  expect([...seen.keys()].sort()).toEqual([...BATCHES, ...LIBRARY].sort());
  for (const name of BATCHES) expect(seen.get(name) ?? 0, `${name} in the ID pass`).toBeGreaterThan(50);
  for (const name of LIBRARY) expect(seen.get(name) ?? 0, `${name} in the ID pass`).toBeGreaterThan(0);
  // The fire's torch shines a metre up, where the level's light spot is, flickering about its 30; the sconce's from
  // its torch's head, the lantern's from inside its panes, where it settled; the lamp's from its bulb.
  expect(shown.lights.map((light) => [light.prop, light.tag])).toEqual([['prop:brazier', 'torch'], ['prop:sconce', 'sconce'], ['prop:lantern', 'lantern'], ['prop:lamp', 'lamp']]); // prettier-ignore
  expect(shown.lights[0]).toMatchObject({ prop: 'prop:brazier', tag: 'torch', position: [8.5, 1, 4.5] });
  expect(shown.lights[0].intensity).toBeGreaterThan(30 * 0.77);
  expect(shown.lights[0].intensity).toBeLessThan(30 * 1.03);
  expect(shown.lights[1].position.map((v) => +v.toFixed(3))).toEqual([4.6, 1.8, 1.225]);
  expect(shown.lights[2].position.map((v) => +v.toFixed(2))).toEqual([4.6, 0.13, 3.6]);
  expect(shown.lights[3].position.map((v) => +v.toFixed(3))).toEqual([5.5, 1.85, 2.4]); // the lamp's, at its bulb
  expect((await harness.readFrame()).blank).toBe(false);
});

test("a knocked crate's mesh follows its body: at rest, in flight and landed", async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
  await show(page);

  const ticks = [30, 40, 50, 150];
  const knocked = await page.evaluate((ticks) => (window as unknown as PropsWindow).__propsPage.knock(ticks), ticks);
  expect(knocked.map((at) => at.tick)).toEqual(ticks);
  for (const at of knocked) {
    const when = `tick ${at.tick}`;
    expect(at.frame, when).toMatchObject({ drawn: true, built: 0 });
    // Its mesh is where its body is: the batch's matrix is the body's pose, the base half a crate below the centre.
    at.matrix.forEach((value, i) => expect(value, `${when} matrix[${i}]`).toBeCloseTo(at.expected[i], 5));
    // And the ID pass sees it there: the body's centre projects inside what the crate covers, near its middle.
    const { crate, projected } = at;
    expect(crate, when).not.toBeNull();
    expect(crate!.px, when).toBeGreaterThan(200);
    const [x0, y0, x1, y1] = crate!.bbox;
    expect(projected[0], when).toBeGreaterThan(x0);
    expect(projected[0], when).toBeLessThan(x1);
    expect(projected[1], when).toBeGreaterThan(y0);
    expect(projected[1], when).toBeLessThan(y1);
    expect(Math.hypot(crate!.centre[0] - projected[0], crate!.centre[1] - projected[1]), when).toBeLessThan(8);
  }
  const [rest, flying, , landed] = knocked;
  // In flight it is up and turning; landed, it has slid more than 0.25 m east of where it stood.
  expect(flying.position[1]).toBeGreaterThan(rest.position[1] + 0.2);
  expect(Math.abs(flying.quaternion[3])).toBeLessThan(0.999);
  expect(landed.position[0] - rest.position[0]).toBeGreaterThan(0.25);
  expect(Math.hypot(landed.position[0] - rest.position[0], landed.position[2] - rest.position[2])).toBeGreaterThan(
    0.25,
  );
  const moved = Math.hypot(
    landed.crate!.centre[0] - rest.crate!.centre[0],
    landed.crate!.centre[1] - rest.crate!.centre[1],
  );
  expect(moved, 'the crate moved on the screen').toBeGreaterThan(20);
});
