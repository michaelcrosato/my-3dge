/**
 * @file The shingle generator (`texture:shingles`, PLAN.md WP 13.17): a roof's shingles in overlapping courses up the
 * slope (v), each course offset half a shingle: a tone per shingle, a dark slot between shingles, a lit butt along
 * each course's bottom row, and the shadow the course above throws across its top, so each dark row sits under the
 * next course's light lip and reads as an overlap, not as mortar. The relief is thickest at each butt and thins up the
 * course to where the next one covers it. Matte; brown, not brick's red.
 *
 * Its tones stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at one shingle across and two courses up (`tile`); the layout is shifted a quarter shingle across
 * and half a course up, so the wrap edge runs through shingles, as the brick's does.
 *
 * @example
 * SHINGLES.size; // [64, 64]: four shingles across, sixteen courses up
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { cellHash, palette, pickTone, runningBond } from '../tile';
import { textureSpec } from '../types';

/** The shingle generator's spec. */
export const SHINGLES = textureSpec({
  description:
    'Roof shingles in overlapping courses: a tone per shingle, dark slots, a shadow under each course above.',
  params: {
    tones: {
      type: 'array',
      items: { type: 'string' },
      default: ['#7b5a44', '#6a4d3a', '#8b6850'],
      description: 'The shingles’ tones, hex; each shingle takes one.',
    },
    shadow: { type: 'string', default: '#3f2c20', description: 'The slots and the shadow under a course, hex.' },
    butt: { type: 'string', default: '#9b785e', description: 'A course’s lit butt, its bottom row, hex.' },
    width: {
      type: 'integer',
      default: 16,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: 'A shingle’s width, its slot included: four times the course, a roof’s tab, not a brick’s.',
    },
    course: {
      type: 'integer',
      default: 4,
      minimum: 2,
      maximum: 256,
      unit: 'texels',
      description: 'How much of each course shows, its shadow row included.',
    },
  },
  size: [64, 64],
  tile: ({ width, course }) => [width, 2 * course],
  create({ params, seed, width: w, height: h }) {
    const tones = palette(params.tones, 'texture:shingles tones');
    const [shadow, butt] = palette([params.shadow, params.butt], 'texture:shingles');
    const { width, course } = params;
    return (x, y, texel) => {
      const phase = [Math.floor(width / 4), Math.floor(course / 2)] as const;
      const { col, row, lx, ly } = runningBond(x, y, [width, course], [w, h], phase);
      let [color, roughness] = [pickTone(tones, cellHash(col, row, seed, 1)), 0.9];
      if (lx === 0 || ly === course - 1) [color, roughness] = [shadow, 0.95];
      else if (ly === 0) color = butt;
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = lx === 0 ? 0.4 : 1 - (0.4 * ly) / (course - 1);
      texel.roughness = roughness;
    };
  },
});
