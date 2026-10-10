/**
 * @file T2 for the hello page (`labs/hello/`, PLAN.md WP 0.8): three.js r182 draws a lit cube on WebGPU (SwiftShader
 * here), directly and through one `PostProcessing` pass, with no warning in the console; Vite resolves `three/webgpu`
 * and `three/tsl` in the browser and sends a bare `three` to the same module; without WebGPU the page reports
 * `GFX_NO_WEBGPU` and does nothing else; a scene that fails to load shows on the page.
 *
 * Invariants: the fixture's advice trap is on for every test that uses its `page`, so any unlisted warning fails it.
 * The startup test launches its own Chromium without `WEBGPU_FLAGS`; everything else uses the project's browser.
 */
import { readFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { chromiumPath, preparePage, VIEWPORT, type GpuLog } from '../../tools/lib/browser';
import { frameMetrics } from '../../tools/cmd/shot';
import { findUnlisted, loadAllowList } from '../setup/adviceTrap';
import { expect, test, type Harness } from './fixtures';

const PAGE = 'labs/hello/';

/** A three.js addon that imports a bare `three`, as many do. */
const ADDON = 'node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** A module as the dev server serves it to the browser. */
async function served(baseURL: string | undefined, path: string): Promise<string> {
  const response = await fetch(new URL(path, baseURL));
  expect(response.status, `the dev server serves ${path}`).toBe(200);
  return response.text();
}

/** The specifiers of a served module's static imports, in order. */
const importsOf = (code: string) => [...code.matchAll(/^import [^;]*? from "([^"]+)";?$/gm)].map((match) => match[1]);

/** The page's `__engine`, as the hello page publishes it (labs/hello/boot.ts). */
interface HelloEngine {
  ready: boolean;
  errors: { code: string; message: string; fix: string }[];
  info(): {
    page: string;
    post: boolean;
    backend?: string;
    adapter?: { architecture: string };
    features?: string[];
    three?: string;
  };
}

/** Reads the page's `__engine` state and the text it shows. */
const pageState = (page: Page) =>
  page.evaluate(() => {
    const engine = (window as unknown as { __engine: HelloEngine }).__engine;
    const message = document.querySelector<HTMLElement>('#msg');
    return {
      ready: engine.ready,
      errors: engine.errors,
      info: engine.info(),
      text: message?.hidden ? '' : (message?.textContent ?? ''),
      gpu: window.__gpu,
    };
  });

/** Opens the hello page with `query`, asserts WebGPU drew it, and measures its frame. */
async function shoot(page: Page, harness: Harness, query = '') {
  await page.goto(`${PAGE}${query}`);
  await harness.ready();
  const proof = await harness.assertWebGPU();
  const frame = await harness.readFrame();
  return { proof, frame, metrics: frameMetrics(frame.rgba, frame.width, frame.height), state: await pageState(page) };
}

test('draws a lit cube on WebGPU, through the post pass and directly, with no warning', async ({ page, harness }) => {
  const post = await shoot(page, harness);
  expect(post.proof.adapter).toMatchObject({ vendor: 'google', architecture: 'swiftshader' });
  expect(post.state.info).toMatchObject({ page: 'hello', post: true, backend: 'WebGPU', three: '182' });
  expect(post.state.info.features).toEqual(post.proof.adapter.features);
  expect(post.state.text, 'the loading message is hidden once ready').toBe('');

  const direct = await shoot(page, harness, '?post=0');
  expect(direct.state.info).toMatchObject({ post: false, backend: 'WebGPU' });

  for (const [name, { frame, metrics }] of Object.entries({ post, direct })) {
    expect([frame.width, frame.height], name).toEqual([VIEWPORT.width, VIEWPORT.height]);
    expect(frame.blank, `${name}: the frame is blank`).toBe(false);
    // The cube covers a sizeable middle part of the frame, lit: many shades, a real luma spread.
    expect(metrics.coverage, `${name}: coverage`).toBeGreaterThan(0.08);
    expect(metrics.coverage, `${name}: coverage`).toBeLessThan(0.4);
    expect(metrics.lumaP95 - metrics.lumaP5, `${name}: luma spread`).toBeGreaterThan(0.1);
    expect(metrics.colors, `${name}: colours`).toBeGreaterThan(50);
    expectBackground(frame.pixel(2, 2), name);
    expect(sameColour(frame.pixel(480, 270), frame.pixel(2, 2)), `${name}: the cube is at the centre`).toBe(false);
  }
  // The grade changes colours only: the same pixels are covered, and the post frame is warmer.
  expect(Math.abs(post.metrics.coverage - direct.metrics.coverage)).toBeLessThan(0.01);
  const warmth = (pixel: number[]) => pixel[0] - pixel[2];
  expect(warmth(post.frame.pixel(480, 270))).toBeGreaterThan(warmth(direct.frame.pixel(480, 270)));
});

test('Vite resolves three/webgpu and three/tsl in the browser, and sends a bare three to the same module', async ({
  page,
  harness,
  baseURL,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  // The scene module's three.js imports, as Vite rewrote them for the browser.
  const scene = importsOf(await served(baseURL, 'labs/hello/hello.ts'));
  const webgpu = scene.find((url) => url.startsWith('/node_modules/.vite/deps/three_webgpu.js?v='));
  const tsl = scene.find((url) => url.startsWith('/node_modules/.vite/deps/three_tsl.js?v='));
  expect(webgpu, `three/webgpu is pre-bundled; the scene imports ${scene.join(', ')}`).toBeDefined();
  expect(tsl, `three/tsl is pre-bundled; the scene imports ${scene.join(', ')}`).toBeDefined();

  // three.js's own addons import a bare 'three' (engine code never does: ESLint bans it). The alias sends that
  // import to the very module three/webgpu resolves to, and the browser links it there.
  expect(readFileSync(ADDON, 'utf8')).toMatch(/^} from 'three';$/m);
  expect(importsOf(await served(baseURL, ADDON))).toEqual([webgpu]);
  const linked = await page.evaluate(
    async ([addonUrl, webgpuUrl]) => {
      const addon = await import(addonUrl);
      const three = await import(webgpuUrl);
      return {
        extendsWebGPUBuild: Object.getPrototypeOf(addon.RoundedBoxGeometry) === three.BoxGeometry,
        renderer: typeof three.WebGPURenderer,
      };
    },
    [`/${ADDON}`, webgpu as string],
  );
  expect(linked).toEqual({ extendsWebGPUBuild: true, renderer: 'function' });

  // The page holds one three.js build, the WebGPU one, and three/tsl; never the WebGL build.
  const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  const deps = loaded.map((url) => new URL(url).pathname).filter((path) => path.includes('/.vite/deps/three'));
  expect(deps.sort()).toEqual(['/node_modules/.vite/deps/three_tsl.js', '/node_modules/.vite/deps/three_webgpu.js']);
  expect(loaded.filter((url) => /three\.module\.js|three\.cjs/.test(url))).toEqual([]);
});

test('the startup test: without the WebGPU flags the page reports GFX_NO_WEBGPU and does nothing else', async ({
  baseURL,
}) => {
  // An explicit empty args: Playwright Test merges the project's launch options (WEBGPU_FLAGS) into a launch without.
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: [] });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const watch = await preparePage(page);
    await page.goto(new URL(PAGE, baseURL).href);
    await expect.poll(async () => (await pageState(page)).errors.length, { timeout: 15_000 }).toBe(1);
    const state = await pageState(page);
    expect(state.errors).toEqual([
      {
        code: 'GFX_NO_WEBGPU',
        message: 'WebGPU is unavailable: navigator.gpu.requestAdapter() gave no adapter',
        fix: expect.stringContaining('WEBGPU_FLAGS'),
      },
    ]);
    const [error] = state.errors;
    expect(state.text).toBe(`GFX_NO_WEBGPU: ${error.message}\nFix: ${error.fix}`);
    expect(state.ready).toBe(false);
    expect(state.info).toEqual({ page: 'hello', post: true });
    const nothing: GpuLog = { adapters: [null], devices: 0, contexts: 0, submits: 0, lost: [] };
    expect(state.gpu).toEqual(nothing);

    // Animation frames come and go; still nothing happens.
    await page.evaluate(() => window.__clock.tick(10));
    expect(await pageState(page)).toEqual(state);
    expect(await watch.errors()).toEqual([]);
    // The page prints one line, the coded error in the advice trap's form (read here on purpose). Chromium itself
    // says WebGPU is missing in lines without a source URL ("WebGPU is experimental on this platform", "Failed to
    // create WebGPU Context Provider"), and Vite's client logs its connection: neither is the page's doing.
    const pageLines = watch.console.filter((line) => line.url && !line.url.endsWith('/@vite/client'));
    expect(pageLines.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: 'error', text: `[GFX_NO_WEBGPU] ${error.message}. Fix: ${error.fix}` },
    ]);
    expect(findUnlisted(pageLines, loadAllowList()).map((warning) => warning.code)).toEqual(['GFX_NO_WEBGPU']);
  } finally {
    await browser.close();
  }
});

test('a scene that fails to load shows on the page, naming the fix', async ({ page, harness }) => {
  await page.route('**/labs/hello/hello.ts*', (route) => route.fulfill({ status: 500, body: 'broken on purpose' }));
  await page.goto(PAGE);
  await expect(harness.ready()).rejects.toThrow('the page signalled an error: HELLO_LOAD: the scene could not load');
  const state = await pageState(page);
  expect(state.ready).toBe(false);
  expect(state.text).toMatch(
    /^HELLO_LOAD: the scene could not load \(.+\)\nFix: reload the page; .+x shot labs\/hello/,
  );
  expect(state.gpu.devices, 'nothing reached the GPU').toBe(0);
});

/** Whether two RGBA pixels have the same colour within ±2 per channel. */
function sameColour(a: number[], b: number[]): boolean {
  return [0, 1, 2].every((c) => Math.abs(a[c] - b[c]) <= 2);
}

/** Asserts that a corner pixel is the scene's dark blue-grey background, whatever the grade did to it. */
function expectBackground(pixel: number[], what: string): void {
  const [r, g, b] = pixel;
  expect(Math.max(r, g, b), `${what}: the background is dark (rgb ${r}, ${g}, ${b})`).toBeLessThan(80);
  expect(b, `${what}: the background is blue-grey (rgb ${r}, ${g}, ${b})`).toBeGreaterThan(r);
}
