/**
 * @file Resolution modes (PLAN.md WP 2.1): how many pixels the renderer draws for the canvas's size on screen, from
 * the view setting `gfx.resolution`. `pixels` draws the engine's own chunky pixels, at most 330 lines and a whole
 * number of screen pixels each (2 at 540 screen lines, 3 at 720, 4 at 1080), so the picture is crisp and cheap;
 * `balanced` draws half the screen's resolution; `full` all of it. Both reduced modes are shown with
 * `image-rendering: pixelated`, so the browser enlarges them without blurring.
 *
 * `fitResolution` is the arithmetic, pure and tested in Node; `createResolution` applies it to a renderer and its
 * canvas: `update()` measures the canvas's CSS size and the device pixel ratio (capped at `MAX_PIXEL_RATIO`) and,
 * when the size, the ratio or the mode changed since the last call, sets the drawing buffer (`setPixelRatio(1)`, then
 * `setSize(width, height, false)`). The page sizes the canvas with CSS; this module never writes its CSS size. The
 * frame calls `update()` first (engine/gfx/renderer.ts), so a resize or a mode change takes effect on the next frame.
 *
 * Phones (WP 3.12, built, not tested): `cap(budget)` caps the buffer's pixels and the pixel ratio by the quality tier
 * (engine/gfx/quality.ts; `pixels` mode by a coarser whole scale), and `keepWidth` widens a portrait picture's
 * vertical field of view so the horizontal one is kept (`2·atan(tan(fov/2)/aspect)`, at most 150°).
 *
 * Invariants: the drawing buffer is at least 1 × 1; in `pixels` mode its height is at most `PIXEL_LINES`, and,
 * uncapped, at least 200 whenever the screen has that many lines and a whole-pixel scale allows it (all but 331 to
 * 399). Changing the size never builds a pipeline (measured, WP 2.1). The setting is a view setting: never in the hash.
 * Carried from `my-3d2dge:src/stress-world/50-frame.js:18-28` (`fit()`, its modes and numbers), and the caps and the
 * portrait lens from `shardfall:crates/pav_app/src/quality.rs:73-84` and `shardfall:crates/pav_view/src/camera.rs:168-173`.
 *
 * @example
 * fitResolution({ width: 1280, height: 720 }, 1, 'pixels'); // { width: 427, height: 240, scale: 3, … }
 * fitResolution({ width: 1280, height: 720 }, 1, 'balanced').width; // 640
 * fitResolution({ width: 1280, height: 720 }, 2, 'full').height; // 1440
 * @see engine/gfx/resolution.test.ts
 */
import type { Camera, PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import type { Field } from '../core/schema';
import { createSettings, defineSettings, type Settings } from '../core/settings';

/** The resolution modes, chunkiest first. */
export const RESOLUTION_MODES = ['pixels', 'balanced', 'full'] as const;

/** A resolution mode: the engine's pixels, half the screen's, or all of it. */
export type ResolutionMode = (typeof RESOLUTION_MODES)[number];

/** The most lines the `pixels` mode draws. */
export const PIXEL_LINES = 330;

/** The highest device pixel ratio drawn at: beyond it, pixels are too small to see and cost the same. */
export const MAX_PIXEL_RATIO = 3;

/** The resolution settings: view settings, never in the hash. */
export const RESOLUTION_SETTINGS = {
  'gfx.resolution': {
    type: 'string',
    enum: RESOLUTION_MODES,
    default: 'pixels',
    view: true,
    description:
      "How many pixels are drawn: 'pixels' (the engine's chunky pixels, at most 330 lines, each a whole number of screen pixels), 'balanced' (half the screen's resolution) or 'full'.",
  },
} as const satisfies Record<string, Field>;
defineSettings(RESOLUTION_SETTINGS);

/** A size in CSS or device pixels. */
export interface Size {
  width: number;
  height: number;
}

/** What a mode gives for a canvas: the drawing buffer's size and how it maps to the screen. */
export interface Fit {
  mode: ResolutionMode;
  /** The canvas's size in CSS pixels, as measured. */
  css: Size;
  /** The device pixel ratio used: the browser's, at most `MAX_PIXEL_RATIO`. */
  pixelRatio: number;
  /** The canvas's size in screen pixels. */
  screen: Size;
  /** Screen pixels per engine pixel in `pixels` mode (a whole number); what the other modes would have used. */
  scale: number;
  /** The drawing buffer's width in pixels. */
  width: number;
  /** The drawing buffer's height in pixels. */
  height: number;
  /** Whether the browser should enlarge the picture without smoothing (every mode but `full`). */
  pixelated: boolean;
}

/** A cap on the drawing buffer (engine/gfx/quality.ts's budget); a null or absent field caps nothing. */
export interface PixelCap {
  /** The most pixels the buffer holds. */
  maxPixels?: number | null;
  /** The most device pixels per CSS pixel. */
  maxPixelRatio?: number | null;
}

/** The drawing buffer `mode` gives a canvas of `css` size at `devicePixelRatio`, within `cap` (none by default). */
export function fitResolution(css: Size, devicePixelRatio: number, mode: ResolutionMode, cap: PixelCap = {}): Fit {
  const ratioCap = cap.maxPixelRatio && cap.maxPixelRatio > 0 ? cap.maxPixelRatio : MAX_PIXEL_RATIO;
  const pixelRatio = Math.min(MAX_PIXEL_RATIO, ratioCap, devicePixelRatio > 0 ? devicePixelRatio : 1);
  const screen = {
    width: Math.max(1, Math.round(css.width * pixelRatio)),
    height: Math.max(1, Math.round(css.height * pixelRatio)),
  };
  const most = cap.maxPixels && cap.maxPixels > 0 ? cap.maxPixels : Infinity;
  let scale = Math.max(1, Math.ceil(screen.height / PIXEL_LINES));
  const chunky = () => ({ width: Math.round(screen.width / scale), height: Math.round(screen.height / scale) });
  while (mode === 'pixels' && chunky().width * chunky().height > most) scale++;
  let size =
    mode === 'pixels'
      ? chunky()
      : mode === 'balanced'
        ? { width: Math.round(screen.width / 2), height: Math.round(screen.height / 2) }
        : screen;
  if (size.width * size.height > most) {
    const k = Math.sqrt(most / (size.width * size.height));
    size = { width: Math.floor(size.width * k), height: Math.floor(size.height * k) };
  }
  return {
    mode,
    css: { width: css.width, height: css.height },
    pixelRatio,
    screen,
    scale,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
    pixelated: mode !== 'full',
  };
}

/** A renderer's resolution, kept to its canvas and the setting. */
export interface Resolution {
  /** The fit applied last; null before the first `update()`. */
  readonly current: Fit | null;
  /** Measures the canvas and applies the mode when anything changed; true when it did. Call once per frame. */
  update(): boolean;
  /** Caps the buffer from the next `update()` on (the quality tier's budget, engine/gfx/quality.ts). */
  cap(cap: PixelCap): void;
}

/** How `createResolution` measures: the canvas's CSS size and the device pixel ratio (the browser's by default). */
export interface ResolutionOptions {
  renderer: WebGPURenderer;
  canvas: HTMLCanvasElement;
  /** The store `gfx.resolution` is read from (a fresh one by default). */
  settings?: Settings;
  /** The device pixel ratio now: `window.devicePixelRatio` by default. */
  pixelRatio?: () => number;
}

/** Keeps `renderer`'s drawing buffer fitted to `canvas` and the `gfx.resolution` setting. */
export function createResolution(options: ResolutionOptions): Resolution {
  const { renderer, canvas } = options;
  const settings = options.settings ?? createSettings();
  const pixelRatio = options.pixelRatio ?? (() => globalThis.devicePixelRatio ?? 1);
  let current: Fit | null = null;
  let key = '';
  let limit: PixelCap = {};
  return {
    get current() {
      return current;
    },
    update() {
      const css = { width: canvas.clientWidth, height: canvas.clientHeight };
      const mode = settings.get<ResolutionMode>('gfx.resolution');
      const ratio = pixelRatio();
      const next = `${css.width}x${css.height}@${ratio}:${mode}<${limit.maxPixels ?? ''},${limit.maxPixelRatio ?? ''}`;
      if (next === key) return false;
      key = next;
      current = fitResolution(css, ratio, mode, limit);
      renderer.setPixelRatio(1);
      renderer.setSize(current.width, current.height, false);
      canvas.style.imageRendering = current.pixelated ? 'pixelated' : '';
      return true;
    },
    cap(next) {
      limit = { maxPixels: next.maxPixels ?? null, maxPixelRatio: next.maxPixelRatio ?? null };
    },
  };
}

/** The widest vertical field of view a portrait picture gets, in degrees. */
export const MAX_PORTRAIT_FOV = 150;

/** The vertical field of view (deg) that keeps `fov`'s width on a picture `aspect` (width / height) wide, below 1. */
export function portraitFov(fov: number, aspect: number): number {
  if (!(aspect > 0 && aspect < 1)) return fov;
  return Math.min(MAX_PORTRAIT_FOV, (360 / Math.PI) * Math.atan(Math.tan((fov * Math.PI) / 360) / aspect));
}

/** Widens a perspective camera placed for this frame when the picture is portrait (`portraitFov`); else no change. */
export function keepWidth(camera: Camera, aspect: number): void {
  const lens = camera as PerspectiveCamera;
  if (!lens.isPerspectiveCamera) return;
  const fov = portraitFov(lens.fov, aspect);
  if (fov === lens.fov) return;
  lens.fov = fov;
  lens.updateProjectionMatrix();
}
