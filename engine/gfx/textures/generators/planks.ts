/**
 * @file The plank generator (`texture:planks`, PLAN.md WP 2.3): floor boards running along x, a dark gap along the
 * bottom of each board and at each board's end (the ends staggered per row), each board its own tone, and grain:
 * streaks long along the board and short across it. The relief sinks the gaps and grooves the grain slightly.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3092-3096` (`E.tex.planks`) with the wood palette of
 * `my-3d2dge:src/stress-world/30-crowd.js:292`, rewritten: periodic (each row's ends at a hashed offset, every
 * `length` texels; grain from stretched tiling noise), y up, the rows shifted half a board up and the ends kept off
 * the wrap columns, so the wrap edge never runs along a gap, and height and roughness added.
 *
 * Invariants: tiles at whole boards across and up (`tile`: [length, board]).
 *
 * @example
 * PLANKS.size; // [64, 64]: two boards along a row, eight rows
 * @see engine/gfx/textures/generators.test.ts
 */
import { cellHash, palette, pickTone, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The plank generator's spec. */
export const PLANKS = textureSpec({
  description: 'Wooden floor boards along x: a tone per board, staggered ends, dark gaps and long grain.',
  params: {
    boards: {
      type: 'array',
      items: { type: 'string' },
      default: ['#9d6a3f', '#8f5f37', '#a87547'],
      description: 'The board tones, hex; each board takes one.',
    },
    grain: { type: 'string', default: '#7e5230', description: 'The darker grain streaks, hex.' },
    line: { type: 'string', default: '#4a2e1c', description: 'The gaps between boards, hex.' },
    board: {
      type: 'integer',
      default: 8,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: "A board's width across the grain, its gap included.",
    },
    length: {
      type: 'integer',
      default: 32,
      minimum: 6,
      maximum: 4096,
      unit: 'texels',
      description: "A board's length along the grain, its end gap included.",
    },
    streaks: {
      type: 'number',
      default: 0.3,
      minimum: 0,
      maximum: 1,
      description: 'The share of each board darkened by grain.',
    },
  },
  size: [64, 64],
  tile: (params) => [params.length, params.board],
  create({ params, seed, width, height }) {
    const boards = palette(params.boards, 'texture:planks boards');
    const [grain, line] = palette([params.grain, params.line], 'texture:planks');
    const { board, length } = params;
    const rows = height / board;
    const shift = Math.floor(board / 2);
    // Streaks: a cell every 16 texels along the board, two per board across it.
    const streak = tileNoise([width, height], {
      cells: [Math.max(1, Math.round(width / 16)), 2 * rows],
      seed,
      octaves: 2,
      salt: 1,
    });
    return (x, y, texel) => {
      const yy = y + shift;
      const course = Math.floor(yy / board);
      const row = wrapIndex(course, rows);
      const ly = yy - course * board;
      // Each row's ends sit at a hashed offset from 2 to length − 2, so no end touches the wrap columns.
      const offset = 2 + Math.floor(cellHash(row, 0, seed, 2) * (length - 3));
      const along = wrapIndex(x - offset, width);
      const piece = Math.floor(along / length);
      const lx = along - piece * length;
      let color = pickTone(boards, cellHash(piece, row, seed, 1));
      let relief = 1;
      let roughness = 0.7;
      if (ly === 0 || lx === 0) {
        [color, relief, roughness] = [line, 0, 0.9];
      } else if (streak(x, y) > 1 - params.streaks) {
        [color, relief, roughness] = [grain, 0.92, 0.78];
      }
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
