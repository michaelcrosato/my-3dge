/**
 * @file Unit tests for the bake's three.js textures (engine/gfx/textures/dataTexture.ts), in Node: each slot is an
 * RGBA byte `DataTexture` with its full mip chain and no GPU mipmap generation, repeating by density on UVs in metres
 * (or the repeat given), sRGB for colour and data for normals and roughness, filtered as the look says; there is an
 * emissive texture only for a texture that glows.
 * @see engine/gfx/textures/dataTexture.ts
 */
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NearestMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { bakeTexture } from './bake';
import { toDataTextures } from './dataTexture';
import { defineTexture } from './texture';

describe('toDataTextures', () => {
  it('makes RGBA byte textures with their mip chains, repeating by density, sRGB for colour only', () => {
    const bake = bakeTexture('texture:staves');
    const maps = toDataTextures(bake);
    expect(maps.emissiveMap).toBeNull();
    for (const [slot, texture] of Object.entries(maps)) {
      if (!texture) continue;
      expect(texture, slot).toMatchObject({
        format: RGBAFormat,
        type: UnsignedByteType,
        generateMipmaps: false,
        wrapS: RepeatWrapping,
        wrapT: RepeatWrapping,
        flipY: false,
      });
      expect(texture.image, slot).toMatchObject({ width: 48, height: 16 });
      expect(
        texture.mipmaps.map((level: { width: number; height: number }) => [level.width, level.height]),
        slot,
      ).toEqual([
        [48, 16],
        [24, 8],
        [12, 4],
        [6, 2],
        [3, 1],
        [1, 1],
      ]);
      expect([texture.repeat.x, texture.repeat.y], slot).toEqual([16 / 48, 16 / 16]);
    }
    expect(maps.map.colorSpace).toBe(SRGBColorSpace);
    expect(maps.normalMap.colorSpace).toBe(NoColorSpace);
    expect(maps.roughnessMap.colorSpace).toBe(NoColorSpace);
    expect(maps.map.image.data).toBe(bake.map);
    const grey = maps.roughnessMap.image.data as Uint8Array;
    expect([grey[0], grey[1], grey[2], grey[3]]).toEqual(
      Array(3)
        .fill(Math.round(bake.roughnessMap[0] * 255))
        .concat(255),
    );
  });

  it('filters as the look says: pixel keeps texels crisp, smooth blends them with anisotropy', () => {
    const bake = bakeTexture('texture:brick');
    expect(toDataTextures(bake).map).toMatchObject({
      magFilter: NearestFilter,
      minFilter: NearestMipmapLinearFilter,
      anisotropy: 1,
    });
    expect(toDataTextures(bake, { look: 'smooth' }).normalMap).toMatchObject({
      magFilter: LinearFilter,
      minFilter: LinearMipmapLinearFilter,
      anisotropy: 4,
    });
  });

  it('takes a repeat per UV unit for geometry whose UVs run 0 to 1', () => {
    const maps = toDataTextures(bakeTexture('texture:brick'), { repeat: [2, 3] });
    expect([maps.map.repeat.x, maps.map.repeat.y, maps.normalMap.repeat.y]).toEqual([2, 3, 3]);
  });

  it('makes an emissive texture, sRGB, for a texture that glows', () => {
    const reg = createRegistry();
    defineTexture(
      'texture:glowing',
      {
        description: 'Glows everywhere.',
        size: [4, 4],
        create: () => (x, y, texel) => {
          texel.color.fill(20);
          texel.emissive.fill(200);
        },
      },
      reg,
    );
    const maps = toDataTextures(bakeTexture('texture:glowing', reg));
    expect(maps.emissiveMap).toMatchObject({ colorSpace: SRGBColorSpace, generateMipmaps: false });
    expect(maps.emissiveMap!.mipmaps).toHaveLength(3);
  });
});
