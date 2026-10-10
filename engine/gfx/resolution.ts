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
 * Invariants: the drawing buffer is at least 1 × 1; in `pixels` mode its height is at most `PIXEL_LINES`, and at
 * least 200 whenever the screen has that many lines and a whole-pixel scale allows it (all but 331 to 399). Changing the size never
 * builds a pipeline (measured, WP 2.1). The setting is a view setting: never in the hash.
 * Carried from `my-3d2dge:src/stress-world/50-frame.js:18-28` (`fit()`, its modes and numbers).
 *
 * @example
 * fitResolution({ width: 1280, height: 720 }, 1, 'pixels'); // { width: 427, height: 240, scale: 3, … }
 * fitResolution({ width: 1280, height: 720 }, 1, 'balanced').width; // 640
 * fitResolution({ width: 1280, height: 720 }, 2, 'full').height; // 1440
 * @see engine/gfx/resolution.test.ts
 */
import type { WebGPURenderer } from 'three/webgpu';
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

/** The drawing buffer `mode` gives a canvas of `css` size at `devicePixelRatio`. */
export function fitResolution(css: Size, devicePixelRatio: number, mode: ResolutionMode): Fit {
  const pixelRatio = Math.min(MAX_PIXEL_RATIO, devicePixelRatio > 0 ? devicePixelRatio : 1);
  const screen = {
    width: Math.max(1, Math.round(css.width * pixelRatio)),
    height: Math.max(1, Math.round(css.height * pixelRatio)),
  };
  const scale = Math.max(1, Math.ceil(screen.height / PIXEL_LINES));
  const size =
    mode === 'pixels'
      ? { width: Math.round(screen.width / scale), height: Math.round(screen.height / scale) }
      : mode === 'balanced'
        ? { width: Math.round(screen.width / 2), height: Math.round(screen.height / 2) }
        : screen;
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
  return {
    get current() {
      return current;
    },
    update() {
      const css = { width: canvas.clientWidth, height: canvas.clientHeight };
      const mode = settings.get<ResolutionMode>('gfx.resolution');
      const ratio = pixelRatio();
      const next = `${css.width}x${css.height}@${ratio}:${mode}`;
      if (next === key) return false;
      key = next;
      current = fitResolution(css, ratio, mode);
      renderer.setPixelRatio(1);
      renderer.setSize(current.width, current.height, false);
      canvas.style.imageRendering = current.pixelated ? 'pixelated' : '';
      return true;
    },
  };
}
