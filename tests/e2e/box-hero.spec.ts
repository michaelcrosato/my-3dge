/**
 * @file T2 for the Stress Box, stage 2 (PLAN.md §9.0, WP 3.10): the room with a hero (labs/box/?scene=room-hero) on
 * WebGPU. The camera suite: from every camera (each classic view in both projections, the orbit, fly and fixed
 * cameras, the chase camera and the depth rail) the ID pass sees the hero, a puppet tagged as the protagonist, with a
 * sane share of the frame (in view, not filling it) and no object filling the frame; first person passes the inverse
 * check: it hides the hero's whole body (`camera.get().culled`), so the body covers nothing where a fly camera at the
 * same pose sees it, and draws his arms instead (WP 13.12: `actor#1/arms`, in view and never filling it), and no wall
 * covers more than 70% of the frame, looking each way. W walks
 * away from the camera in every camera mode (the keyboard's W, through the devices and `fromCamera`). Cycling every
 * camera and resolution mode while he walks builds 0 pipelines after the warm-up. The CPU-only contract for these
 * scenes is tests/e2e/parity.spec.ts.
 *
 * Invariants: the page is driven through `window.__engine`, the keyboard and the virtual clock, as an agent drives
 * it; the hero is first walked to the open middle of the room's north half, so every camera has room round him.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { JOINTS } from '../../engine/anim/skeleton';
import { CAMERA_3D, VIEW_NAMES } from '../../engine/gfx/cameras/codes';
import { FOLLOW_CAMERAS } from '../../engine/gfx/cameras/place';
import { RESOLUTION_MODES } from '../../engine/gfx/resolution';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
/** Every camera but first person: each classic view in both projections, then each 3D camera. */
const CAMERAS = [
  ...VIEW_NAMES.flatMap((view) => [`cam=${view}`, `cam=${view},persp`]),
  ...CAMERA_3D.map((type) => `cam3=${type}`),
  ...FOLLOW_CAMERAS.filter((type) => type !== 'first').map((type) => `cam3=${type}`),
];

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** One object the ID pass sees. */
interface Seen {
  name: string;
  px: number;
  share: number;
  entity?: number;
  protagonist?: boolean;
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

/** The ID pass's view from the camera now: what it sees, largest first. */
async function seen(page: Page): Promise<Seen[]> {
  const shot = await call<{ ids: { visible: Seen[] } }>(page, 'shot', { ids: true, metrics: false, thumbnail: false });
  return shot.ids.visible;
}

/** The hero's feet, m. */
async function feet(page: Page): Promise<[number, number, number]> {
  const { actor } = await call<{ actor: { x: number; y: number; z: number } }>(page, 'get', 1);
  return [actor.x, actor.y, actor.z];
}

/** Holds the key `code` for `frames` frames of the virtual clock, then lets go for as many. */
async function hold(page: Page, code: string, frames: number) {
  await page.keyboard.down(code);
  await page.evaluate((n) => window.__clock.tick(n), frames);
  await page.keyboard.up(code);
  await page.evaluate((n) => window.__clock.tick(n), frames);
}

/** Opens the room with a hero, ready on WebGPU, and walks him to the open middle of the room's north half. */
async function open(page: Page, harness: Harness, query = '') {
  await page.goto(`labs/box/?scene=room-hero${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
  await call(page, 'step', 24, { move: [0.8, 0.6] });
  await call(page, 'step', 30);
}

test.describe('the box, stage 2: a hero', () => {
  test.setTimeout(240_000);

  test('every camera sees the hero in the ID pass, with a sane share of the frame', async ({ page, harness }) => {
    await open(page, harness);
    for (const code of CAMERAS) {
      await call(page, 'camera.set', code);
      await call(page, 'render', 30); // the lagging cameras settle on him
      const visible = await seen(page);
      const hero = visible.find((object) => object.entity === 1);
      expect(hero, code).toMatchObject({ name: 'actor#1', protagonist: true });
      expect(hero!.px, code).toBeGreaterThanOrEqual(50); // in view, not a speck
      expect(hero!.share, code).toBeLessThan(0.5); // not filling the frame
      expect(Math.max(...visible.map((object) => object.share)), code).toBeLessThan(0.9); // not inside anything
    }
  });

  test('first person hides the hero’s body and draws his arms, and no wall covers more than 70% of its frame', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const jump = readFileSync(join(ROOT, 'tests/replays/box-2-jump.replay.json'), 'utf8');
    await call(page, 'replay', jump, { until: 170, draw: 0 }); // on top of the low wall, in the room's middle
    expect((await feet(page))[1]).toBeCloseTo(0.75, 2);
    let body = 0;
    for (const [yaw, pitch] of [
      [0, -5],
      [90, -5],
      [180, -5],
      [270, -5],
      [0, -70],
    ]) {
      const code = `cam3=first,${yaw},${pitch}`;
      expect((await call<{ culled: string[] }>(page, 'camera.set', code)).culled, code).toEqual([...JOINTS]);
      await call(page, 'render', 10);
      const first = await seen(page);
      expect(
        first.find((object) => object.name === 'actor#1'),
        code,
      ).toBeUndefined(); // the body hidden from it
      const arms = first.find((object) => object.name === 'actor#1/arms')?.share ?? 0; // its arms drawn instead
      expect(arms, `${code}: the arms`).toBeGreaterThan(0.003);
      expect(arms, `${code}: the arms`).toBeLessThan(0.25);
      for (const wall of first.filter((object) => object.name.startsWith('level:room/wall')))
        expect(wall.share, `${code}: ${wall.name}`).toBeLessThanOrEqual(0.7);
      await call(page, 'camera.set', 'cam3=fly'); // the same place and lens, culling nothing
      await call(page, 'render', 2);
      body = Math.max(body, (await seen(page)).find((object) => object.entity === 1)?.share ?? 0);
    }
    expect(body).toBeGreaterThan(0.05); // what first person hides: his body, seen from his own eyes
  });

  test('W walks away from the camera in every camera mode', async ({ page, harness }) => {
    await open(page, harness);
    for (const code of [...CAMERAS, 'cam3=first']) {
      await call(page, 'camera.set', code);
      await call(page, 'render', 2);
      const { yaw } = await call<{ yaw: number }>(page, 'camera.get');
      const before = await feet(page);
      await hold(page, 'KeyW', 20);
      const after = await feet(page);
      await hold(page, 'KeyS', 20); // and back, so every camera starts from the same place
      const [dx, dz] = [after[0] - before[0], after[2] - before[2]];
      const away = dx * Math.sin(yaw) + dz * Math.cos(yaw); // along the camera's heading, forward(yaw)
      expect(Math.hypot(dx, dz), code).toBeGreaterThan(1);
      expect(away, code).toBeGreaterThan(0.95 * Math.hypot(dx, dz));
    }
  });

  test('cycling every camera and resolution mode while he walks builds 0 pipelines after the warm-up', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    for (const code of [...CAMERAS, 'cam3=first']) {
      await call(page, 'camera.set', code);
      for (const mode of RESOLUTION_MODES) {
        await call(page, 'set', 'gfx.resolution', mode);
        await call(page, 'step', 6, { move: [0, 0.3] });
        const frame = await call<{ drawn: boolean; built: number }>(page, 'render', 2);
        expect(frame, `${code}, ${mode}`).toMatchObject({ drawn: true, built: 0 });
      }
    }
    const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
    expect(advice).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });
});
