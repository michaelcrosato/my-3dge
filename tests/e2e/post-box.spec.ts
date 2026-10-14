/**
 * @file T2 for post-processing in the Stress Box (PLAN.md WP 7.4; the post page's own tests: tests/e2e/post.spec.ts):
 * 1. the box (labs/box, a `createEngine` page) draws every frame and shot through the chain: the look its URL names
 *    (`node x shot labs/box --set post.look=…`) and the one `__engine.set` names (`node x set post.look …` in an
 *    inspect session) are what `__engine.shot` shoots, with the same ID pass;
 * 2. the box's own drawers tag their parts: in the parts view (`post.show=parts`), the hall's props are objects inside
 *    every prop's ID-pass box, and a stepped crowd-100's bodies are characters beyond the hero's own pixels.
 *
 * Invariants: frames are drawn by calling the page; colours compare by channel (tests/e2e/post-pixels.ts). Split from
 * post.spec.ts to keep each under 400 lines (ADR-0014 amendment 16).
 */
import type { IdEntry } from '../../engine/gfx/idpass';
import { expect, test } from './fixtures';
import { changedShare, idsOf, partIn, partsOf, rgba, type Shot } from './post-pixels';

/** The box's `window.__engine`: `shot`, which `node x shot` calls (tools/cmd/shot.ts), `set`, `step` and `render`. */
declare const __engine: {
  shot(options: object): Promise<Shot & { metrics: { colors: number } }>;
  set(path: string, value: string): unknown;
  step(steps: number): unknown;
  render(frames: number): unknown;
};

test('the Stress Box draws through the chain: its URL and __engine.set name the look __engine.shot shoots', async ({
  page,
  harness,
}) => {
  await page.goto('labs/box/?scene=room&post.look=look:game-boy');
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
  const shoot = () => page.evaluate(() => __engine.shot({ ids: true, metrics: true, pixels: true, thumbnail: false }));
  const opened = await shoot();
  expect(opened.metrics.colors, 'look:game-boy, named in the URL').toBeLessThanOrEqual(4);
  await page.evaluate(() => __engine.set('post.look', 'look:clean'));
  const clean = await shoot();
  expect(clean.metrics.colors, 'look:clean, set through __engine').toBeGreaterThan(4);
  expect(idsOf(opened), 'the ID pass of the look the URL named').toEqual(idsOf(clean));
  expect(changedShare(rgba(opened), rgba(clean)), 'look:game-boy against look:clean').toBeGreaterThan(0.5);
  await page.evaluate(() => __engine.set('post.look', 'look:game-boy'));
  const set = await shoot();
  expect(changedShare(rgba(set), rgba(opened)), 'look:game-boy set through __engine against the URL’s').toBe(0);
});

test("the Stress Box's props draw as objects and its crowd's bodies as characters, in the parts view", async ({
  page,
  harness,
}) => {
  test.setTimeout(240_000);
  /** The box's `scene` from its iso camera after `steps` steps, in the parts view, with its ID pass. */
  const partsView = async (scene: string, steps: number) => {
    await page.goto(`labs/box/?scene=${scene}&cam=iso&post.show=parts`);
    await harness.ready({ timeout: 120_000 });
    await harness.assertWebGPU();
    if (steps > 0) await page.evaluate((n) => __engine.step(n), steps);
    await page.evaluate(() => __engine.render(2));
    const shot = await page.evaluate(() =>
      __engine.shot({ ids: true, metrics: false, pixels: true, thumbnail: false }),
    );
    const visible = shot.ids!.visible;
    const px = (entries: typeof visible) => entries.reduce((sum, entry) => sum + entry.px, 0);
    return { shot, parts: partsOf(shot), visible, px };
  };
  /** Expects each of `entries` big enough that its edges do not decide to show `part` on most of its pixels. */
  const expectShown = (view: Awaited<ReturnType<typeof partsView>>, entries: IdEntry[], part: number) => {
    for (const entry of entries.filter((e) => e.px >= 50)) {
      const shown = partIn(view.parts, view.shot.width, entry.bbox, part);
      expect(shown, `part ${part} in ${entry.name}'s box, against its ${entry.px} px`).toBeGreaterThan(entry.px / 2);
    }
  };

  // The hall's props (engine/gfx/props.ts, tagged objects): green inside every prop's box.
  const hall = await partsView('hall-props', 0);
  const props = hall.visible.filter((entry) => entry.name.startsWith('prop:'));
  expect(hall.px(props), 'prop pixels in view').toBeGreaterThan(1000);
  expectShown(hall, props, 1);
  const objects = hall.parts.filter((part) => part === 1).length;
  expect(objects, 'object pixels against the props’').toBeGreaterThan(hall.px(props) * 0.75);

  // The crowd's bodies (engine/gfx/puppets/crowd.ts, tagged characters): red beyond the hero's own pixels.
  const crowd = await partsView('crowd-100', 240);
  const bodies = crowd.visible.filter((entry) => /^crowd\/(puppets|rigs)\//.test(entry.name));
  const hero = crowd.px(crowd.visible.filter((entry) => entry.protagonist));
  expect(crowd.px(bodies), 'crowd body pixels in view').toBeGreaterThan(1000);
  expectShown(crowd, bodies, 0);
  const characters = crowd.parts.filter((part) => part === 0).length;
  expect(characters - hero, 'character pixels beyond the hero’s, against the bodies’').toBeGreaterThan(
    crowd.px(bodies) * 0.75,
  );
  expect(harness.advice()).toEqual([]);
});
