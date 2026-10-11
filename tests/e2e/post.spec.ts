/**
 * @file T2 for post-processing (PLAN.md WP 7.4) on the post page (tests/pages/post.html: the Stress Box's room with
 * two characters and a glowing orb, drawn through the chain):
 * 1. the clean look skips the chain (`plain`, fewer draw calls) and draws the plain frame; every scoped filter (cel, pixel, palette, outline, stylize, grade,
 *    scanlines, grain, chroma), with every palette, every style and the outline's own colour, changes the pixels of
 *    the parts its scope names and leaves the rest alone, for the scopes all, characters, objects and environment,
 *    the parts read back from the chain's own parts view; the whole-screen filters (bloom, edge smoothing, curvature,
 *    vignette, low resolution) change the picture; and the ID pass of every one of those frames is the clean frame's;
 * 2. objects tagged pixel art (`setPart(…, { pixelArt: true })`) are drawn as pixel art under a pixel filter scoped
 *    elsewhere, exactly as when its scope covers them, and pixel art's one-block rim darkens the blocks round them and
 *    nothing far away; a look with a material style, drawn by a chain made without a style set, gives advice
 *    `GFX_POST_NO_STYLES`;
 * 3. switching to every look builds 0 pipelines after the warm-up and recompiles no material, the ID pass staying the
 *    clean frame's, and switching looks every 20 steps while the room's session steps leaves its hashes those of the
 *    same session stepped in Node; no switch, in any test, runs a warm-up (the re-warm I-46 removes) or builds a
 *    pipeline, which `during` counts round each switch (tests/pages/post.ts);
 * 4. pixel art snaps the camera to its block grid: sliding the camera by fractions of a block changes the picture
 *    only when it crosses half a block, then by a whole block; without the snap every slide shimmers;
 * 5. bloom is off at the `low` quality tier, with advice `GFX_POST_NO_BLOOM`;
 * 6. the edge smoothing that measures better (engine/gfx/post/aa.ts records it): FXAA and SMAA against the frame
 *    drawn at 4 × 4 the size and averaged down;
 * 7. URL parameters reach the chain (the route `node x shot tests/pages/post.html --set post.look=…` takes): the page
 *    opened with `?post.look=look:game-boy` draws that look, and `__engine.shot`, which `x shot` calls, shoots it with
 *    the clean frame's ID pass;
 * 8. the Stress Box (labs/box, a `createEngine` page) draws every frame and shot through the chain: the look its URL
 *    names (`node x shot labs/box --set post.look=…`) and the one `__engine.set` names (`node x set post.look …` in an
 *    inspect session) are what `__engine.shot` shoots, with the same ID pass.
 *
 * Invariants: frames are drawn by calling the page; the Node session is the same scene and seed, stepped with no
 * intents; colours compare by channel, a pixel "changed" when a channel moved by more than `DIFF` levels.
 */
import type { Page } from '@playwright/test';
import '../../labs/box/scenes/room';
import { AA_CHOICE } from '../../engine/gfx/post/aa';
import { createSession } from '../../engine/sim/scene';
import { expect, test, type Harness } from './fixtures';
import { SCOPED, SCOPES, SCREEN } from './post-cases';
import {
  averageDown,
  borderOf,
  changedShare,
  DIFF,
  differs,
  edgeError,
  idsOf,
  lumaAt,
  nearPart,
  partsOf,
  rgba,
  type Shot,
} from './post-pixels';

/** Warm-ups run, pipelines built and frames that came back idle: a re-warm adds to all three. */
interface Counts {
  warmUps: number;
  pipelines: number;
  idle: number;
}

/** What a look switch reports: `stats` after it, `during` it. */
interface Shown {
  frame: { drawn: boolean; built: number };
  builds: number;
  recompiled: number;
  style: string;
  stats: { warmUps: number; pipelines: number; drawCalls: number };
  during: Counts;
  plain: boolean;
}

/** What a switch may do: nothing that warms up or builds. */
const STILL: Counts = { warmUps: 0, pipelines: 0, idle: 0 };

/** Expects `shown` to have drawn with no warm-up and no pipeline built, the renderer's counts still `first`'s. */
function expectStill(shown: Shown, first: Shown, where: string): void {
  expect(shown.frame, where).toMatchObject({ drawn: true, built: 0 });
  expect(shown.during, `${where}: warm-ups, pipelines and idle frames while switching`).toEqual(STILL);
  const counts = [shown.stats.warmUps, shown.stats.pipelines];
  expect(counts, `${where}: warm-ups and pipelines since the first switch`).toEqual([first.stats.warmUps, first.stats.pipelines]); // prettier-ignore
}

/** What the page publishes as `window.__postPage` (tests/pages/post.ts), as far as this suite uses it. */
interface PostPage {
  looks(): string[];
  post: { look: { id: string } };
  settings: { set(path: string, value: unknown): unknown; get(path: string): unknown };
  setLook(id: string, filters?: object): Promise<Shown>;
  shoot(options?: { ids?: boolean; pixels?: boolean }): Promise<Shot>;
  shootPlain(): Promise<Shot>;
  pixelArt(on: boolean): number;
  withoutStyles(id: string): Promise<{ drawn: boolean; built: number }>;
  parts(): Promise<Shot>;
  run(
    steps: number,
    every: number,
    looks: string[],
  ): Promise<{ hashes: Record<string, string>; built: number[]; during: Counts }>;
  slide(fractions: number[], snap: boolean): Promise<string[]>;
  measureAa(): Promise<Record<'none' | 'fxaa' | 'smaa' | 'reference', Shot>>;
}

declare const __postPage: PostPage;

/** The page's `window.__engine`: `shot`, which `node x shot` calls (tools/cmd/shot.ts), and the box's `set`. */
declare const __engine: {
  shot(options: object): Promise<Shot & { metrics: { colors: number } }>;
  set(path: string, value: string): unknown;
};

const PAGE = 'tests/pages/post.html';
/** Pixels this close to another part's are left out of "outside": neighbourhood filters reach that far. */
const BORDER = 13;

/** Opens the page with `query` (URL parameters), ready on WebGPU. */
async function open(page: Page, harness: Harness, query = ''): Promise<void> {
  await page.goto(`${PAGE}${query}`);
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
}

test('every filter and scope works, a clean look is the plain frame, and the ID pass is unchanged by filters', async ({
  page,
  harness,
}) => {
  test.setTimeout(300_000);
  await open(page, harness);
  const clean = await page.evaluate(() => __postPage.setLook('look:clean'));
  expect(clean.frame).toMatchObject({ drawn: true, built: 0 });
  expect(clean.plain, 'the clean look draws straight, skipping the chain').toBe(true);
  const base = await page.evaluate(() => __postPage.shoot({ ids: true }));
  const plain = await page.evaluate(() => __postPage.shootPlain());
  expect(changedShare(rgba(base), rgba(plain)), 'the clean look against the plain frame').toBe(0);
  const parts = partsOf(await page.evaluate(() => __postPage.parts()));
  const counts = [0, 1, 2].map((part) => parts.filter((p) => p === part).length);
  expect(counts[0], 'character pixels').toBeGreaterThan(800);
  expect(counts[1], 'object pixels').toBeGreaterThan(800);
  const border = borderOf(parts, base.width, base.height, BORDER);
  const ids = idsOf(base);
  expect(ids.length, 'objects the ID pass sees').toBeGreaterThan(10);
  const before = rgba(base);
  // Every switch below leaves the renderer's counts as this one, after the shots' own first builds, left them.
  const first = await page.evaluate(() => __postPage.setLook('look:clean'));

  for (const { name, filters, inside, to } of SCOPED) {
    for (const [scope, covered] of SCOPES) {
      const spec = { [name]: { ...filters, scope } };
      const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), spec);
      expectStill(shown, first, `${name} ${JSON.stringify(filters)} on ${scope}`);
      expect([shown.plain, shown.stats.drawCalls > first.stats.drawCalls], `${name} on ${scope}: through the chain`).toEqual([false, true]); // prettier-ignore
      const shot = await page.evaluate(() => __postPage.shoot({ ids: true }));
      expect(idsOf(shot), `the ID pass with ${name} ${JSON.stringify(filters)} on ${scope}`).toEqual(ids);
      const after = rgba(shot);
      const tally = { in: 0, inChanged: 0, out: 0, outChanged: 0, offColour: 0 };
      for (let p = 0; p < parts.length; p++) {
        const changed = differs(before, after, p);
        if (covered.includes(parts[p])) {
          tally.in++;
          if (changed) tally.inChanged++;
          if (changed && to && [0, 1, 2].some((c) => Math.abs(after[p * 4 + c] - to[c]) > DIFF)) tally.offColour++;
        } else if (!border[p]) {
          tally.out++;
          if (changed) tally.outChanged++;
        }
      }
      const where = `${name} ${JSON.stringify(filters)} on ${scope}: ${tally.inChanged}/${tally.in} inside changed, ${tally.outChanged}/${tally.out} outside`;
      expect(tally.inChanged / tally.in, where).toBeGreaterThanOrEqual(inside);
      if (tally.out > 0) expect(tally.outChanged / tally.out, where).toBeLessThanOrEqual(0.002);
      expect(tally.offColour, `${where}; changed pixels not ${to?.join(',')}`).toBe(0);
    }
  }

  for (const { filters, changed } of SCREEN) {
    const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), filters);
    expectStill(shown, first, JSON.stringify(filters));
    const shot = await page.evaluate(() => __postPage.shoot({ ids: true }));
    expect(idsOf(shot), `the ID pass with ${JSON.stringify(filters)}`).toEqual(ids);
    const share = changedShare(before, rgba(shot));
    expect(share, JSON.stringify(filters)).toBeGreaterThanOrEqual(changed);
  }
});

test('objects tagged pixel art are pixel art whatever the scope, and pixel art has its one-block dark rim', async ({
  page,
  harness,
}) => {
  test.setTimeout(120_000);
  await open(page, harness);
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const partsShot = await page.evaluate(() => __postPage.parts());
  const { width, height } = partsShot;
  const parts = partsOf(partsShot);
  const nearCharacter = nearPart(parts, width, height, 0, BORDER);
  const pixel = { size: 6, levels: 0, outline: false, snap: false };
  const shoot = async (filters: object) => {
    const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), filters);
    expect(shown.during, `switching to ${JSON.stringify(filters)}`).toEqual(STILL);
    return rgba(await page.evaluate(() => __postPage.shoot()));
  };

  // The pixel filter on the environment only: once tagged pixel art, the characters change, and are drawn as when
  // the filter's scope covers them.
  const environment = { pixel: { ...pixel, scope: 'environment' } };
  const untagged = await shoot(environment);
  const scoped = await shoot({ pixel: { ...pixel, scope: 'characters+environment' } });
  expect(await page.evaluate(() => __postPage.pixelArt(true)), 'meshes tagged pixel art').toBeGreaterThanOrEqual(2);
  let tagged: Uint8Array;
  try {
    tagged = await shoot(environment);
  } finally {
    await page.evaluate(() => __postPage.pixelArt(false));
  }
  const art = { in: 0, inChanged: 0, out: 0, outChanged: 0 };
  for (let p = 0; p < parts.length; p++) {
    const changed = differs(untagged, tagged, p);
    if (parts[p] === 0) {
      art.in++;
      if (changed) art.inChanged++;
    } else if (!nearCharacter[p]) {
      art.out++;
      if (changed) art.outChanged++;
    }
  }
  const artWhere = `tagged characters: ${art.inChanged}/${art.in} inside changed, ${art.outChanged}/${art.out} away from them`;
  // Measured 862/2134 inside (WP 7.4's review): blocks change a smooth capsule's edges and shading.
  expect(art.inChanged / art.in, artWhere).toBeGreaterThanOrEqual(0.2);
  expect(art.outChanged / art.out, artWhere).toBeLessThanOrEqual(0.002);
  expect(changedShare(tagged, scoped), 'tagged characters against characters in scope').toBeLessThanOrEqual(0.0005);

  // The pixel filter on the characters, with and without the rim: dark blocks appear round them, and only there.
  const rimless = await shoot({ pixel: { ...pixel, scope: 'characters' } });
  const rimmed = await shoot({ pixel: { ...pixel, scope: 'characters', outline: true } });
  const rim = { outside: 0, darker: 0, far: 0, farChanged: 0 };
  for (let p = 0; p < parts.length; p++) {
    const changed = differs(rimless, rimmed, p);
    if (!nearCharacter[p]) {
      rim.far++;
      if (changed) rim.farChanged++;
    } else if (changed && parts[p] !== 0) {
      rim.outside++;
      if (lumaAt(rimmed, p) < lumaAt(rimless, p)) rim.darker++;
    }
  }
  const rimWhere = `the rim: ${rim.outside} pixels outside the characters changed, ${rim.darker} darker; ${rim.farChanged}/${rim.far} far from them`;
  // Measured 1083 pixels, every one darker (WP 7.4's review).
  expect(rim.outside, rimWhere).toBeGreaterThanOrEqual(400);
  expect(rim.darker / rim.outside, rimWhere).toBeGreaterThanOrEqual(0.9);
  expect(rim.farChanged / rim.far, rimWhere).toBeLessThanOrEqual(0.002);
});

test('a look with a material style, drawn by a chain without a style set, draws its filters with advice', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const frame = await page.evaluate(() => __postPage.withoutStyles('look:cartoon'));
  expect(frame).toMatchObject({ drawn: true });
  expect(harness.advice().map((advice) => advice.code)).toContain('GFX_POST_NO_STYLES');
});

test('every look builds 0 pipelines after the warm-up and recompiles nothing, and switching looks never changes the hash', async ({
  page,
  harness,
}) => {
  test.setTimeout(400_000);
  await open(page, harness);
  const looks = await page.evaluate(() => __postPage.looks());
  expect(looks.length).toBe(86);
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const ids = idsOf(await page.evaluate(() => __postPage.shoot({ ids: true, pixels: false })));
  // A shot draws into a target of its own: its first frame straight (above) and through the chain (the parts view)
  // build their pipelines; every switch below leaves the counts as this one left them.
  await page.evaluate(() => __postPage.parts());
  const first = await page.evaluate(() => __postPage.setLook('look:clean'));
  const styles = new Set<string>();
  for (const id of [...looks, 'look:clean']) {
    const shown = await page.evaluate((look) => __postPage.setLook(look), id);
    expectStill(shown, first, id);
    expect(shown.recompiled, `materials ${id} recompiled`).toBe(0);
    expect(shown.builds, `${id}: the chain's output graph builds`).toBe(1);
    styles.add(shown.style);
    const shot = await page.evaluate(() => __postPage.shoot({ ids: true, pixels: false }));
    expect(idsOf(shot), `the ID pass with ${id}`).toEqual(ids);
  }
  expect([...styles].sort(), 'the styles the looks switched to').toEqual(['flat', 'lambert', 'pbr', 'toon']);

  const played = await page.evaluate(
    (all) => __postPage.run(240, 20, all),
    ['look:hd-2d', 'look:cartoon', 'look:oil-painting', 'look:game-boy', 'look:arcade-crt', 'look:flat-paper'],
  );
  expect(played.built.length).toBe(240);
  expect(Math.max(...played.built), 'pipelines built by any frame of the run').toBe(0);
  expect(played.during, 'warm-ups, pipelines and idle frames over the run').toEqual(STILL);
  const session = createSession('box:room', { seed: 1 });
  const node: Record<string, string> = { 0: session.world.hash() };
  for (let k = 1; k <= 240; k++) {
    session.step();
    if (k % 60 === 0) node[k] = session.world.hash();
  }
  expect(played.hashes).toEqual(node);
});

test('pixel art snaps the camera to its block grid, so the picture moves only by whole blocks', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const fractions = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const snapped = (await page.evaluate((f) => __postPage.slide(f, true), fractions)).map((s) => rgba(s));
  const loose = (await page.evaluate((f) => __postPage.slide(f, false), fractions)).map((s) => rgba(s));
  const changes = (frames: Uint8Array[]) => frames.slice(1).map((frame, i) => changedShare(frames[i], frame));
  const snapping = changes(snapped);
  expect(snapping.filter((share) => share > 0).length, `snapped: ${snapping.join(', ')}`).toBe(1);
  expect(
    changes(loose).every((share) => share > 0),
    `loose: ${changes(loose).join(', ')}`,
  ).toBe(true);
  // The one change is a whole block: the last frame is the first moved one block across.
  const [width, height, block] = [480, 270, 6];
  const [first, last] = [snapped[0], snapped[5]];
  let same = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = block; x < width - block; x++) {
      total++;
      const p = y * width + x;
      const q = y * width + x + block;
      if (![0, 1, 2].some((c) => Math.abs(last[p * 4 + c] - first[q * 4 + c]) > DIFF)) same++;
    }
  }
  expect(same / total, 'the slid frame is the first moved by one block').toBeGreaterThan(0.97);
});

test('bloom is off at the low quality tier, with advice', async ({ page, harness }) => {
  await open(page, harness);
  const glow = { bloom: { scope: 'all', strength: 1.5, threshold: 0.1 } };
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const off = rgba(await page.evaluate(() => __postPage.shoot()));
  const on = await page.evaluate((f) => __postPage.setLook('look:clean', f), glow);
  expect(on.during, 'switching bloom on').toEqual(STILL);
  const high = rgba(await page.evaluate(() => __postPage.shoot()));
  // The shots' own first builds, straight and through the chain, are done: the switch below leaves the counts so.
  const first = await page.evaluate((f) => __postPage.setLook('look:clean', f), glow);
  expect(changedShare(off, high), 'bloom at the high tier').toBeGreaterThan(0.05);
  await page.evaluate(() => __postPage.settings.set('quality', 'low'));
  const shown = await page.evaluate((f) => __postPage.setLook('look:clean', f), glow);
  expectStill(shown, first, 'bloom at the low tier');
  const low = rgba(await page.evaluate(() => __postPage.shoot()));
  expect(changedShare(off, low), 'bloom at the low tier').toBe(0);
  expect(harness.advice().map((advice) => advice.code)).toContain('GFX_POST_NO_BLOOM');
});

test('the edge smoothing that measures better is the one the chain uses', async ({ page, harness }) => {
  test.setTimeout(240_000);
  await open(page, harness);
  const shots = await page.evaluate(() => __postPage.measureAa());
  const { width, height } = shots.none;
  const reference = averageDown(rgba(shots.reference), width, height, 4);
  const none = rgba(shots.none);
  const errors = {
    none: edgeError(none, none, reference),
    fxaa: edgeError(rgba(shots.fxaa), none, reference),
    smaa: edgeError(rgba(shots.smaa), none, reference),
  };
  console.log(`edge smoothing, mean luma error on edges: ${JSON.stringify(errors)}`);
  const other = AA_CHOICE === 'fxaa' ? 'smaa' : 'fxaa';
  expect(errors[AA_CHOICE], JSON.stringify(errors)).toBeLessThan(errors.none);
  expect(errors[AA_CHOICE], JSON.stringify(errors)).toBeLessThanOrEqual(errors[other]);
});

test('URL parameters reach the chain, and x shot shoots what it draws', async ({ page, harness }) => {
  await open(page, harness, '?post.look=look:game-boy');
  const opened = await page.evaluate(() => [__postPage.settings.get('post.look'), __postPage.post.look.id]);
  expect(opened, 'post.look read back, and the look drawn').toEqual(['look:game-boy', 'look:game-boy']);
  // What `node x shot tests/pages/post.html --set post.look=look:game-boy` calls.
  const shot = await page.evaluate(() => __engine.shot({ ids: true, metrics: true, pixels: true, thumbnail: false }));
  expect(shot.metrics.colors, 'the Game Boy look draws four greens at most').toBeLessThanOrEqual(4);
  await page.evaluate(() => __postPage.setLook('look:clean'));
  const clean = await page.evaluate(() => __postPage.shoot({ ids: true }));
  expect(idsOf(shot), 'the ID pass of the look the URL named').toEqual(idsOf(clean));
  expect(changedShare(rgba(shot), rgba(clean)), 'the look the URL named against look:clean').toBeGreaterThan(0.5);
  await page.evaluate(() => __postPage.setLook('look:game-boy'));
  const set = rgba(await page.evaluate(() => __postPage.shoot()));
  expect(changedShare(rgba(shot), set), 'the look the URL named against the same look set on the page').toBe(0);
});

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
