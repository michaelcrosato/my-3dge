/**
 * @file T2 for the gallery (PLAN.md WP 7.7): every registered entry with a `gallery` field renders a sheet (Done-when):
 * on the gallery's page (tests/pages/gallery.html, every lab's entries), `__engine.gallery.shoot` films every entry
 * of every kind, a test a kind, and each frame shows its subject (its ID pass sees enough of it besides the stage's
 * ground, an emitter's fullest frame: `emptyFrames`, as `x gallery` checks); the kinds are the six that need review. A deep link opens one entry on any page:
 * the box's `#gallery/prop/prop:chair` shows the chair, its camera fitted round it, in the middle of the frame. A
 * wrong kind or id warns with the valid names (`DEV_GALLERY_UNKNOWN`) and shows the first instead. A shot smaller than
 * the canvas through a look's filters is the whole picture at that size, not its top-left quarter (engine/gfx/shot.ts
 * `atSize`: the gallery's sheets in a look).
 *
 * Invariants: the kinds' shots are x gallery's size (240 × 135), so the spec judges what the tool's sheets show (a
 * snowflake is a pixel there and nothing at 96 × 54); no other advice.
 */
import type { Page } from '@playwright/test';
import { emptyFrames, SIZE, type Filmed } from '../../tools/cmd/gallery';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown>;

/** Calls the `__engine` member at `path` (`gallery.shoot`) with `args`. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** The kinds that need review, which the gallery films. */
const KINDS = ['body', 'emitter', 'look', 'material', 'move', 'prop'];

/** What a frame's ID pass saw, as `__engine.shot` returns it. */
type Seen = { visible: { name: string; px: number; share: number; centre: [number, number] }[] };

test.describe('the gallery', () => {
  test('opens one entry on any page from a deep link: the box’s chair, framed in the middle', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/box/#gallery/prop/prop:chair');
    await harness.ready();
    await harness.assertWebGPU();
    await call(page, 'render', 2);
    const { width, height, ids } = await call<{ width: number; height: number; ids: Seen }>(page, 'shot', { metrics: false, thumbnail: false }); // prettier-ignore
    const chair = ids.visible.filter((entry) => entry.name.startsWith('prop:chair/'));
    expect(chair.map((entry) => entry.name).sort()).toEqual(['prop:chair/back/page0', 'prop:chair/seat/page0', 'prop:chair/sideEast/page0', 'prop:chair/sideWest/page0']); // prettier-ignore
    expect(chair.reduce((sum, entry) => sum + entry.share, 0)).toBeGreaterThan(0.05); // fitted round it, not lost
    const [x, y] = chair.find((entry) => entry.name.includes('/back/'))!.centre;
    expect([x / width, y / height].map((v) => Math.abs(v - 0.5) < 0.25)).toEqual([true, true]); // in the middle
    expect(harness.advice()).toEqual([]);
  });

  test('warns about a wrong kind with the valid kinds, and shows the first kind instead', async ({ page, harness }) => {
    await page.goto('labs/box/#gallery/props/prop:chair');
    await harness.ready();
    const advice = harness.advice().map((warning) => warning.text);
    expect(advice).toEqual([expect.stringContaining('[DEV_GALLERY_UNKNOWN] the gallery has no kind "props" (did you mean "prop"?); it shows body instead: use one of: body, emitter, look, material, move, prop')]); // prettier-ignore
    const { ids } = await call<{ ids: Seen }>(page, 'shot', { metrics: false, thumbnail: false });
    expect(ids.visible.some((entry) => entry.name.startsWith('actor#') && entry.px > 0)).toBe(true); // the humanoid
  });

  test('warns about a wrong id with its kind’s ids, and shows the kind’s first instead', async ({ page, harness }) => {
    await page.goto('labs/box/#gallery/prop/prop:chiar');
    await harness.ready();
    const advice = harness.advice().map((warning) => warning.text);
    expect(advice).toEqual([expect.stringContaining('the gallery has no prop "prop:chiar" (did you mean "prop:chair"')]); // prettier-ignore
    expect(advice[0]).toContain('it shows prop:banner instead: use one of: prop:banner, prop:barrel');
  });

  test('shoots a smaller frame through a look’s filters as the canvas draws it, not its top-left quarter', async ({
    page,
    harness,
  }) => {
    await page.goto('labs/box/?post.look=look:grade/faded#gallery/prop/prop:crate'); // a grade: the chain, any size
    await harness.ready();
    await call(page, 'render', 2);
    type Pixels = { width: number; height: number; pixels: string };
    const options = { ids: false, metrics: false, thumbnail: false, pixels: true };
    const full = await call<Pixels>(page, 'shot', options);
    const [w, h] = [Math.floor(full.width / 2), Math.floor(full.height / 2)];
    const half = await call<Pixels>(page, 'shot', { ...options, size: { width: w, height: h } });
    const [a, b] = [Buffer.from(full.pixels, 'base64'), Buffer.from(half.pixels, 'base64')];
    const at = (x: number, y: number, c: number) => a[(y * full.width + x) * 4 + c];
    const whole = (x: number, y: number, c: number) => (at(2 * x, 2 * y, c) + at(2 * x + 1, 2 * y, c) + at(2 * x, 2 * y + 1, c) + at(2 * x + 1, 2 * y + 1, c)) / 4; // prettier-ignore
    const differ = (from: (x: number, y: number, c: number) => number) => {
      let sum = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) sum += Math.abs(b[(y * w + x) * 4 + c] - from(x, y, c)); // prettier-ignore
      return sum / (w * h * 3);
    };
    // The half-size shot is the whole picture at half size (2 × 2 averages), far from its top-left quarter at full size.
    expect(differ(whole)).toBeLessThan(8);
    expect(differ(whole)).toBeLessThan(differ(at) / 3);
    expect(harness.advice()).toEqual([]);
  });

  for (const kind of KINDS) {
    test(`renders every ${kind} with a gallery field, each frame showing it`, async ({ page, harness }) => {
      test.setTimeout(15 * 60_000);
      await page.goto(`tests/pages/gallery.html#gallery/${kind}`);
      await harness.ready();
      const kinds = await call<{ kind: string; count: number }[]>(page, 'gallery.list');
      expect(kinds.map((k) => k.kind)).toEqual(KINDS);
      const ids = await call<string[]>(page, 'gallery.list', kind);
      expect(ids.length).toBe(kinds.find((k) => k.kind === kind)!.count);
      const empty: string[] = [];
      for (const id of ids) {
        const filmed = await call<Filmed>(page, 'gallery.shoot', kind, id, SIZE); // x gallery's: what it judges
        expect(filmed.frames.length, `${id}'s frames`).toBe((await call<unknown[]>(page, 'gallery.frames', kind, id)).length); // prettier-ignore
        empty.push(...emptyFrames(filmed).map((frame) => frame.label));
      }
      expect(empty, 'frames showing nothing but the ground').toEqual([]);
      expect(harness.advice()).toEqual([]);
    });
  }
});
