/**
 * @file The look `look:torch-toon`: toon shading with outlines in the torch-lit hall (PLAN.md WP 7.8): every material
 * banded in three steps of light with a rim, the characters and objects inked, as the prototype drew them. The style is
 * WP 7.2's toon (engine/gfx/materials/toon.ts: the bands follow each light, the torches' pools too); the ink is the
 * composite's edge outline (engine/gfx/post/composite.ts: from depth, crease and ID), which also outlines the skinned
 * hero and crowd, where an outline shell cannot go (engine/gfx/materials/outline.ts). Carried from the prototype's
 * `TOON_BANDS` (three steps) and its ink round characters and objects
 * (`my-3d2dge:src/stress-world/00-setup.js:91-116`).
 *
 * Invariants: data only, the kind's fields (`node x describe look`): the sky `sky:hall` (engine/gfx/sky.ts), which a
 * page that starts the engine shows (engine/app/look.ts), the toon style, and every filter it leaves out off; levels 0
 * (off) or 8 and more, so dull colours keep their hue. A page draws it when its setting `post.look` names it; switching
 * to it from a look with the scene's own lights warms up first (the lights change the shader key), then builds nothing.
 *
 * @example
 * look.id; // 'look:torch-toon'
 * look.sky; // 'sky:hall'
 * @see labs/box/looks/torch-toon.test.ts
 * @see tests/e2e/box-look.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:torch-toon`: toon shading with outlines in the torch-lit hall. */
export const look = defineLook('look:torch-toon', {
  description: 'Toon shading in the torch-lit hall: three bands of light with a rim, the characters and objects inked.',
  sky: 'sky:hall',
  style: 'toon',
  toon: { bands: 3, rim: 0.35 },
  filters: { outline: { scope: 'characters+objects', width: 2, darken: 0 } },
});
