/**
 * @file The CPU bake (PLAN.md WP 2.3, §6.7, I-20): runs a texture generator (engine/gfx/textures/texture.ts) over
 * every texel and returns its maps as plain typed arrays, named as three.js's material slots name them: `map` (the
 * colour, sRGB RGBA bytes), `heightMap` and `roughnessMap` (floats 0–1), `emissiveMap` (sRGB RGBA bytes, or null when
 * nothing glows) and `normalMap` (tangent-space RGBA bytes, from the height). No three.js and no GPU: a bake is a
 * pure function of the texture, its parameters, its seed and its size, which Node tests hash (`hash`), and
 * engine/gfx/textures/dataTexture.ts turns into `DataTexture`s with mipmaps.
 *
 * A texture is named by a `TextureRef`: an id (`'texture:brick'`), or `{ texture, seed, params, size }`; the seed is
 * 1, the parameters the generator's defaults and the size its default unless given. `key` names the bake (the
 * canonical hash of what it was baked from), so equal refs share one bake.
 *
 * Normals from height: a Sobel gradient on the tiling height field (it wraps, so the normal map tiles too), a height
 * step of 1 sloping 45°, encoded as three.js reads tangent-space normal maps (x right, y up, z out; OpenGL's
 * convention). Materials scale it with `normalScale`.
 *
 * Invariants: texel (x, y) is row y from the bottom, as a `DataTexture` uploads it (no flip); colours are rounded and
 * clamped to bytes, alpha 255; height and roughness are stored as written (the `tex` QA family checks their range);
 * the same ref gives the same bytes and `hash` in Node and Chromium (int32 hashing, no `Math.random`, no trigonometry).
 *
 * @example
 * const bake = bakeTexture('texture:checker');
 * [bake.width, bake.height, bake.map.length]; // [64, 64, 16384]
 * bake.hash === bakeTexture({ texture: 'texture:checker', seed: 1 }).hash; // true
 * @see engine/gfx/textures/bake.test.ts
 */
import { Fnv64, hashValue, type Canonical } from '../../core/hash';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { assertSize, getTexture, textureParams, type TextureEntry } from './texture';
import type { Texel, TexelFn, TextureLook } from './types';

/** A texture by id, or by id with its seed, parameters and size. */
export type TextureRef =
  | string
  | {
      texture: string;
      /** The seed, a whole number; 1 by default. */
      seed?: number;
      /** Parameters to set; the rest keep the generator's defaults. */
      params?: Record<string, unknown>;
      /** [width, height] in texels, a whole number of the pattern's tiles; the generator's size by default. */
      size?: readonly number[];
    };

/** What a texture was baked from: everything filled. */
export interface BakeSource {
  texture: string;
  seed: number;
  params: Record<string, unknown>;
  width: number;
  height: number;
  /** The generator's density (texels per metre) and look, carried for the `DataTexture`s. */
  density: number;
  look: TextureLook;
}

/** A baked texture: its source, its maps and its hash. */
export interface TextureBake extends BakeSource {
  /** The canonical hash of the source: equal refs give equal keys. */
  key: string;
  /** The colour, RGBA bytes (sRGB, alpha 255), row 0 at the bottom. */
  map: Uint8Array;
  /** The relief, 0–1, one float per texel. */
  heightMap: Float32Array;
  /** The roughness, 0–1, one float per texel. */
  roughnessMap: Float32Array;
  /** The emitted colour, RGBA bytes (sRGB), or null when every texel is black. */
  emissiveMap: Uint8Array | null;
  /** Tangent-space normals from the relief, RGBA bytes (x, y, z mapped to 0–255, alpha 255). */
  normalMap: Uint8Array;
  /** FNV-1a 64 of the source key and every map: equal hashes, equal bakes. */
  hash: string;
}

/** A generator ready to sample: its filled source and the function writing texel (x, y) at any integer point. */
export interface TextureSampler extends BakeSource {
  entry: TextureEntry;
  /** Writes texel (x, y) into `texel`, after resetting it (height 1, roughness 1, no emission). */
  sample(x: number, y: number, texel: Texel): Texel;
}

/** A fresh texel. */
export function newTexel(): Texel {
  return { color: [0, 0, 0], height: 1, roughness: 1, emissive: [0, 0, 0] };
}

/** The filled source of `ref` on `registry`. Throws `CORE_NO_ENTRY`, `CORE_BAD_SPEC` or `GFX_TEXTURE_SIZE`. */
export function textureSampler(ref: TextureRef, registry: Registry = sharedRegistry): TextureSampler {
  const given = typeof ref === 'string' ? { texture: ref } : ref;
  const entry = getTexture(given.texture, registry);
  const params = textureParams(entry, given.params ?? {});
  const size = given.size ?? entry.size;
  assertSize(entry, params, size);
  const seed = given.seed ?? 1;
  if (!Number.isInteger(seed)) throw new RangeError(`the seed of ${entry.id} must be a whole number, got ${seed}`);
  const [width, height] = size;
  const write: TexelFn = entry.create({ params, seed, width, height });
  return {
    entry,
    texture: entry.id,
    seed,
    params,
    width,
    height,
    density: entry.density,
    look: entry.look as TextureLook,
    sample(x, y, texel) {
      texel.height = 1;
      texel.roughness = 1;
      texel.emissive[0] = texel.emissive[1] = texel.emissive[2] = 0;
      write(x, y, texel);
      return texel;
    },
  };
}

/** A byte: rounded and clamped to 0–255. */
const byte = (value: number) => (value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value));

/** The relief's depth: Sobel's gradient of a height step of 1 is 0.5 per texel, so 2 slopes it 45°. */
const RELIEF = 2;

/**
 * Tangent-space normals of a tiling height field (`width` × `height` floats, row 0 at the bottom): Sobel gradients
 * with wrap-around, z out of the surface, scaled by `depth` (a height step of 1 slopes 45° at 2), as RGBA bytes.
 */
export function normalsFromHeight(heights: Float32Array, width: number, height: number, depth = RELIEF): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const at = (x: number, y: number) => heights[((y + height) % height) * width + ((x + width) % width)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const nx = (-dx / 8) * depth;
      const ny = (-dy / 8) * depth;
      const length = Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * width + x) * 4;
      out[i] = byte((nx / length) * 127.5 + 127.5);
      out[i + 1] = byte((ny / length) * 127.5 + 127.5);
      out[i + 2] = byte((1 / length) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** The key of a bake from `source`: the canonical hash of its texture, seed, parameters and size. */
export function bakeKey(source: Pick<BakeSource, 'texture' | 'seed' | 'params' | 'width' | 'height'>): string {
  const { texture, seed, params, width, height } = source;
  return hashValue({ texture, seed, params, size: [width, height] } as Canonical);
}

/** Bakes `ref` on `registry` (the shared one by default). Throws CORE_NO_ENTRY, CORE_BAD_SPEC, GFX_TEXTURE_SIZE. */
export function bakeTexture(ref: TextureRef, registry: Registry = sharedRegistry): TextureBake {
  const sampler = textureSampler(ref, registry);
  const { width, height } = sampler;
  const count = width * height;
  const map = new Uint8Array(count * 4);
  const heightMap = new Float32Array(count);
  const roughnessMap = new Float32Array(count);
  const emissive = new Uint8Array(count * 4);
  let glows = false;
  const texel = newTexel();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sampler.sample(x, y, texel);
      const t = y * width + x;
      const i = t * 4;
      map[i] = byte(texel.color[0]);
      map[i + 1] = byte(texel.color[1]);
      map[i + 2] = byte(texel.color[2]);
      map[i + 3] = 255;
      heightMap[t] = texel.height;
      roughnessMap[t] = texel.roughness;
      emissive[i] = byte(texel.emissive[0]);
      emissive[i + 1] = byte(texel.emissive[1]);
      emissive[i + 2] = byte(texel.emissive[2]);
      emissive[i + 3] = 255;
      glows ||= emissive[i] > 0 || emissive[i + 1] > 0 || emissive[i + 2] > 0;
    }
  }
  const { texture, seed, params, density, look } = sampler;
  const source: BakeSource = { texture, seed, params, width, height, density, look };
  const key = bakeKey(source);
  const emissiveMap = glows ? emissive : null;
  const normalMap = normalsFromHeight(heightMap, width, height);
  const hasher = new Fnv64().string(key).bytes(map).numbers(heightMap).numbers(roughnessMap).bytes(normalMap);
  hasher.byte(emissiveMap ? 1 : 0);
  if (emissiveMap) hasher.bytes(emissiveMap);
  return { ...source, key, map, heightMap, roughnessMap, emissiveMap, normalMap, hash: hasher.hex() };
}
