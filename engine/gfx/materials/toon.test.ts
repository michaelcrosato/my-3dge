/**
 * @file Unit tests for toon shading (engine/gfx/materials/toon.ts), in Node: the look's uniforms (defaults, clamped
 * changes, render-group uniforms shared by reference, the dither's grid), the carried gradient map's texels, the toon
 * material (its own type, Lambert's parameters, the banded lighting model reading the shared uniforms), the ramp's
 * nodes (the dithered bands, the ordered pattern, the shade; the pattern's order checked against the composite's
 * table) and the measured baseline. How the bands look, and the comparison that chose them, is
 * tests/e2e/materials-v2.spec.ts; the ramps in the playground's looks, tests/e2e/playground-looks.spec.ts.
 * @see engine/gfx/materials/toon.ts
 */
import { readFileSync } from 'node:fs';
import { Color, MeshToonNodeMaterial, NearestFilter } from 'three/webgpu';
import { float, renderGroup, vec2, vec3 } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import {
  BandedToonLighting,
  bandsOf,
  bayer4,
  createToonUniforms,
  ditheredBandsOf,
  gridThreshold,
  SHADE_TINT,
  shadeOf,
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
    expect(TOON_LOOK).toEqual({ bands: 3, rim: 0.25, shade: 0, dither: 0 });
    toon.set({ bands: 4.4 });
    expect(toon.bands.value).toBe(4);
    toon.set({ bands: 0, rim: 2, shade: 3, dither: 1.5 });
    expect(toon.values()).toEqual({ bands: 2, rim: 1, shade: 1, dither: 1 });
    toon.set({ bands: 40, rim: -1, shade: -1, dither: -2 });
    expect(toon.values()).toEqual({ bands: 8, rim: 0, shade: 0, dither: 0 });
    expect(createToonUniforms({ rim: 0.5, shade: 0.6 }).values()).toEqual({
      bands: 3,
      rim: 0.5,
      shade: 0.6,
      dither: 0,
    });
  });

  it('are render-group uniforms, so a still mesh draws a change the next frame; the grid starts at cell 0, 1 px', () => {
    const toon = createToonUniforms();
    for (const node of [toon.bands, toon.rim, toon.shade, toon.dither, toon.grid])
      expect(node.groupNode).toBe(renderGroup);
    expect(toon.grid.value.toArray()).toEqual([0, 0, 1]);
  });
});

/** The composite's 4 × 4 table (engine/gfx/post/shaders/common.ts `post_bayer4`), read from its source. */
const TABLE = (() => {
  const source = readFileSync(new URL('../post/shaders/common.ts', import.meta.url), 'utf8');
  return source
    .match(/array<f32, 16>\(([^)]*)\)/)![1]
    .split(',')
    .map(Number);
})();

describe('the ramp', () => {
  it("orders its pattern as the composite's table: Bayer's 2 × 2 order of 2 × 2 orders, any cell wrapped", () => {
    // The formula `bayer4` builds, on numbers: 4 · b2(x mod 2, y mod 2) + b2(⌊x/2⌋ mod 2, ⌊y/2⌋ mod 2).
    const b2 = (x: number, y: number) => (2 * x + 3 * y) % 4;
    const wrap = (a: number, b: number) => a - Math.floor(a / b) * b;
    const rank = (x: number, y: number) => {
      const [mx, my] = [wrap(x, 4), wrap(y, 4)];
      return 4 * b2(mx % 2, my % 2) + b2(Math.floor(mx / 2), Math.floor(my / 2));
    };
    expect(TABLE).toHaveLength(16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(rank(x, y), `(${x}, ${y})`).toBe(TABLE[y * 4 + x]);
    expect([rank(-1, 0), rank(-4, -3), rank(5, 6)]).toEqual([rank(3, 0), rank(0, 1), rank(1, 2)]);
  });

  it('builds its nodes from shares, cells and colours: the dithered bands, the pattern, the threshold, the shade', () => {
    const toon = createToonUniforms();
    const nodes = [
      ditheredBandsOf(float(0.5), toon.bands, float(0.5)),
      bayer4(vec2(-3, 7)),
      gridThreshold(toon.grid),
      shadeOf(vec3(0.6, 0.6, 0.6), toon.shade),
    ];
    for (const node of nodes) expect((node as { isNode?: boolean }).isNode).toBe(true);
    expect(SHADE_TINT[2]).toBe(1); // cooler: blue kept, red and green lowered
    expect(SHADE_TINT[0] > SHADE_TINT[1]).toBe(true); // toward violet, not toward cyan
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
