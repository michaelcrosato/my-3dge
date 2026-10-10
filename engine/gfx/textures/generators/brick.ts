/**
 * @file The brick generator (`texture:brick`, PLAN.md WP 2.3): brick courses in running bond, each brick its own
 * tone, a mortar joint along each course's bottom and each brick's right, a lit top row on every brick, and dark
 * specks. The relief sinks the joints, so lit walls show their courses.
 *
 * Carried from the lab's brick (`my-3d2dge:src/lab3d/10-materials.js:24-30`, 8 × 4 texels, the palette) and the hall's
 * wall faces (`my-3d2dge:src/stress-world/10-hall.js:225-236`, courses, staggered joints, lit brick tops and specks),
 * rewritten: periodic (tones hashed by wrapped cell, specks by wrapped texel), y up, the layout shifted a quarter
 * brick across and half a course up so the wrap edge runs through bricks, and height and roughness added.
 *
 * Invariants: tiles at whole bricks across and an even number of courses (`tile`: [brick width, 2 × course]).
 *
 * @example
 * BRICK.size; // [64, 64]: eight bricks across, sixteen courses
 * @see engine/gfx/textures/generators.test.ts
 */
import { cellHash, palette, pickTone, runningBond, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The brick generator's spec. */
export const BRICK = textureSpec({
  description: 'Brick courses in running bond: a tone per brick, sunk mortar joints, lit brick tops and dark specks.',
  params: {
    bricks: {
      type: 'array',
      items: { type: 'string' },
      default: ['#625d4d', '#6b6553', '#5a5546', '#676150'],
      description: 'The brick tones, hex; each brick takes one.',
    },
    mortar: { type: 'string', default: '#3d392f', description: 'The joints, hex.' },
    hi: { type: 'string', default: '#7d7662', description: "Each brick's lit top row, hex." },
    lo: { type: 'string', default: '#4c483b', description: 'Dark specks, hex.' },
    width: {
      type: 'integer',
      default: 8,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: "A brick's length, its joint included.",
    },
    course: {
      type: 'integer',
      default: 4,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: "A course's height, its joint included.",
    },
    specks: {
      type: 'number',
      default: 0.06,
      minimum: 0,
      maximum: 1,
      description: 'The share of texels that are specks.',
    },
  },
  size: [64, 64],
  tile: (params) => [params.width, 2 * params.course],
  create({ params, seed, width, height }) {
    const bricks = palette(params.bricks, 'texture:brick bricks');
    const [mortar, hi, lo] = palette([params.mortar, params.hi, params.lo], 'texture:brick');
    const cell = [params.width, params.course] as const;
    const size = [width, height] as const;
    const phase = [Math.floor(params.width / 4), Math.floor(params.course / 2)] as const;
    return (x, y, texel) => {
      const { col, row, lx, ly } = runningBond(x, y, cell, size, phase);
      let color = pickTone(bricks, cellHash(col, row, seed, 1));
      let relief = 1;
      let roughness = 0.85;
      if (ly === 0 || lx === cell[0] - 1) {
        [color, relief, roughness] = [mortar, 0, 0.95];
      } else if (ly === cell[1] - 1) {
        [color, relief, roughness] = [hi, 0.9, 0.8];
      } else if (cellHash(wrapIndex(x, width), wrapIndex(y, height), seed, 2) < params.specks) {
        [color, relief, roughness] = [lo, 0.85, 0.9];
      }
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
