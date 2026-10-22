/**
 * @file The wood generator (`texture:wood`, PLAN.md WP 13.17): plain wood for doors, furniture and trim, its grain
 * running up (v): dark grain lines a few texels apart, wavering as a sawn board's do, over slow bands of its tones, and
 * now and then a knot, a dark core in a ring that bends the grain round it. The relief sinks the grain a little.
 *
 * Its tones stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24 shades a
 * channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning, as every building material's).
 * The planks are a floor's boards; this is one surface.
 *
 * Invariants: tiles at 32 texels (`tile`), a knot's cell; a knot and the grain it bends stay inside their cell, so
 * no cell's edge, the wrap's included, cuts one; the grain lines lie half a spacing off the wrap column, as the
 * planks' joints keep off it (engine/gfx/textures/seams.ts says why); `spacing` divides 16.
 *
 * @example
 * WOOD.size; // [64, 64]: sixteen grain lines across, two knot cells up
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { cellHash, palette, pickTone, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** A knot's cell, in texels: one knot at most in each. */
const CELL = 32;

/** The wood generator's spec. */
export const WOOD = textureSpec({
  description:
    'Plain wood, its grain running up: wavering dark grain lines over slow bands of tone, and a knot now and then.',
  params: {
    tones: {
      type: 'array',
      items: { type: 'string' },
      default: ['#a8743f', '#94652f', '#bb8550'],
      description: "The wood's tones, hex, in slow bands up the grain.",
    },
    grain: { type: 'string', default: '#6f4524', description: "The grain lines and a knot's ring, hex." },
    knot: { type: 'string', default: '#4e2f18', description: "A knot's core, hex." },
    spacing: {
      type: 'integer',
      default: 4,
      enum: [2, 4, 8, 16],
      unit: 'texels',
      description: 'From one grain line to the next, across the grain.',
    },
    knots: {
      type: 'number',
      default: 0.4,
      minimum: 0,
      maximum: 1,
      description: 'The share of 32-texel cells with a knot.',
    },
  },
  size: [64, 64],
  tile: () => [CELL, CELL],
  create({ params, seed, width, height }) {
    const tones = palette(params.tones, 'texture:wood tones');
    const [grain, knot] = palette([params.grain, params.knot], 'texture:wood');
    const size = [width, height] as const;
    const waver = tileNoise(size, { cells: [width / 16, height / 16], seed, octaves: 2, salt: 1 });
    const band = tileNoise(size, { cells: [width / 16, height / 16], seed, salt: 2 });
    const { spacing } = params;
    return (x, y, texel) => {
      const [wx, wy] = [wrapIndex(x, width), wrapIndex(y, height)];
      const [col, row] = [Math.floor(wx / CELL), Math.floor(wy / CELL)];
      // A knot sits at a hashed point 10 to 21 texels across its cell and 12 to 19 up, an ellipse 2 across and 3 up
      // bending the grain within 4 of it (8 texels across, 12 up), so neither it nor its bend reaches the cell's edge:
      // only its own cell's knot touches a texel.
      const has = cellHash(col, row, seed, 3) < params.knots;
      const dx = wx - (col * CELL + 10 + Math.floor(cellHash(col, row, seed, 4) * 12));
      const dy = wy - (row * CELL + 12 + Math.floor(cellHash(col, row, seed, 5) * 8));
      const r = has ? Math.sqrt((dx * dx) / 4 + (dy * dy) / 9) : Infinity;
      let [color, relief, roughness] = [knot, 0.8, 0.7];
      if (r >= 1 && r < 1.7) [color, relief] = [grain, 0.85];
      else if (r >= 1.7) {
        // The grain wavers up to a line's spacing either way, and bends round a knot within 4 of it.
        const bend = r < 4 ? Math.sign(dx) * (4 - r) * 0.75 : 0;
        const u = Math.floor(x + (waver(x, y) - 0.5) * 2 * spacing + bend);
        const line = wrapIndex(u, spacing) === spacing >> 1; // half a spacing off the wrap column: never along it
        const tone = pickTone(tones, Math.min(0.999, Math.max(0, (band(x, y) - 0.3) * 2.5)));
        [color, relief, roughness] = line ? [grain, 0.9, 0.7] : [tone, 1, 0.62];
      }
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
