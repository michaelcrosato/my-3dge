/**
 * @file T2 for the renderer (PLAN.md WP 2.1) on the scene page (tests/pages/scene.html): WebGPU is asserted and
 * `info()` reports the adapter's features and limits; a scripted session that switches resolution modes, resizes and
 * shows the registered pools builds 0 pipelines after the warm-up, drawn directly and through a post pass; a change
 * of the shader key (fog, shadows, a light) re-warms before anything is drawn; the counter sees a pipeline built
 * after the warm-up (`GFX_COLD_PIPELINE`) and is pinned to r182's internals; a feature off raises its advice code;
 * WebGPU's errors reach the log; and without WebGPU the page reports `GFX_NO_WEBGPU` and does nothing else.
 *
 * Invariants: every test but the startup test uses the fixture's page, so any unlisted advice fails it; the tests
 * that provoke advice read it through `harness.advice()`. Frames are drawn by calling the page (`__scene.draw`,
 * `__scene.settle`), and the virtual clock runs the page's own loop.
 */
import { chromium, type Page } from '@playwright/test';
import type { Log } from '../../engine/core/log';
import type { Settings } from '../../engine/core/settings';
import type { FrameReport, FrameView, Gfx, GfxInfo } from '../../engine/gfx/renderer';
import type { WarmupProgress, WarmupReport } from '../../engine/gfx/warmup';
import { chromiumPath, preparePage, VIEWPORT, type GpuLog } from '../../tools/lib/browser';
import { expect, test, type Harness } from './fixtures';

/** What the scene page publishes as `window.__scene` (tests/pages/scene.ts). */
interface ScenePage {
  gfx: Gfx;
  scene: import('three/webgpu').Scene;
  view: FrameView;
  settings: Settings;
  log: Log;
  startup: WarmupReport;
  progress: WarmupProgress[];
  three: typeof import('three/webgpu');
  draw(alpha?: number): FrameReport;
  settle(alpha?: number): Promise<FrameReport>;
  show(name: string, count?: number): void;
}

declare global {
  interface Window {
    /** The scene page's handle (tests/pages/scene.ts). */
    __scene: ScenePage;
  }
}

const PAGE = 'tests/pages/scene.html';

/** A 16:9 viewport whose three resolution modes all differ: pixels 427 × 240, balanced 640 × 360, full itself. */
const WIDE = { width: 1280, height: 720 };

/** Opens the scene page at `viewport` with `query`, waits for ready, and asserts WebGPU drew it. */
async function open(page: Page, harness: Harness, query = '', viewport = WIDE) {
  await page.setViewportSize(viewport);
  await page.goto(`${PAGE}${query}`);
  await harness.ready();
  return harness.assertWebGPU();
}

/** The renderer's stats and the canvas's drawing buffer and CSS scaling. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const { gfx } = window.__scene;
    const canvas = gfx.renderer.domElement;
    return { stats: gfx.stats(), canvas: [canvas.width, canvas.height], scaling: canvas.style.imageRendering };
  });

/** How many pixels differ between two frames of one size by more than 24 in some channel. */
function changed(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if ([0, 1, 2].some((c) => Math.abs(a[i + c] - b[i + c]) > 24)) count++;
  }
  return count;
}

test('starts on WebGPU; info() reports the adapter, its features and limits, and the features on', async ({
  page,
  harness,
}) => {
  const proof = await open(page, harness);
  const { info, adapterLimits, startup, progress, stats } = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const limits: Record<string, number> = {};
    for (const name in adapter!.limits) limits[name] = adapter!.limits[name as keyof GPUSupportedLimits] as number;
    const { startup, progress, gfx } = window.__scene;
    const info = (window as unknown as { __engine: { info(): GfxInfo } }).__engine.info();
    return { info, adapterLimits: limits, startup, progress, stats: gfx.stats() };
  });
  expect(info).toMatchObject({ backend: 'WebGPU', three: '182', downgrades: [] });
  expect(info.adapter).toMatchObject({ vendor: 'google', architecture: 'swiftshader', fallback: true });
  expect(info.features, 'info() lists every adapter feature').toEqual(proof.adapter.features);
  expect(info.features).toEqual(expect.arrayContaining(['timestamp-query', 'float32-filterable']));
  // The device has the adapter's limits, beyond WebGPU's defaults (a 128 MB storage binding by default).
  expect(info.limits).toEqual(adapterLimits);
  expect(info.limits.maxStorageBufferBindingSize).toBeGreaterThan(134217728);
  expect(info.enabled).toEqual(['feature:float32Filtering', 'feature:largeBuffers', 'feature:timestamps']);

  // The startup warm-up: one step per registered pool between the scene and the warm frame, with progress.
  expect(progress).toEqual([
    { done: 1, total: 4, step: 'scene' },
    { done: 2, total: 4, step: 'pool:flags' },
    { done: 3, total: 4, step: 'pool:sparks' },
    { done: 4, total: 4, step: 'frame' },
  ]);
  expect(startup).toMatchObject({ count: 1, entries: ['pool:flags', 'pool:sparks'] });
  expect(startup.compiled, 'compileAsync built most pipelines, off the frame').toBeGreaterThan(0);
  expect(startup.built).toBe(startup.compiled + startup.drawn);
  expect(stats).toMatchObject({ warmUps: 1, pipelinesAfterWarmUp: 0, pipelines: startup.built });
  expect(stats.drawCalls, 'renderer.info counts the frame').toBeGreaterThan(0);
  expect(stats.triangles).toBeGreaterThan(0);
  const frame = await harness.readFrame();
  expect(frame.blank).toBe(false);
  expect(frame.distinctColors, 'a lit, shadowed scene').toBeGreaterThan(50);
});

for (const query of ['', '?post=1']) {
  const how = query ? 'through a post pass' : 'directly';
  test(`a scripted session switching resolution modes and showing the pools builds 0 pipelines after warm-up, drawn ${how}`, async ({
    page,
    harness,
  }) => {
    await open(page, harness, query);
    const modes = [
      { mode: 'pixels', size: [427, 240], scaling: 'pixelated' },
      { mode: 'balanced', size: [640, 360], scaling: 'pixelated' },
      { mode: 'full', size: [1280, 720], scaling: '' },
      { mode: 'pixels', size: [427, 240], scaling: 'pixelated' },
    ];
    for (const { mode, size, scaling } of modes) {
      const frame = await page.evaluate(async (next) => {
        window.__scene.settings.set('gfx.resolution', next);
        return window.__scene.settle();
      }, mode);
      expect(frame, mode).toMatchObject({ drawn: true, built: 0 });
      const { stats, canvas, scaling: css } = await measure(page);
      expect({ mode: stats.mode, size: [stats.width, stats.height], canvas, css }, mode).toEqual({
        mode,
        size,
        canvas: size,
        css: scaling,
      });
    }
    // A resize: 540 screen lines give the engine's pixels at 2 screen pixels each.
    await page.setViewportSize(VIEWPORT);
    expect(await page.evaluate(() => window.__scene.settle())).toMatchObject({ drawn: true, built: 0 });
    expect((await measure(page)).canvas).toEqual([480, 270]);

    const before = await harness.readFrame();
    const shown = await page.evaluate(async () => {
      window.__scene.show('sparks', 32);
      window.__scene.show('flags');
      return window.__scene.settle();
    });
    expect(shown, 'showing the registered pools builds nothing').toMatchObject({ drawn: true, built: 0 });
    const after = await harness.readFrame();
    expect(changed(before.rgba, after.rgba), 'the pools are drawn').toBeGreaterThan(500);

    await harness.tick(10);
    const { stats } = await measure(page);
    expect(stats.frames, "the page's loop drew on each animation frame").toBeGreaterThanOrEqual(16);
    expect(stats).toMatchObject({ warmUps: 1, pipelinesAfterWarmUp: 0 });
  });
}

test('a shader-key change re-warms before anything is drawn: fog, shadows off, another light', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const changes = ['fog', 'shadows', 'light'];
  for (const [i, change] of changes.entries()) {
    const { first, settled, stats, key } = await page.evaluate(async (what) => {
      const { scene, gfx, three } = window.__scene;
      if (what === 'fog') scene.fog = new three.Fog(0x1d2430, 6, 30);
      if (what === 'shadows') gfx.renderer.shadowMap.enabled = false;
      if (what === 'light') {
        const lamp = new three.PointLight(0xffb070, 6, 0, 2);
        lamp.position.set(0, 2.5, 2);
        scene.add(lamp);
      }
      const first = window.__scene.draw();
      const settled = await window.__scene.settle();
      return { first, settled, stats: gfx.stats(), key: gfx.warmup.last!.key };
    }, change);
    expect(first, `${change}: the frame waits for the warm-up`).toMatchObject({ drawn: false, warming: true });
    expect(settled, change).toMatchObject({ drawn: true, built: 0 });
    expect(stats, change).toMatchObject({ warmUps: i + 2, pipelinesAfterWarmUp: 0 });
    expect(key).toContain({ fog: 'fog:linear', shadows: 'shadows:off', light: ',' }[change]);
  }
});

test('the counter sees a pipeline built after the warm-up (GFX_COLD_PIPELINE); registering it re-warms', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const cold = await page.evaluate(async () => {
    const { scene, three, gfx } = window.__scene;
    const probe = new three.Mesh(new three.BoxGeometry(0.5, 0.5, 0.5), new three.MeshNormalMaterial());
    probe.position.set(0, 2, 1);
    scene.add(probe);
    const frame = await window.__scene.settle();
    return { frame, stats: gfx.stats() };
  });
  expect(cold.frame.built, 'a material nothing warmed builds its pipeline in the frame').toBeGreaterThan(0);
  expect(cold.stats.pipelinesAfterWarmUp).toBe(cold.frame.built);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_COLD_PIPELINE']);

  const warmed = await page.evaluate(async () => {
    const { scene, three, gfx } = window.__scene;
    const later = new three.Mesh(new three.TorusGeometry(0.3, 0.1), new three.MeshPhongMaterial({ color: 0x55cc88 }));
    later.visible = false;
    scene.add(later);
    gfx.warmup.register('probe:later', { objects: () => [later] });
    const first = window.__scene.draw();
    await window.__scene.settle();
    later.visible = true;
    return { first, shown: await window.__scene.settle(), entries: gfx.warmup.last!.entries };
  });
  expect(warmed.first, 'a new entry changes the key: the warm-up runs first').toMatchObject({ warming: true });
  expect(warmed.entries).toContain('probe:later');
  expect(warmed.shown, 'shown after its warm-up, it builds nothing').toMatchObject({ drawn: true, built: 0 });
});

test("the pipeline counter is pinned to r182's internals", async ({ page, harness }) => {
  await open(page, harness);
  const pin = await page.evaluate(async (url) => {
    const { checkPinned, PINNED_REVISION } = await import(url);
    const { gfx, scene, three } = window.__scene;
    const pinned = checkPinned(gfx.renderer);
    const otherRelease = checkPinned(gfx.renderer, '183');
    // Internals of another shape, as a later release might give them: a renderer whose cache is no longer a Map.
    const changed = {
      _initialized: true,
      _pipelines: { caches: {}, programs: gfx.renderer },
    } as unknown as Gfx['renderer'];
    const renamed = checkPinned(changed);
    const unread = gfx.pipelines.count(changed).cached;
    // The cache it reads grows with the builds the device counts: a new material, one pipeline in both.
    const before = gfx.pipelines.count(gfx.renderer);
    scene.add(new three.Mesh(new three.SphereGeometry(0.2), new three.MeshToonMaterial({ color: 0xffffff })));
    await window.__scene.settle();
    const after = gfx.pipelines.count(gfx.renderer);
    return { revision: three.REVISION, PINNED_REVISION, pinned, otherRelease, renamed, unread, before, after };
  }, '/engine/gfx/pipelines.ts');
  expect(pin.revision).toBe(pin.PINNED_REVISION);
  expect(pin.pinned, 'r182 has the internals the counter reads').toEqual([]);
  expect(pin.otherRelease).toEqual(["three.js is r183, the counter reads r182's internals"]);
  expect(pin.renamed).toEqual([
    'renderer._pipelines.caches is not a Map',
    'renderer._pipelines.programs.vertex is not a Map',
    'renderer._pipelines.programs.fragment is not a Map',
    'renderer._pipelines.programs.compute is not a Map',
    'renderer._nodes.nodeFrame.update is not a function',
  ]);
  expect(pin.unread, 'unreadable internals give no cached count').toBeNull();
  expect(pin.after.built - pin.before.built).toBe(1);
  expect(pin.after.cached! - pin.before.cached!).toBe(1);
  expect(harness.advice().map((advice) => advice.code)).toEqual(['GFX_PIPELINES_UNPINNED', 'GFX_COLD_PIPELINE']);
});

test('a feature that gfx.featuresOff lists is off, with its advice code; play and the warm-up are unchanged', async ({
  page,
  harness,
}) => {
  const off = encodeURIComponent(JSON.stringify(['feature:timestamps', 'feature:largeBuffers']));
  await open(page, harness, `?gfx.featuresOff=${off}`);
  const { info, advice, stats } = await page.evaluate(() => {
    const { gfx, log } = window.__scene;
    return {
      info: gfx.info,
      advice: log.advice.map(({ code, subject, message }) => ({ code, subject, message })),
      stats: gfx.stats(),
    };
  });
  expect(info.enabled).toEqual(['feature:float32Filtering']);
  expect(info.downgrades).toEqual(['GFX_NO_TIMESTAMPS', 'GFX_SMALL_BUFFERS']);
  expect(advice).toEqual([
    {
      code: 'GFX_SMALL_BUFFERS',
      subject: 'feature:largeBuffers',
      message:
        'feature:largeBuffers is off: gfx.featuresOff lists it; GPU techniques with large buffers run smaller or stay off',
    },
    {
      code: 'GFX_NO_TIMESTAMPS',
      subject: 'feature:timestamps',
      message: 'feature:timestamps is off: gfx.featuresOff lists it; the GPU time per frame stays unmeasured',
    },
  ]);
  expect(harness.advice().map((warning) => warning.code)).toEqual(['GFX_SMALL_BUFFERS', 'GFX_NO_TIMESTAMPS']);
  expect(stats).toMatchObject({ pipelinesAfterWarmUp: 0, warmUps: 1 });
  expect((await harness.readFrame()).blank).toBe(false);
});

test('WebGPU errors and a lost device reach the log; the frame alpha is checked and kept', async ({
  page,
  harness,
}) => {
  await open(page, harness);
  const alpha = await page.evaluate(() => {
    window.__scene.draw(0.25);
    const kept = window.__scene.gfx.stats().alpha;
    let refused = '';
    try {
      window.__scene.draw(1.5);
    } catch (error) {
      refused = (error as { code: string }).code;
    }
    return { kept, refused };
  });
  expect(alpha).toEqual({ kept: 0.25, refused: 'GFX_BAD_ALPHA' });

  // An uncaptured validation error: a buffer mapped both for reading and for writing.
  await page.evaluate(async () => {
    window.__scene.gfx.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE });
    // WebGPU reports it once the device next works: the next frame.
    await window.__scene.settle();
  });
  await expect
    .poll(() => page.evaluate(() => window.__scene.log.errors.map(({ code, values }) => ({ code, kind: values.kind }))))
    .toEqual([{ code: 'GFX_GPU_ERROR', kind: 'GPUValidationError' }]);
  // A lost device, as three.js reports one.
  const lost = await page.evaluate(() => {
    const { gfx, log } = window.__scene;
    gfx.renderer.onDeviceLost({ api: 'WebGPU', message: 'lost on purpose', reason: null, originalEvent: null });
    return log.errors.at(-1);
  });
  expect(lost).toMatchObject({
    code: 'GFX_DEVICE_LOST',
    message: 'the GPU device was lost (unknown): lost on purpose',
  });
  expect(harness.advice().map((warning) => warning.code)).toEqual(['GFX_GPU_ERROR', 'GFX_DEVICE_LOST']);
});

test('the startup test: without the WebGPU flags the scene page reports GFX_NO_WEBGPU and does nothing else', async ({
  baseURL,
}) => {
  // An explicit empty args: Playwright Test merges the project's launch options (WEBGPU_FLAGS) into a launch without.
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: [] });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const watch = await preparePage(page);
    await page.goto(new URL(PAGE, baseURL).href);
    const signals = () =>
      page.evaluate(() => {
        const engine = (window as unknown as { __engine: { ready: boolean; errors: { code: string }[] } }).__engine;
        return { ready: engine.ready, codes: engine.errors.map((error) => error.code), gpu: window.__gpu };
      });
    await expect.poll(async () => (await signals()).codes, { timeout: 15_000 }).toEqual(['GFX_NO_WEBGPU']);
    const nothing: GpuLog = { adapters: [null], devices: 0, contexts: 0, submits: 0, lost: [] };
    expect(await signals()).toEqual({ ready: false, codes: ['GFX_NO_WEBGPU'], gpu: nothing });
    expect(await page.evaluate(() => '__scene' in window)).toBe(false);
    expect(await watch.errors()).toEqual([]);
  } finally {
    await browser.close();
  }
});
