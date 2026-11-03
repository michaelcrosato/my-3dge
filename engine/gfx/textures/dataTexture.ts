/**
 * @file A bake as three.js textures (PLAN.md WP 2.3, §6.7): `toDataTextures` turns a CPU bake
 * (engine/gfx/textures/bake.ts) into `DataTexture`s for a material's slots, `map`, `normalMap`, `roughnessMap` and
 * `emissiveMap`, each with its full mip chain computed on the CPU (engine/gfx/textures/mips.ts), repeating, and
 * filtered for the look (`filterTexture`): `pixel` magnifies and minifies with nearest (crisp texels; r182's WebGPU
 * backend takes the mipmap filter from the minification filter, so it also reads the nearest level, not a blend),
 * `smooth` filters linearly on all three, with 4× anisotropy for floors seen at a grazing angle. `filterTexture`
 * also re-filters a texture made here for another look (a look's `textures`, engine/gfx/materials/library.ts
 * `filter`): both looks sample it filtered (`textureSample`, as only nearest on both counts as unfilterable in r182),
 * so the shader stays the same and r182 swaps its sampler and uploads its levels again, building no pipeline.
 *
 * Repeat: the bake's density (texels per metre) on geometry whose UVs are in metres (WP 2.4's builders) makes the
 * texture repeat every size / density metres; `repeat` overrides it, in repeats per UV unit, for geometry whose UVs
 * run 0–1 (three.js's own `BoxGeometry`). Colour maps are sRGB (`SRGBColorSpace`, uploaded as rgba8unorm-srgb, so
 * the GPU filters in linear light); the normal and roughness maps are data (no colour space). The roughness map
 * holds roughness in every colour channel; three.js reads green.
 *
 * Invariants: every texture is RGBA, unsigned bytes, `generateMipmaps` false with its levels in `mipmaps` (three.js
 * r182 uploads each level and builds no mipmap pipeline); the textures share nothing with the bake but its level-0
 * bytes, which they must not change.
 *
 * @example
 * import { bakeTexture } from './bake';
 * const maps = toDataTextures(bakeTexture('texture:brick'));
 * [maps.map.mipmaps.length, maps.map.repeat.x, maps.emissiveMap]; // [7, 0.25, null]
 * @see engine/gfx/textures/dataTexture.test.ts
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NearestMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type ColorSpace,
  type Texture,
} from 'three/webgpu';
import type { TextureBake } from './bake';
import { mipChain, type MipEncoding } from './mips';
import type { TextureLook } from './types';

/** A bake's textures, by the material slot each fills. */
export interface TextureMaps {
  map: DataTexture;
  normalMap: DataTexture;
  roughnessMap: DataTexture;
  /** Null when the texture does not glow. */
  emissiveMap: DataTexture | null;
}

/** How the textures are made: the look (the bake's own by default) and a repeat overriding the density. */
export interface DataTextureOptions {
  look?: TextureLook;
  /** Repeats per UV unit, [u, v]; by default density / size on each axis (UVs in metres). */
  repeat?: readonly [number, number];
}

/** The roughness floats as grey RGBA bytes. */
function roughnessBytes(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  for (let t = 0; t < values.length; t++) {
    const v = values[t];
    const b = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    out.set([b, b, b, 255], t * 4);
  }
  return out;
}

/**
 * Filters `texture` for `look` (see the file comment): its magnification and minification filters and anisotropy.
 * Returns whether any changed, and marks the texture for upload when one did, so the renderer swaps its sampler.
 */
export function filterTexture(texture: Texture, look: TextureLook): boolean {
  const pixel = look === 'pixel';
  const [mag, min, anisotropy] = pixel
    ? [NearestFilter, NearestMipmapLinearFilter, 1]
    : [LinearFilter, LinearMipmapLinearFilter, 4];
  if (texture.magFilter === mag && texture.minFilter === min && texture.anisotropy === anisotropy) return false;
  texture.magFilter = mag;
  texture.minFilter = min;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return true;
}

/** One `DataTexture` of RGBA bytes with its mip chain, repeating, filtered for `look`. */
function dataTexture(
  data: Uint8Array,
  bake: TextureBake,
  encoding: MipEncoding,
  colorSpace: ColorSpace,
  options: Required<DataTextureOptions>,
  name: string,
): DataTexture {
  const { width, height } = bake;
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.mipmaps = mipChain(data, width, height, encoding) as unknown as DataTexture['mipmaps'];
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = colorSpace;
  filterTexture(texture, options.look);
  texture.repeat.set(options.repeat[0], options.repeat[1]);
  texture.name = `${bake.texture}#${bake.key}:${name}`;
  texture.needsUpdate = true;
  return texture;
}

/** The textures of `bake` for a material's slots (see the file comment). */
export function toDataTextures(bake: TextureBake, options: DataTextureOptions = {}): TextureMaps {
  const filled: Required<DataTextureOptions> = {
    look: options.look ?? bake.look,
    repeat: options.repeat ?? [bake.density / bake.width, bake.density / bake.height],
  };
  return {
    map: dataTexture(bake.map, bake, 'srgb', SRGBColorSpace, filled, 'map'),
    normalMap: dataTexture(bake.normalMap, bake, 'normal', NoColorSpace, filled, 'normalMap'),
    roughnessMap: dataTexture(roughnessBytes(bake.roughnessMap), bake, 'linear', NoColorSpace, filled, 'roughnessMap'),
    emissiveMap: bake.emissiveMap
      ? dataTexture(bake.emissiveMap, bake, 'srgb', SRGBColorSpace, filled, 'emissiveMap')
      : null,
  };
}
