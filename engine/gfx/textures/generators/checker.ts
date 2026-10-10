/**
 * @file The checker generator (`texture:checker`, PLAN.md WP 2.3): square tiles of two colours, alternating (castle
 * floors, bonus rooms, and a test pattern that shows how a surface is mapped). Flat: no relief, so no normals; the
 * two colours may differ in roughness.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3098` (`E.tex.checker`), rewritten: y up, shifted half a tile on both
 * axes so the wrap edge runs through tiles, and roughness added.
 *
 * Invariants: tiles at two squares on each axis (`tile`: [2 × square, 2 × square]).
 *
 * @example
 * CHECKER.size; // [64, 64]: four squares across, four up
 * @see engine/gfx/textures/generators.test.ts
 */
import { palette, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The checker generator's spec. */
export const CHECKER = textureSpec({
  description: 'Square tiles of two alternating colours, flat.',
  params: {
    a: { type: 'string', default: '#d8d0e8', description: 'The first colour, hex.' },
    b: { type: 'string', default: '#5a5270', description: 'The second colour, hex.' },
    square: {
      type: 'integer',
      default: 16,
      minimum: 1,
      maximum: 2048,
      unit: 'texels',
      description: "A square's side.",
    },
    roughnessA: { type: 'number', default: 0.55, minimum: 0, maximum: 1, description: "The first colour's roughness." },
    roughnessB: { type: 'number', default: 0.7, minimum: 0, maximum: 1, description: "The second colour's roughness." },
  },
  size: [64, 64],
  tile: (params) => [2 * params.square, 2 * params.square],
  create({ params, width, height }) {
    const [a, b] = palette([params.a, params.b], 'texture:checker');
    const s = params.square;
    const shift = Math.floor(s / 2);
    return (x, y, texel) => {
      const column = Math.floor(wrapIndex(x + shift, width) / s);
      const row = Math.floor(wrapIndex(y + shift, height) / s);
      const first = ((column + row) & 1) === 0;
      const color = first ? a : b;
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.roughness = first ? params.roughnessA : params.roughnessB;
    };
  },
});
