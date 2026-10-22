/**
 * @file The playground's ground materials (docs/PLAYGROUND.md §2.2, PLAN.md WP 10.5): the hill's turf
 * (`material:playground-grass`, the engine's grass texture) and its rock (`material:playground-rock`, the dirt texture
 * in greys: gravel and stone), the layers its terrain names (labs/playground/scenes/hill.ts) for the splat to mix by
 * slope (engine/gfx/terrainSplat.ts). The page imports it (labs/playground/main.ts); the sim never reads materials.
 *
 * Level art, not a look: both looks draw it in their toon style. WP 13.17's building materials will add the yards'
 * and the street's.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * PLAYGROUND_GROUND; // ['material:playground-grass', 'material:playground-rock']
 * @see labs/playground/scenes/hill.test.ts
 */
import { defineMaterial } from '../../engine';

/** The ground's materials: the hill's turf, then its rock. */
export const PLAYGROUND_GROUND = ['material:playground-grass', 'material:playground-rock'] as const;

defineMaterial(PLAYGROUND_GROUND[0], {
  description: "The playground's turf: the hill and the yards (texture:grass).",
  map: 'texture:grass',
  roughness: 0.95,
});

defineMaterial(PLAYGROUND_GROUND[1], {
  description: "The playground's rock, where the hill is steep: the dirt texture in greys, gravel and stone.",
  map: { texture: 'texture:dirt', params: { base: '#8a8a84', dark: '#6d6d68', light: '#a3a39c', pebble: '#bdbdb5', shade: '#5a5a55' } }, // prettier-ignore
  roughness: 0.9,
});
