/**
 * @file Renders a page on WebGPU in the platform's Chromium and writes what it drew: a PNG and its look metrics.
 *
 * `node x shot <page>` serves the repository with Vite (tools/lib/vite.ts, on a free port), opens the page the way
 * the e2e fixture does (tools/lib/browser.ts: the WebGPU flags, the virtual clock, seed 1), waits for
 * `window.__engine.ready`, screenshots its first canvas, and writes `out/shot/<page>/frame.png` (out/ is never
 * committed) with the metrics in `report.json`: the size, the colour count, the background (the commonest colour)
 * and the coverage (the share of other pixels), the luma mean and its P5 to P95 spread, the dark and blown-out
 * shares, the mean colour, a histogram summary (the four commonest colours at 3 bits per channel), and what the page
 * reports through `__engine.info()` (backend, adapter, three.js). A page is `labs/<name>` (its index.html) or an
 * `.html` file, with an optional query: `node x shot labs/hello`, `node x shot 'labs/hello/?post=0'`.
 *
 * Usage: node x shot <page>. Fails (exit 1) when the page signals an error or throws, reports another backend than
 * WebGPU, or draws a blank frame (one colour). Console warnings no advice baseline lists are reported as warnings.
 *
 * Basic on purpose (WP 0.8): WP 2.6 extends it with `--scene`, `--cam`, `--set`, `--ids`, `--metrics` and `--marks`,
 * the ID pass and text thumbnails, shooting through a render target (engine/gfx/shot.ts) instead of a screenshot.
 *
 * @example
 * const metrics = frameMetrics(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1); // coverage 0.5
 * @see tools/cmd/shot.test.ts
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { browserRuntime, describePageError, launchBrowser, preparePage, VIEWPORT } from '../lib/browser';
import type { Finding } from '../lib/report';
import { targetSlug } from '../lib/report';
import { startVite } from '../lib/vite';
import { UsageError, type Command, type CommandResult } from '../x';

/** How long a page may take to signal ready or an error, in milliseconds. */
export const READY_TIMEOUT_MS = 30_000;

/** A pixel counts as background when no channel differs from the background colour by more than this. */
const BACKGROUND_TOLERANCE = 6;

/** The look metrics of one RGBA frame (PLAN.md §8.5; WP 2.6 adds the ID pass's and edge density). */
export interface FrameMetrics {
  width: number;
  height: number;
  /** Distinct RGBA colours. */
  colors: number;
  /** True when every pixel has the same colour. */
  blank: boolean;
  /** The commonest colour, `#rrggbb`. */
  background: string;
  /** The share of pixels that differ from the background (by more than 6 in some channel), in [0, 1]. */
  coverage: number;
  /** Rec. 709 luma of the 8-bit values, in [0, 1]: mean, 5th and 95th percentiles. */
  lumaMean: number;
  lumaP5: number;
  lumaP95: number;
  /** The shares of pixels with luma under 0.05 (dark) and over 0.95 (blown out). */
  dark: number;
  blown: number;
  /** The mean colour, `#rrggbb`. */
  meanColor: string;
  /** The four commonest colours at 3 bits per channel (each the centre of its bin), with their shares. */
  histogram: string;
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Measures a frame of row-major RGBA bytes (4 a pixel). */
export function frameMetrics(rgba: Uint8Array, width: number, height: number): FrameMetrics {
  const pixels = width * height;
  if (pixels === 0 || rgba.length < pixels * 4)
    throw new Error(`frameMetrics: ${rgba.length} bytes for ${width}×${height}`);
  const counts = new Map<number, number>();
  const bins = new Map<number, number>();
  const lumaBuckets = new Uint32Array(256);
  const sum = [0, 0, 0];
  let lumaSum = 0;
  let dark = 0;
  let blown = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    const rgb = (r << 16) | (g << 8) | b;
    const key = rgb * 256 + a;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const bin = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lumaBuckets[Math.min(255, Math.round(luma * 255))]++;
    lumaSum += luma;
    if (luma < 0.05) dark++;
    if (luma > 0.95) blown++;
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
  }
  let backgroundKey = 0;
  let backgroundCount = -1;
  for (const [key, count] of counts) if (count > backgroundCount) [backgroundKey, backgroundCount] = [key, count];
  const background = [(backgroundKey / 2 ** 24) & 255, (backgroundKey / 2 ** 16) & 255, (backgroundKey / 256) & 255];
  let covered = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const far = [0, 1, 2].some((c) => Math.abs(rgba[i + c] - background[c]) > BACKGROUND_TOLERANCE);
    if (far) covered++;
  }
  const percentile = (p: number) => {
    let seen = 0;
    for (let bucket = 0; bucket < 256; bucket++) {
      seen += lumaBuckets[bucket];
      if (seen >= p * pixels) return bucket / 255;
    }
    return 1;
  };
  const centre = (bits: number) => (bits << 5) + 16;
  const histogram = [...bins.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4)
    .map(([bin, count]) => {
      const colour = hex(centre(bin >> 6), centre((bin >> 3) & 7), centre(bin & 7));
      return `${colour} ${(Math.round((count / pixels) * 1000) / 10).toFixed(1)}%`;
    })
    .join(', ');
  return {
    width,
    height,
    colors: counts.size,
    blank: counts.size <= 1,
    background: hex(background[0], background[1], background[2]),
    coverage: round(covered / pixels),
    lumaMean: round(lumaSum / pixels),
    lumaP5: round(percentile(0.05)),
    lumaP95: round(percentile(0.95)),
    dark: round(dark / pixels),
    blown: round(blown / pixels),
    meanColor: hex(sum[0] / pixels, sum[1] / pixels, sum[2] / pixels),
    histogram,
  };
}

/** The verdict on a frame's metrics: a blank frame fails; an almost empty one (coverage under 0.5%) warns. */
export function judgeFrame(metrics: FrameMetrics, page: string): { failures: Finding[]; warnings: Finding[] } {
  const size = `${metrics.width}×${metrics.height}`;
  if (metrics.blank) {
    const message = `${page} drew a blank frame: all ${size} pixels are ${metrics.background}. Draw before signalling ready, and check that the camera sees the scene`;
    return { failures: [{ id: 'SHOT_BLANK', message }], warnings: [] };
  }
  if (metrics.coverage < 0.005) {
    const message = `${page} drew almost nothing: ${(metrics.coverage * 100).toFixed(2)}% of ${size} differs from the background ${metrics.background}; check the camera and the scene's scale`;
    return { failures: [], warnings: [{ id: 'SHOT_EMPTY', message }] };
  }
  return { failures: [], warnings: [] };
}

/** Turns a page argument into the URL path to open (relative to the server) and the file that must exist for it. */
export function resolvePage(page: string): { path: string; file: string } {
  const [rawPath, query] = page.split(/\?(.*)/s, 2);
  const path = rawPath.replace(/^\.?\//, '');
  const suffix = query === undefined ? '' : `?${query}`;
  if (path.endsWith('.html')) return { path: `${path}${suffix}`, file: path };
  const dir = path.replace(/\/+$/, '');
  return { path: `${dir}/${suffix}`, file: `${dir}/index.html` };
}

/** The lab pages there are, for a usage error. */
function labPages(root: string): string[] {
  const labs = join(root, 'labs');
  if (!existsSync(labs)) return [];
  return readdirSync(labs)
    .filter((name) => existsSync(join(labs, name, 'index.html')))
    .map((name) => `labs/${name}`);
}

/**
 * A port the system reports free on 127.0.0.1. `startVite()` without a port falls back to Vite's 5173 (strict), which
 * another server may hold; asking the system first keeps shots clear of every lane's `$PORT`.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** The page's signal (PLAN.md §8.3), read once: ready, its errors as lines, and its info. */
interface Signals {
  ready: boolean;
  errors: string[];
  info?: Record<string, unknown>;
}

/** Runs in the page, through `evaluate`: reads `window.__engine`, if the page has published it. */
function pageSignals(): Signals | undefined {
  const engine = (window as unknown as { __engine?: Record<string, unknown> }).__engine;
  if (!engine) return undefined;
  const errors = ((engine.errors ?? []) as { code?: string; message?: string; fix?: string }[]).map(
    (error) => `${error.code ?? 'ERROR'}: ${error.message ?? ''}${error.fix ? ` (fix: ${error.fix})` : ''}`,
  );
  const info = typeof engine.info === 'function' ? (engine.info as () => Record<string, unknown>)() : undefined;
  return { ready: engine.ready === true, errors, info };
}

export default {
  usage: 'shot <page>',
  options: {},
  maxPositionals: 1,
  async run({ positionals, root }): Promise<CommandResult> {
    const [page] = positionals;
    if (!page)
      throw new UsageError(`name a page: labs/<name> or an .html file (${labPages(root).join(', ') || 'no labs yet'})`);
    const { path, file } = resolvePage(page);
    if (!existsSync(join(root, file))) {
      throw new UsageError(
        `there is no ${file} for ${page}; pages: ${labPages(root).join(', ') || 'none'}, or an .html file`,
      );
    }
    const out = join('out', 'shot', targetSlug(page));
    const server = await startVite({ root, port: await freePort() });
    const browser = await launchBrowser();
    try {
      const tab = await browser.newPage({ viewport: VIEWPORT });
      const watch = await preparePage(tab, { seed: 1, root });
      let pageErrors = 0;
      tab.on('pageerror', () => pageErrors++);
      await tab.goto(`${server.url}${path}`);
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let signals = await tab.evaluate(pageSignals);
      while (!signals?.ready && !signals?.errors.length && pageErrors === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        signals = await tab.evaluate(pageSignals);
      }
      const runtime = browserRuntime(browser.version());
      const failures: Finding[] = (await watch.errors()).map((error) => ({
        id: 'SHOT_PAGE_ERROR',
        message: `${page} threw: ${describePageError(error)}`,
        ...(error.file ? { file: error.file, line: error.line } : {}),
      }));
      for (const error of signals?.errors ?? [])
        failures.push({ id: 'SHOT_PAGE_SIGNAL', message: `${page} signalled ${error}` });
      if (!signals?.ready && failures.length === 0) {
        const message = `${page} signalled neither window.__engine.ready nor an error within ${READY_TIMEOUT_MS} ms; publish __engine (PLAN.md §8.3)`;
        failures.push({ id: 'SHOT_NOT_READY', message, file });
      }
      const info = signals?.info ?? {};
      if (failures.length === 0 && info.backend !== undefined && info.backend !== 'WebGPU') {
        failures.push({
          id: 'SHOT_NOT_WEBGPU',
          message: `${page} reports backend ${String(info.backend)}, not WebGPU (PLAN.md §6.7)`,
        });
      }
      // Loaded here, not at the top: these test modules join the program only when a shot runs.
      const { describeUnlisted, findUnlisted, loadAllowList } = await import('../../tests/setup/adviceTrap');
      const warnings: Finding[] = findUnlisted(watch.console, loadAllowList()).map((warning) => ({
        id: 'SHOT_CONSOLE',
        message: describeUnlisted([warning], ` in ${page}`),
      }));
      if (failures.length > 0)
        return { ok: false, summary: `${page} did not draw`, browser: runtime, failures, warnings };

      const png = await tab.locator('canvas').first().screenshot();
      mkdirSync(join(root, out), { recursive: true });
      writeFileSync(join(root, out, 'frame.png'), png);
      const { decodePng } = await import('../../tests/e2e/fixtures');
      const { width, height, rgba } = decodePng(png);
      const metrics = frameMetrics(rgba, width, height);
      const verdict = judgeFrame(metrics, page);
      const adapter = info.adapter as { vendor?: string; architecture?: string } | undefined;
      return {
        ok: verdict.failures.length === 0,
        summary: `${page}: ${width}×${height}, coverage ${(metrics.coverage * 100).toFixed(1)}%, luma ${metrics.lumaP5}–${metrics.lumaP95}, ${metrics.colors} colours`,
        lines: [`png: ${out}/frame.png`, `histogram: ${metrics.histogram}`],
        browser: runtime,
        failures: verdict.failures,
        warnings: [...warnings, ...verdict.warnings],
        metrics: {
          ...metrics,
          backend: String(info.backend ?? 'unreported'),
          adapter: adapter ? `${adapter.vendor ?? '?'}/${adapter.architecture ?? '?'}` : 'unreported',
          three: String(info.three ?? 'unreported'),
        },
        artifacts: [
          {
            path: `${out}/frame.png`,
            kind: 'image',
            describes: `the first canvas of ${page}, as Chromium presented it`,
          },
        ],
      };
    } finally {
      await browser.close();
      await server.close();
    }
  },
} satisfies Command;
