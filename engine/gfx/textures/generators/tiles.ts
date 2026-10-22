/**
 * @file The tile generator (`texture:tiles`, PLAN.md WP 13.17): glazed square tiles for a kitchen's or a bathroom's
 * floor and walls: a tone per tile, a highlight along each tile's top row where the glaze catches the light, and sunk
 * grout along its bottom and left; with `checker` tones, every other tile is of those, as a kitchen floor's checker.
 * The glaze is smooth, the grout rough.
 *
 * Its tones stand more than a twentieth of the scale apart in value, more than one of the pixel look's 24
 * shades a channel, so the toon bands and the pixel look keep them apart (WP 13.17's tuning).
 *
 * Invariants: tiles at a tile, or two for a checker (`tile`); the layout is shifted half a tile across and up, so the
 * wrap edge runs through tiles, never along a joint (engine/gfx/textures/seams.ts says why).
 *
 * @example
 * TILES.size; // [64, 64]: eight tiles across, eight up
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { cellHash, palette, pickTone, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The tile generator's spec. */
export const TILES = textureSpec({
  description:
    'Glazed square tiles: a tone per tile, a glaze highlight along each top, sunk grout; with checker tones, a checker.',
  params: {
    tones: {
      type: 'array',
      items: { type: 'string' },
      default: ['#e4dcc6', '#cfc6ae'],
      description: 'The tiles’ tones, hex; each tile takes one.',
    },
    checker: {
      type: 'array',
      items: { type: 'string' },
      default: [],
      description: 'The other tiles’ tones, hex, laid as a checker with the first; none: every tile is of the first.',
    },
    glaze: { type: 'string', default: '#f7f3e6', description: 'The highlight along a tile’s top row, hex.' },
    grout: { type: 'string', default: '#958e80', description: 'The grout, hex.' },
    tile: {
      type: 'integer',
      default: 8,
      minimum: 3,
      maximum: 256,
      unit: 'texels',
      description: 'A tile’s side, its grout included.',
    },
  },
  size: [64, 64],
  tile: ({ tile, checker }) => (checker.length ? [2 * tile, 2 * tile] : [tile, tile]),
  create({ params, seed, width, height }) {
    const tones = palette(params.tones, 'texture:tiles tones');
    const others = params.checker.length ? palette(params.checker, 'texture:tiles checker') : tones;
    const [glaze, grout] = palette([params.glaze, params.grout], 'texture:tiles');
    const { tile } = params;
    const [cols, rows, half] = [width / tile, height / tile, Math.floor(tile / 2)];
    return (x0, y0, texel) => {
      const [x, y] = [x0 + half, y0 + half];
      const [lx, ly] = [wrapIndex(x, tile), wrapIndex(y, tile)];
      const [col, row] = [wrapIndex(Math.floor(x / tile), cols), wrapIndex(Math.floor(y / tile), rows)];
      const set = (col + row) % 2 === 1 ? others : tones;
      let [color, relief, roughness] = [pickTone(set, cellHash(col, row, seed, 1)), 1, 0.25];
      if (lx === 0 || ly === 0) [color, relief, roughness] = [grout, 0.3, 0.9];
      else if (ly === tile - 1) [color, roughness] = [glaze, 0.15];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = relief;
      texel.roughness = roughness;
    };
  },
});
