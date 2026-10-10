/**
 * @file Unit tests for the CPU bake (engine/gfx/textures/bake.ts): bakes are reproducible in Node, hashed (the
 * golden hash of every v1 generator, the same baked twice and under the sim's fdlibm swap), keyed by what they were
 * baked from; the maps are laid out row 0 at the bottom with bytes clamped; the normal map leans away from a rise,
 * as three.js reads tangent-space normals, and tiles; an emissive map exists only when something glows.
 * @see engine/gfx/textures/bake.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { withSimMath } from '../../core/simMath';
import { bakeTexture, normalsFromHeight, textureSampler } from './bake';
import { defineTexture } from './texture';

/** The golden hash of each v1 generator's default bake (seed 1, its own size). Change only with a written reason. */
const GOLDEN: Record<string, string> = {
  'texture:brick': '3dd75675792ce930',
  'texture:checker': '7ed478bb53c378c2',
  'texture:flagstone': '7672e92b7f2c5e5d',
  'texture:planks': '6fd57cdff53b430f',
  'texture:staves': '637d695f4be4e26c',
  'texture:stone': '05b0ebbfb06feae8',
};

describe('bakeTexture', () => {
  it('bakes every v1 generator to its golden hash, the same twice and under the fdlibm swap', () => {
    for (const [id, hash] of Object.entries(GOLDEN)) {
      expect(bakeTexture(id).hash, id).toBe(hash);
      expect(bakeTexture(id).hash, id).toBe(hash);
      expect(
        withSimMath(() => bakeTexture(id).hash),
        id,
      ).toBe(hash);
    }
  });

  it('fills the source and keys the bake by it: seed, parameters and size change it, spelling does not', () => {
    const bake = bakeTexture('texture:brick');
    expect(bake).toMatchObject({
      texture: 'texture:brick',
      seed: 1,
      width: 64,
      height: 64,
      density: 16,
      look: 'pixel',
    });
    expect(bake.params).toMatchObject({ width: 8, course: 4 });
    expect(bakeTexture({ texture: 'texture:brick', seed: 1, params: { width: 8 } }).key).toBe(bake.key);
    const others = [
      bakeTexture({ texture: 'texture:brick', seed: 2 }),
      bakeTexture({ texture: 'texture:brick', params: { mortar: '#000000' } }),
      bakeTexture({ texture: 'texture:brick', size: [128, 64] }),
    ];
    for (const other of others) {
      expect(other.key).not.toBe(bake.key);
      expect(other.hash).not.toBe(bake.hash);
    }
    expect(others[2].map.length).toBe(128 * 64 * 4);
  });

  it('lays the maps out row 0 at the bottom, colours clamped to bytes, alpha 255', () => {
    const reg = createRegistry();
    defineTexture(
      'texture:ramp',
      {
        description: 'A ramp up the rows, colours past the byte range.',
        size: [4, 4],
        create: () => (x, y, texel) => {
          texel.color[0] = y * 100 - 50;
          texel.color[1] = x;
          texel.color[2] = 254.6;
          texel.height = y / 3;
          texel.roughness = x / 3;
        },
      },
      reg,
    );
    const bake = bakeTexture('texture:ramp', reg);
    const texel = (x: number, y: number) => [...bake.map.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
    expect(texel(0, 0)).toEqual([0, 0, 255, 255]);
    expect(texel(3, 1)).toEqual([50, 3, 255, 255]);
    expect(texel(2, 3)).toEqual([250, 2, 255, 255]);
    expect(bake.heightMap[3 * 4]).toBeCloseTo(1);
    expect(bake.roughnessMap[2]).toBeCloseTo(2 / 3);
    expect(bake.emissiveMap).toBeNull();
  });

  it('makes an emissive map only when a texel glows', () => {
    const reg = createRegistry();
    defineTexture(
      'texture:ember',
      {
        description: 'One glowing texel.',
        size: [4, 4],
        create: () => (x, y, texel) => {
          texel.color.fill(40);
          if (x === 1 && y === 2) texel.emissive.splice(0, 3, 255, 120, 0);
        },
      },
      reg,
    );
    const bake = bakeTexture('texture:ember', reg);
    expect(bake.emissiveMap).not.toBeNull();
    expect([...bake.emissiveMap!.slice((2 * 4 + 1) * 4, (2 * 4 + 1) * 4 + 4)]).toEqual([255, 120, 0, 255]);
    expect([...bake.emissiveMap!.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect(
      textureSampler('texture:ember', reg).sample(0, 0, {
        color: [0, 0, 0],
        height: 0,
        roughness: 0,
        emissive: [9, 9, 9],
      }),
    ).toMatchObject({
      height: 1,
      roughness: 1,
      emissive: [0, 0, 0],
    });
  });

  it('refuses a missing texture, a bad parameter and a size that does not tile', () => {
    expect(() => bakeTexture('texture:brik')).toThrow(expect.objectContaining({ code: 'CORE_NO_ENTRY' }));
    expect(() => bakeTexture({ texture: 'texture:brick', params: { mortar: 3 } })).toThrow(/mortar is a number/);
    expect(() => bakeTexture({ texture: 'texture:brick', size: [60, 64] })).toThrow(
      expect.objectContaining({ code: 'GFX_TEXTURE_SIZE' }),
    );
  });
});

describe('normalsFromHeight', () => {
  /** The decoded normal at (x, y) of a `width` × `height` normal map. */
  const normal = (map: Uint8Array, width: number, x: number, y: number) =>
    [0, 1, 2].map((c) => map[(y * width + x) * 4 + c] / 127.5 - 1);

  it('is flat on flat ground and leans away from a rise, x right and y up', () => {
    const flat = normalsFromHeight(new Float32Array(16).fill(0.5), 4, 4);
    expect(normal(flat, 4, 1, 1).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0, 1]);
    // A step up to the right between columns 3 and 4 of 8: the surface faces left (-x) at the step.
    const step = Float32Array.from({ length: 64 }, (_, i) => (i % 8 >= 4 ? 1 : 0));
    const [nx, ny, nz] = normal(normalsFromHeight(step, 8, 8), 8, 3, 2);
    expect(nx).toBeCloseTo(-Math.SQRT1_2, 1);
    expect(ny).toBeCloseTo(0, 2);
    expect(nz).toBeCloseTo(Math.SQRT1_2, 1);
    // A rise up the rows (y): the surface faces down (-y).
    const rise = Float32Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) >= 4 ? 1 : 0));
    expect(normal(normalsFromHeight(rise, 8, 8), 8, 2, 3)[1]).toBeLessThan(-0.5);
  });

  it('wraps at the edges, so the normal map tiles', () => {
    // The step between the last column and the first is a step like any other.
    const step = Float32Array.from({ length: 64 }, (_, i) => (i % 8 === 0 ? 1 : 0));
    const map = normalsFromHeight(step, 8, 8);
    expect(normal(map, 8, 7, 4)[0]).toBeLessThan(-0.5);
    expect(normal(map, 8, 1, 4)[0]).toBeGreaterThan(0.5);
  });
});
