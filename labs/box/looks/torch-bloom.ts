/**
 * @file The look `look:torch-bloom`: bloom over the torch-lit hall (PLAN.md WP 7.8): the flames, the coals, the dais's
 * runes and the fight's sparks glow. As the prototype's bloom (`my-3d2dge:src/stress-world/45-filters.js:69-79, 99`):
 * what is brighter than 0.72 glows, added back at 0.6; here through three.js's `BloomNode`, before the composite and
 * never scoped. Bloom is off at the `low` quality tier (advice `GFX_POST_NO_BLOOM`).
 *
 * Invariants: data only, the kind's fields (`node x describe look`): the sky `sky:hall` (engine/gfx/sky.ts), which a
 * page that starts the engine shows (engine/app/look.ts), the scene's own style, and every filter it leaves out off;
 * levels 0 (off) or 8 and more, so dull colours keep their hue. A page draws it when its setting `post.look` names it;
 * switching to it from a look with the scene's own lights warms up first (the lights change the shader key), then
 * builds nothing.
 *
 * @example
 * look.id; // 'look:torch-bloom'
 * look.sky; // 'sky:hall'
 * @see labs/box/looks/torch-bloom.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:torch-bloom`: bloom over the torch-lit hall. */
export const look = defineLook('look:torch-bloom', {
  description: 'Bloom in the torch-lit hall: the flames, coals, runes and sparks glow.',
  sky: 'sky:hall',
  filters: { bloom: { scope: 'all', strength: 0.6, threshold: 0.72 } },
});
