/**
 * @file Unit tests for the material registry (engine/gfx/materials/material.ts): a registry gets the kind with the
 * built-ins (and the texture kind their maps need); a material is three.js's classic parameters as data with their
 * defaults; maps are a texture id or an object, filled by `textureRefOf`; a bad colour, a map naming no texture, a
 * parameter the generator lacks, a size that does not tile and unknown map keys are refused at `defineMaterial`; a
 * missing id warns once and gives `material:default`.
 * @see engine/gfx/materials/material.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { createLog } from '../../core/log';
import { createRegistry } from '../../core/registry';
import { BUILT_IN_MATERIALS } from './builtins';
import { defineMaterial, getMaterial, mapProblems, textureRefOf } from './material';

describe('the material kind', () => {
  it('comes with the built-ins, and the texture kind their maps need', () => {
    const reg = createRegistry();
    getMaterial('material:brick', reg);
    expect(reg.list('material').map((entry) => entry.id)).toEqual(Object.keys(BUILT_IN_MATERIALS).sort());
    expect(reg.kinds()).toEqual(expect.arrayContaining(['material', 'texture']));
    expect(reg.describe().kinds.find((kind) => kind.kind === 'material')).toMatchObject({
      fallback: 'material:default',
    });
  });

  it("holds three.js's classic parameters as data, each with its default", () => {
    const entry = defineMaterial('material:plain', { color: '#336699' }, createRegistry());
    expect(entry).toMatchObject({
      color: '#336699',
      map: null,
      roughness: 1,
      metalness: 0,
      emissive: '#000000',
      emissiveIntensity: 1,
      normalScale: 1,
      unlit: false,
      transparent: false,
      opacity: 1,
      alphaTest: 0,
      side: 'front',
      flatShading: false,
      vertexColors: false,
      fog: true,
      depthWrite: true,
    });
  });

  it('takes a map as a texture id or an object, and fills it', () => {
    expect(textureRefOf('texture:brick')).toEqual({
      texture: 'texture:brick',
      seed: 1,
      params: {},
      size: null,
      look: null,
      repeat: null,
    });
    expect(textureRefOf({ texture: 'texture:planks', seed: 3, look: 'smooth', repeat: [1, 1] })).toMatchObject({
      seed: 3,
      look: 'smooth',
      repeat: [1, 1],
    });
    expect(textureRefOf(null)).toBeNull();
    const reg = createRegistry();
    const entry = defineMaterial('material:wall', { map: { texture: 'texture:brick', params: { width: 16 } } }, reg);
    expect(textureRefOf(entry.map)?.params).toEqual({ width: 16 });
  });

  it('refuses bad colours and maps at definition, naming each problem', () => {
    const reg = createRegistry();
    const refused = (spec: Record<string, unknown>) => {
      try {
        defineMaterial('material:bad', spec, reg);
      } catch (error) {
        return (error as Error).message;
      }
      return 'defined';
    };
    expect(refused({ color: 'red' })).toMatch(/color is "red"; write colours as hex strings/);
    expect(refused({ map: 'texture:brik' })).toMatch(/map names texture texture:brik, which is not defined/);
    expect(refused({ map: { texture: 'texture:brick', params: { widht: 9 } } })).toMatch(
      /unknown key "widht" \(did you mean "width"\?\)/,
    );
    expect(refused({ map: { texture: 'texture:brick', size: [60, 64] } })).toMatch(
      /GFX_TEXTURE_SIZE|cannot bake at 60 × 64/,
    );
    expect(refused({ map: { texture: 'texture:brick', tint: '#fff' } })).toMatch(/map has unknown keys tint/);
    expect(refused({ map: { texture: 'texture:brick', look: 'blurry', seed: -1 } })).toMatch(
      /map\.seed is -1.*map\.look is "blurry"/,
    );
    expect(refused({ map: 42 })).toMatch(/a map is a texture id/);
    expect(refused({ side: 'both' })).toMatch(/side is "both", not one of "front", "back", "double"/);
    expect(mapProblems(null, reg)).toEqual([]);
  });

  it('gives material:default, with one warning, for a missing id', () => {
    const printed: string[] = [];
    const log = createLog({ console: { warn: (line: string) => printed.push(line), error: vi.fn() } });
    const reg = createRegistry({ log });
    expect(getMaterial('material:brikc', reg).id).toBe('material:default');
    expect(getMaterial('material:brikc', reg).id).toBe('material:default');
    expect(printed).toEqual([
      expect.stringMatching(
        /^\[CORE_UNKNOWN_ID\] there is no material "material:brikc" \(did you mean "material:brick"/,
      ),
    ]);
  });
});
