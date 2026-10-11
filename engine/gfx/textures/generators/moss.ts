/**
 * @file The moss generator (`texture:moss`, PLAN.md WP 7.3): flagstones (engine/gfx/textures/generators/flagstone.ts,
 * every one of its parameters) overgrown with moss. Moss takes the joints and cracks first, then spreads over the
 * stones in patches as `cover` rises, until at 1 it carpets them; it is speckled in two greens with lighter tips where
 * it grows thickest, fills the joints (the relief rises there) and is fully rough.
 *
 * `mossGrowth(size, seed, tones)` is the growth itself, for any texture: it lays moss over a texel already written
 * (reading its height to find the joints), at a cover that may change from texel to texel. The level floor bake
 * (engine/gfx/textures/contactShadow.ts) uses it to make moss creep in from the foot of the walls.
 *
 * Carried from the hall floor's moss (`my-3d2dge:src/stress-world/10-hall.js:205-219`: two greens, speckled by a
 * hash, by noise, thinning away from the walls), rewritten: periodic (tiling noise and wrapped hashes), y up, joints
 * first, and height and roughness added.
 *
 * Invariants: tiles at the flagstones' tile and the growth noise's 16 texels (`tile`); `cover` 0 leaves the stones
 * bare, 1 covers every texel.
 *
 * @example
 * MOSS.size; // [64, 64]
 * // const grow = mossGrowth([64, 64], 1, palette(['#3f5a44', '#4d6b4b', '#62805a'], 'moss'));
 * // grow(texel, x, y, 0.5); // true when moss now covers texel (x, y)
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import type { Rgb } from '../../../core/color';
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec, type Texel } from '../types';
import { FLAGSTONE } from './flagstone';

/** Below this height a texel is a joint or a crack, where moss takes first. */
const JOINT = 0.35;
/** How much easier moss takes in a joint, in growth-noise units. */
const JOINT_BONUS = 0.2;

/** The least common multiple of two positive whole numbers. */
const lcm = (a: number, b: number): number => {
  let [x, y] = [a, b];
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
};

/**
 * Moss growth over a texture of `size` texels: `grow(texel, x, y, cover)` lays moss over the texel when it grows
 * there at `cover` (0–1, about the share of open stone it covers; joints and cracks take it first), and says whether
 * it did. `tones` are the dark, mid and light greens.
 */
export function mossGrowth(
  size: readonly [number, number],
  seed: number,
  tones: readonly [Rgb, Rgb, Rgb],
): (texel: Texel, x: number, y: number, cover: number) => boolean {
  const [width, height] = size;
  const cells = [Math.max(1, Math.round(width / 16)), Math.max(1, Math.round(height / 16))] as const;
  const patches = tileNoise(size, { cells, seed, octaves: 2, salt: 11 });
  const [dark, mid, light] = tones;
  return (texel, x, y, cover) => {
    if (!(cover > 0)) return false;
    const [px, py] = [wrapIndex(x, width), wrapIndex(y, height)];
    // A share p of two octaves lies above 0.5 + 0.48 (0.5 − p) (see texture:dirt); cover 1 takes everything.
    const above = cover >= 1 ? -Infinity : 0.5 + 0.48 * (0.5 - cover);
    const growth = patches(px, py) + (texel.height < JOINT ? JOINT_BONUS : 0);
    if (growth <= above) return false;
    const speck = cellHash(px, py, seed, 12);
    const color = growth > above + 0.12 && speck < 0.3 ? light : speck < 0.5 ? dark : mid;
    texel.color[0] = color[0];
    texel.color[1] = color[1];
    texel.color[2] = color[2];
    texel.height = Math.min(1, Math.max(texel.height, 0.7) + speck * 0.08);
    texel.roughness = 1;
    return true;
  };
}

/** The moss generator's spec. */
export const MOSS = textureSpec({
  description:
    'Flagstones overgrown with moss: it takes the joints and cracks first, then spreads over the stones as cover rises.',
  params: {
    ...(FLAGSTONE.params as NonNullable<typeof FLAGSTONE.params>),
    dark: { type: 'string', default: '#3f5a44', description: 'The darker moss, hex.' },
    moss: { type: 'string', default: '#4d6b4b', description: 'The moss, hex.' },
    light: { type: 'string', default: '#62805a', description: 'The tips where it grows thickest, hex.' },
    cover: {
      type: 'number',
      default: 0.35,
      minimum: 0,
      maximum: 1,
      description: 'About the share of open stone it covers: 0 none (the joints stay bare too), 1 all.',
    },
  },
  size: [64, 64],
  tile: (params) => [lcm(params.stone, 16), lcm(2 * params.stone, 16)],
  create(context) {
    const { params, seed, width, height } = context;
    const stones = FLAGSTONE.create(context);
    const tones = palette([params.dark, params.moss, params.light], 'texture:moss') as [Rgb, Rgb, Rgb];
    const grow = mossGrowth([width, height], seed, tones);
    return (x, y, texel) => {
      stones(x, y, texel);
      grow(texel, x, y, params.cover);
    };
  },
});
