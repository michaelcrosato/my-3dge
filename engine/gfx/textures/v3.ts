/**
 * @file The engine's v3 texture generators (PLAN.md WP 13.17): the building materials a house, a yard and a street
 * need: asphalt, carpet, concrete, glass, shingles, siding, tiles, wallpaper and wood, by id. Every registry gets them
 * with the kind `texture` (engine/gfx/textures/texture.ts), after the v1 and v2 sets, and their materials, of the same
 * names, with the kind `material` (engine/gfx/materials/builtins.ts). Their default palettes are tuned for the toon
 * bands and the pixel look's 24 shades a channel: each one's tones stand more than a twentieth of the scale apart.
 *
 * Invariants: ids are `texture:<name>`, one per generator module under engine/gfx/textures/generators/.
 *
 * @example
 * Object.keys(V3_TEXTURES); // ['texture:asphalt', 'texture:carpet', 'texture:concrete', 'texture:glass', …]
 * @see engine/gfx/textures/generators/v3.test.ts
 */
import { ASPHALT } from './generators/asphalt';
import { CARPET } from './generators/carpet';
import { CONCRETE } from './generators/concrete';
import { GLASS } from './generators/glass';
import { SHINGLES } from './generators/shingles';
import { SIDING } from './generators/siding';
import { TILES } from './generators/tiles';
import { WALLPAPER } from './generators/wallpaper';
import { WOOD } from './generators/wood';
import type { TextureSpec } from './types';

/** The v3 generators, by id. */
export const V3_TEXTURES: Readonly<Record<string, TextureSpec>> = {
  'texture:asphalt': ASPHALT as unknown as TextureSpec,
  'texture:carpet': CARPET as unknown as TextureSpec,
  'texture:concrete': CONCRETE as unknown as TextureSpec,
  'texture:glass': GLASS as unknown as TextureSpec,
  'texture:shingles': SHINGLES as unknown as TextureSpec,
  'texture:siding': SIDING as unknown as TextureSpec,
  'texture:tiles': TILES as unknown as TextureSpec,
  'texture:wallpaper': WALLPAPER as unknown as TextureSpec,
  'texture:wood': WOOD as unknown as TextureSpec,
};
