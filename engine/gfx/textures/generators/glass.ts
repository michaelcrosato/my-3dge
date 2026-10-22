/**
 * @file The glass generator (`texture:glass`, PLAN.md WP 13.17): a window's pane, pale and cool, with soft
 * reflections in diagonal bands across it: a broad one and a narrow one each repeat, as a sky catches in glass. Flat
 * and smooth. The material that uses it stays opaque (engine/gfx/materials/builtins.ts says why).
 *
 * Its colours stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at one repeat (`tile`: [repeat, repeat]); the bands run at 45°, so they meet at the wrap.
 *
 * @example
 * GLASS.size; // [64, 64]: four repeats across, four up
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { palette, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The glass generator's spec. */
export const GLASS = textureSpec({
  description: 'Window glass: pale and cool, a broad and a narrow reflection in diagonal bands across it.',
  params: {
    base: { type: 'string', default: '#9fc3d3', description: 'The glass, hex.' },
    sheen: { type: 'string', default: '#c9e2ec', description: 'The reflections, hex.' },
    repeat: {
      type: 'integer',
      default: 16,
      minimum: 8,
      maximum: 256,
      unit: 'texels',
      description: 'From one pair of bands to the next, across and up.',
    },
  },
  size: [64, 64],
  tile: ({ repeat }) => [repeat, repeat],
  create({ params }) {
    const [base, sheen] = palette([params.base, params.sheen], 'texture:glass');
    const { repeat } = params;
    const broad = Math.max(2, Math.floor(repeat / 5));
    return (x, y, texel) => {
      const d = wrapIndex(x + y, repeat);
      const color = d < broad || d === broad + 2 ? sheen : base;
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = 1;
      texel.roughness = 0.05;
    };
  },
});
