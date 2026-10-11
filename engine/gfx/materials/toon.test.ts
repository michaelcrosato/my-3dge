/**
 * @file Unit tests for toon shading (engine/gfx/materials/toon.ts), in Node: the look's uniforms (defaults, clamped
 * changes, shared by reference), the carried gradient map's texels, the toon material (its own type, Lambert's
 * parameters, the banded lighting model reading the shared uniforms) and the measured baseline. How the bands look,
 * and the comparison that chose them, is tests/e2e/materials-v2.spec.ts.
 * @see engine/gfx/materials/toon.ts
 */
import { Color, MeshToonNodeMaterial, NearestFilter } from 'three/webgpu';
import { float } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import {
  BandedToonLighting,
  bandsOf,
  createToonUniforms,
  gradientToonMaterial,
  MeshBandedToonNodeMaterial,
  TOON_BANDS,
  TOON_LOOK,
  toonGradientMap,
} from './toon';

describe('toon uniforms', () => {
  it('start from the default look, take changes clamped to their ranges, and report them', () => {
    const toon = createToonUniforms();
    expect(toon.values()).toEqual(TOON_LOOK);
    expect(TOON_LOOK).toEqual({ bands: 3, rim: 0.25 });
    toon.set({ bands: 4.4 });
    expect(toon.bands.value).toBe(4);
    toon.set({ bands: 0, rim: 2 });
    expect(toon.values()).toEqual({ bands: 2, rim: 1 });
    toon.set({ bands: 40, rim: -1 });
    expect(toon.values()).toEqual({ bands: 8, rim: 0 });
    expect(createToonUniforms({ rim: 0.5 }).values()).toEqual({ bands: 3, rim: 0.5 });
  });
});

describe('toonGradientMap', () => {
  it('is the carried TOON_BANDS: one grey texel per level, nearest, no mipmaps', () => {
    const map = toonGradientMap();
    expect([map.image.width, map.image.height]).toEqual([3, 1]);
    expect(Array.from(map.image.data as Uint8Array)).toEqual([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
    expect([map.magFilter, map.minFilter, map.generateMipmaps]).toEqual([NearestFilter, NearestFilter, false]);
    expect(TOON_BANDS).toEqual([90, 170, 255]);
    expect(toonGradientMap([0, 255]).image.width).toBe(2);
  });
});

describe('MeshBandedToonNodeMaterial', () => {
  it("has its own type, takes Lambert's parameters, and lights with the bands reading the shared uniforms", () => {
    const toon = createToonUniforms();
    const material = new MeshBandedToonNodeMaterial(
      { color: new Color('#c8a070'), emissive: new Color('#100000') },
      toon,
    );
    expect(material.type).toBe('MeshBandedToonNodeMaterial');
    expect(material.lights).toBe(true);
    expect('#' + material.color.getHexString()).toBe('#c8a070');
    const lighting = material.setupLightingModel();
    expect(lighting).toBeInstanceOf(BandedToonLighting);
    expect(lighting.look).toBe(toon);
    expect(new MeshBandedToonNodeMaterial().toon.values()).toEqual(TOON_LOOK);
  });

  it('cuts a share of light with a node, whatever the bands are', () => {
    expect((bandsOf(float(0.5), float(3)) as { isNode?: boolean }).isNode).toBe(true);
    expect((bandsOf(float(0.5), createToonUniforms().bands) as { isNode?: boolean }).isNode).toBe(true);
  });
});

describe('gradientToonMaterial', () => {
  it("is three.js's toon material with the gradient map: the baseline the bands were measured against", () => {
    const map = toonGradientMap();
    const material = gradientToonMaterial({ color: new Color('#ffffff') }, map);
    expect(material).toBeInstanceOf(MeshToonNodeMaterial);
    expect(material.gradientMap).toBe(map);
  });
});
