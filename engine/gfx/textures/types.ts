/**
 * @file What a texture generator is (PLAN.md WP 2.3, §6.7, I-20): a seeded, periodic function that writes four
 * values per texel, its colour (albedo), its height (relief, from which the bake derives the normal map), its
 * roughness and its emissive colour, so one generator gives every map a material needs. `textureSpec` types a
 * generator from its parameter schema, so `create` reads its parameters typed and filled with their defaults.
 *
 * A generator is `create(context) => (x, y, texel) => void`: `create` runs once per bake with the parameters, the
 * seed and the size (precompute palettes and noises there), and the function it returns writes texel (x, y) of the
 * texture. Texel coordinates: x right (u), y up (v), (0, 0) at the bottom left. The bake resets the texel before
 * each call to height 1, roughness 1 and no emission, so a generator writes only what it makes; it always writes the
 * colour.
 *
 * Invariants: the function is pure (engine/gfx/textures/tile.ts has the seeded hashes and noises), and periodic: it
 * gives the same texel at (x + width, y) and (x, y + height) for any integers, so the texture tiles. Colours are
 * sRGB bytes 0–255 (fractions allowed; the bake rounds), height and roughness are 0–1.
 *
 * @example
 * const flat = textureSpec({
 *   description: 'One colour.',
 *   params: { color: { type: 'string', default: '#808080', description: 'The colour.' } },
 *   create: () => (x, y, texel) => void texel.color.fill(128),
 * });
 * flat.description; // 'One colour.'
 * @see engine/gfx/textures/texture.ts
 */
import type { Rgb } from '../../core/color';
import type { EntryOf, Schema } from '../../core/schema';

/** One texel as a generator writes it. */
export interface Texel {
  /** The albedo, as sRGB bytes 0–255. */
  color: Rgb;
  /** The relief, 0 (deepest: mortar, gaps) to 1 (highest); 1 unless written. */
  height: number;
  /** The microfacet roughness, 0 (mirror) to 1 (matte); 1 unless written. */
  roughness: number;
  /** The emitted colour, as sRGB bytes; black unless written. */
  emissive: Rgb;
}

/** What `create` is given: the parameters (defaults filled), the seed, and the size the texture bakes at. */
export interface TextureContext<P = Record<string, unknown>> {
  params: P;
  seed: number;
  width: number;
  height: number;
}

/** Writes texel (x, y). */
export type TexelFn = (x: number, y: number, texel: Texel) => void;

/** How a texture is magnified: `pixel` keeps texels crisp (nearest), `smooth` blends them (linear). */
export type TextureLook = 'pixel' | 'smooth';

/** A generator: its parameters, the size and look it bakes at, and the function that writes its texels. */
export interface TextureSpec<S extends Schema = Schema> {
  /** What it draws, in plain sentences. */
  description: string;
  /** Its parameters, as schema fields (engine/core/schema.ts), each with its default. */
  params?: S;
  /** The size it bakes at by default, [width, height] in texels: one period of the pattern. */
  size?: [number, number];
  /** The smallest size the pattern repeats at, given the parameters; a bake size must be a multiple of it. */
  tile?: (params: EntryOf<S>) => [number, number];
  /** Texels per metre, on geometry whose UVs are in metres (WP 2.4's builders); 16 by default. */
  density?: number;
  /** How it is magnified; `pixel` by default. */
  look?: TextureLook;
  /** The generator: called once per bake, it returns the function that writes each texel. */
  create: (context: TextureContext<EntryOf<S>>) => TexelFn;
}

/** Returns `spec` unchanged, typed: `create` sees the parameters as the schema `params` declares them. */
export function textureSpec<const S extends Schema>(spec: TextureSpec<S>): TextureSpec<S> {
  return spec;
}
