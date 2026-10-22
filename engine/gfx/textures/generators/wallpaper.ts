/**
 * @file The wallpaper generator (`texture:wallpaper`, PLAN.md WP 13.17): a printed paper in vertical stripes, a narrow
 * stripe at the left of each repeat and a small diamond in the middle of the wide band between, printed a little
 * proud. Matte.
 *
 * Its colours stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at one repeat (`tile`: [repeat, repeat]); the layout is shifted so the wrap edge runs through
 * the bare paper between a stripe and its diamond, never along a stripe's edge.
 *
 * @example
 * WALLPAPER.size; // [64, 64]: eight repeats across, eight up
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { palette, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The wallpaper generator's spec. */
export const WALLPAPER = textureSpec({
  description: 'Printed wallpaper: vertical stripes, and a small diamond in each wide band between them.',
  params: {
    base: { type: 'string', default: '#d9cfab', description: 'The paper, hex.' },
    stripe: { type: 'string', default: '#b5a87f', description: 'The stripes, hex: as heavy as the diamonds.' },
    motif: { type: 'string', default: '#9b8b63', description: 'The diamonds, hex.' },
    repeat: {
      type: 'integer',
      default: 8,
      minimum: 5,
      maximum: 256,
      unit: 'texels',
      description: 'One repeat, across and up: a stripe and its band.',
    },
    width: {
      type: 'integer',
      default: 3,
      minimum: 1,
      maximum: 64,
      unit: 'texels',
      description:
        'A stripe’s width, a diamond’s by default; at most the repeat less 3, so the diamond fits beside it.',
    },
  },
  size: [64, 64],
  tile: ({ repeat }) => [repeat, repeat],
  create({ params }) {
    const [base, stripe, motif] = palette([params.base, params.stripe, params.motif], 'texture:wallpaper');
    const { repeat } = params;
    const width = Math.min(params.width, repeat - 3);
    const [cx, cy] = [width + Math.floor((repeat - width) / 2), Math.floor(repeat / 2)];
    return (x, y, texel) => {
      const [lx, ly] = [wrapIndex(x + width + 1, repeat), wrapIndex(y, repeat)];
      let [color, relief] = [base, 0.95];
      if (lx < width) color = stripe;
      else if (Math.abs(lx - cx) + Math.abs(ly - cy) <= 1) [color, relief] = [motif, 1];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = 0.85;
    };
  },
});
