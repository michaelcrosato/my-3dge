/**
 * @file T2 for the clip library (PLAN.md WP 8.6) on the library page (tests/pages/library.html): the browser smoke
 * test that replaces my-3d2dge's Mocap Lab check (`tools/mocap-test.mjs`). One clip of each of the ten sets plays on
 * the mannequin and on the humanoid (`build:heroic`) through the clip layer, at four moments from its start to its end:
 * each frame draws both figures (the ID pass sees each) and compiles no pipeline (the ID pass compiles its own), and
 * each pose is sound (`animCheck`: finite, every bone at its length, the feet on or over the floor, the sockets in
 * reach). Quaternius' `Sword_Attack` also plays as three.js's `AnimationClip` on an `AnimationMixer`, every bone within
 * 0.1 mm of the clip layer's FK, and draws. The page raises no error and no advice (the harness's trap).
 */
import type { Page } from '@playwright/test';
import type { ClipRef, MixerShown, PlayShown } from '../pages/library';
import { expect, test } from './fixtures';

/** What the page publishes as `window.__libraryPage` (tests/pages/library.ts). */
interface LibraryPage {
  play(ref: ClipRef & { moments?: number }): Promise<PlayShown>;
  mixer(ref: ClipRef): Promise<MixerShown>;
}
type LibraryWindow = { __libraryPage: LibraryPage };

const PAGE = 'tests/pages/library.html';
/** One clip of each set: a cartwheel, a backflip, a sword swing, and 100STYLE's old man in each of his gaits. */
const SAMPLES: ClipRef[] = [
  { dir: 'cmu', clip: 'Cartwheel' },
  { dir: 'mesh2motion', clip: 'Backflip' },
  { dir: 'quaternius', clip: 'Sword_Attack' },
  { dir: 'style100', clip: 'Old_Walk' },
  { dir: 'style100_back', clip: 'Old_WalkBack' },
  { dir: 'style100_backrun', clip: 'Old_RunBack' },
  { dir: 'style100_idle', clip: 'Old_Idle' },
  { dir: 'style100_run', clip: 'Old_Run' },
  { dir: 'style100_side', clip: 'Old_SideLeft' },
  { dir: 'style100_siderun', clip: 'Old_SideRunRight' },
];

/** Calls `name` on the page with `arg`. */
const call = <K extends keyof LibraryPage>(page: Page, name: K, arg: Parameters<LibraryPage[K]>[0]) =>
  page.evaluate(
    ([name, arg]) => ((window as unknown as LibraryWindow).__libraryPage[name] as (a: unknown) => unknown)(arg),
    [name, arg] as const,
  ) as ReturnType<LibraryPage[K]>;

test('one clip of each set plays on the mannequin and the humanoid: both drawn, every pose sound', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  for (const ref of SAMPLES) {
    const shown = await call(page, 'play', ref);
    expect(shown.moments.map((m) => m.t)).toHaveLength(4);
    expect(shown.moments[3].t, `${shown.clip} ends where it ends`).toBeCloseTo(shown.dur, 1);
    for (const { t, frame, seen, problems } of shown.moments) {
      const at = `${shown.clip} at ${t.toFixed(2)} s`;
      expect(frame, at).toMatchObject({ drawn: true, built: 0 });
      expect(problems, at).toEqual({ mannequin: [], humanoid: [] });
      const px = Object.fromEntries(seen.map(({ name, px }) => [name, px]));
      expect(Object.keys(px).sort(), at).toEqual(['humanoid', 'mannequin']);
      for (const name of ['mannequin', 'humanoid']) expect(px[name], `${at}: ${name}`).toBeGreaterThan(1500);
    }
  }
});

test("Sword_Attack plays as three.js's AnimationClip on a mixer, its bones within 0.1 mm of FK, and draws", async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();

  const shown = await call(page, 'mixer', { dir: 'quaternius', clip: 'Sword_Attack' });
  expect(shown.ticks).toBeGreaterThan(90); // every 60 Hz tick of its 1.53 s
  expect(shown.worst).toBeLessThan(1e-4);
  expect(shown.frame).toMatchObject({ drawn: true, built: 0 });
  expect(shown.seen.map(({ name }) => name)).toEqual(['mixer']);
  expect(shown.seen[0].px).toBeGreaterThan(1500);
});
