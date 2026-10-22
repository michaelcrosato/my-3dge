/**
 * @file T2 for the agent eye (engine/dev/eye.ts, PLAN.md WP 12.3) against the ID pass (engine/gfx/idpass.ts), in the
 * Stress Box's pages: in the hero's room and in the hall with its props, with the hero at his spawn and walked two
 * ways, from each of the box's cameras (each classic view in both projections, the 3D cameras, the follow cameras and
 * first person), the eye's answers on the same frame, whether it sees the hero and whether it sees the level, are the
 * ID pass's for at least 95% of the cases (the Done-when's bound). First person's hero is no case: the view draws his
 * arms, which have no body, where the eye looks past his body. The props, drawn in instanced batches, name no entity
 * in the ID pass, so they are no case either. Each disagreement goes into the test's annotations (`disagree`).
 *
 * Invariants: the page is driven through `window.__engine`; each camera is set, two frames drawn, then the ID pass and
 * the eye read the same frame; the eye looks at 192 × 108, five pixels a cell at 960 × 540.
 */
import { CAMERA_3D, FOLLOW_CAMERAS, VIEW_NAMES } from '../../engine/gfx/cameras/codes';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: {
  pause(): void;
  step(n: number, intents?: object): number;
  render(frames: number): Promise<unknown>;
  shot(options: object): Promise<unknown>;
  eye(options: object): unknown;
  entities(component: string): unknown;
  camera: { set(code: string): unknown; get(): unknown };
};

/** The box's cameras: each classic view in both projections, the 3D cameras, the follow cameras and first person. */
const CAMERAS = [
  ...VIEW_NAMES.flatMap((view) => [`cam=${view}`, `cam=${view},persp`]),
  ...CAMERA_3D.map((type) => `cam3=${type}`),
  ...FOLLOW_CAMERAS.map((type) => `cam3=${type}`),
];

/** Where the hero stands for each round: at his spawn after a step (bodies join the queries at the first), then walked east and north. */ // prettier-ignore
const WALKS: readonly (readonly [number, [number, number] | null])[] = [
  [1, null],
  [40, [1, 0]],
  [40, [0, -1]],
];

/** The least share of the cases on which the eye and the ID pass agree (the WP's Done-when). */
const AGREE = 0.95;

/** One case: what it asks, and what each answer said. */
interface Case {
  scene: string;
  camera: string;
  walk: number;
  what: 'hero' | 'level';
  ids: boolean;
  eye: boolean;
}

test.describe('the agent eye against the ID pass', () => {
  test.setTimeout(900_000);

  test('answers as the ID pass does, whether it sees the hero and the level, on the box’s cameras', async ({
    page,
    harness,
  }) => {
    const cases: Case[] = [];
    for (const scene of ['room-hero', 'hall-props']) {
      await page.goto(`labs/box/?scene=${scene}`);
      await harness.ready({ timeout: 240_000 });
      await page.evaluate(() => __engine.pause());
      for (const [k, [steps, move]] of WALKS.entries()) {
        await page.evaluate(([n, m]) => __engine.step(n, m ? { move: m } : {}), [steps, move] as const);
        for (const camera of CAMERAS) {
          const answers = await page.evaluate(async (code) => {
            __engine.camera.set(code);
            await __engine.render(2);
            const shot = (await __engine.shot({ ids: true, metrics: false, thumbnail: false })) as {
              ids: { visible: { name: string; entity?: number; px: number }[] };
            };
            const eye = __engine.eye({ cols: 192, rows: 108 }) as { visible: { key: string; player?: boolean }[] };
            const hero = (__engine.entities('actor') as { id: number }[])[0]?.id;
            return {
              first: (__engine.camera.get() as { type: string }).type === 'first',
              ids: { hero: shot.ids.visible.some((v) => v.entity === hero), level: shot.ids.visible.some((v) => v.name.startsWith('level:')) }, // prettier-ignore
              eye: { hero: eye.visible.some((t) => t.player === true), level: eye.visible.some((t) => t.key === 'level') }, // prettier-ignore
            };
          }, camera);
          cases.push({ scene, camera, walk: k, what: 'level', ids: answers.ids.level, eye: answers.eye.level });
          if (!answers.first) cases.push({ scene, camera, walk: k, what: 'hero', ids: answers.ids.hero, eye: answers.eye.hero }); // prettier-ignore
        }
      }
    }
    const apart = cases.filter((c) => c.ids !== c.eye);
    for (const c of apart) {
      test.info().annotations.push({ type: 'disagree', description: `${c.scene}, ${c.camera}, walk ${c.walk}: the ${c.what} seen by the ID pass ${c.ids}, by the eye ${c.eye}` }); // prettier-ignore
    }
    test.info().annotations.push({ type: 'agree', description: `${cases.length - apart.length} of ${cases.length}` });
    expect(cases.length).toBeGreaterThan(100);
    expect((cases.length - apart.length) / cases.length, apart.map((c) => `${c.scene} ${c.camera} ${c.walk} ${c.what}`).join('; ')).toBeGreaterThanOrEqual(AGREE); // prettier-ignore
    expect(harness.advice()).toEqual([]);
  });
});
