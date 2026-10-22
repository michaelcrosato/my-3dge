/**
 * @file The concrete generator (`texture:concrete`, PLAN.md WP 13.17): a path's or a foundation's pale grey, mottled
 * at two scales, with small dark pores where air was caught. The relief rolls faintly with the mottling and sinks
 * the pores; rough all over.
 *
 * Its greys stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at the mottling's 16 texels (`tile`: [16, 16]); pores are single texels, hashed where they are.
 *
 * @example
 * CONCRETE.size; // [64, 64]
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The concrete generator's spec. */
export const CONCRETE = textureSpec({
  description: 'Concrete: pale grey mottled lighter and darker at two scales, with small dark pores.',
  params: {
    base: { type: 'string', default: '#a3a19b', description: 'The concrete, hex.' },
    dark: { type: 'string', default: '#908e88', description: 'The darker mottling, hex.' },
    light: { type: 'string', default: '#b7b5af', description: 'The lighter mottling, hex.' },
    pore: { type: 'string', default: '#6e6c67', description: 'The pores, hex.' },
    mottle: {
      type: 'number',
      default: 0.25,
      minimum: 0,
      maximum: 0.5,
      description: 'The share in each of the dark and the light mottling.',
    },
    pores: { type: 'number', default: 0.03, minimum: 0, maximum: 1, description: 'The share of texels a pore.' },
  },
  size: [64, 64],
  tile: () => [16, 16],
  create({ params, seed, width, height }) {
    const [base, dark, light, pore] = palette([params.base, params.dark, params.light, params.pore], 'texture:concrete'); // prettier-ignore
    const n = tileNoise([width, height], { cells: [width / 16, height / 16], seed, octaves: 2, salt: 1 });
    const spread = 0.48 * (0.5 - params.mottle); // texture:dirt's measure of two octaves' spread
    const [low, high] = [0.5 - spread, 0.5 + spread];
    return (x, y, texel) => {
      const v = n(x, y);
      let [color, relief] = [v < low ? dark : v > high ? light : base, 0.85 + 0.1 * v];
      if (cellHash(wrapIndex(x, width), wrapIndex(y, height), seed, 2) < params.pores) [color, relief] = [pore, 0.5];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = 0.9;
    };
  },
});
