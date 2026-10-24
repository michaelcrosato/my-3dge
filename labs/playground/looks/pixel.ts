/**
 * @file The look `look:playground-pixel`, the playground as pixel art (docs/PLAYGROUND.md §5.2, PLAN.md WP 13.24): a
 * low-resolution picture at a whole-number scale (the pixel filter's `size` 0: the largest whole block giving 240 to
 * 360 lines, one drawn pixel in the engine's `pixels` resolution, engine/gfx/post/grid.ts), 1-pixel ink from depth and
 * normals, each material a ramp of four shades its shadows shifted in hue, its steps mixed by an ordered dither
 * fixed to the world (the toon style's `dither`, its cells counted from the snap), 24 shades a channel. The
 * orthographic cameras (isometric, top-down, at whole-number zooms: `cam.wholeZoom`) are snapped to the pixel grid in
 * translation, the remainder carried as a smooth offset of the upscaled picture (`smooth`; the page's canvas has a
 * margin of two drawn pixels for it), so a pan never shimmers; the sky a clean gradient. The perspective cameras, where
 * snapping cannot hold, draw its variant (labs/playground/looks/pixelPerspective.ts).
 *
 * Invariants: data only, the kind's fields (`node x describe look`); the sky `sky:daylight`; levels 0 or at least 24,
 * so pixel art keeps its hues (engine/gfx/post/filters.ts); every filter it leaves out off.
 *
 * @example
 * look.id; // 'look:playground-pixel'
 * look.filters.pixel.size; // 0: the art block from the lines
 * @see labs/playground/looks/looks.test.ts
 * @see tests/e2e/playground-looks.spec.ts
 */
import { defineLook } from '../../../engine';
import { PIXEL_FILTERS, PIXEL_TOON } from './pixelPerspective';

/** The look `look:playground-pixel`: a low-resolution picture, ramps dithered on the world, snapped and gliding. */
export const look = defineLook('look:playground-pixel', {
  description:
    'The playground as pixel art: 240 to 360 lines, 1-pixel ink, a ramp of four shades per material dithered on the world, the camera snapped to the pixels and gliding.',
  sky: 'sky:daylight',
  style: 'toon',
  toon: PIXEL_TOON,
  perspective: 'look:playground-pixel-perspective',
  skyGradient: 1,
  filters: { ...PIXEL_FILTERS, pixel: { ...PIXEL_FILTERS.pixel, snap: true, smooth: true } },
});
