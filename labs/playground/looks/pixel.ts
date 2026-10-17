/**
 * @file The look `look:playground-pixel`, the playground's pixel-art look as it starts (docs/PLAYGROUND.md §5.2,
 * PLAN.md WP 13.1): daylight, toon bands, then the picture cut into 3-pixel blocks with a one-block rim and 24 shades a
 * channel, lightly dithered. WP 13.24 finishes it (a whole-number low-resolution render, 1-pixel ink, palette ramps,
 * the orthographic cameras snapped to the pixel grid); until then it is the composite's pixel and palette filters, as
 * the box's `look:torch-pixel` draws them.
 *
 * Invariants: data only, the kind's fields (`node x describe look`); the sky `sky:daylight`; levels 0 or at least 24,
 * so pixel art keeps its hues (engine/gfx/post/filters.ts); every filter it leaves out off.
 *
 * @example
 * look.id; // 'look:playground-pixel'
 * @see labs/playground/looks/looks.test.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:playground-pixel`: daylight in 3-pixel blocks, 24 shades a channel, lightly dithered. */
export const look = defineLook('look:playground-pixel', {
  description: 'The playground in daylight as pixel art: toon bands in 3-pixel blocks with a rim, 24 shades, dithered.',
  sky: 'sky:daylight',
  style: 'toon',
  toon: { bands: 3, rim: 0.3 },
  filters: {
    pixel: { scope: 'all', size: 3, outline: true },
    palette: { scope: 'all', palette: 'none', levels: 24, dither: 0.25 },
  },
});
