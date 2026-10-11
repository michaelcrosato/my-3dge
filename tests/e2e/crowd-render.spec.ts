/**
 * @file T2 for crowd rendering and pose LOD (PLAN.md WP 5.4) on the crowd-render page (tests/pages/crowd-render.html).
 * - The crowd grows from 100 to 1,000 to 5,000 wanderers (walkers, slimes and wisps), every one in view and drawn,
 *   and no frame builds a pipeline, though the batches add pages; each frame's draw calls, the renderer's count beyond
 *   the empty scene's, are the crowd's own count with one shadow map, within `CROWD_DRAW_BUDGET`; the ID pass sees a
 *   page of every batch that drew.
 * - The sim's hash after 60 steps of 300 wanderers is the same with LOD on, with LOD off, and with nothing drawn, and
 *   it is the hash Node computes for the same scene (tests/pages/crowdRenderScene.ts); with LOD on every band was
 *   used and capes were left out far away, with LOD off every body was drawn in full, and no frame built a pipeline.
 * - Every kind of body draws: up close, the ID pass sees a page of every batch the frame filled (the humanoids'
 *   shapes and capes, the slimes' bodies, horns and wings, the wisps' cores and halos, the blob shadows).
 *
 * Invariants: frames are drawn by calling the page; draw calls are the renderer's (`renderer.info`), pipelines the
 * device's (engine/gfx/pipelines.ts); no advice is raised.
 */
import type { Page } from '@playwright/test';
import type { Grown, Ran } from '../pages/crowd-render';
import { createCrowdScene } from '../pages/crowdRenderScene';
import { expect, test } from './fixtures';

/**
 * The draw calls the 5,000-wanderer frame may cost with one shadow map. The crowd draws a call per shown page of each
 * batch (11 batches; pages of 8,192 instances), lit ones again in the shadow map: 46 measured. my-3d2dge's crowd cost
 * 1,225 (PLAN.md §7, I-21); 64 leaves room for a body or two more without hiding a regression to small pages.
 */
const CROWD_DRAW_BUDGET = 64;

/** What the page publishes as `window.__crowdPage` (tests/pages/crowd-render.ts), as far as this suite uses it. */
interface CrowdPage {
  grow(n: number): Promise<Grown>;
  ids(): Promise<{ name: string; px: number }[]>;
  run(mode: 'on' | 'off' | 'none', ticks?: number, every?: number): Promise<Ran>;
}
type CrowdWindow = { __crowdPage: CrowdPage };

const PAGE = 'tests/pages/crowd-render.html';

/** Calls `name` on the page with `args`. */
const call = <K extends keyof CrowdPage>(page: Page, name: K, ...args: Parameters<CrowdPage[K]>) =>
  page.evaluate(
    ([name, args]) => ((window as unknown as CrowdWindow).__crowdPage[name] as (...a: unknown[]) => unknown)(...args),
    [name, args] as const,
  ) as ReturnType<CrowdPage[K]>;

test('5,000 wanderers draw, no pipeline is built as the crowd grows, and draw calls stay within budget', async ({
  page,
  harness,
}) => {
  test.setTimeout(240_000);
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  const pages: Record<string, number>[] = [];
  for (const n of [100, 1000, 5000]) {
    const grown = await call(page, 'grow', n);
    expect(grown.frame, `${n}: drawn, building nothing`).toMatchObject({ drawn: true, built: 0 });
    expect(grown.pipelinesAfterWarmUp, `${n}: pipelines after the warm-up`).toBe(0);
    expect([grown.agents, grown.drawn, grown.crowd.bodies], `${n}: every wanderer drawn`).toEqual([n, n, n]);
    expect(grown.crowd.lod).toMatchObject({ outside: 0, far: 0, near: 0 });
    expect(grown.drawCalls - grown.empty, `${n}: the renderer's count, beyond the empty scene's`).toBe(grown.counted);
    expect(grown.counted, `${n}: draw calls with one shadow map`).toBeLessThanOrEqual(CROWD_DRAW_BUDGET);
    test.info().annotations.push({
      type: `${n} wanderers`,
      description: `${grown.counted} draw calls, ${grown.triangles} triangles`,
    });
    pages.push(grown.crowd.pages);
  }
  expect(pages[2]['crowd/puppets/ball'], 'pages added while playing').toBeGreaterThan(pages[0]['crowd/puppets/ball']);
  expect(harness.advice()).toEqual([]);
});

test('the sim hash is the same with LOD on, LOD off and nothing drawn, and the same as in Node', async ({
  page,
  harness,
}) => {
  test.setTimeout(120_000);
  await page.goto(PAGE);
  await harness.ready();

  const on = await call(page, 'run', 'on', 60, 6);
  const none = await call(page, 'run', 'none', 60, 6);
  const off = await call(page, 'run', 'off', 60, 6);
  const node = createCrowdScene({ seed: 7, side: 60 });
  node.grow(300);
  for (let tick = 0; tick < 60; tick++) node.world.step();

  expect(off.hash, 'LOD off').toBe(on.hash);
  expect(none.hash, 'nothing drawn').toBe(on.hash);
  expect(node.world.hash(), 'Node').toBe(on.hash);
  expect(
    on.bands.every((count) => count > 0),
    `LOD on: every band used (${on.bands})`,
  ).toBe(true);
  expect(off.bands.slice(1), 'LOD off: everything in full').toEqual(off.bands.slice(1).map(() => 0));
  expect(
    on.bands.reduce((a, b) => a + b),
    'the same bodies drawn',
  ).toBe(off.bands[0]);
  expect(on.culled, 'some out of view').toBeGreaterThan(0);
  expect(on.instances, 'capes left out far away').toBeLessThan(off.instances);
  expect([on.frames, off.frames, none.frames]).toEqual([10, 10, 0]);
  expect([on.built, off.built], 'pipelines built by the frames').toEqual([0, 0]);
  expect(harness.advice()).toEqual([]);
});

test('every body draws in its batches: the ID pass sees a page of each', async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();

  const { last } = await call(page, 'run', 'off', 6, 6);
  const seen = new Set((await call(page, 'ids')).map((entry) => entry.name));
  const drew = Object.entries(last!.instances).filter(([, count]) => count > 0);
  expect(drew.map(([batch]) => batch).sort(), 'humanoids, capes, slimes with horns and wings, wisps, shadows').toEqual([
    'crowd/puppets/ball',
    'crowd/puppets/eye',
    'crowd/puppets/limb@0.875',
    'crowd/puppets/limb@1',
    'crowd/puppets/strip',
    'crowd/rigs/ball',
    'crowd/rigs/ball~material:puppetHalo',
    'crowd/rigs/box',
    'crowd/rigs/cone',
    'crowd/rigs/eye',
    'crowd/shadows',
  ]);
  for (const [batch] of drew) expect(seen.has(`${batch}/page0`), `${batch} seen by the ID pass`).toBe(true);
  expect(harness.advice()).toEqual([]);
});
