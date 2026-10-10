/**
 * @file The shared e2e fixture (PLAN.md §8.8): every suite imports `test` and `expect` from here. Before any page
 * script runs, each page gets the virtual clock, seeded `Math.random` and named streams, and the WebGPU probe
 * (`tools/lib/browser.ts`). Each test gets a `harness`: the `ready || error` wait, `assertWebGPU`, `readFrame`,
 * `tick`, the console it captured, its page errors (mapped to `.ts` files and lines) and the advice trap's catch.
 *
 * Invariants: a page error the test never read fails the test, naming its file and line; so does an advice code,
 * `console.warn` or three.js deprecation that no file under tests/baselines/advice/ lists and the test never read
 * through `harness.advice()` (the advice trap, tests/setup/adviceTrap.ts); `ready()` turns a startup crash into one
 * line instead of a hang; `readFrame` is a Playwright screenshot of the canvas element (§4.8). The
 * seed is 1 unless a suite sets `test.use({ seed })`.
 *
 * @example
 * test('draws', async ({ page, harness }) => {
 *   await page.goto('tests/pages/harness.html');
 *   await harness.ready();
 *   await harness.assertWebGPU();
 *   expect((await harness.readFrame()).blank).toBe(false);
 * });
 * @see tests/e2e/harness.spec.ts
 */
import { decodePng } from '../../tools/lib/png';
import { test as base, expect, type Page } from '@playwright/test';
import {
  describePageError,
  preparePage,
  type AdapterRecord,
  type ConsoleRecord,
  type PageError,
} from '../../tools/lib/browser';
import { describeUnlisted, findUnlisted, loadAllowList, type Warning } from '../setup/adviceTrap';

/** Playwright's `expect`, re-exported so a suite imports everything from this file. */
export { expect };

/** What WebGPU did in the page, as `assertWebGPU` measured it. */
export interface WebGPUProof {
  /** The adapter the page got (on this platform: vendor `google`, architecture `swiftshader`). */
  adapter: AdapterRecord;
  devices: number;
  /** Canvas contexts configured for WebGPU. */
  contexts: number;
  /** Command-buffer submits. */
  submits: number;
  /** The backend the page itself reports through `__engine.info().backend`, when it reports one. */
  backend?: string;
}

/** A frame read from the page: decoded RGBA pixels plus the PNG. */
export interface Frame {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes a pixel. */
  rgba: Uint8Array;
  /** The screenshot as Playwright returned it. */
  png: Buffer;
  /** How many different colours the frame holds. */
  distinctColors: number;
  /** True when every pixel has the same colour. */
  blank: boolean;
  /** The RGBA bytes of the pixel at (x, y), from the top left. */
  pixel(x: number, y: number): [number, number, number, number];
}

/** What each test gets as `harness`. */
export interface Harness {
  /**
   * Waits for `__engine.ready` and checks the virtual clock is installed; rejects in one line on `__engine.errors`,
   * a page error or the timeout.
   */
  ready(options?: { timeout?: number }): Promise<void>;
  /** Asserts that WebGPU really ran: an adapter, a device, a configured canvas, submits, no lost device. */
  assertWebGPU(): Promise<WebGPUProof>;
  /** Screenshots the element matching `selector` (the first canvas by default) and decodes it. */
  readFrame(selector?: string): Promise<Frame>;
  /** Runs `frames` display frames of the virtual clock (1/60 s each). */
  tick(frames?: number): Promise<void>;
  /** Every console message so far. */
  console: ConsoleRecord[];
  /** Every page error so far, mapped to sources; reading them means the test handles them. */
  errors(): Promise<PageError[]>;
  /**
   * The advice codes, warnings and three.js deprecations so far that no file under tests/baselines/advice/ lists;
   * reading them means the test handles them (a test that provokes advice on purpose asserts on these).
   */
  advice(): Warning[];
}

/** The advice trap's allow list, read once per worker. */
const ALLOWED = loadAllowList();

/** The ready-or-error signal a page publishes as `window.__engine` (PLAN.md §8.3); only these members are read. */
interface PageSignals {
  ready?: boolean;
  errors?: { code?: string; message?: string }[];
  info?: () => { backend?: string };
}

export { decodePng };

/** Reads the page's `__engine` signal, if any. */
function readSignals(page: Page): Promise<{ ready: boolean; errors: string[] } | undefined> {
  return page.evaluate(() => {
    const signals = (window as unknown as { __engine?: PageSignals }).__engine;
    if (!signals) return undefined;
    const errors = (signals.errors ?? []).map((error) => `${error.code ?? 'ERROR'}: ${error.message ?? ''}`);
    return { ready: signals.ready === true, errors };
  });
}

/** Playwright's `test` with the `seed` option (default 1) and the `harness` fixture, set up for every test. */
export const test = base.extend<{ seed: number; harness: Harness }>({
  seed: [1, { option: true }],
  harness: [
    async ({ page, seed }, use) => {
      const watch = await preparePage(page, { seed });
      let read = 0;
      let adviceRead = 0;
      let count = 0;
      page.on('pageerror', () => count++);
      const harness: Harness = {
        console: watch.console,
        async errors() {
          const all = await watch.errors();
          read = all.length;
          return all;
        },
        advice() {
          const all = findUnlisted(watch.console, ALLOWED);
          adviceRead = all.length;
          return all;
        },
        async ready({ timeout = 15_000 } = {}) {
          const deadline = Date.now() + timeout;
          for (;;) {
            if (count > 0) {
              const all = await watch.errors();
              read = all.length;
              throw new Error(`page error before ready: ${describePageError(all[0])}`);
            }
            const signals = await readSignals(page);
            if (signals?.ready) {
              const clock = await page.evaluate(() => typeof window.__clock?.tick === 'function');
              if (!clock) throw new Error(`${page.url()} is ready, but the virtual clock is not installed`);
              return;
            }
            if (signals?.errors.length) throw new Error(`the page signalled an error: ${signals.errors.join('; ')}`);
            if (Date.now() > deadline) {
              const tail = watch.console.slice(-3).map((record) => `${record.type}: ${record.text}`);
              throw new Error(
                `${page.url()} signalled neither window.__engine.ready nor errors within ${timeout} ms` +
                  (tail.length ? `; last console lines: ${tail.join(' | ')}` : '; the console is empty'),
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        },
        async assertWebGPU() {
          const { gpu, backend } = await page.evaluate(() => ({
            gpu: window.__gpu,
            backend: (window as unknown as { __engine?: PageSignals }).__engine?.info?.().backend,
          }));
          const adapter = gpu.adapters.find((record) => record !== null);
          const fix = 'launch Chromium with WEBGPU_FLAGS from tools/lib/browser.ts (PLAN.md §8.8)';
          expect(adapter, `WebGPU gave no adapter (${gpu.adapters.length} requests): ${fix}`).toBeTruthy();
          expect(gpu.devices, 'WebGPU created no device').toBeGreaterThan(0);
          expect(gpu.contexts, 'no canvas was configured for WebGPU').toBeGreaterThan(0);
          expect(gpu.submits, 'WebGPU never submitted a command buffer').toBeGreaterThan(0);
          expect(gpu.lost, 'a WebGPU device was lost').toEqual([]);
          if (backend !== undefined) expect(backend, 'the page reports another backend than WebGPU').toBe('WebGPU');
          return {
            adapter: adapter as AdapterRecord,
            devices: gpu.devices,
            contexts: gpu.contexts,
            submits: gpu.submits,
            backend,
          };
        },
        async readFrame(selector = 'canvas') {
          const png = await page.locator(selector).first().screenshot();
          const { width, height, rgba } = decodePng(png);
          const colours = new Set<number>();
          const view = new DataView(rgba.buffer, rgba.byteOffset, rgba.byteLength);
          for (let i = 0; i < rgba.length; i += 4) colours.add(view.getUint32(i));
          const pixel = (x: number, y: number): [number, number, number, number] => {
            const i = (y * width + x) * 4;
            return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
          };
          return { width, height, rgba, png, distinctColors: colours.size, blank: colours.size <= 1, pixel };
        },
        async tick(frames = 1) {
          await page.evaluate((n) => window.__clock.tick(n), frames);
        },
      };
      await use(harness);
      const unread = (await watch.errors()).slice(read);
      if (unread.length > 0) {
        throw new Error(
          `unhandled page error${unread.length > 1 ? 's' : ''}: ${unread.map(describePageError).join('; ')}`,
        );
      }
      const advice = findUnlisted(watch.console, ALLOWED).slice(adviceRead);
      if (advice.length > 0) throw new Error(describeUnlisted(advice, ` in ${page.url()}`));
    },
    { auto: true },
  ],
});
