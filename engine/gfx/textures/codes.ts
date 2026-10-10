/**
 * @file The texture codes (PLAN.md WP 2.3): the errors a bake raises for a size its pattern cannot tile at or a
 * palette with no colours, each naming its fix (collected into docs/ERRORS.md by `x docs`). A module of its own so
 * the generators (engine/gfx/textures/generators/) and the bake can raise them without importing each other.
 *
 * Invariants: raised when a bake starts, never while texels are written, so a bad size or palette fails at once.
 *
 * @example
 * TEXTURE_CODES.GFX_TEXTURE_SIZE.template; // 'texture {id} cannot bake at {width} × {height}: {reason}'
 * @see engine/gfx/textures/bake.ts
 */
import { defineCodes } from '../../core/log';

/** The codes of the texture bake, with their fixes. */
export const TEXTURE_CODES = defineCodes('gfx', {
  GFX_TEXTURE_SIZE: {
    template: 'texture {id} cannot bake at {width} × {height}: {reason}',
    fix: 'bake at a whole multiple of its tile, {tile} texels with these parameters (size: [{suggest}] fits), or change the parameters that set the tile',
    doc: 'Raised by `bakeTexture` (engine/gfx/textures/bake.ts) and by `defineTexture` for a default size that is not a whole number of pattern tiles (a running bond needs whole cells across and an even number of courses), or is not 2 to 4096 texels on a side: such a texture would show a seam where it repeats.',
  },
  GFX_EMPTY_PALETTE: {
    template: '{what} lists no colours',
    fix: "give it at least one hex colour ('#6b6f5a')",
  },
});
