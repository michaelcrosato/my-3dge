/**
 * @file The look `look:playground-cel`, the playground's cel-shaded look as it starts (docs/PLAYGROUND.md §5.2,
 * PLAN.md WP 13.1): daylight, every material banded in three steps of light with a rim, everything inked. WP 13.24
 * finishes it (a ramp per material, hue-shifted shadows, ink from depth and normals scaled to the resolution); until
 * then it is the engine's toon style and the composite's edge outline, as the box's `look:torch-toon` draws them.
 *
 * Invariants: data only, the kind's fields (`node x describe look`); the sky `sky:daylight` (engine/gfx/sky.ts); every
 * filter it leaves out off. The page draws it by default (labs/playground/main.ts); P switches to the pixel look.
 *
 * @example
 * look.id; // 'look:playground-cel'
 * look.sky; // 'sky:daylight'
 * @see labs/playground/looks/looks.test.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:playground-cel`: three bands of daylight with a rim, everything inked. */
export const look = defineLook('look:playground-cel', {
  description: 'The playground in daylight, cel-shaded: three bands of light with a rim, everything inked.',
  sky: 'sky:daylight',
  style: 'toon',
  toon: { bands: 3, rim: 0.35 },
  filters: {
    outline: { scope: 'all', width: 2, darken: 0 },
    grade: { scope: 'all', saturation: 1.15, contrast: 1.05 },
  },
});
