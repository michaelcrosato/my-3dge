/**
 * @file The look `look:playground-cel`, the playground cel-shaded (docs/PLAYGROUND.md §5.2, PLAN.md WP 13.24): the
 * toon style's ramp per material (three bands of light and a rim, each material's shadows its own colour shifted in
 * hue, cooler and more saturated, rather than darkened: `shade`), ink from depth and normals at sharp creases, the
 * outline shells round the props and the bodies (skinned ones too, engine/gfx/stageShells.ts), both 1 px at 270
 * lines and scaled to the picture's lines in whole pixels, and the sky's dome as a clean gradient (`skyGradient`).
 * By day and by night the light is the hour's (engine/gfx/daylight.ts); the look keeps its numbers. It is drawn at
 * the screen's full resolution (`resolution: 'full'`, while `gfx.resolution` is `auto`) with every texture blended
 * (`textures: 'smooth'`), the owner's directions of 2026-11-03 (WP 13.30, ADR-0025 amendments 47 and 49): the
 * engine's `pixels` resolution and crisp texels are the pixel look's.
 *
 * The ink is a dark tint of the surface under it (0.35 of it), at sharp creases only (0.2): measured in WP 13.2's
 * review, a 2 px black line at every crease covered the player's whole accent where the isometric and top-down
 * cameras draw the player 11 to 15 px tall, which tests/e2e/playground.spec.ts counts in every camera.
 *
 * Invariants: data only, the kind's fields (`node x describe look`); the sky `sky:daylight` (engine/gfx/sky.ts); every
 * filter it leaves out off. P steps to it from the clean look, the page's default (labs/playground/main.ts), and on
 * to the pixel look.
 *
 * @example
 * look.id; // 'look:playground-cel'
 * look.toon.bands; // 3
 * [look.resolution, look.textures]; // ['full', 'smooth']
 * @see labs/playground/looks/looks.test.ts
 * @see tests/e2e/playground-looks.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:playground-cel`: three bands and a rim per material, hue-shifted shadows, ink, shells, a gradient sky. */
export const look = defineLook('look:playground-cel', {
  description:
    'The playground cel-shaded at full resolution: three bands and a rim per material, shadows shifted in hue, smooth textures, inked and outlined, a gradient sky.',
  sky: 'sky:daylight',
  style: 'toon',
  resolution: 'full',
  textures: 'smooth',
  toon: { bands: 3, rim: 0.35, shade: 0.7 },
  shells: { width: 1, color: '#1a1420' },
  skyGradient: 1,
  filters: {
    outline: { scope: 'all', width: 1, lines: 270, darken: 0.35, crease: 0.2 },
    grade: { scope: 'all', saturation: 1.15, contrast: 1.12 },
  },
});
