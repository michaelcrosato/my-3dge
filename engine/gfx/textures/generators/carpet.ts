/**
 * @file The carpet generator (`texture:carpet`, PLAN.md WP 13.17): a close pile in its colour, each tuft a shade
 * lighter or darker, mottled in soft patches where it has worn or been brushed the other way. The relief roughens
 * with the tufts; the pile is matte.
 *
 * Its shades stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at the patches' 16 texels (`tile`: [16, 16]); tufts are single texels, hashed where they are.
 *
 * @example
 * CARPET.size; // [64, 64]
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The carpet generator's spec. */
export const CARPET = textureSpec({
  description: 'A close carpet pile: tufts a shade lighter or darker than its colour, soft worn patches.',
  params: {
    base: { type: 'string', default: '#7c3a3a', description: 'The pile, hex.' },
    light: { type: 'string', default: '#8f4747', description: 'Lighter tufts and the worn patches, hex.' },
    dark: { type: 'string', default: '#682f2f', description: 'Darker tufts, hex.' },
    tufts: {
      type: 'number',
      default: 0.3,
      minimum: 0,
      maximum: 1,
      description: 'The share of texels a tuft lighter or darker, half each.',
    },
    worn: {
      type: 'number',
      default: 0.15,
      minimum: 0,
      maximum: 0.5,
      description: 'The share of the pile worn lighter.',
    },
  },
  size: [64, 64],
  tile: () => [16, 16],
  create({ params, seed, width, height }) {
    const [base, light, dark] = palette([params.base, params.light, params.dark], 'texture:carpet');
    const patch = tileNoise([width, height], { cells: [width / 16, height / 16], seed, octaves: 2, salt: 1 });
    // Two octaves of value noise gather near 0.5: beyond 0.5 + 0.96 (0.5 − share) lies about `share` of them.
    const wornAbove = 0.5 + 0.96 * (0.5 - params.worn);
    return (x, y, texel) => {
      const tuft = cellHash(wrapIndex(x, width), wrapIndex(y, height), seed, 2);
      const worn = patch(x, y) > wornAbove;
      let color = worn ? light : base;
      if (tuft < params.tufts / 2) color = dark;
      else if (tuft > 1 - params.tufts / 2) color = light;
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = 0.8 + 0.2 * tuft;
      texel.roughness = 1;
    };
  },
});
