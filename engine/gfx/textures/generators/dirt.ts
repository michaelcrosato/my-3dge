/**
 * @file The dirt generator (`texture:dirt`, PLAN.md WP 7.3): bare ground in soft patches of three tones at two
 * scales, with pebbles, small clusters of two or three texels lit along their top and shaded along their bottom. Its
 * palette makes sand, snow or gravel too. The relief rolls gently with the patches and raises the pebbles, so a lit
 * path shows its stones.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3078-3083` (`E.tex.dirt`: patches at two scales, pebbles with a lit
 * edge, the palette), rewritten: periodic (patches from tiling noise, pebbles started at hashed wrapped texels), y
 * up, and height and roughness added.
 *
 * Invariants: tiles at the patches' 16 texels (`tile`: [16, 16]); pebbles may overlap (the lit top wins).
 *
 * @example
 * DIRT.size; // [64, 64]: four patch cells across
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The side of the area holding one pebble on average when `pebbles` is 1, in texels. */
const PEBBLE_CELL = 4;

/** The dirt generator's spec. */
export const DIRT = textureSpec({
  description:
    'Bare ground: soft patches of three tones at two scales and pebbles lit along their tops (sand, snow or gravel by palette).',
  params: {
    base: { type: 'string', default: '#9a7048', description: 'The ground, hex.' },
    dark: { type: 'string', default: '#7d5838', description: 'The darker patches, hex.' },
    light: { type: 'string', default: '#b08a5e', description: 'The lighter patches, hex.' },
    pebble: { type: 'string', default: '#c9a276', description: "A pebble's lit top, hex." },
    shade: { type: 'string', default: '#6e4a2e', description: "A pebble's shaded bottom, hex." },
    patches: {
      type: 'number',
      default: 0.25,
      minimum: 0,
      maximum: 0.5,
      description: 'The share of the ground in each of the dark and the light patches.',
    },
    pebbles: {
      type: 'number',
      default: 0.18,
      minimum: 0,
      maximum: 1,
      description: 'Pebbles per 4 × 4 texel area, on average (at 1, one in each).',
    },
  },
  size: [64, 64],
  tile: () => [16, 16],
  create({ params, seed, width, height }) {
    const [base, dark, light, top, shade] = palette(
      [params.base, params.dark, params.light, params.pebble, params.shade],
      'texture:dirt',
    );
    const size = [width, height] as const;
    // Patches about 16 texels across, with 8-texel detail. Two octaves of value noise gather near 0.5, so a share p
    // of the texels lies beyond 0.5 ± 0.48 (0.5 − p) on each side (measured over three seeds: 0.12 holds a quarter).
    const patch = tileNoise(size, { cells: [width / 16, height / 16], seed, octaves: 2, gain: 0.5, salt: 1 });
    const spread = 0.48 * (0.5 - params.patches);
    const [low, high] = [0.5 - spread, 0.5 + spread];
    // A pebble starts at a texel (its bottom-left) with the chance that gives `pebbles` of 4 × 4 areas one.
    const chance = params.pebbles / (PEBBLE_CELL * PEBBLE_CELL);
    const starts = (ax: number, ay: number) => cellHash(wrapIndex(ax, width), wrapIndex(ay, height), seed, 2) < chance;
    const wide = (ax: number, ay: number) =>
      cellHash(wrapIndex(ax, width), wrapIndex(ay, height), seed, 3) < 0.5 ? 2 : 3;
    return (x, y, texel) => {
      const n = patch(x, y);
      let color = n < low ? dark : n > high ? light : base;
      let relief = 0.6 + n * 0.2;
      let roughness = 0.95;
      // Part of a pebble started up to 2 texels left and 1 below: 2 or 3 texels wide, 2 tall, its top row lit. Any
      // texel may start one, so pebbles fall anywhere, the wrap edge no different from any other line.
      pebble: for (const dy of [1, 0]) {
        for (let dx = 0; dx < 3; dx++) {
          if (!starts(x - dx, y - dy) || dx >= wide(x - dx, y - dy)) continue;
          [color, relief, roughness] = dy === 1 ? [top, 0.85, 0.8] : [shade, 0.78, 0.85];
          break pebble;
        }
      }
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
