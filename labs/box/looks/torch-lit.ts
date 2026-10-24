/**
 * @file The look `look:torch-lit`: the torch-lit hall, the prototype's stress world (PLAN.md WP 7.8): dark but for the
 * torches on the braziers, each flickering on its own, the nearest casting shadows, and fog from 12 m past the hero. It
 * is the sky `sky:hall` over the scene's own style with no filter: the light pool lights all the hall's 30 torch
 * spots on a renderer with tiled lighting (engine/gfx/enhanced/lighting.ts), else the 12 nearest the hero
 * (engine/gfx/lights.ts), the light following him round the hall; the other box looks are this one with a style or a
 * filter preset (labs/box/README.md lists them).
 *
 * Invariants: data only, the kind's fields (`node x describe look`): the sky `sky:hall` (engine/gfx/sky.ts), which a
 * page that starts the engine shows (engine/app/look.ts), the scene's own style, and every filter it leaves out off;
 * levels 0 (off) or 8 and more, so dull colours keep their hue. A page draws it when its setting `post.look` names it;
 * switching to it from a look with the scene's own lights warms up first (the lights change the shader key), then
 * builds nothing.
 *
 * @example
 * look.id; // 'look:torch-lit'
 * look.sky; // 'sky:hall'
 * @see labs/box/looks/torch-lit.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:torch-lit`: the torch-lit hall: the sky `sky:hall` over the scene's own style, no filter. */
export const look = defineLook('look:torch-lit', {
  description:
    'The torch-lit hall: dark but for the flickering torches near the hero, the nearest casting shadows; fog past him.',
  sky: 'sky:hall',
});
