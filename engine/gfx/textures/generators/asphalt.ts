/**
 * @file The asphalt generator (`texture:asphalt`, PLAN.md WP 13.17): a road's dark grey binder speckled with lighter
 * stone chips and darker pits, in soft lighter patches where traffic has worn it. The relief raises the chips and
 * sinks the pits; it is rough all over.
 *
 * Its greys stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at the patches' 16 texels (`tile`: [16, 16]); chips and pits are single texels, hashed where they
 * are.
 *
 * @example
 * ASPHALT.size; // [64, 64]
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The asphalt generator's spec. */
export const ASPHALT = textureSpec({
  description: 'Asphalt: dark grey binder speckled with lighter chips and darker pits, worn lighter in soft patches.',
  params: {
    base: { type: 'string', default: '#3d3e41', description: 'The binder, hex.' },
    worn: { type: 'string', default: '#4f5054', description: 'The worn patches, hex.' },
    chip: { type: 'string', default: '#5e5f63', description: 'The stone chips, hex.' },
    pit: { type: 'string', default: '#2b2c2e', description: 'The pits, hex.' },
    chips: { type: 'number', default: 0.16, minimum: 0, maximum: 1, description: 'The share of texels a chip.' },
    pits: { type: 'number', default: 0.06, minimum: 0, maximum: 1, description: 'The share of texels a pit.' },
    patches: { type: 'number', default: 0.3, minimum: 0, maximum: 0.5, description: 'The share worn lighter.' },
  },
  size: [64, 64],
  tile: () => [16, 16],
  create({ params, seed, width, height }) {
    const [base, worn, chip, pit] = palette([params.base, params.worn, params.chip, params.pit], 'texture:asphalt');
    const patch = tileNoise([width, height], { cells: [width / 16, height / 16], seed, octaves: 2, salt: 1 });
    const above = 0.5 + 0.96 * (0.5 - params.patches); // two octaves gather near 0.5 (texture:carpet says how)
    return (x, y, texel) => {
      const speck = cellHash(wrapIndex(x, width), wrapIndex(y, height), seed, 2);
      let [color, relief] = [patch(x, y) > above ? worn : base, 0.75];
      if (speck < params.chips) [color, relief] = [chip, 0.9];
      else if (speck > 1 - params.pits) [color, relief] = [pit, 0.55];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = 0.95;
    };
  },
});
