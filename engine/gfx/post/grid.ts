/**
 * @file The pixel grid a frame draws on (PLAN.md WP 7.4, WP 13.24; docs/PLAYGROUND.md §5.2): what the post chain
 * (engine/gfx/post/chain.ts) works out each frame from its filter chain and the drawing buffer's lines.
 * - **The art block** (`artBlock`): the pixel filter's `size` 0 takes the largest whole block giving the picture at
 *   least 240 lines and at most 360 (every buffer of 480 lines or more; one of 361 to 479 keeps its own pixels): one
 *   drawn pixel in the engine's `pixels` resolution (270 lines on 1080 or 540 screen lines), four in `full` at 1080,
 *   so pixel art is a low-resolution picture at a whole-number scale in every resolution mode.
 * - **The snap** (`snapBlock`, `frameGrid`): pixel art over the environment that snaps puts the camera on its block
 *   grid for the frame (engine/gfx/post/snap.ts `snapGrid`), one drawn pixel too; else the whole screen's low
 *   resolution snaps it (blocks of 2 px or more). The frame's grid gives the whole blocks the camera stands at (the
 *   dithers' cells: the composite's palette dither, `frame.zw`, and the toon ramp's, `toon.grid`, so both patterns
 *   stay on the world) and, with the pixel filter's `smooth`, the remainder as the picture's glide, which the page
 *   carries (engine/gfx/resolution.ts `shift`).
 * - **The ink's width** (`inkWidth`): the outline filter's `width`, scaled with the picture's lines when its `lines`
 *   says so, in whole pixels, at least 1 (1 px at 270 lines is 4 px at 1080).
 *
 * Invariants: pure but for `frameGrid`, which moves the camera until its `restore()`; equal chains and sizes give
 * equal grids; nothing reaches the sim.
 *
 * @example
 * import { chainOf } from './filters';
 * artBlock(270); // 1: the engine's pixels are the art's
 * artBlock(1080); // 4
 * snapBlock(chainOf({ pixel: { scope: 'all', size: 0 } }), 1080); // 4
 * inkWidth(chainOf({ outline: { scope: 'all', width: 1, lines: 270 } }).outline, 1080); // 4
 * @see engine/gfx/post/grid.test.ts
 * @see tests/e2e/playground-looks.spec.ts
 */
import type { Camera } from 'three/webgpu';
import { scopeMask, type FilterChain } from './filters';
import { PART_BITS } from './mrt';
import { snapGrid, type SnapGrid } from './snap';

/** The lines pixel art's picture keeps to: at least `least`, at most `most` wherever a whole block allows it. */
export const ART_LINES = { least: 240, most: 360 } as const;

/** The art block for a picture `lines` high: the largest whole block giving it at least 240 lines (1 below that). */
export function artBlock(lines: number): number {
  return Math.max(1, Math.floor(lines / ART_LINES.least));
}

/** The pixel filter's block for a picture `lines` high: its `size`, or the art block for `size` 0. */
export function pixelBlock(chain: FilterChain, lines: number): number {
  return chain.pixel.size === 0 ? artBlock(lines) : chain.pixel.size;
}

/**
 * The block grid the camera snaps to for `chain` on a picture `lines` high: pixel art's when it covers the
 * environment and snaps (characters and objects in pixel art move on their own, and a snapping camera would make a
 * sharp world jump), one drawn pixel included; else the whole screen's low resolution of 2 px or more; 0 for none.
 */
export function snapBlock(chain: FilterChain, lines: number = ART_LINES.least): number {
  if (chain.pixel.snap && (scopeMask(chain.pixel.scope) & PART_BITS.environment) !== 0) return pixelBlock(chain, lines);
  return chain.screen.scope === 'all' && chain.screen.pixelate > 1 ? chain.screen.pixelate : 0;
}

/** The outline's width in pixels on a picture `lines` high: `width`, scaled when `lines` is set (see the file comment). */
export function inkWidth(outline: FilterChain['outline'], lines: number): number {
  return outline.lines > 0 ? Math.max(1, Math.round((outline.width * lines) / outline.lines)) : outline.width;
}

/** A frame's grid: its pixel art's block, the snap's cells and the picture's glide, and how to put the camera back. */
export interface FrameGrid {
  /** The pixel filter's block this frame. */
  block: number;
  /** The whole blocks the camera stands at, across and down: (0, 0) unsnapped. */
  cells: [number, number];
  /** The glide the page carries, in drawn pixels, right and down: (0, 0) unless snapped and `smooth`. */
  shift: [number, number];
  restore(): void;
}

/** Snaps `camera` for a frame of `chain` drawn `size` big (see the file comment); call `restore()` after it. */
export function frameGrid(chain: FilterChain, camera: Camera, size: { width: number; height: number }): FrameGrid {
  const block = pixelBlock(chain, size.height);
  const snap = snapBlock(chain, size.height);
  const grid: SnapGrid | null = snap > 0 ? snapGrid(camera, snap, size) : null;
  return {
    block,
    cells: grid ? grid.cells : [0, 0],
    shift: grid && chain.pixel.smooth ? grid.shift : [0, 0],
    restore: () => grid?.restore(),
  };
}
