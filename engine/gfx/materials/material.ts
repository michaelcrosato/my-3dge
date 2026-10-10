/**
 * @file The material registry (PLAN.md WP 2.3, §6.6, §6.7, I-49): the registry kind `material`, one entry per
 * material, as data with the parameters agents know from three.js's classic materials: `color`, `map`, `roughness`,
 * `metalness`, `emissive`, `emissiveIntensity`, `normalScale`, `opacity`, `transparent`, `alphaTest`, `side`,
 * `flatShading`, `vertexColors`, `fog`, `depthWrite`, plus `unlit` (glTF's word: drawn without lights). How a
 * material is drawn is the engine's business (engine/gfx/materials/compile.ts): v1 compiles the same data to
 * `MeshLambertMaterial` or `MeshBasicMaterial`, later WPs to better node materials and styles (WP 7.2), without the
 * data changing (doctrine: Common ground outside, Quality under the hood inside).
 *
 * `map` names a texture generator (engine/gfx/textures/texture.ts): an id (`'texture:brick'`) or
 * `{ texture, seed, params, size, look, repeat }`. One generator fills every slot: its colour is the `map`, its
 * height the normal map (scaled by `normalScale`), its roughness the roughness map (used by styles that shade with
 * roughness) and its emissive the emissive map.
 *
 * `defineMaterial(id, spec)` adds one (a game's own materials live with the game); `materialKind(registry)` declares
 * the kind with the engine's built-in materials (engine/gfx/materials/builtins.ts), and `material:default` stands in,
 * with a warning, for a missing id.
 *
 * Invariants: colours are hex strings; a map's texture exists when the material is defined (define textures
 * first), and its parameters, size, look and repeat are checked then, so a bad map fails at `defineMaterial`, never
 * at the first frame. Problems raise `CORE_BAD_SPEC` naming each, as every registry kind does.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * defineMaterial('material:mossyBrick', { color: '#c8d8b0', map: { texture: 'texture:brick', seed: 4 } }, reg);
 * reg.get('material', 'material:mossyBrick').roughness; // 1, the default
 * textureRefOf(reg.get('material', 'material:mossyBrick').map); // { texture: 'texture:brick', seed: 4, … }
 * @see engine/gfx/materials/material.test.ts
 */
import { hex } from '../../core/color';
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import { isPlainObject, type Schema, type SpecOf } from '../../core/schema';
import { textureSampler, type TextureRef } from '../textures/bake';
import { textureKind } from '../textures/texture';
import type { TextureLook } from '../textures/types';
import { BUILT_IN_MATERIALS } from './builtins';

/** The fields of a `material` entry: three.js's classic material parameters, as data. */
export const MATERIAL_FIELDS = {
  description: { type: 'string', default: '', description: 'What it is for, in plain sentences.' },
  color: {
    type: 'string',
    default: '#ffffff',
    description: "The base colour, hex; it multiplies the map (three.js's color).",
  },
  map: {
    type: 'any',
    default: null,
    description:
      "The texture generator that fills the maps: a texture id ('texture:brick'), or { texture, seed, params, size, look, repeat }; null for none. Its height becomes the normal map, its roughness the roughness map, its emissive the emissive map.",
  },
  roughness: {
    type: 'number',
    default: 1,
    minimum: 0,
    maximum: 1,
    description: 'Microfacet roughness, 0 (mirror) to 1 (matte), for the styles that shade with it (pbr, WP 7.2).',
  },
  metalness: {
    type: 'number',
    default: 0,
    minimum: 0,
    maximum: 1,
    description: 'How metallic, 0 to 1, for the styles that shade with it (pbr, WP 7.2).',
  },
  emissive: {
    type: 'string',
    default: '#000000',
    description:
      "The colour it glows with, hex, unaffected by light; it multiplies the map's emissive, as three.js's emissiveMap does (write '#ffffff' to show a glowing texture as baked).",
  },
  emissiveIntensity: { type: 'number', default: 1, minimum: 0, description: 'A multiplier on emissive.' },
  normalScale: {
    type: 'number',
    default: 1,
    minimum: 0,
    maximum: 8,
    description: "How deep the map's relief looks: scales the normal map from its height (0 turns it off).",
  },
  unlit: {
    type: 'boolean',
    default: false,
    description:
      'Drawn without lights (glTF unlit, three.js MeshBasicMaterial): color × map as it is; for glows, skies and markers.',
  },
  transparent: { type: 'boolean', default: false, description: 'Blended with what is behind it, by opacity.' },
  opacity: { type: 'number', default: 1, minimum: 0, maximum: 1, description: 'Its opacity when transparent.' },
  alphaTest: {
    type: 'number',
    default: 0,
    minimum: 0,
    maximum: 1,
    description: 'Texels with alpha below this are not drawn (cut-outs).',
  },
  side: {
    type: 'string',
    enum: ['front', 'back', 'double'],
    default: 'front',
    description: 'Which faces are drawn.',
  },
  flatShading: { type: 'boolean', default: false, description: 'Faceted: one normal per triangle.' },
  vertexColors: { type: 'boolean', default: false, description: "Multiplies by the geometry's color attribute." },
  fog: { type: 'boolean', default: true, description: "Whether the scene's fog applies." },
  depthWrite: {
    type: 'boolean',
    default: true,
    description: 'Whether it writes depth (off for some transparent layers).',
  },
} as const satisfies Schema;

/** A `material` entry. */
export type MaterialEntry = Entry<typeof MATERIAL_FIELDS>;

/** What `defineMaterial` takes: any of the fields, each with its default. */
export type MaterialSpec = SpecOf<typeof MATERIAL_FIELDS>;

/** A material's map, filled: the texture and how it is baked and shown. */
export interface MapRef {
  texture: string;
  seed: number;
  params: Record<string, unknown>;
  /** [width, height] in texels, or null for the generator's size. */
  size: [number, number] | null;
  /** The look, or null for the generator's. */
  look: TextureLook | null;
  /** Repeats per UV unit [u, v], or null for the generator's density on UVs in metres. */
  repeat: [number, number] | null;
}

/** The keys a map object may have. */
const MAP_KEYS = ['texture', 'seed', 'params', 'size', 'look', 'repeat'];

/** A material's `map` filled (null for none). Throws `TypeError` for a value that is not a map; see `mapProblems`. */
export function textureRefOf(map: unknown): MapRef | null {
  if (map === null || map === undefined) return null;
  const given = (typeof map === 'string' ? { texture: map } : map) as Partial<MapRef>;
  if (!isPlainObject(given) || typeof given.texture !== 'string') {
    throw new TypeError("a map is a texture id ('texture:brick') or { texture, seed, params, size, look, repeat }");
  }
  return {
    texture: given.texture,
    seed: given.seed ?? 1,
    params: (given.params as Record<string, unknown>) ?? {},
    size: (given.size as [number, number]) ?? null,
    look: given.look ?? null,
    repeat: (given.repeat as [number, number]) ?? null,
  };
}

/** The bake source of a map (what `bakeTexture` takes). */
export function bakeRefOf(ref: MapRef): TextureRef {
  return { texture: ref.texture, seed: ref.seed, params: ref.params, ...(ref.size ? { size: ref.size } : {}) };
}

/** The problems of a `map` value against `registry`'s textures, one sentence each. */
export function mapProblems(map: unknown, registry: Registry): string[] {
  if (map === null) return [];
  if (isPlainObject(map)) {
    const unknown = Object.keys(map).filter((key) => !MAP_KEYS.includes(key));
    if (unknown.length) return [`map has unknown keys ${unknown.join(', ')} (keys: ${MAP_KEYS.join(', ')})`];
  }
  let ref: MapRef | null;
  try {
    ref = textureRefOf(map);
  } catch (error) {
    return [`map: ${(error as Error).message}`];
  }
  if (!ref) return [];
  const problems: string[] = [];
  const pair = (value: unknown) =>
    Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && v > 0);
  if (!Number.isInteger(ref.seed) || ref.seed < 0)
    problems.push(`map.seed is ${ref.seed}; it must be a whole number ≥ 0`);
  if (ref.look !== null && ref.look !== 'pixel' && ref.look !== 'smooth') {
    problems.push(`map.look is ${JSON.stringify(ref.look)}, not one of 'pixel', 'smooth'`);
  }
  if (ref.repeat !== null && !pair(ref.repeat)) problems.push('map.repeat must be [u, v], two positive numbers');
  if (ref.size !== null && !pair(ref.size)) problems.push('map.size must be [width, height] in texels');
  if (!isPlainObject(ref.params)) problems.push("map.params must be an object of the generator's parameters");
  if (problems.length) return problems;
  if (!registry.kinds().includes('texture') || !registry.has('texture', ref.texture)) {
    const ids = registry.kinds().includes('texture') ? registry.list('texture').map((entry) => entry.id) : [];
    return [`map names texture ${ref.texture}, which is not defined (textures: ${ids.join(', ')}); define it first`];
  }
  try {
    textureSampler(bakeRefOf(ref), registry);
  } catch (error) {
    problems.push(`map: ${(error as Error).message}`);
  }
  return problems;
}

/** The problems of a material beyond its fields: its colours and its map. */
function materialProblems(entry: MaterialEntry, registry: Registry): string[] {
  const problems: string[] = [];
  for (const key of ['color', 'emissive'] as const) {
    try {
      hex(entry[key]);
    } catch {
      problems.push(`${key} is ${JSON.stringify(entry[key])}; write colours as hex strings ('#rrggbb')`);
    }
  }
  return [...problems, ...mapProblems(entry.map, registry)];
}

/** Declares the kind `material` (and `texture`, which maps need) on `registry`, with the built-ins, unless it has it. */
export function materialKind(registry: Registry): void {
  if (registry.kinds().includes('material')) return;
  textureKind(registry);
  registry.defineKind('material', {
    description:
      "Materials as data with three.js's classic parameters (color, map, roughness, emissive, flags); the engine decides how to draw them.",
    fields: MATERIAL_FIELDS,
    fallback: 'material:default',
    defineWith: "defineMaterial('<id>', { color: '#…', map: 'texture:…', … })",
    check: (entry) => materialProblems(entry as MaterialEntry, registry),
  });
  for (const [id, spec] of Object.entries(BUILT_IN_MATERIALS)) registry.def('material', id, spec);
}
materialKind(sharedRegistry);

/**
 * Defines a material on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each
 * problem (a colour that is not hex, a map naming no texture, a parameter the generator lacks…), `CORE_DUPLICATE_ID`
 * when defined twice.
 */
export function defineMaterial(id: string, spec: MaterialSpec, registry: Registry = sharedRegistry): MaterialEntry {
  materialKind(registry);
  return registry.def('material', id, spec as Record<string, unknown>) as MaterialEntry;
}

/** The material `id` of `registry`; a missing id warns once (`CORE_UNKNOWN_ID`) and gives `material:default`. */
export function getMaterial(id: string, registry: Registry = sharedRegistry): MaterialEntry {
  materialKind(registry);
  return registry.get('material', id) as MaterialEntry;
}
