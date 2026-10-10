/**
 * @file How a material is drawn (PLAN.md WP 2.3, §6.7): `compileMaterial` turns a `material` entry
 * (engine/gfx/materials/material.ts) and its baked maps into a three.js material. v1 draws a lit material with
 * `MeshLambertMaterial` (diffuse lighting, shadows, the map, the normal map from its height, emissive and the
 * emissive map) and an unlit one with `MeshBasicMaterial` (color × map, no lights, no normals, no emissive); r182's
 * WebGPU renderer draws both as node materials. Roughness, metalness and the roughness map stay in the data for the
 * styles that shade with them (WP 7.2 compiles the same entries to toon, flat and pbr), so game data never changes
 * when the look improves.
 *
 * Invariants: reads only the entry's fields, never its id (ask the entry); the material's `name` is the entry's id
 * and `userData.material` holds it too, for the inspector and the ID pass; the maps are shared, never copied (dispose
 * them with the library that baked them, engine/gfx/materials/library.ts).
 *
 * @example
 * import { getMaterial } from './material';
 * compileMaterial(getMaterial('material:glow'), null).type; // 'MeshBasicMaterial'
 * drawnAs(getMaterial('material:default')); // 'lambert'
 * @see engine/gfx/materials/compile.test.ts
 */
import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Vector2,
  type Material,
} from 'three/webgpu';
import type { TextureMaps } from '../textures/dataTexture';
import type { MaterialEntry } from './material';

/** The three.js material class a v1 material compiles to. */
export type DrawnAs = 'lambert' | 'basic';

/** How `entry` is drawn in v1: `basic` when unlit, else `lambert`. */
export function drawnAs(entry: MaterialEntry): DrawnAs {
  return entry.unlit ? 'basic' : 'lambert';
}

const SIDES = { front: FrontSide, back: BackSide, double: DoubleSide } as const;

/** The three.js material of `entry`, with `maps` baked from its map (null when it has none). */
export function compileMaterial(entry: MaterialEntry, maps: TextureMaps | null): Material {
  const common = {
    name: entry.id,
    color: new Color(entry.color),
    map: maps?.map ?? null,
    transparent: entry.transparent,
    opacity: entry.opacity,
    alphaTest: entry.alphaTest,
    side: SIDES[entry.side],
    vertexColors: entry.vertexColors,
    fog: entry.fog,
    depthWrite: entry.depthWrite,
  };
  const material =
    drawnAs(entry) === 'basic'
      ? new MeshBasicMaterial(common)
      : new MeshLambertMaterial({
          ...common,
          normalMap: maps && entry.normalScale > 0 ? maps.normalMap : null,
          normalScale: new Vector2(entry.normalScale, entry.normalScale),
          emissive: new Color(entry.emissive),
          emissiveIntensity: entry.emissiveIntensity,
          emissiveMap: maps?.emissiveMap ?? null,
          flatShading: entry.flatShading,
        });
  material.userData.material = entry.id;
  return material;
}
