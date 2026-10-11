/**
 * @file The water generator (`texture:water`, PLAN.md WP 7.3): still water in two blue tones in broad patches, with
 * ripple lines running across it (along x), bent by a slow swell and dithered on every other texel, as the 2D games
 * paint a pond. The ripples are baked, so they do not move; the relief swells with them, so the normal map catches
 * the light along each line, and the water is smooth (low roughness), its crests a little rougher.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3085-3089` (`E.tex.water`: ripple crests on a checker dither, two tones
 * by noise, the palette), rewritten: periodic (a whole number of ripples up the texture, the swell and the drift
 * whole periods across it, the tones and the breaks in the lines from tiling noise), y up, the ripples turned to run
 * across the view rather than along it, no trigonometry (the ripple is a smoothed triangle wave, the same bits in
 * every runtime), and height and roughness added.
 *
 * Invariants: tiles at 64 texels across (the swell repeats every 32, the drift every 64) and a whole ripple up (two
 * when the wavelength is odd, so the dither's checker meets itself): `tile` is [64, wavelength].
 *
 * @example
 * WATER.size; // [64, 64]: four ripples up
 * wave(0); // 1: a crest; wave(0.5) is −1, a trough
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** Texels across the texture per period of the swell that bends the ripples. */
const SWELL = 32;
/** Texels across the texture over which the ripples drift one wavelength up. */
const DRIFT = 64;

/** A smooth wave of period 1 in [−1, 1], 1 at whole numbers: a smoothstepped triangle, close to cos 2πt. */
export function wave(t: number): number {
  const tri = Math.abs(2 * (t - Math.floor(t)) - 1);
  return 2 * tri * tri * (3 - 2 * tri) - 1;
}

/** The water generator's spec. */
export const WATER = textureSpec({
  description:
    'Still water: two blue tones in broad patches, and ripple lines bent by a slow swell, dithered, with a gentle relief.',
  params: {
    base: { type: 'string', default: '#2f7fd0', description: 'The water, hex.' },
    dark: { type: 'string', default: '#2464b0', description: 'The deeper patches, hex.' },
    light: { type: 'string', default: '#9fe3ff', description: 'The ripple crests, hex.' },
    wavelength: {
      type: 'integer',
      default: 16,
      minimum: 4,
      maximum: 256,
      unit: 'texels',
      description: 'The distance between ripples, up the texture.',
    },
    crests: {
      type: 'number',
      default: 0.12,
      minimum: 0,
      maximum: 1,
      description: 'The share of each ripple drawn as its crest line (before the dither takes every other texel).',
    },
    swell: {
      type: 'number',
      default: 0.35,
      minimum: 0,
      maximum: 2,
      description: 'How far the swell bends the ripples, in wavelengths.',
    },
  },
  size: [64, 64],
  // An even height too, so the dither's checker meets itself across the wrap edge.
  tile: (params) => [DRIFT, params.wavelength % 2 ? 2 * params.wavelength : params.wavelength],
  create({ params, seed, width, height }) {
    const [base, dark, light] = palette([params.base, params.dark, params.light], 'texture:water');
    const size = [width, height] as const;
    // Patches about 16 texels across (tileNoise repeats at the size whatever its cell count).
    const cells = [Math.max(1, Math.round(width / 16)), Math.max(1, Math.round(height / 16))] as const;
    const tone = tileNoise(size, { cells, seed, octaves: 2, salt: 1 });
    const breaks = tileNoise(size, { cells, seed, salt: 2 });
    return (x, y, texel) => {
      const [px, py] = [wrapIndex(x, width), wrapIndex(y, height)];
      // The phase: a whole number of ripples up, plus whole periods of swell and drift across, so it tiles.
      const t = py / params.wavelength + params.swell * wave(px / SWELL) + px / DRIFT;
      const swing = wave(t);
      const tri = Math.abs(2 * (t - Math.floor(t)) - 1);
      let color = tone(px, py) > 0.5 ? base : dark;
      let relief = 0.5 + swing * 0.25;
      let roughness = 0.08;
      const lit = (px + py) % 2 === 1 || cellHash(px, py, seed, 3) < 0.15;
      if (tri > 1 - params.crests && lit && breaks(px, py) > 0.35) [color, relief, roughness] = [light, 0.85, 0.3];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
