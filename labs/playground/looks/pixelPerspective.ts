/**
 * @file The look `look:playground-pixel-perspective`, the pixel look's variant for the perspective cameras (first
 * person, the shooter and the platformer; docs/PLAYGROUND.md §5.2, PLAN.md WP 13.24): the chain draws its filters and
 * toon numbers in place of `look:playground-pixel`'s while the camera is a perspective one (the look's `perspective`,
 * engine/gfx/post/chain.ts), its style and sky staying the pixel look's. A perspective picture moves in depth, where
 * no snap to the pixel grid can hold it still, so it draws unsnapped, with no glide, and its dither, fixed to the
 * screen there, is lighter, so the pattern crawls less over moving surfaces. `PIXEL_FILTERS` and `PIXEL_TOON` are
 * what both share.
 *
 * Invariants: data only; the pixel look's style and sky.
 *
 * @example
 * look.filters.pixel.snap; // false
 * @see labs/playground/looks/looks.test.ts
 */
import { defineLook } from '../../../engine';

/** The pixel looks' toon numbers: four bands and a rim, shadows shifted in hue, the steps dithered. */
export const PIXEL_TOON = { bands: 4, rim: 0.3, shade: 0.6, dither: 0.5 } as const;

/** The pixel looks' filters: the art block from the lines, 1-pixel ink, 24 shades a channel. */
export const PIXEL_FILTERS = {
  pixel: { scope: 'all', size: 0, levels: 0, outline: false, snap: false, smooth: false },
  outline: { scope: 'all', width: 1, lines: 270, darken: 0.3, crease: 0.4 },
  palette: { scope: 'all', palette: 'none', levels: 24, dither: 0 },
} as const;

/** The look `look:playground-pixel-perspective` (see the file comment). */
export const look = defineLook('look:playground-pixel-perspective', {
  description:
    "The pixel look's variant for the perspective cameras: unsnapped, no glide, a lighter dither on the screen.",
  sky: 'sky:daylight',
  style: 'toon',
  toon: { ...PIXEL_TOON, dither: 0.3 },
  filters: PIXEL_FILTERS,
});
