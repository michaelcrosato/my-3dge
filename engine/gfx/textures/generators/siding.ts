/**
 * @file The siding generator (`texture:siding`, PLAN.md WP 13.17): painted clapboard, horizontal boards lapped down
 * the wall (v up): a tone per board, its butt along the bottom catching the light, and the shadow the board above
 * throws across its top row. The relief stands each board out at its butt and back toward the wall up its face, so a
 * lit wall shows its laps.
 *
 * Its tones stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at one board up and any width (`tile`: [1, board]); a board's tone is its row's alone; the boards
 * are shifted half a board up, so the wrap edge runs across a board's face, never along a lap.
 *
 * @example
 * SIDING.size; // [64, 64]: sixteen boards up
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { cellHash, palette, pickTone, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The siding generator's spec. */
export const SIDING = textureSpec({
  description: 'Painted clapboard: horizontal boards, each lit along its butt and shadowed under the board above.',
  params: {
    tones: {
      type: 'array',
      items: { type: 'string' },
      default: ['#b4c0c7', '#c6d1d7'],
      description: 'The boards’ tones, hex; each board takes one.',
    },
    butt: { type: 'string', default: '#e2e9ed', description: 'A board’s lit butt, its bottom row, hex.' },
    shadow: { type: 'string', default: '#84909a', description: 'The shadow under the board above, hex.' },
    board: {
      type: 'integer',
      default: 4,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: 'How much of each board shows, up the wall.',
    },
  },
  size: [64, 64],
  tile: ({ board }) => [1, board],
  create({ params, seed, height }) {
    const tones = palette(params.tones, 'texture:siding tones');
    const [butt, shadow] = palette([params.butt, params.shadow], 'texture:siding');
    const { board } = params;
    const rows = height / board;
    const half = Math.floor(board / 2);
    return (_x, y0, texel) => {
      const y = y0 + half;
      const ly = wrapIndex(y, board);
      const row = wrapIndex(Math.floor(y / board), rows);
      let color = pickTone(tones, cellHash(row, 0, seed, 1));
      if (ly === 0) color = butt;
      else if (ly === board - 1) color = shadow;
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = 1 - (0.35 * ly) / (board - 1);
      texel.roughness = 0.75;
    };
  },
});
