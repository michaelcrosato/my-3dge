/**
 * @file The look `look:daylight`: the box under a plain day (PLAN.md WP 11.5): the sky `sky:daylight` over the scene's
 * own style with no filter, its sun casting shadows across the scene. On a renderer with cascaded shadows
 * (`feature:cascadedShadows`, engine/gfx/enhanced/csm.ts) the sun casts through three cascades of the view, so the
 * crowd arenas' shadows stay sharp near the camera; tests/e2e/enhanced.spec.ts draws it both ways.
 *
 * Invariants: data only, the kind's fields (`node x describe look`): the sky `sky:daylight` (engine/gfx/sky.ts), which
 * a page that starts the engine shows (engine/app/look.ts), the scene's own style, and every filter it leaves out off.
 * Switching to it from a look with the scene's own lights warms up first (the lights change the shader key), then
 * builds nothing.
 *
 * @example
 * look.id; // 'look:daylight'
 * look.sky; // 'sky:daylight'
 * @see labs/box/looks/daylight.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:daylight`: the box under a plain day: the sky `sky:daylight` over the scene's own style. */
export const look = defineLook('look:daylight', {
  description: 'A plain day: the day sky and its sun over the scene, casting shadows; no filter.',
  sky: 'sky:daylight',
});
