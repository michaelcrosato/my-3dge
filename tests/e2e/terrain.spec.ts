/**
 * @file T2 for terrain (PLAN.md WP 10.5; engine/gfx/terrain.ts), on the playground's hill (`?scene=hill`,
 * labs/playground/scenes/hill.ts), by `window.__engine`:
 * 1. the hill opens on WebGPU and its frames build 0 pipelines after the warm-up through the five cameras and both
 *    looks while the player runs up the slope; then the ID pass sees the chunk under the player at its finest level in
 *    every one of those views;
 * 2. running down from the hilltop switches the far chunks' levels with 0 pipelines built; from the top looking west,
 *    the near chunk draws at its finest level and the far ones coarser;
 * 3. the hill's replay (tests/replays/terrain-hill.replay.json) keeps its goldens in the page while it renders through
 *    every camera mode and both looks: the terrain's drawing never changes play.
 *
 * Invariants: the sim is stepped with `__engine.step` and frames drawn with `__engine.render`; the page is read through
 * `__engine` only. Pipelines are counted before any ID shot, as tests/e2e/level-meshes.spec.ts counts them: the ID
 * pass is a tool's pass, which builds its own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS } from '../../labs/playground/views';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** The hill's replay. */
const HILL = readFileSync(join(import.meta.dirname, '../replays/terrain-hill.replay.json'), 'utf8');

/** Calls the `__engine` member at `path` (`camera.get`) with `args`. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** The terrain's meshes the ID pass sees in a shot of the frame drawn now. */
async function terrainSeen(page: Page): Promise<string[]> {
  type Ids = { ids: { visible: { name: string; px: number }[] } };
  const shot = await call<Ids>(page, 'shot', { ids: true, metrics: false, thumbnail: false });
  return shot.ids.visible.map((entry) => entry.name).filter((name) => name.startsWith('terrain:block/'));
}

/** Opens the hill and waits for it. */
async function open(page: Page, harness: { ready(o: { timeout: number }): Promise<unknown> }) {
  await page.goto('labs/playground/?scene=hill');
  await harness.ready({ timeout: 120_000 });
  await call(page, 'pause');
  await call(page, 'render', 2);
}

test.describe('terrain, on the playground’s hill', () => {
  test.setTimeout(300_000);

  test('builds 0 pipelines after the warm-up through every camera and both looks, and sees the chunk under the player at its finest', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await harness.assertWebGPU();
    const views = PLAYGROUND_LOOKS.flatMap((look) => PLAYGROUND_CAMERAS.map((mode) => ({ look, mode })));
    for (const { look, mode } of views) {
      await call(page, 'set', 'post.look', look);
      await call(page, 'camera.set', mode.code);
      await call(page, 'step', 6, { move: [1, 0] });
      await call(page, 'render', 2);
      const { pipelinesAfterWarmUp } = await call<{ pipelinesAfterWarmUp: number }>(page, 'stats');
      expect(pipelinesAfterWarmUp, `${look} ${mode.name}`).toBe(0);
    }
    const under = 'terrain:block/64,32#0'; // the player, near (77, 48) by now: the chunk from (64, 32)
    for (const { look, mode } of views) {
      await call(page, 'set', 'post.look', look);
      await call(page, 'camera.set', mode.code);
      await call(page, 'render', 2);
      expect(await terrainSeen(page), `${look} ${mode.name}`).toContain(under);
    }
    expect(harness.advice()).toEqual([]);
  });

  test('switches the far chunks’ levels building nothing, and draws the near chunk finest and the far ones coarser', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await call(page, 'camera.set', PLAYGROUND_CAMERAS[0].code); // the shooter
    const top = { at: [94, 10, 48], yaw: -Math.PI / 2 }; // on the hill's top, facing west
    await call(page, 'actions.run', 'place', top);
    await call(page, 'step', 30, { look: [-Math.PI / 2, -0.15], cam: -Math.PI / 2 });
    for (let k = 0; k < 6; k++) {
      await call(page, 'step', 20, { move: [-1, 0] }); // running down toward them: they switch levels
      await call(page, 'render', 1);
    }
    expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
    await call(page, 'actions.run', 'place', top);
    await call(page, 'step', 30, {});
    await call(page, 'render', 2);
    const seen = await terrainSeen(page);
    expect(seen).toContain('terrain:block/64,32#0');
    expect(seen.some((name) => /^terrain:block\/(0|32),\d+#[12]$/.test(name)), seen.join(', ')).toBe(true); // prettier-ignore
    for (const name of seen) expect(seen.filter((other) => other.split('#')[0] === name.split('#')[0])).toHaveLength(1); // prettier-ignore
    expect(harness.advice()).toEqual([]);
  });

  test('keeps the hill replay’s goldens while it renders through every camera mode and both looks', async ({
    page,
    harness,
  }) => {
    test.setTimeout(600_000); // 900 frames drawn, one a step, on SwiftShader
    await open(page, harness);
    const views: [number, { cam?: string; set?: Record<string, string> }][] = [
      ...PLAYGROUND_CAMERAS.map((mode, i): [number, { cam: string }] => [i * 150, { cam: mode.code }]),
      [400, { set: { 'post.look': PLAYGROUND_LOOKS[1] } }],
    ];
    const run = await call<{ hashes: Record<string, string> }>(page, 'replay', HILL, { views });
    const goldens = (JSON.parse(HILL) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
    expect(run.hashes).toEqual(goldens);
    expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
    expect(harness.advice()).toEqual([]);
  });
});
