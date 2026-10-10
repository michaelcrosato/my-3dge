/**
 * @file The barrel-stave generator (`texture:staves`, PLAN.md WP 2.3): staves running up, each its own tone and a
 * dark gap along its right edge, the odd knot, and iron hoops across them (a lit top row, a shaded one under it),
 * for a barrel's side wrapped round a cylinder (x round, y up). The relief rounds each stave and raises the hoops;
 * the hoops are smoother (less rough) than the wood.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:292-305` (`barrelTex` and the wood palette), rewritten:
 * periodic round the barrel (tones by wrapped stave), y up, the staves shifted half a stave so the wrap edge runs
 * through a stave, and height and roughness added. Its default 48 × 16 texels are the prototype's 38 × 14 rounded to
 * whole staves.
 *
 * Invariants: tiles at whole staves round (`tile`: [stave, 1]); hoop rows past the height are skipped.
 *
 * @example
 * STAVES.size; // [48, 16]: twelve staves round, two hoops
 * @see engine/gfx/textures/generators.test.ts
 */
import { cellHash, palette, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The barrel-stave generator's spec. */
export const STAVES = textureSpec({
  description: "A barrel's side: staves running up, a tone per stave, dark gaps, knots, and iron hoops across.",
  params: {
    staves: {
      type: 'array',
      items: { type: 'string' },
      default: ['#9d6a3f', '#8f5f37', '#a87547'],
      description: 'The stave tones, hex; the staves take them in turn.',
    },
    line: { type: 'string', default: '#4a2e1c', description: 'The gaps between staves, hex.' },
    knot: { type: 'string', default: '#6e4528', description: 'Knots in the wood, hex.' },
    hoop: { type: 'string', default: '#5d5a66', description: "A hoop's lit top row, hex." },
    hoopShade: { type: 'string', default: '#3a3842', description: "The rest of a hoop's rows, hex." },
    stave: {
      type: 'integer',
      default: 4,
      minimum: 2,
      maximum: 256,
      unit: 'texels',
      description: "A stave's width, its gap included.",
    },
    hoops: {
      type: 'array',
      items: { type: 'integer', minimum: 0 },
      default: [2, 12],
      description: 'The bottom row of each hoop, in texels from the bottom.',
    },
    thickness: { type: 'integer', default: 2, minimum: 1, maximum: 64, unit: 'texels', description: "A hoop's rows." },
    knots: {
      type: 'number',
      default: 0.06,
      minimum: 0,
      maximum: 1,
      description: 'The share of wood texels that are knots.',
    },
  },
  size: [48, 16],
  tile: (params) => [params.stave, 1],
  create({ params, seed, width, height }) {
    const staves = palette(params.staves, 'texture:staves staves');
    const [line, knot, hoop, hoopShade] = palette(
      [params.line, params.knot, params.hoop, params.hoopShade],
      'texture:staves',
    );
    const { stave, thickness } = params;
    const shift = Math.floor(stave / 2);
    /** The hoop row index of each row (0 is a hoop's top), or -1. */
    const hoopRow = Array.from({ length: height }, () => -1);
    for (const bottom of params.hoops) {
      for (let i = 0; i < thickness && bottom + i < height; i++) hoopRow[bottom + i] = thickness - 1 - i;
    }
    return (x, y, texel) => {
      const xx = wrapIndex(x + shift, width);
      const index = Math.floor(xx / stave);
      const lx = xx - index * stave;
      const row = hoopRow[wrapIndex(y, height)];
      let color = staves[index % staves.length];
      // A stave is rounded: highest in its middle, falling to its gap.
      let relief = 0.85 - 0.25 * Math.abs((lx + 0.5) / (stave - 1) - 0.5);
      let roughness = 0.8;
      if (row >= 0) {
        [color, relief, roughness] = [row === 0 ? hoop : hoopShade, 1, 0.45];
      } else if (lx === stave - 1) {
        [color, relief, roughness] = [line, 0.2, 0.9];
      } else if (cellHash(index, wrapIndex(y, height), seed, 1) < params.knots) {
        [color, roughness] = [knot, 0.85];
      }
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
