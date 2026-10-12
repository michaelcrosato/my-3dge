/**
 * @file The grass generator (`texture:grass`, PLAN.md WP 7.3): turf in blotches of light and dark grass at two
 * scales, short blade marks running up (dark where the turf is dark, light where it is light), and clusters of
 * flowers, two-texel spots in yellow or white gathered in a few meadows rather than spread evenly. No texel is a lone
 * speck: the blotches, blades and flowers all span more than one, so the turf does not sparkle at a distance.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3069-3076` (`E.tex.grass`: blotches at two scales, blade marks, rare
 * flower clusters, the palette), rewritten: periodic (blotches and meadows from tiling noise; blades hashed by wrapped
 * column, each column's marks offset so they do not line up; flowers hashed by wrapped 2 × 2 block), y up, and
 * height and roughness added: the blades stand above the turf, the flowers above the blades.
 *
 * Invariants: tiles at the blotches' 16 texels (`tile`: [16, 16]), which also holds whole blade runs (4 texels) and
 * flower blocks (2).
 *
 * @example
 * GRASS.size; // [64, 64]
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The length of the run a blade mark sits in, in texels (a mark is 2 or 3 of them). */
const RUN = 4;

/** The grass generator's spec. */
export const GRASS = textureSpec({
  description:
    'Turf: blotches of light and dark grass, short blade marks running up, and flowers clustered in a few meadows.',
  params: {
    base: { type: 'string', default: '#55a94a', description: 'The turf, hex.' },
    dark: { type: 'string', default: '#3e8a3a', description: 'The dark blotches and blades, hex.' },
    light: { type: 'string', default: '#6cc25a', description: 'The light blotches and blades, hex.' },
    flower: { type: 'string', default: '#f4e27a', description: 'The rarer flowers, hex.' },
    flower2: { type: 'string', default: '#f2f2f6', description: 'The commoner flowers, hex.' },
    patches: {
      type: 'number',
      default: 0.25,
      minimum: 0,
      maximum: 0.5,
      description: 'The share of the turf in each of the dark and the light blotches.',
    },
    blades: {
      type: 'number',
      default: 0.25,
      minimum: 0,
      maximum: 1,
      description: 'The share of 4-texel runs up each column holding a blade mark.',
    },
    flowers: {
      type: 'number',
      default: 0.12,
      minimum: 0,
      maximum: 1,
      description: 'The share of 2 × 2 blocks inside a meadow holding a flower; meadows cover about a fifth.',
    },
  },
  size: [64, 64],
  tile: () => [16, 16],
  create({ params, seed, width, height }) {
    const [base, dark, light, flower, flower2] = palette(
      [params.base, params.dark, params.light, params.flower, params.flower2],
      'texture:grass',
    );
    const size = [width, height] as const;
    // Blotches 16 texels across with 8-texel detail; see texture:dirt for the thresholds (two octaves' quantiles).
    const blotch = tileNoise(size, { cells: [width / 16, height / 16], seed, octaves: 2, salt: 1 });
    const meadow = tileNoise(size, { cells: [width / 16, height / 16], seed, salt: 3 });
    const spread = 0.48 * (0.5 - params.patches);
    const [low, high] = [0.5 - spread, 0.5 + spread];
    return (x, y, texel) => {
      const [px, py] = [wrapIndex(x, width), wrapIndex(y, height)];
      const n = blotch(px, py);
      let color = n < low ? dark : n > high ? light : base;
      let relief = 0.6 + n * 0.2;
      let roughness = 0.9;
      // A blade mark: 2 or 3 texels at the bottom of a hashed run, the runs of each column offset by a hash.
      const yy = wrapIndex(py + Math.floor(cellHash(px, 0, seed, 4) * RUN), height);
      const run = Math.floor(yy / RUN);
      if (cellHash(px, run, seed, 2) < params.blades && yy - run * RUN < (cellHash(px, run, seed, 5) < 0.5 ? 2 : 3)) {
        [color, relief] = [n < 0.5 ? light : dark, 0.85 + (yy - run * RUN) * 0.05];
      }
      // A flower: a 2 × 2 block in a meadow (where the meadow noise is in its top fifth), the blocks a texel off
      // the wrap edge so it runs through them.
      const [bx, by] = [
        wrapIndex(Math.floor((px + 1) / 2), width / 2),
        wrapIndex(Math.floor((py + 1) / 2), height / 2),
      ];
      if (meadow(px, py) > 0.7 && cellHash(bx, by, seed, 6) < params.flowers) {
        [color, relief, roughness] = [cellHash(bx, by, seed, 7) < 0.3 ? flower : flower2, 1, 0.8];
      }
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
