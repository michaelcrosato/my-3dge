/**
 * @file Unit tests for how a material is drawn (engine/gfx/materials/compile.ts), in Node: a lit material compiles
 * to `MeshLambertMaterial` with its colour, maps, normal scale, emissive and flags; an unlit one to
 * `MeshBasicMaterial` with colour × map and nothing lit; the compiled material carries the entry's id; a normal scale
 * of 0 drops the normal map.
 * @see engine/gfx/materials/compile.ts
 */
import { DoubleSide, FrontSide, type MeshBasicMaterial, type MeshLambertMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { bakeTexture } from '../textures/bake';
import { toDataTextures } from '../textures/dataTexture';
import { compileMaterial, drawnAs } from './compile';
import { defineMaterial } from './material';

describe('compileMaterial', () => {
  const maps = toDataTextures(bakeTexture('texture:stone'));

  it('draws a lit material with MeshLambertMaterial: colour, maps, normal scale, emissive and flags', () => {
    const entry = defineMaterial(
      'material:lit',
      {
        color: '#ff8000',
        map: 'texture:stone',
        normalScale: 0.5,
        emissive: '#200000',
        emissiveIntensity: 2,
        side: 'double',
        flatShading: true,
        transparent: true,
        opacity: 0.5,
        fog: false,
      },
      createRegistry(),
    );
    expect(drawnAs(entry)).toBe('lambert');
    const material = compileMaterial(entry, maps) as MeshLambertMaterial;
    expect(material.type).toBe('MeshLambertMaterial');
    expect(material).toMatchObject({
      name: 'material:lit',
      map: maps.map,
      normalMap: maps.normalMap,
      emissiveMap: null,
      emissiveIntensity: 2,
      side: DoubleSide,
      flatShading: true,
      transparent: true,
      opacity: 0.5,
      fog: false,
    });
    expect(material.color.getHexString()).toBe('ff8000');
    expect(material.emissive.getHexString()).toBe('200000');
    expect([material.normalScale.x, material.normalScale.y]).toEqual([0.5, 0.5]);
    expect(material.userData.material).toBe('material:lit');
  });

  it('draws an unlit material with MeshBasicMaterial: colour × map, no lights', () => {
    const entry = defineMaterial(
      'material:sign',
      { color: '#ffffff', map: 'texture:stone', unlit: true },
      createRegistry(),
    );
    expect(drawnAs(entry)).toBe('basic');
    const material = compileMaterial(entry, maps) as MeshBasicMaterial;
    expect(material.type).toBe('MeshBasicMaterial');
    expect(material).toMatchObject({ map: maps.map, side: FrontSide });
    expect('normalMap' in material && (material as unknown as MeshLambertMaterial).normalMap).toBeFalsy();
  });

  it('drops the normal map at normalScale 0, and draws without maps when there are none', () => {
    const reg = createRegistry();
    const flat = defineMaterial('material:flat', { map: 'texture:stone', normalScale: 0 }, reg);
    expect((compileMaterial(flat, maps) as MeshLambertMaterial).normalMap).toBeNull();
    const plain = compileMaterial(defineMaterial('material:plain', {}, reg), null) as MeshLambertMaterial;
    expect([plain.map, plain.normalMap, plain.emissiveMap]).toEqual([null, null, null]);
  });
});
