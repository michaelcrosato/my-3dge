/**
 * @file The renderer (PLAN.md §6.7, WP 0.8 then WP 2.1): WebGPU or nothing, then everything WebGPU offers.
 * `createRenderer` asks for a WebGPU adapter before anything else and refuses to start without one (`GFX_NO_WEBGPU`,
 * naming the fix). It creates the device itself, with every adapter feature and the adapter's limits
 * (engine/gfx/caps.ts), counts the pipelines it builds (engine/gfx/pipelines.ts) and hands it to three.js's
 * `WebGPURenderer`, so three.js never requests an adapter of its own and its WebGL 2 fallback has nothing to fall back
 * from; `await renderer.init()` follows, then the backend assertion. It then reports the GPU (`info`: adapter,
 * features, limits), checks the feature registry (engine/gfx/features.ts, an advice code for every feature off), and
 * routes WebGPU's errors to the log: an uncaptured validation or memory error as `GFX_GPU_ERROR`, a lost device as
 * `GFX_DEVICE_LOST` (r182 has no `renderer.onError`; these are its two error routes).
 *
 * `frame(view)` draws one frame: it fits the drawing buffer to the canvas and `gfx.resolution`
 * (engine/gfx/resolution.ts) and the camera's aspect to it, warms up when the scene's shader key changed
 * (engine/gfx/warmup.ts; the frames until it is done are skipped, never drawn half-built), resets `renderer.info`,
 * starts a new node frame (`advanceFrame`, engine/gfx/pipelines.ts: r182 starts one only in its own animation-frame
 * loop, so a frame drawn off it would show a post pass's last picture), and draws with `view.draw` (a post pass) or
 * `render()`. `view.alpha` is the clock's interpolation alpha, kept for the
 * stats. A frame that builds a pipeline after the warm-up raises `GFX_COLD_PIPELINE`: it stalled. `stats()` gives
 * `renderer.info`'s counts with the pipeline counts. Draw with `render()`, never `renderAsync()` (deprecated since
 * r181; docs/THREE-DELTA.md). Game code meets none of this (doctrine: Quality under the hood).
 *
 * Invariants: a `Gfx` exists only on the WebGPU backend; every failure to get there is a `GfxError` with its code and
 * fix, and nothing is drawn, configured or allocated on the GPU before the adapter check passes. Rendering settings
 * are view settings: nothing here reaches the sim or the hash.
 *
 * @example
 * const refused = await requestWebGPU(undefined).catch((error: GfxError) => error.code); // 'GFX_NO_WEBGPU' in Node
 * @see tests/e2e/renderer.spec.ts
 * @see tests/e2e/hello.spec.ts
 * @see engine/gfx/renderer.test.ts
 */
/// <reference types="@webgpu/types" />
import { REVISION, WebGPURenderer, type PerspectiveCamera } from 'three/webgpu';
import { codeError, defineCodes, log as sharedLog, type Log } from '../core/log';
import type { Registry } from '../core/registry';
import { createSettings, type Settings } from '../core/settings';
import { readCaps, requestDevice, type GfxCaps } from './caps';
import { resolveFeatures, type FeatureReport } from './features';
import { advanceFrame, checkPinned, countPipelines, type PipelineCounter } from './pipelines';
import { createResolution, type Resolution, type ResolutionMode } from './resolution';
import { createWarmup, type Warmup, type WarmupView } from './warmup';

/** The codes the renderer raises at startup, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const GFX_CODES = defineCodes('gfx', {
  GFX_NO_WEBGPU: {
    template: 'WebGPU is unavailable: {reason}',
    fix: 'open the page in a browser with WebGPU and hardware acceleration on (Chrome or Edge 113+, Safari 26+); headless, launch Chromium with WEBGPU_FLAGS from tools/lib/browser.ts (PLAN.md §8.8)',
    doc: 'Raised at startup, before anything touches the GPU, when the browser has no `navigator.gpu`, gives no adapter or device, or three.js starts another backend than WebGPU. WebGPU is the only renderer: there is no WebGL fallback (PLAN.md §6.7), so nothing starts, and a page shows this message with its fix.',
  },
});

/** The codes a running renderer raises through the log. */
export const FRAME_CODES = defineCodes('gfx', {
  GFX_GPU_ERROR: {
    template: 'WebGPU refused a call ({kind}): {message}',
    fix: 'fix the resource or pipeline the message names; GPU errors never change play, but what that call draws is missing or wrong',
    doc: "Recorded from the device's `uncapturederror` event (engine/gfx/renderer.ts): a validation, out-of-memory or internal error nothing caught.",
  },
  GFX_DEVICE_LOST: {
    template: 'the GPU device was lost ({reason}): {message}',
    fix: 'reload the page; the sim runs on the CPU and is intact (capture it first with __engine.capture()), but nothing draws until the renderer starts again',
  },
  GFX_COLD_PIPELINE: {
    template: '{count} GPU pipeline(s) were built while drawing frame {frame}, after the warm-up: the frame stalled',
    fix: 'register what the frame drew for the first time with gfx.warmup.register(id, { objects }), or add what changed to the shader key with gfx.warmup.keyPart(name, part), so the warm-up builds it first',
    doc: 'Advice from `frame()` (engine/gfx/renderer.ts): the pipeline counter (engine/gfx/pipelines.ts) saw a pipeline built during a drawn frame after the first warm-up, the stall PLAN.md §8.7 budgets at 0.',
  },
  GFX_WARMUP_FAILED: {
    template: 'the warm-up failed: {message}',
    fix: 'the cause is recorded with this error; frames draw without a warm-up meanwhile, building pipelines as they meet them',
  },
  GFX_BAD_ALPHA: {
    template: 'the frame alpha must be a number from 0 to 1, not {alpha}',
    fix: "pass the clock's interpolation alpha (clock.advance(now).alpha), which is always from 0 to 1",
  },
});

/** A code the renderer raises at startup: a key of `GFX_CODES`. */
export type GfxCode = keyof typeof GFX_CODES;

/** A renderer failure: its code, the message from the code's template, and the code's fix. */
export class GfxError extends Error {
  override name = 'GfxError';
  /** The code, as docs/ERRORS.md lists it. */
  readonly code: GfxCode;
  /** What to do about it, from the code's `fix`. */
  readonly fix: string;

  /** Fills the code's template with `values` (`{reason}` → `values.reason`). */
  constructor(code: GfxCode, values: Record<string, string>) {
    const { template, fix } = GFX_CODES[code];
    super(template.replace(/\{(\w+)\}/g, (marker, name: string) => values[name] ?? marker));
    this.code = code;
    this.fix = fix;
  }
}

/** What the renderer reports about itself (the GPU half of `__engine.info()`, PLAN.md §8.3). */
export interface GfxInfo {
  /** Always `WebGPU`: no other backend gets this far. */
  backend: 'WebGPU';
  /** The adapter's identity (on this platform: vendor `google`, architecture `swiftshader`, a fallback adapter). */
  adapter: GfxCaps['adapter'];
  /** The adapter's features, sorted; the device has every one of them. */
  features: string[];
  /** The device's limits, by name: the adapter's own, unless `GFX_DEFAULT_LIMITS` said otherwise. */
  limits: Record<string, number>;
  /** three.js's revision: `182`. */
  three: string;
  /** The ids of the features on (engine/gfx/features.ts). */
  enabled: string[];
  /** The advice codes of the features off: every downgrade taken. */
  downgrades: string[];
}

/** One frame to draw: the warm-up's view, plus the clock's interpolation alpha (1, the latest state, by default). */
export interface FrameView extends WarmupView {
  alpha?: number;
}

/** What `frame()` did. */
export interface FrameReport {
  /** Whether it drew; false while a warm-up runs. */
  drawn: boolean;
  /** Whether a warm-up is running. */
  warming: boolean;
  /** The alpha it drew at. */
  alpha: number;
  /** Pipelines built while drawing it: 0 after the warm-up, or it stalled. */
  built: number;
}

/** The renderer's counts: the last frame's from `renderer.info`, the pipelines' since startup. */
export interface GfxStats {
  /** Frames drawn. */
  frames: number;
  /** The last drawn frame's alpha. */
  alpha: number;
  /** The resolution mode (null before the first frame), and the drawing buffer's size. */
  mode: ResolutionMode | null;
  width: number;
  height: number;
  /** The last frame's draw calls (`renderer.info.render`). */
  drawCalls: number;
  /** The last frame's triangles. */
  triangles: number;
  /** The last frame's points. */
  points: number;
  /** The last frame's render passes. */
  renders: number;
  /** The last frame's compute dispatches. */
  computeCalls: number;
  /** Textures alive on the GPU (`renderer.info.memory`). */
  textures: number;
  /** Geometries alive on the GPU. */
  geometries: number;
  /** Pipelines built since startup (pipelines.ts). */
  pipelines: number;
  /** Shader modules compiled since startup. */
  shaders: number;
  /** Pipelines three.js holds cached now; null when unreadable. */
  cachedPipelines: number | null;
  /** Warm-ups run. */
  warmUps: number;
  /** Pipelines built outside warm-ups since the first began: 0 is the budget (§8.7); null before a warm-up. */
  pipelinesAfterWarmUp: number | null;
}

/** A started renderer: three.js's `WebGPURenderer`, its device, its report, and what draws a frame. */
export interface Gfx {
  renderer: WebGPURenderer;
  device: GPUDevice;
  info: GfxInfo;
  /** The feature registry's verdict for this GPU. */
  features: FeatureReport;
  /** The drawing buffer, fitted to the canvas and `gfx.resolution` by each frame. */
  resolution: Resolution;
  /** The warm-up registry: pools and batches register here. */
  warmup: Warmup;
  /** The pipeline counter. */
  pipelines: PipelineCounter;
  /** Draws one frame (see the file comment). Throws `GFX_BAD_ALPHA`. */
  frame(view: FrameView): FrameReport;
  /** The counts so far. */
  stats(): GfxStats;
}

/** How `createRenderer` is made: antialiasing, and the settings, registry and log it reads and reports to. */
export interface GfxOptions {
  antialias?: boolean;
  /** The store the view settings are read from (`gfx.resolution`, `gfx.featuresOff`); a fresh one by default. */
  settings?: Settings;
  /** Where the `feature` entries are (the shared registry by default). */
  registry?: Registry;
  /** Where errors and advice go (the shared log by default). */
  log?: Log;
}

/**
 * Asks `gpu` (by default the browser's `navigator.gpu`) for an adapter; rejects with `GfxError` `GFX_NO_WEBGPU` when
 * there is no WebGPU or no adapter. Nothing is created on the GPU.
 */
export async function requestWebGPU(gpu: GPU | undefined = globalThis.navigator?.gpu): Promise<GPUAdapter> {
  if (!gpu) throw new GfxError('GFX_NO_WEBGPU', { reason: 'this browser has no navigator.gpu' });
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    throw new GfxError('GFX_NO_WEBGPU', { reason: `navigator.gpu.requestAdapter() failed (${String(error)})` });
  }
  if (!adapter) throw new GfxError('GFX_NO_WEBGPU', { reason: 'navigator.gpu.requestAdapter() gave no adapter' });
  return adapter;
}

/**
 * Routes the device's uncaptured errors and a lost device to `log`; three.js's own handling of a loss still runs.
 * WebGPU delivers an uncaptured error once the device next does work (a frame's submit), not at the call.
 */
function routeErrors(renderer: WebGPURenderer, device: GPUDevice, log: Log): void {
  device.addEventListener('uncapturederror', (event) => {
    const { error } = event as GPUUncapturedErrorEvent;
    // Handled: recorded with its code, so the browser does not print it again as an uncoded warning.
    event.preventDefault();
    log.error('GFX_GPU_ERROR', { kind: error.constructor.name, message: error.message });
  });
  const lost = renderer.onDeviceLost;
  renderer.onDeviceLost = (info) => {
    log.error('GFX_DEVICE_LOST', { reason: info.reason ?? 'unknown', message: info.message });
    lost.call(renderer, info);
  };
}

/**
 * Starts three.js's `WebGPURenderer` on `canvas`, on WebGPU only: the adapter check, a device with every feature and
 * limit the adapter offers, `await renderer.init()`, the backend assertion, then the report, the feature registry and
 * the error routes. Rejects with `GfxError` `GFX_NO_WEBGPU` at the first step that fails. Draw with `frame(view)`.
 */
export async function createRenderer(canvas: HTMLCanvasElement, options: GfxOptions = {}): Promise<Gfx> {
  const log = options.log ?? sharedLog;
  const settings = options.settings ?? createSettings({ registry: options.registry });
  const adapter = await requestWebGPU();
  let device: GPUDevice;
  try {
    device = await requestDevice(adapter, { log });
  } catch (error) {
    throw new GfxError('GFX_NO_WEBGPU', { reason: `the adapter gave no device (${String(error)})` });
  }
  const pipelines = countPipelines(device, { log });
  const renderer = new WebGPURenderer({ canvas, device, antialias: options.antialias ?? false });
  await renderer.init();
  if ((renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend !== true) {
    renderer.dispose();
    throw new GfxError('GFX_NO_WEBGPU', { reason: 'three.js started another backend than WebGPU' });
  }
  routeErrors(renderer, device, log);
  // One frame may render several times (a post pass): `frame()` resets the counts once per frame.
  renderer.info.autoReset = false;
  const caps = readCaps(adapter, device);
  const features = resolveFeatures(caps, { registry: options.registry, settings, log });
  const info: GfxInfo = {
    backend: 'WebGPU',
    adapter: caps.adapter,
    features: caps.features,
    limits: caps.limits,
    three: REVISION,
    enabled: features.on,
    downgrades: features.downgrades,
  };
  const resolution = createResolution({ renderer, canvas, settings });
  const warmup = createWarmup({ renderer, counter: pipelines });
  let frames = 0;
  let alpha = 1;
  let failed: string | null = null;

  const frame = (view: FrameView): FrameReport => {
    const next = view.alpha ?? 1;
    if (!(next >= 0 && next <= 1)) throw codeError('GFX_BAD_ALPHA', { alpha: String(view.alpha) });
    resolution.update();
    const { css } = resolution.current!;
    const camera = view.camera as PerspectiveCamera;
    const aspect = css.width > 0 && css.height > 0 ? css.width / css.height : 1;
    if (camera.isPerspectiveCamera && camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    const idle = { drawn: false, warming: true, alpha: next, built: 0 };
    if (warmup.running) return idle;
    const key = warmup.key(view.scene);
    if (key !== warmup.last?.key && key !== failed) {
      warmup.run(view).catch((error: unknown) => {
        failed = key;
        log.error('GFX_WARMUP_FAILED', { message: String(error) }, error);
      });
      return idle;
    }
    if (!advanceFrame(renderer)) {
      log.warnOnce('GFX_PIPELINES_UNPINNED', { revision: REVISION, problems: checkPinned(renderer).join('; ') });
    }
    renderer.info.reset();
    const before = pipelines.count().built;
    (view.draw ?? (() => renderer.render(view.scene, view.camera)))();
    const built = pipelines.count().built - before;
    frames++;
    alpha = next;
    if (built > 0 && warmup.last) log.warnOnce('GFX_COLD_PIPELINE', { count: built, frame: frames });
    return { drawn: true, warming: false, alpha, built };
  };

  const stats = (): GfxStats => {
    const { render, compute, memory } = renderer.info;
    const counted = pipelines.count(renderer);
    const fit = resolution.current;
    return {
      frames,
      alpha,
      mode: fit?.mode ?? null,
      width: fit?.width ?? 0,
      height: fit?.height ?? 0,
      drawCalls: render.drawCalls,
      triangles: render.triangles,
      points: render.points,
      renders: render.frameCalls,
      computeCalls: compute.frameCalls,
      textures: memory.textures,
      geometries: memory.geometries,
      pipelines: counted.built,
      shaders: counted.shaders,
      cachedPipelines: counted.cached,
      warmUps: warmup.last?.count ?? 0,
      pipelinesAfterWarmUp: warmup.start === null ? null : counted.built - warmup.start - warmup.built,
    };
  };

  return { renderer, device, info, features, resolution, warmup, pipelines, frame, stats };
}
