/**
 * @file Chromium for the tools and the e2e fixture, through Playwright: the launch options `playwright.config.ts`
 * also uses, the init script every page gets before its own scripts run (a virtual clock, seeded randomness and a
 * WebGPU probe), and the console and the page's errors collected, mapped to `.ts` files and lines
 * (tools/lib/pageErrors.ts) (§8.1, §8.8).
 *
 * Invariants: WebGPU runs on SwiftShader with shardfall's flags (`WEBGPU_FLAGS`), so pages present to their real
 * canvas. The clock only moves on `__clock.tick(n)`, 1/60 s per frame, and `Math.random` and `__clock.rng(name)`
 * are seeded, so a run repeats exactly. `__gpu` counts what WebGPU really did (adapters, devices, configured
 * canvases, queue submits, lost devices); it is measured, never reported by the page.
 *
 * @example
 * import { chromium } from '@playwright/test';
 * const browser = await chromium.launch(launchOptions());
 * const page = await browser.newPage({ viewport: VIEWPORT });
 * const watch = await preparePage(page, { seed: 1 }); // the virtual clock and the console, before the first goto
 * await browser.close();
 * @see tests/e2e/harness.spec.ts
 */
/// <reference types="@webgpu/types" />
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type LaunchOptions, type Page } from '@playwright/test';
import { fnv1a } from './hash';
import { mapPageError, type PageError } from './pageErrors';

/** Shardfall's WebGPU flags (PLAN.md §8.8): SwiftShader through Vulkan, presenting to the page's own canvas. */
export const WEBGPU_FLAGS: readonly string[] = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-angle=swiftshader',
];

/** The container's Chromium (153 since 2026-10-22); `$CHROMIUM_PATH` overrides it. Nothing runs `playwright install`. */
export const DEFAULT_CHROMIUM = '/opt/pw-browsers/chromium';

/** The platform's Chromium release (tools/deps.json), which scripts/setup.sh fetches where the container's is absent. */
export const CHROMIUM_VERSION = '153.0.8010.12';

/** Where scripts/setup.sh keeps Chrome for Testing `CHROMIUM_VERSION` on a machine without `DEFAULT_CHROMIUM`. */
export function cachedChromium(env: Record<string, string | undefined> = process.env): string {
  return join(env.HOME || homedir(), '.cache', 'my3dge', `chrome-${CHROMIUM_VERSION}`, 'chrome-linux64', 'chrome');
}

/** The viewport every harness page gets. */
export const VIEWPORT = { width: 960, height: 540 } as const;

/**
 * The Chromium executable: `$CHROMIUM_PATH`; else `DEFAULT_CHROMIUM` when it exists; else `cachedChromium()` when it
 * exists (a machine outside the container, after scripts/setup.sh); else `DEFAULT_CHROMIUM`, so the launch error names
 * the platform's path. No shell state is needed, so every worktree resolves the same browser.
 */
export function chromiumPath(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  if (exists(DEFAULT_CHROMIUM)) return DEFAULT_CHROMIUM;
  const cached = cachedChromium(env);
  return exists(cached) ? cached : DEFAULT_CHROMIUM;
}

/** Playwright's launch options for WebGPU on this platform, shared by `playwright.config.ts` and the `x` commands. */
export function launchOptions(env: Record<string, string | undefined> = process.env): LaunchOptions {
  return { executablePath: chromiumPath(env), args: [...WEBGPU_FLAGS] };
}

/** Launches the platform's Chromium with WebGPU, for `x` commands that open pages. */
export function launchBrowser(): Promise<Browser> {
  return chromium.launch(launchOptions());
}

/** The browser part of a report's runtime: `153.0.8010.12` → `chromium153`. */
export function browserRuntime(version: string): string {
  return `chromium${version.split('.')[0]}`;
}

/** The page's virtual clock and seeded streams, installed as `window.__clock`. */
export interface VirtualClock {
  /** The seed of `Math.random`; named streams derive from it. */
  seed: number;
  /** Display frames run so far by `tick`. */
  frames: number;
  /** The virtual time `performance.now()` returns, in milliseconds (1000 at load). */
  now(): number;
  /** Runs `n` display frames: each advances time by 1/60 s, then runs the pending animation-frame callbacks. */
  tick(n?: number): void;
  /** The seeded stream named `name` (mulberry32), the same object on every call: `__clock.rng('spawn')()`. */
  rng(name: string): () => number;
  /** Called after each frame of `tick`, for recorders. */
  onFrame: (() => void) | null;
}

/** One adapter WebGPU returned: its identity and features. */
export interface AdapterRecord {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  features: string[];
}

/** What WebGPU really did in the page, counted by the probe: `window.__gpu`. */
export interface GpuLog {
  /** Each `requestAdapter()` result; null when WebGPU refused. */
  adapters: (AdapterRecord | null)[];
  /** Devices created. */
  devices: number;
  /** Canvas contexts configured for WebGPU. */
  contexts: number;
  /** Command-buffer submits on any queue. */
  submits: number;
  /** The message of every device that was lost. */
  lost: string[];
}

declare global {
  interface Window {
    /** The virtual clock, installed by the tools' init script (tools/lib/browser.ts). */
    __clock: VirtualClock;
    /** The WebGPU probe's counts, installed by the tools' init script (tools/lib/browser.ts). */
    __gpu: GpuLog;
  }
}

/*
 * COPY of my-3d2dge:tools/filmstrip.mjs:39-53, without lines 48-49 (which hid navigator.gpu and Web Audio): a
 * virtual clock that only moves when the tool calls __clock.tick(), and a seeded Math.random (mulberry32). Changed:
 * `__film` is named `__clock`; added named streams (`rng`), seeded from the FNV-1a hash of their name, and the frame
 * counter. It runs in the page.
 */
function installVirtualClock(seed: number, hash: (text: string) => number): void {
  let now = 1000,
    id = 0;
  const due = new Map<number, FrameRequestCallback>(),
    fixed = (obj: object, key: string, value: unknown) =>
      Object.defineProperty(obj, key, { value, configurable: true, writable: true });
  const stream = (state: number) => () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = stream(seed >>> 0);
  fixed(performance, 'now', () => now);
  Date.now = () => 1.7e12 + now;
  window.requestAnimationFrame = (f) => {
    due.set(++id, f);
    return id;
  };
  window.cancelAnimationFrame = (i) => {
    due.delete(i);
  };
  fixed(navigator, 'getGamepads', () => []); // a controller plugged into this machine must not steer the run
  const streams = new Map<string, () => number>();
  window.__clock = {
    seed,
    frames: 0,
    onFrame: null,
    now: () => now,
    rng(name) {
      let next = streams.get(name);
      if (!next) streams.set(name, (next = stream((hash(name) ^ seed) >>> 0)));
      return next;
    },
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60;
        this.frames++;
        const run = [...due.values()];
        due.clear();
        for (const f of run) f(now);
        if (this.onFrame) this.onFrame();
      }
    },
  };
}

/* Counts what WebGPU really does in the page (window.__gpu), by wrapping the prototypes' methods. Runs in the page. */
function installGpuProbe(): void {
  const log: GpuLog = { adapters: [], devices: 0, contexts: 0, submits: 0, lost: [] };
  window.__gpu = log;
  if (typeof GPU === 'undefined') return;
  const requestAdapter = GPU.prototype.requestAdapter;
  GPU.prototype.requestAdapter = async function (this: GPU, options?: GPURequestAdapterOptions) {
    const adapter = await requestAdapter.call(this, options);
    const info = adapter?.info;
    log.adapters.push(
      adapter && info
        ? {
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
            features: [...adapter.features].map(String).sort(),
          }
        : null,
    );
    return adapter;
  };
  const requestDevice = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, descriptor?: GPUDeviceDescriptor) {
    const device = await requestDevice.call(this, descriptor);
    log.devices++;
    void device.lost.then((info) => log.lost.push(info.message || String(info.reason)));
    return device;
  };
  const configure = GPUCanvasContext.prototype.configure;
  GPUCanvasContext.prototype.configure = function (this: GPUCanvasContext, configuration: GPUCanvasConfiguration) {
    log.contexts++;
    return configure.call(this, configuration);
  };
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (this: GPUQueue, buffers: Iterable<GPUCommandBuffer>) {
    log.submits++;
    return submit.call(this, buffers);
  };
}

/**
 * The init script for `page.addInitScript`: the virtual clock seeded with `seed`, then the WebGPU probe. The
 * functions are serialized; the `__name` shim absorbs the helper tsx's transform inserts into them.
 */
export function initScript(seed: number): string {
  if (!Number.isInteger(seed) || seed < 0)
    throw new Error(`initScript: the seed must be a whole number ≥ 0, not ${seed}`);
  return `(() => { const __name = (target) => target;
(${installVirtualClock.toString()})(${seed}, ${fnv1a.toString()});
(${installGpuProbe.toString()})(); })();`;
}

/** One console message the page printed. */
export interface ConsoleRecord {
  /** `log`, `info`, `warning`, `error`, `debug`… */
  type: string;
  text: string;
  /** Where it was printed, as the browser reports it (unmapped). */
  url?: string;
  line?: number;
}

/** What `preparePage` collects while the page runs. */
export interface PageWatch {
  /** Every console message, in order (the advice trap of WP 0.5 reads these). */
  console: ConsoleRecord[];
  /** Every uncaught page error so far, mapped to sources. */
  errors(): Promise<PageError[]>;
}

/**
 * Prepares a page before it loads anything: installs the init script (virtual clock seeded with `seed`, seeded
 * `Math.random` and named streams, the WebGPU probe) and starts collecting console messages and mapped page errors.
 */
export async function preparePage(page: Page, options: { seed?: number; root?: string } = {}): Promise<PageWatch> {
  await page.addInitScript({ content: initScript(options.seed ?? 1) });
  const records: ConsoleRecord[] = [];
  const errors: Promise<PageError>[] = [];
  page.on('console', (message) => {
    const at = message.location();
    records.push({
      type: message.type(),
      text: message.text(),
      url: at.url || undefined,
      line: at.url ? at.lineNumber + 1 : undefined,
    });
  });
  page.on('pageerror', (error) => errors.push(mapPageError(error, options.root)));
  return { console: records, errors: () => Promise.all(errors) };
}
