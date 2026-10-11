/**
 * @file The plaster generator (`texture:plaster`, PLAN.md WP 7.3): a rendered wall, pale plaster mottled in three
 * tones with fine grit and hairline cracks, and patches where it has fallen away to show brick courses beneath, each
 * patch with a shaded rim where the plaster breaks off. The relief sets the bricks back behind the plaster's face and
 * sinks their joints and the cracks, so a lit wall shows where its plaster has gone.
 *
 * New in my-3dge (the prototype's rooms had bare brick and stone); the exposed brick is laid as the brick generator
 * lays it (engine/gfx/textures/generators/brick.ts: running bond, a tone per brick, joints along the bottom and right).
 *
 * Invariants: tiles at the mottling's 16 texels and whole brick courses (`tile`: [16, 16] for bricks that divide it,
 * else a multiple of both); the cracks and patches come from tiling noise, the bricks from a running bond.
 *
 * @example
 * PLASTER.size; // [64, 64]
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import { cellHash, palette, pickTone, runningBond, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The least common multiple of two positive whole numbers. */
const lcm = (a: number, b: number): number => {
  let [x, y] = [a, b];
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
};

/** The plaster generator's spec. */
export const PLASTER = textureSpec({
  description:
    'A plastered wall: mottled pale plaster with grit and hairline cracks, fallen away in patches to brick courses.',
  params: {
    plaster: { type: 'string', default: '#cfc4ad', description: 'The plaster, hex.' },
    shade: { type: 'string', default: '#b8ac94', description: 'The darker mottling and grit, hex.' },
    light: { type: 'string', default: '#ddd3be', description: 'The lighter mottling, hex.' },
    crack: { type: 'string', default: '#8f846f', description: 'The cracks and the shaded rim of each patch, hex.' },
    bricks: {
      type: 'array',
      items: { type: 'string' },
      default: ['#8a4a3a', '#7a4033', '#955443'],
      description: 'The exposed brick tones, hex; each brick takes one.',
    },
    mortar: { type: 'string', default: '#5a4a40', description: "The exposed bricks' joints, hex." },
    brick: {
      type: 'integer',
      default: 8,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: "An exposed brick's length, its joint included.",
    },
    course: {
      type: 'integer',
      default: 4,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: "An exposed course's height, its joint included.",
    },
    fallen: {
      type: 'number',
      default: 0.15,
      minimum: 0,
      maximum: 0.9,
      description: 'The share of the wall whose plaster has fallen away.',
    },
    cracks: {
      type: 'number',
      default: 0.5,
      minimum: 0,
      maximum: 1,
      description: 'How much of the plaster is crossed by hairline cracks, 0 (none) to 1.',
    },
  },
  size: [64, 64],
  tile: (params) => [lcm(16, params.brick), lcm(16, 2 * params.course)],
  create({ params, seed, width, height }) {
    const [plaster, shade, light, crack, mortar] = palette(
      [params.plaster, params.shade, params.light, params.crack, params.mortar],
      'texture:plaster',
    );
    const bricks = palette(params.bricks, 'texture:plaster bricks');
    const size = [width, height] as const;
    const [cells8, cells16] = [[width / 8, height / 8] as const, [width / 16, height / 16] as const];
    const mottle = tileNoise(size, { cells: cells16, seed, octaves: 2, salt: 1 });
    const patch = tileNoise(size, { cells: cells16, seed, octaves: 3, salt: 2 });
    const vein = tileNoise(size, { cells: cells8, seed, octaves: 2, salt: 3 });
    const veined = tileNoise(size, { cells: cells16, seed, salt: 4 });
    // Three octaves gather near 0.5: the share `fallen` lies above 0.5 + 0.44 (0.5 − fallen) (measured).
    const gone = params.fallen > 0 ? 0.5 + 0.44 * (0.5 - params.fallen) : Infinity;
    const cell = [params.brick, params.course] as const;
    const phase = [Math.floor(params.brick / 4), Math.floor(params.course / 2)] as const;
    return (x, y, texel) => {
      const [px, py] = [wrapIndex(x, width), wrapIndex(y, height)];
      const set = (color: readonly number[], relief: number, roughness: number) => {
        texel.color[0] = color[0];
        texel.color[1] = color[1];
        texel.color[2] = color[2];
        texel.height = relief;
        texel.roughness = roughness;
      };
      const p = patch(px, py);
      if (p > gone) {
        const { col, row, lx, ly } = runningBond(px, py, cell, size, phase);
        if (ly === 0 || lx === cell[0] - 1) return set(mortar, 0.15, 0.95);
        return set(pickTone(bricks, cellHash(col, row, seed, 5)), 0.5, 0.85);
      }
      // The rim, where the plaster breaks off: shaded on the patch's lower side, a little proud on its upper side.
      if (p > gone - 0.02) return set(crack, 0.85, 0.95);
      // Hairline cracks: the thin band where a noise crosses its middle, only where a slower noise lets them run.
      const v = vein(px, py);
      if (Math.abs(v - 0.5) < 0.02 && veined(px, py) > 1 - 0.7 * params.cracks) return set(crack, 0.6, 0.95);
      const m = mottle(px, py);
      const grit = cellHash(px, py, seed, 6) < 0.04;
      const color = grit || m < 0.38 ? shade : m > 0.62 ? light : plaster;
      set(color, 0.95 + m * 0.05 - (grit ? 0.05 : 0), 0.9);
    };
  },
});
