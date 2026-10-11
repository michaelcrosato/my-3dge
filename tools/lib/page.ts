/**
 * @file Pages for the `x` commands (PLAN.md §8.1, §8.3, WP 2.7): reading a page's ready-or-error signal
 * (`window.__engine`), waiting for it, finding the page that draws a scene module's scenes, and playing replays in
 * that page for `x replay --browser page` (`pageRuntime`: `__engine.replay`, engine/app/playback.ts, which draws a
 * frame after every step), or in tests/pages/replay.html for `--browser sim` (`replayBrowser`). `x inspect`, `x shot`
 * and `x replay` share them.
 *
 * Invariants: they only read pages and call `__engine`'s members; waiting polls (never the page's animation frames,
 * which the virtual clock holds, tools/lib/browser.ts), and ends at ready, an error signal, a thrown error or the
 * timeout, whichever comes first.
 *
 * @example
 * labPageOf(process.cwd(), 'labs/box/scenes/room.ts'); // 'labs/box/'
 * @see tools/cmd/inspect.test.ts
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { SimMathName } from '../../engine/core/simMath';
import type { HashedView, Runtime } from '../cmd/sim';
import { browserRuntime, launchBrowser, preparePage, VIEWPORT, type PageWatch } from './browser';
import { startVite } from './vite';

/** How long a page may take to signal ready or an error, ms. */
export const READY_MS = 60_000;

/** `window.__engine` as the tools call it in a page. */
export type PageEngine = Record<string, (...args: unknown[]) => unknown> & { scene: { dump(options: object): string } };
/** The page's engine, inside `evaluate`. */
declare const __engine: PageEngine;

/** A page's ready-or-error signal (PLAN.md §8.3), read once. */
export interface Signals {
  ready: boolean;
  errors: string[];
  info?: Record<string, unknown>;
  shoots: boolean;
}

/** Reads `window.__engine`'s signal in `tab`; undefined before the page publishes one. */
export function readSignals(tab: Page): Promise<Signals | undefined> {
  return tab.evaluate(() => {
    const engine = (window as unknown as { __engine?: Record<string, unknown> }).__engine;
    if (!engine) return undefined;
    const errors = ((engine.errors ?? []) as { code?: string; message?: string; fix?: string }[]).map(
      (e) => `${e.code ?? 'ERROR'}: ${e.message ?? ''}${e.fix ? ` (fix: ${e.fix})` : ''}`,
    );
    const info = typeof engine.info === 'function' ? (engine.info as () => Record<string, unknown>)() : undefined;
    return { ready: engine.ready === true, errors, info, shoots: typeof engine.shot === 'function' };
  });
}

/** Waits until `tab` signals ready or an error, or throws an uncaught error, or `ms` pass; returns the last signal. */
export async function waitReady(tab: Page, watch: PageWatch, ms = READY_MS): Promise<Signals | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const signals = await readSignals(tab).catch(() => undefined);
    const thrown = await watch.errors();
    if (signals?.ready || signals?.errors.length || thrown.length || Date.now() > deadline) return signals;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The page that draws the scenes of a module under `labs/<name>/scenes/`: `labs/<name>/`; throws for other modules. */
export function labPageOf(root: string, file: string): string {
  const lab = /^labs\/([^/]+)\/scenes\//.exec(file)?.[1];
  if (!lab || !existsSync(join(root, 'labs', lab, 'index.html'))) {
    throw new Error(
      `${file} has no page: a scene's page is labs/<name>/ for a module under labs/<name>/scenes/ (use --browser sim for the others)`,
    );
  }
  return `labs/${lab}/`;
}

/** `x replay --browser page`'s runtime: each replay in its scene's page (`labPageOf`), drawn after every step. */
export function pageRuntime(page: Page, url: string, root: string, watch: PageWatch): Runtime {
  let open = '';
  const play = (text: string, options: Record<string, unknown>) =>
    page.evaluate(([t, o]) => __engine.replay(t, o) as Promise<Record<string, unknown>>, [text, options] as const);
  return {
    name: 'Chromium page',
    async load(file) {
      const lab = labPageOf(root, file);
      if (lab === open) return;
      await page.goto(`${url}${lab}`);
      const signals = await waitReady(page, watch);
      if (!signals?.ready) throw new Error(`${lab} did not start: ${signals?.errors.join('; ') || 'no ready signal'}`);
      open = lab;
    },
    play: async (text, every) => (await play(text, { every: every === true })).hashes as Record<string, string>,
    stateAt: async (text, step) => (await play(text, { until: step })) as unknown as HashedView,
  };
}

/** How `--browser` plays in Chromium: the sim-only page, or the scene's own page while it renders. */
export type BrowserMode = 'sim' | 'page';

/**
 * Chromium with its own Vite server for `x replay --browser`: tests/pages/replay.html (`window.__replay`) under the
 * swap `swap` names, or the scenes' own pages (`pageRuntime`).
 */
export async function replayBrowser(root: string, mode: BrowserMode, swap?: SimMathName[]) {
  const server = await startVite({ root });
  const browser = await launchBrowser();
  const close = async () => {
    await browser.close();
    await server.close();
  };
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const watch = await preparePage(page, { seed: 1, root });
    if (mode === 'page') {
      return {
        runtime: pageRuntime(page, server.url, root, watch),
        watch,
        version: browserRuntime(browser.version()),
        close,
      };
    }
    await page.goto(`${server.url}tests/pages/replay.html`);
    const ready = () => (window as { __engine?: { ready?: boolean } }).__engine?.ready === true;
    await page.waitForFunction(ready, undefined, { timeout: 30_000 });
    const runtime: Runtime = {
      name: 'Chromium',
      load: (file) => page.evaluate((path) => window.__replay.load(path), file),
      play: (text, every) =>
        page.evaluate(([t, e, s]) => window.__replay.play(t, { every: e, swap: s }), [text, every, swap] as const),
      stateAt: (text, step) =>
        page.evaluate(([t, k, s]) => window.__replay.stateAt(t, k, { swap: s }), [text, step, swap] as const),
    };
    return { runtime, watch, version: browserRuntime(browser.version()), close };
  } catch (error) {
    await close();
    throw error;
  }
}
