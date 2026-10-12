/**
 * @file T2 for clip mode in the Stress Box (PLAN.md WP 8.9; labs/box/?scene=clips, labs/box/scenes/clips.ts) on WebGPU.
 * The page loads the animation library (every set under data/anim/sets/, registered as `clipset` entries) and plays one
 * clip of each set on the mannequin and the hero through the clip layer, each set through `box.clips.clip` as an agent
 * would: each figure plays that clip fully faded in, its pose finite, each frame drawn with no pipeline built after
 * the warm-up, and the ID pass sees both figures; no error or advice. With `BOX_CLIPS=all` (the gate's long runs, tools/lib/
 * tiers.ts `LONG_RUNS`) the same test plays every clip of every set. Frame stepping holds a frame in the page. The box
 * page ships the clips, so it shows 100STYLE's credit (CC BY 4.0, data/anim/SOURCES.md) on screen, whatever the scene:
 * the title and the dataset's link, the authors, the year, the license with its link, and the note of the changes (a
 * DOM query). Clip mode headless, every clip on the mannequin and `x anim show` frame for frame, is
 * labs/box/scenes/clips.test.ts.
 *
 * Invariants: the page is driven through `window.__engine` and the virtual clock, as an agent drives it; the clip
 * names come from the catalogs (tools/anim/find.ts `catalogRows`), as `x anim find` reads them.
 */
import type { Page } from '@playwright/test';
import { catalogRows } from '../../tools/anim/find';
import { SETS_DIR } from '../../tools/anim/repack';
import { expect, test, type Harness } from './fixtures';

/** The credit, as the plan words it (PLAN.md WP 8.9, WP 8.10). */
const CREDIT =
  'Motion: 100STYLE, by Mason, Starke and Komura (2022), CC BY 4.0; converted to key poses, one loop per style and gait';
/** One clip of each set, as x anim show names it: the library page's picks (tests/e2e/library.spec.ts). */
const PICKS = [
  'cmu/Cartwheel',
  'mesh2motion/Backflip',
  'quaternius/Sword_Attack',
  'style100/Old_Walk',
  'style100_back/Old_WalkBack',
  'style100_backrun/Old_RunBack',
  'style100_idle/Old_Idle',
  'style100_run/Old_Run',
  'style100_side/Old_SideLeft',
  'style100_siderun/Old_SideRunRight',
];
/** Every clip of every set, for the long run (`BOX_CLIPS=all`). */
const EVERY = () => catalogRows(SETS_DIR).map(({ set, row }) => `${set}/${row.name}`);
/** The clips this run plays. */
const CLIPS = process.env.BOX_CLIPS === 'all' ? EVERY() : PICKS;
/** The figures' entity ids: the hero, then the mannequin (labs/box/scenes/clips.ts spawns them so). */
const FIGURES = { hero: 1, mannequin: 2 } as const;

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** What `play` reports of one clip. */
interface Played {
  /** The clip on top of each figure, its weight, and whether every effector and socket is finite. */
  figures: { clip: string; w: number; finite: boolean }[];
  frame: { drawn: boolean; built: number };
}

/** Calls the member `path` with `args` in the page; resolves with its result. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** Plays `clip` through the setting for `steps` steps, draws a frame, and reads each figure, all in one round trip. */
function play(page: Page, clip: string, steps = 15): Promise<Played> {
  return page.evaluate(
    async ([clip, steps, ids]) => {
      __engine.set('box.clips.clip', clip);
      __engine.step(steps);
      const frame = (await __engine.render(1)) as Played['frame'];
      const figures = ids.map((id) => {
        const { clips } = __engine.get(id) as { clips: { state: { slots: { clip: string; w: number }[] } } };
        const top = clips.state.slots.at(-1)!;
        const anim = __engine.anim(id) as { effectors: Record<string, number[]>; sockets: Record<string, number[]> };
        const numbers = [...Object.values(anim.effectors), ...Object.values(anim.sockets)].flat();
        return { clip: top.clip, w: top.w, finite: numbers.every(Number.isFinite) };
      });
      return { frame: { drawn: frame.drawn, built: frame.built }, figures };
    },
    [clip, steps, Object.values(FIGURES)] as const,
  );
}

/** Opens clip mode with `query`, ready on WebGPU. */
async function open(page: Page, harness: Harness, query = '') {
  await page.goto(`labs/box/?scene=clips&cam=threequarter${query}`);
  await harness.ready({ timeout: 120_000 });
  await harness.assertWebGPU();
}

test.describe('the box: clip mode', () => {
  test.setTimeout(process.env.BOX_CLIPS === 'all' ? 6 * 3_600_000 : 300_000);

  test('one clip of each set plays on the mannequin and the hero, both drawn, no pipeline built', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const described = await call<{ ids: string[] }>(page, 'describe', 'clipset');
    expect(described.ids).toEqual(PICKS.map((ref) => `clipset:${ref.split('/')[0]}`).sort());
    for (const ref of CLIPS) {
      const played = await play(page, ref);
      const [set, name] = ref.split('/');
      for (const figure of played.figures) {
        expect(figure, ref).toEqual({ clip: `${set.toUpperCase()}/${name}`, w: 1, finite: true });
      }
      expect(played.frame, ref).toEqual({ drawn: true, built: 0 });
    }
    const stats = await call<{ pipelinesAfterWarmUp: number | null }>(page, 'stats');
    expect(stats.pipelinesAfterWarmUp).toBe(0);
    // the ID pass (which compiles its own pipelines) sees both figures in each set's clip
    for (const ref of PICKS) {
      await play(page, ref);
      const shot = await call<{ ids: { visible: { name: string; px: number }[] } }>(page, 'shot', {
        ids: true,
        metrics: false,
        thumbnail: false,
      });
      const px = Object.fromEntries(shot.ids.visible.map(({ name, px }) => [name, px]));
      for (const [who, id] of Object.entries(FIGURES)) expect(px[`actor#${id}`], `${ref}: the ${who}`).toBeGreaterThan(100); // prettier-ignore
    }
    expect(await harness.errors()).toEqual([]);
    expect(harness.advice()).toEqual([]);
  });

  test('frame stepping holds a frame of the clip in the page', async ({ page, harness }) => {
    await open(page, harness, '&box.clips.clip=quaternius/Sword_Attack&box.clips.frame=12');
    await call(page, 'step', 20);
    const times = async () =>
      page.evaluate((ids) => ids.map((id) => (__engine.get(id) as { clips: { state: { slots: { t: number }[] } } }).clips.state.slots.at(-1)!.t), Object.values(FIGURES)); // prettier-ignore
    expect(await times()).toEqual([12 / 30, 12 / 30]);
    await call(page, 'set', 'box.clips.frame', 13);
    await call(page, 'step', 1);
    expect(await times()).toEqual([13 / 30, 13 / 30]);
    expect(await harness.errors()).toEqual([]);
  });
});

test('the box page shows 100STYLE’s credit, with the dataset’s and the license’s links', async ({ page, harness }) => {
  await page.goto('labs/box/?scene=room');
  await harness.ready({ timeout: 60_000 });
  const credit = page.locator('#credit');
  await expect(credit).toBeVisible();
  expect((await credit.textContent())?.replace(/\s+/g, ' ').trim()).toBe(CREDIT);
  const links = await credit.locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
  expect(links).toEqual([
    ['100STYLE', 'https://zenodo.org/records/8127870'],
    ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ]);
  const box = (await credit.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height).toBe(true);
});
