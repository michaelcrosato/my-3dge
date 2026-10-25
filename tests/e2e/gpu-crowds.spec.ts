/**
 * @file T2 for GPU-driven crowds (PLAN.md WP 11.4, `feature:gpuCrowds`) on the gpu-crowds page (tests/pages/
 * gpu-crowds.html): the same wanderers drawn by a crowd through the instancing service (`cpu`) and through a GPU crowd
 * (`gpu`, engine/gfx/enhanced/crowds.ts).
 * - Growing from 100 to 1,000 to 5,000 wanderers, every one in view: the GPU crowd draws a call a batch (again in the
 *   shadow map for casting ones), the renderer's count beyond the empty scene's is the crowd's own, at 5,000 at most
 *   half the instancing service's, the cull's two compute calls a frame, and no frame builds a pipeline.
 * - The cull, read back: from a low corner, where some wanderers are out of view, each batch keeps exactly the
 *   instances whose spheres touch the view (by the CPU's own test on the matrices it wrote; within 1 mm of a plane
 *   either way), in the order they were written; seen from high above, every instance.
 * - The picture: through either crowd, the same frame differs in no more than `PICTURE_SHARE` of its pixels, its
 *   materials in each of the four styles (the GPU crowd's copies re-pointed as the looks re-point them).
 * - The ID pass sees a mesh of every batch that drew.
 *
 * Invariants: frames are drawn by calling the page; draw calls are the renderer's (`renderer.info`), pipelines the
 * device's (engine/gfx/pipelines.ts); no advice is raised.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The share of a frame's pixels the two crowds may draw apart: pieces cut by the view's edge drop their shadows. */
const PICTURE_SHARE = 0.002;

/** One frame's counts, as the page returns them. */
interface Framed {
  drawn: number;
  frame: { drawn: boolean; built: number };
  drawCalls: number;
  computeCalls: number;
  counted: number;
  pipelinesAfterWarmUp: number | null;
  crowd: { bodies: number; instances: Record<string, number> };
  gpu: { instances: number; culls: number; dropped: number } | null;
}

/** A batch's cull, read back. */
interface Culled {
  batch: number;
  shown: number;
  kept: number;
  got: number;
  maybe: number;
  order: boolean;
}

/** What the page publishes as `window.__gpuCrowdsPage` (tests/pages/gpu-crowds.ts), as far as this suite uses it. */
interface GpuCrowdsPage {
  grow(n: number, place?: 'high' | 'low'): { agents: number };
  frame(path: 'cpu' | 'gpu'): Promise<Framed>;
  compare(threshold?: number, style?: string): Promise<{ pixels: number; over: number; any: number }>;
  cull(): Promise<Culled[] | null>;
  ids(path: 'cpu' | 'gpu'): Promise<{ name: string; px: number }[]>;
}
type PageWindow = { __gpuCrowdsPage: GpuCrowdsPage };

const PAGE = 'tests/pages/gpu-crowds.html';

/** Calls `name` on the page with `args`. */
const call = <K extends keyof GpuCrowdsPage>(page: Page, name: K, ...args: Parameters<GpuCrowdsPage[K]>) =>
  page.evaluate(
    ([name, args]) =>
      ((window as unknown as PageWindow).__gpuCrowdsPage[name] as (...a: unknown[]) => unknown)(...args),
    [name, args] as const,
  ) as Promise<Awaited<ReturnType<GpuCrowdsPage[K]>>>;

/** Each culled batch kept what the CPU's test keeps, in order. */
function expectCulled(culled: Culled[] | null, where: string): void {
  expect(culled, `${where}: the GPU crowd's buffers`).not.toBeNull();
  for (const batch of culled!) {
    const label = `${where}, batch ${batch.batch}`;
    expect(batch.got, `${label}: kept`).toBeGreaterThanOrEqual(batch.kept - batch.maybe);
    expect(batch.got, `${label}: kept`).toBeLessThanOrEqual(batch.kept);
    expect(batch.order, `${label}: in the order written`).toBe(true);
  }
}

test('each batch draws once, a GPU crowd builds no pipeline as it grows, and draws half the calls at 5,000', async ({
  page,
  harness,
}) => {
  test.setTimeout(300_000);
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();
  for (const n of [100, 1000, 5000]) {
    await call(page, 'grow', n);
    const cpu = await call(page, 'frame', 'cpu');
    const gpu = await call(page, 'frame', 'gpu');
    for (const [path, framed] of [
      ['cpu', cpu],
      ['gpu', gpu],
    ] as const) {
      expect(framed.frame, `${n}, ${path}: drawn, building nothing`).toMatchObject({ drawn: true, built: 0 });
      expect(framed.pipelinesAfterWarmUp, `${n}, ${path}: pipelines after the warm-up`).toBe(0);
      expect([framed.drawn, framed.crowd.bodies], `${n}, ${path}: every wanderer drawn`).toEqual([n, n]);
      expect(framed.drawCalls, `${n}, ${path}: the renderer's count, beyond the empty scene's`).toBe(framed.counted);
    }
    expect(gpu.crowd.instances, `${n}: the same instances written`).toEqual(
      Object.fromEntries(Object.entries(cpu.crowd.instances).map(([name, count]) => [name.replace(/^cpu\//, 'gpu/'), count])), // prettier-ignore
    );
    expect(gpu.computeCalls - cpu.computeCalls, `${n}: the cull's two calls`).toBe(2);
    expect(gpu.gpu).toMatchObject({ dropped: 0 });
    test.info().annotations.push({ type: `${n} wanderers`, description: `${cpu.counted} draw calls through pages, ${gpu.counted} through the GPU crowd` }); // prettier-ignore
    if (n === 5000) expect(gpu.counted * 2, `${n}: at most half the pages' calls`).toBeLessThanOrEqual(cpu.counted);
    expectCulled(await call(page, 'cull'), `${n} from high above`);
  }
  expect(harness.advice()).toEqual([]);
});

test('the cull keeps what the view shows, in order, and the picture is the instancing service’s', async ({
  page,
  harness,
}) => {
  test.setTimeout(240_000);
  await page.goto(PAGE);
  await harness.ready();
  await call(page, 'grow', 1000, 'low');
  await call(page, 'frame', 'gpu');
  const culled = await call(page, 'cull');
  expectCulled(culled, 'from a low corner');
  const kept = culled!.reduce((sum, batch) => sum + batch.got, 0);
  const shown = culled!.reduce((sum, batch) => sum + batch.shown, 0);
  expect(kept, 'some instances culled').toBeLessThan(shown);
  for (const style of ['lambert', 'toon', 'flat', 'pbr']) {
    const picture = await call(page, 'compare', 8, style);
    test.info().annotations.push({ type: `picture, ${style}`, description: `${picture.over} of ${picture.pixels} pixels apart by more than 8, ${picture.any} at all` }); // prettier-ignore
    expect(picture.over / picture.pixels, `${style}: pixels apart`).toBeLessThanOrEqual(PICTURE_SHARE);
  }
  expect(harness.advice()).toEqual([]);
});

test('the ID pass sees a mesh of every batch that drew', async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
  await call(page, 'grow', 300, 'low');
  const { crowd } = await call(page, 'frame', 'gpu');
  const seen = new Set((await call(page, 'ids', 'gpu')).map((entry) => entry.name));
  const drew = Object.entries(crowd.instances).filter(([, count]) => count > 0);
  expect(drew.length).toBeGreaterThan(5);
  for (const [batch] of drew) expect(seen.has(`${batch}/gpu`), `${batch} seen by the ID pass`).toBe(true);
  expect(harness.advice()).toEqual([]);
});
