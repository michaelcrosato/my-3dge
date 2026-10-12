/**
 * @file The look `look:torch-pixel`: the prototype's pixel look over the torch-lit hall (PLAN.md WP 7.8): the picture
 * in 4 px blocks, 8 shades a channel, dithered between them. Its numbers are the prototype's filter panel's
 * (`my-3d2dge:src/stress-world/45-filters.js:21-24`), as the engine's preset `look:pixel/dithered` holds them; the
 * camera snaps to the block grid, so the hall does not shimmer as it slides (engine/gfx/post/snap.ts).
 *
 * Invariants: data only, the kind's fields (`node x describe look`): the sky `sky:hall` (engine/gfx/sky.ts), which a
 * page that starts the engine shows (engine/app/look.ts), the scene's own style, and every filter it leaves out off;
 * levels 0 (off) or 8 and more, so dull colours keep their hue. A page draws it when its setting `post.look` names it;
 * switching to it from a look with the scene's own lights warms up first (the lights change the shader key), then
 * builds nothing.
 *
 * @example
 * look.id; // 'look:torch-pixel'
 * look.sky; // 'sky:hall'
 * @see labs/box/looks/torch-pixel.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:torch-pixel`: the prototype's pixel look over the torch-lit hall. */
export const look = defineLook('look:torch-pixel', {
  description: 'Pixel art in the torch-lit hall: 4 px blocks, 8 shades a channel, dithered.',
  sky: 'sky:hall',
  filters: {
    pixel: { scope: 'all', size: 4, outline: false },
    palette: { scope: 'all', palette: 'none', levels: 8, dither: 0.35 },
  },
});
