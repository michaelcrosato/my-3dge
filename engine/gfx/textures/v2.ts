/**
 * @file The engine's v2 texture generators (PLAN.md WP 7.3): runes, moss, metal, plaster, dirt, grass and water, by
 * id. Every registry gets them with the kind `texture` (engine/gfx/textures/texture.ts), after the v1 set
 * (engine/gfx/textures/v1.ts). The level floor bake (engine/gfx/textures/contactShadow.ts) is not here: it is made
 * per level, and a game defines it under its own id.
 *
 * Invariants: ids are `texture:<name>`, one per generator module under engine/gfx/textures/generators/.
 *
 * @example
 * Object.keys(V2_TEXTURES); // ['texture:dirt', 'texture:grass', 'texture:metal', 'texture:moss', …]
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import { DIRT } from './generators/dirt';
import { GRASS } from './generators/grass';
import { METAL } from './generators/metal';
import { MOSS } from './generators/moss';
import { PLASTER } from './generators/plaster';
import { RUNES } from './generators/runes';
import { WATER } from './generators/water';
import type { TextureSpec } from './types';

/** The v2 generators, by id. */
export const V2_TEXTURES: Readonly<Record<string, TextureSpec>> = {
  'texture:dirt': DIRT as unknown as TextureSpec,
  'texture:grass': GRASS as unknown as TextureSpec,
  'texture:metal': METAL as unknown as TextureSpec,
  'texture:moss': MOSS as unknown as TextureSpec,
  'texture:plaster': PLASTER as unknown as TextureSpec,
  'texture:runes': RUNES as unknown as TextureSpec,
  'texture:water': WATER as unknown as TextureSpec,
};
