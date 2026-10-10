/**
 * @file The flagstone generator (`texture:flagstone`, PLAN.md WP 2.3): square stones in running-bond rows, each its
 * own tone from the palette, with a one-texel joint along its left and top, a lit bevel inside the joint and a
 * shaded one along its bottom and right (light from the top left, as pixel art paints it), specks of grit, and a
 * crack across some stones. The relief puts the joints and cracks low and the bevels on a slope, so the normal map
 * shadows the joints under any light.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3059-3067` (`E.tex.flagstone`) with the palette of
 * `my-3d2dge:src/lab3d/10-materials.js:14` (the free camera room's floor), rewritten: periodic (stone tones hashed
 * by wrapped cell, specks by wrapped texel), y up, the layout shifted a quarter stone across and half a stone up so
 * the wrap edge runs through stones, never along a joint, and height and roughness added.
 *
 * Invariants: tiles at whole stones across and an even number of rows (`tile`: [stone, 2 × stone]).
 *
 * @example
 * FLAGSTONE.size; // [64, 64]: four stones across, four rows
 * @see engine/gfx/textures/generators.test.ts
 */
import { cellHash, palette, pickTone, runningBond, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The flagstone generator's spec. */
export const FLAGSTONE = textureSpec({
  description:
    'Square flagstones in running-bond rows: a tone per stone, joints, lit and shaded bevels, grit and the odd crack.',
  params: {
    stones: {
      type: 'array',
      items: { type: 'string' },
      default: ['#6b6f5a', '#767a63', '#626653'],
      description: 'The stone tones, hex; each stone takes one.',
    },
    mortar: { type: 'string', default: '#3a3c31', description: 'The joints and cracks, hex.' },
    hi: { type: 'string', default: '#8b8f75', description: "The lit bevel inside each stone's left and top joints." },
    lo: { type: 'string', default: '#51543f', description: "The shaded bevel along each stone's bottom and right." },
    speck: { type: 'string', default: '#45473a', description: 'Specks of grit, hex.' },
    stone: {
      type: 'integer',
      default: 16,
      minimum: 8,
      maximum: 256,
      unit: 'texels',
      description: "A stone's side, its joint included.",
    },
    specks: {
      type: 'number',
      default: 0.05,
      minimum: 0,
      maximum: 1,
      description: 'The share of texels that are grit.',
    },
    cracks: { type: 'number', default: 0.07, minimum: 0, maximum: 1, description: 'The share of stones with a crack.' },
  },
  size: [64, 64],
  tile: (params) => [params.stone, 2 * params.stone],
  create({ params, seed, width, height }) {
    const stones = palette(params.stones, 'texture:flagstone stones');
    const [mortar, hi, lo, speck] = palette([params.mortar, params.hi, params.lo, params.speck], 'texture:flagstone');
    const s = params.stone;
    const size = [width, height] as const;
    const phase = [Math.floor(s / 4), Math.floor(s / 2)] as const;
    const wear = tileNoise(size, { cells: [(2 * width) / s, (2 * height) / s], seed, salt: 1 });
    return (x, y, texel) => {
      const { col, row, lx, ly } = runningBond(x, y, [s, s], size, phase);
      const set = (color: readonly number[], relief: number, roughness: number) => {
        texel.color[0] = color[0];
        texel.color[1] = color[1];
        texel.color[2] = color[2];
        texel.height = relief;
        texel.roughness = roughness;
      };
      if (lx === 0 || ly === s - 1) return set(mortar, 0, 0.95);
      if (lx === 1 || ly === s - 2) return set(hi, 0.55, 0.75);
      if (lx === s - 1 || ly === 0) return set(lo, 0.55, 0.85);
      const crack = cellHash(col, row, seed, 3) < params.cracks;
      if (crack && lx > 2 && lx < s - 3 && Math.abs(lx - (s - 1 - ly) * 0.7 - 3) < 0.6) return set(mortar, 0.3, 0.95);
      const surface = wear(x, y);
      if (cellHash(wrapIndex(x, width), wrapIndex(y, height), seed, 2) < params.specks) {
        return set(speck, 0.9 - surface * 0.1, 0.9);
      }
      set(pickTone(stones, cellHash(col, row, seed, 1)), 1 - surface * 0.12, 0.78 + surface * 0.12);
    };
  },
});
