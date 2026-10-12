/**
 * @file The look `look:torch-cel`: the prototype's comic cel over the torch-lit hall (PLAN.md WP 7.8): light in four
 * flat bands keeping each colour's hue, the colour pushed, ink where the picture changes sharply. Its numbers are the
 * prototype's filter panel's (`my-3d2dge:src/stress-world/45-filters.js:21-24`), as the engine's preset
 * `look:cel/comic` holds them.
 *
 * Invariants: data only, the kind's fields (`node x describe look`): the sky `sky:hall` (engine/gfx/sky.ts), which a
 * page that starts the engine shows (engine/app/look.ts), the scene's own style, and every filter it leaves out off;
 * levels 0 (off) or 8 and more, so dull colours keep their hue. A page draws it when its setting `post.look` names it;
 * switching to it from a look with the scene's own lights warms up first (the lights change the shader key), then
 * builds nothing.
 *
 * @example
 * look.id; // 'look:torch-cel'
 * look.sky; // 'sky:hall'
 * @see labs/box/looks/torch-cel.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:torch-cel`: the prototype's comic cel over the torch-lit hall. */
export const look = defineLook('look:torch-cel', {
  description: 'Comic cel in the torch-lit hall: four flat bands of light, pushed colour and ink lines.',
  sky: 'sky:hall',
  filters: { cel: { scope: 'all', bands: 4, punch: 1.3, ink: 0.9, inkWidth: 1.5 } },
});
