/**
 * @file The look `look:torch-fxaa`: FXAA over the torch-lit hall (PLAN.md WP 7.8): the edges smoothed along their
 * direction. The engine's edge smoothing (engine/gfx/post/aa.ts: FXAA, which measured nearer the supersampled edges
 * than SMAA), over the whole picture, as the prototype's FXAA toggle (`my-3d2dge:src/stress-world/45-filters.js:11`).
 *
 * Invariants: data only, the kind's fields (`node x describe look`): the sky `sky:hall` (engine/gfx/sky.ts), which a
 * page that starts the engine shows (engine/app/look.ts), the scene's own style, and every filter it leaves out off;
 * levels 0 (off) or 8 and more, so dull colours keep their hue. A page draws it when its setting `post.look` names it;
 * switching to it from a look with the scene's own lights warms up first (the lights change the shader key), then
 * builds nothing.
 *
 * @example
 * look.id; // 'look:torch-fxaa'
 * look.sky; // 'sky:hall'
 * @see labs/box/looks/torch-fxaa.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:torch-fxaa`: fXAA over the torch-lit hall. */
export const look = defineLook('look:torch-fxaa', {
  description: 'FXAA in the torch-lit hall: every edge smoothed.',
  sky: 'sky:hall',
  filters: { aa: { scope: 'all' } },
});
