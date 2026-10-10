/**
 * @file The dressed-stone generator (`texture:stone`, PLAN.md WP 2.3): big blocks in running bond, bevelled (lit top
 * and left, dark bottom and right) with a joint along the bottom and right, each block its own tone, worn patches
 * from noise. The relief raises each block's face above its bevels and sinks the joints: the pillars' shafts, the
 * stairs, plinths.
 *
 * Carried from the hall's `blockTex` (`my-3d2dge:src/stress-world/10-hall.js:239-248`) and the lab's pillar stone
 * (`my-3d2dge:src/lab3d/10-materials.js:32-39`, the palette), rewritten: periodic (tones hashed by wrapped cell,
 * patches from tiling noise), y up, the layout shifted a quarter block across and half a block up so the wrap edge
 * runs through blocks, and height and roughness added.
 *
 * Invariants: tiles at whole blocks across and an even number of courses (`tile`: [width, 2 × course]).
 *
 * @example
 * STONE.size; // [64, 64]: four blocks across, eight courses
 * @see engine/gfx/textures/generators.test.ts
 */
import { cellHash, palette, pickTone, runningBond, tileNoise } from '../tile';
import { textureSpec } from '../types';

/** The dressed-stone generator's spec. */
export const STONE = textureSpec({
  description: 'Dressed stone: big bevelled blocks in running bond, a tone per block, sunk joints and worn patches.',
  params: {
    blocks: {
      type: 'array',
      items: { type: 'string' },
      default: ['#7d7662', '#857e69', '#76705c'],
      description: 'The block tones, hex; each block takes one.',
    },
    mortar: { type: 'string', default: '#4a4538', description: 'The joints, hex.' },
    hi: { type: 'string', default: '#a39b84', description: "The lit bevel along each block's top and left, hex." },
    lo: {
      type: 'string',
      default: '#615b4b',
      description: "The shaded bevel along each block's bottom and right, and the worn patches, hex.",
    },
    width: {
      type: 'integer',
      default: 16,
      minimum: 6,
      maximum: 256,
      unit: 'texels',
      description: "A block's width, its joint included.",
    },
    course: {
      type: 'integer',
      default: 8,
      minimum: 4,
      maximum: 256,
      unit: 'texels',
      description: "A course's height (a block's), its joint included.",
    },
    wear: {
      type: 'number',
      default: 0.2,
      minimum: 0,
      maximum: 1,
      description: 'The share of each face worn into darker patches.',
    },
  },
  size: [64, 64],
  tile: (params) => [params.width, 2 * params.course],
  create({ params, seed, width, height }) {
    const blocks = palette(params.blocks, 'texture:stone blocks');
    const [mortar, hi, lo] = palette([params.mortar, params.hi, params.lo], 'texture:stone');
    const [bw, bh] = [params.width, params.course];
    const size = [width, height] as const;
    const phase = [Math.floor(bw / 4), Math.floor(bh / 2)] as const;
    // Patches about 3.3 texels across, as the prototype's noise2(x * .3, y * .3); a whole number of cells per tile.
    const cells = [Math.max(1, Math.round(width * 0.3)), Math.max(1, Math.round(height * 0.3))] as const;
    const patches = tileNoise(size, { cells, seed, salt: 1 });
    return (x, y, texel) => {
      const { col, row, lx, ly } = runningBond(x, y, [bw, bh], size, phase);
      let color = pickTone(blocks, cellHash(col, row, seed, 1));
      let relief = 1;
      let roughness = 0.75;
      if (ly === 0 || lx === bw - 1) [color, relief, roughness] = [mortar, 0, 0.95];
      else if (ly === bh - 1 || lx === 0) [color, relief, roughness] = [hi, 0.6, 0.7];
      else if (ly === 1 || lx === bw - 2) [color, relief, roughness] = [lo, 0.6, 0.8];
      else if (patches(x, y) > 1 - params.wear) [color, relief, roughness] = [lo, 0.9, 0.85];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
