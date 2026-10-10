/**
 * @file The engine's v1 texture generators (PLAN.md WP 2.3): flagstone, brick courses, dressed stone, planks, barrel
 * staves and checker, by id. Every registry gets them with the kind `texture` (engine/gfx/textures/texture.ts); WP
 * 7.3 adds the rest of the library (runes, moss, metal, plaster, dirt, grass, water).
 *
 * Invariants: ids are `texture:<name>`, one per generator module under engine/gfx/textures/generators/.
 *
 * @example
 * Object.keys(V1_TEXTURES); // ['texture:brick', 'texture:checker', 'texture:flagstone', 'texture:planks', …]
 * @see engine/gfx/textures/generators.test.ts
 */
import { BRICK } from './generators/brick';
import { CHECKER } from './generators/checker';
import { FLAGSTONE } from './generators/flagstone';
import { PLANKS } from './generators/planks';
import { STAVES } from './generators/staves';
import { STONE } from './generators/stone';
import type { TextureSpec } from './types';

/** The v1 generators, by id. */
export const V1_TEXTURES: Readonly<Record<string, TextureSpec>> = {
  'texture:brick': BRICK as unknown as TextureSpec,
  'texture:checker': CHECKER as unknown as TextureSpec,
  'texture:flagstone': FLAGSTONE as unknown as TextureSpec,
  'texture:planks': PLANKS as unknown as TextureSpec,
  'texture:staves': STAVES as unknown as TextureSpec,
  'texture:stone': STONE as unknown as TextureSpec,
};
