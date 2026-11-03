/**
 * @file T2 for the filters Style Lab brought and for tuning and combining (PLAN.md WP 13.31, WP 13.32) on the post page
 * (tests/pages/post.html, the Stress Box's room as tests/e2e/post.spec.ts draws it):
 * 1. every scoped filter Style Lab brought (sharpen, misregister, watercolor, paper, split, selective, duotone), and
 *    grade's and outline's new numbers, changes the pixels of the parts its scope names and leaves the rest alone, for
 *    the scopes all, characters, objects and environment; every camera and screen filter (lens, dof, tiltshift,
 *    flare, streaks, crt, vhs, speedlines, vignette, letterbox) changes the picture; and the ID pass of every frame
 *    is the clean frame's (tests/e2e/filters-cases.ts holds the cases);
 * 2. a filter's `amount`: at 0 the picture is the clean frame's, for a filter that mixes (duotone) and one that moves
 *    where pixels look (lens); at 0.5 a mixing filter's change is half its change at 1;
 * 3. combining, live: `post.combine` laying a look on the clean look draws what that look draws; `post.strength` 0
 *    draws the clean frame and 0.5 about half the change; changing either builds no pipeline and runs no warm-up.
 *
 * Every switch in every test draws with 0 pipelines built and no warm-up after the first (`expectStill`): a filter, its
 * scope, its amount, a layer or the strength is a uniform write. That every look, Style Lab's and the combined ones
 * among them, switches the same way is tests/e2e/post.spec.ts's third test, which walks them all.
 *
 * Invariants: frames are drawn by calling the page; colours compare by channel, a pixel "changed" when a channel moved
 * by more than `DIFF` levels (tests/e2e/post-pixels.ts).
 */
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';
import { SCOPED_MORE, SCREEN_MORE } from './filters-cases';
import { SCOPES } from './post-cases';
import { borderOf, changedShare, differs, idsOf, partsOf, rgba, type Shot } from './post-pixels';

/** What a look switch reports (tests/pages/post.ts's `setLook`), as far as this suite reads it. */
interface Shown {
  frame: { drawn: boolean; built: number };
  stats: { warmUps: number; pipelines: number };
  during: { warmUps: number; pipelines: number; idle: number };
}

/** The post page's `window.__postPage` (tests/pages/post.ts), as far as this suite uses it. */
declare const __postPage: {
  settings: { set(path: string, value: unknown): unknown };
  setLook(id: string, filters?: object): Promise<Shown>;
  shoot(options?: { ids?: boolean; pixels?: boolean }): Promise<Shot>;
  parts(): Promise<Shot>;
};

const PAGE = 'tests/pages/post.html';
/** Pixels this close to another part's are left out of "outside": neighbourhood filters reach that far. */
const BORDER = 13;

/** Opens the post page, ready on WebGPU. */
async function open(page: Page, harness: Harness): Promise<void> {
  await page.goto(PAGE);
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
}

/** Expects `shown` to have drawn with no warm-up and no pipeline built, the renderer's counts still `first`'s. */
function expectStill(shown: Shown, first: Shown, where: string): void {
  expect(shown.frame, where).toMatchObject({ drawn: true, built: 0 });
  expect(shown.during, `${where}: warm-ups, pipelines and idle frames while switching`).toEqual({ warmUps: 0, pipelines: 0, idle: 0 }); // prettier-ignore
  expect([shown.stats.warmUps, shown.stats.pipelines], `${where}: since the first switch`).toEqual([first.stats.warmUps, first.stats.pipelines]); // prettier-ignore
}

/** The mean change of every channel from `a` to `b`, in levels. */
function meanChange(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i] - b[i]);
  return sum / ((a.length / 4) * 3);
}

/** Draws the clean look with `filters`, checks the switch built nothing, and returns the frame's pixels. */
async function draw(page: Page, first: Shown, filters: object, where: string): Promise<Uint8Array> {
  const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), filters);
  expectStill(shown, first, where);
  return rgba(await page.evaluate(() => __postPage.shoot()));
}

test('every filter Style Lab brought works in its scope or over the screen, the ID pass unchanged', async ({
  page,
  harness,
}) => {
  test.setTimeout(300_000);
  await open(page, harness);
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const base = await page.evaluate(() => __postPage.shoot({ ids: true }));
  const parts = partsOf(await page.evaluate(() => __postPage.parts()));
  const border = borderOf(parts, base.width, base.height, BORDER);
  const ids = idsOf(base);
  const before = rgba(base);
  const first = await page.evaluate(() => __postPage.setLook('look:clean'));

  for (const { name, filters, inside } of SCOPED_MORE) {
    for (const [scope, covered] of SCOPES) {
      const where = `${name} ${JSON.stringify(filters)} on ${scope}`;
      const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), { [name]: { ...filters, scope } });
      expectStill(shown, first, where);
      const shot = await page.evaluate(() => __postPage.shoot({ ids: true }));
      expect(idsOf(shot), `the ID pass with ${where}`).toEqual(ids);
      const after = rgba(shot);
      const tally = { in: 0, inChanged: 0, out: 0, outChanged: 0 };
      for (let p = 0; p < parts.length; p++) {
        const changed = differs(before, after, p);
        if (covered.includes(parts[p])) {
          tally.in++;
          if (changed) tally.inChanged++;
        } else if (!border[p]) {
          tally.out++;
          if (changed) tally.outChanged++;
        }
      }
      const said = `${where}: ${tally.inChanged}/${tally.in} inside changed, ${tally.outChanged}/${tally.out} outside`;
      expect(tally.inChanged / tally.in, said).toBeGreaterThanOrEqual(inside);
      if (tally.out > 0) expect(tally.outChanged / tally.out, said).toBeLessThanOrEqual(0.002);
    }
  }

  for (const { filters, changed } of SCREEN_MORE) {
    const where = JSON.stringify(filters);
    const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), filters);
    expectStill(shown, first, where);
    const shot = await page.evaluate(() => __postPage.shoot({ ids: true }));
    expect(idsOf(shot), `the ID pass with ${where}`).toEqual(ids);
    expect(changedShare(before, rgba(shot)), where).toBeGreaterThanOrEqual(changed);
  }
});

test("a filter's amount: 0 is the clean frame, half is half the change", async ({ page, harness }) => {
  test.setTimeout(120_000);
  await open(page, harness);
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const clean = rgba(await page.evaluate(() => __postPage.shoot()));
  await page.evaluate(() => __postPage.parts()); // the first shot through the chain builds its own pipelines
  const first = await page.evaluate(() => __postPage.setLook('look:clean'));
  const duotone = (amount: number) => ({ duotone: { scope: 'all', mid: '#ff0000', light: '#ffff00', amount } });

  const none = await draw(page, first, duotone(0), 'duotone at 0');
  const half = await draw(page, first, duotone(0.5), 'duotone at 0.5');
  const whole = await draw(page, first, duotone(1), 'duotone at 1');
  expect(changedShare(clean, none), 'duotone at amount 0 against the clean frame').toBeLessThanOrEqual(0.001);
  expect(changedShare(clean, whole), 'duotone at amount 1').toBeGreaterThan(0.4);
  const ratio = meanChange(clean, half) / meanChange(clean, whole);
  expect(ratio, `duotone's change at 0.5 over its change at 1: ${ratio.toFixed(3)}`).toBeGreaterThan(0.4);
  expect(ratio).toBeLessThan(0.6);

  const still = await draw(page, first, { lens: { scope: 'all', distortion: 0.4, amount: 0 } }, 'lens at 0');
  expect(changedShare(clean, still), 'lens at amount 0 against the clean frame').toBeLessThanOrEqual(0.001);
});

test('post.combine lays a look on live, and post.strength fades the whole of it, building nothing', async ({
  page,
  harness,
}) => {
  test.setTimeout(120_000);
  await open(page, harness);
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const clean = rgba(await page.evaluate(() => __postPage.shoot()));
  await page.evaluate(() => __postPage.parts()); // the first shot through the chain builds its own pipelines
  const first = await page.evaluate(() => __postPage.setLook('look:clean'));
  const look = async (id: string, where: string) => {
    const shown = await page.evaluate((i) => __postPage.setLook(i), id);
    expectStill(shown, first, where);
    return rgba(await page.evaluate(() => __postPage.shoot()));
  };
  const set = (path: string, value: unknown) => page.evaluate(([p, v]) => __postPage.settings.set(p as string, v), [path, value] as const); // prettier-ignore

  const cinematic = await look('look:cinematic', 'look:cinematic');
  expect(changedShare(clean, cinematic), 'look:cinematic against the clean frame').toBeGreaterThan(0.2);
  await set('post.combine', [{ look: 'look:cinematic' }]);
  const laid = await look('look:clean', 'look:cinematic laid on look:clean');
  expect(changedShare(cinematic, laid), 'laid on against drawn').toBeLessThanOrEqual(0.001);

  await set('post.strength', 0);
  const faded = await look('look:clean', 'post.strength 0');
  expect(changedShare(clean, faded), 'post.strength 0 against the clean frame').toBeLessThanOrEqual(0.001);
  await set('post.strength', 0.5);
  const half = await look('look:clean', 'post.strength 0.5');
  const ratio = meanChange(clean, half) / meanChange(clean, laid);
  expect(ratio, `the change at strength 0.5 over the change at 1: ${ratio.toFixed(3)}`).toBeGreaterThan(0.3);
  expect(ratio).toBeLessThan(0.7);
  await set('post.strength', 1);
  await set('post.combine', []);
  expect(changedShare(clean, await look('look:clean', 'back to clean')), 'cleared').toBeLessThanOrEqual(0.001);
});
