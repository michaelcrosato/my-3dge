/**
 * @file The generator registry (PLAN.md WP 2.3, §6.6, §6.7, I-20): the registry kind `texture`, one entry per
 * seeded, periodic generator (engine/gfx/textures/types.ts says what a generator is), with its parameters as schema
 * fields, the size it bakes at, the tile its pattern repeats at, its density in texels per metre and its look. A
 * material names a texture by id and may set its parameters and seed (engine/gfx/materials/material.ts); the bake
 * (engine/gfx/textures/bake.ts) reads only these fields, never an id (ask the entry), so a new generator works in
 * every material without editing the bake.
 *
 * `defineTexture(id, spec)` adds one (a game's own generators live with the game, never in the engine).
 * `textureKind(registry)` declares the kind with the engine's v1 generators (engine/gfx/textures/v1.ts) the first
 * time anything here touches a registry; the shared registry gets them on import.
 *
 * Invariants: every parameter is a valid schema field with a description and a default (a material may leave any
 * out); the default size is 2 to 4096 texels on a side and a whole number of tiles for the default parameters
 * (`GFX_TEXTURE_SIZE` otherwise). Problems raise `CORE_BAD_SPEC` naming each, as every registry kind does.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * defineTexture('texture:stripes', {
 *   description: 'Two-texel stripes.',
 *   params: { color: { type: 'string', default: '#c0c0c0', description: 'The light stripes.' } },
 *   size: [8, 8],
 *   tile: () => [4, 1],
 *   create: () => (x, y, texel) => void texel.color.fill(x % 4 < 2 ? 192 : 64),
 * }, reg);
 * reg.list('texture').map((entry) => entry.id).includes('texture:flagstone'); // true: the v1 set comes with the kind
 * @see engine/gfx/textures/texture.test.ts
 */
import { codeError } from '../../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import { checkField, isPlainObject, parse, type Schema } from '../../core/schema';
import './codes';
import type { TextureSpec } from './types';
import { V1_TEXTURES } from './v1';

/** The fields of a `texture` entry. */
export const TEXTURE_FIELDS = {
  description: { type: 'string', required: true, description: 'What it draws, in plain sentences.' },
  params: {
    type: 'object',
    default: {},
    description:
      "Its parameters as schema fields (engine/core/schema.ts: type, default, description, minimum…), each with a default: what a material's map may set.",
  },
  size: {
    type: 'array',
    items: { type: 'integer', minimum: 2, maximum: 4096 },
    default: [64, 64],
    description: 'The size it bakes at, [width, height] in texels: a whole number of tiles.',
  },
  tile: {
    type: 'function',
    default: () => [1, 1],
    description: 'The smallest size its pattern repeats at, given the parameters: (params) => [width, height].',
  },
  density: {
    type: 'number',
    default: 16,
    minimum: 0.001,
    unit: 'texels/m',
    description:
      "Texels per metre on geometry whose UVs are in metres (WP 2.4's builders): the map repeats every size / density metres.",
  },
  look: {
    type: 'string',
    enum: ['pixel', 'smooth'],
    default: 'pixel',
    description: "How it is magnified: 'pixel' keeps texels crisp (nearest), 'smooth' blends them (linear).",
  },
  create: {
    type: 'function',
    required: true,
    description:
      'The generator: ({ params, seed, width, height }) => (x, y, texel) => void, writing texel (x, y): color (sRGB bytes), height, roughness, emissive.',
  },
} as const satisfies Schema;

/** A `texture` entry: one generator. */
export type TextureEntry = Entry<typeof TEXTURE_FIELDS> & {
  readonly params: Schema;
  readonly size: readonly [number, number];
  readonly tile: (params: Record<string, unknown>) => [number, number];
  readonly create: TextureSpec['create'];
};

/** The parameters of `entry` with `given` set: every parameter filled; throws `CORE_BAD_SPEC` naming each problem. */
export function textureParams(entry: TextureEntry, given: unknown = {}): Record<string, unknown> {
  return parse(entry.params, given, `the params of ${entry.id}`) as Record<string, unknown>;
}

/** Why `entry` cannot bake at `size` with `params` (a sentence), or '' when it can. */
export function sizeProblem(entry: TextureEntry, params: Record<string, unknown>, size: readonly number[]): string {
  const [width, height] = size;
  if (size.length !== 2 || ![width, height].every((side) => Number.isInteger(side) && side >= 2 && side <= 4096)) {
    return 'a size is [width, height], whole numbers of texels from 2 to 4096';
  }
  const [tw, th] = entry.tile(params);
  if (width % tw || height % th) return `its pattern repeats every ${tw} × ${th} texels with these parameters`;
  return '';
}

/** Throws `GFX_TEXTURE_SIZE` when `entry` cannot bake at `size` with `params`. */
export function assertSize(entry: TextureEntry, params: Record<string, unknown>, size: readonly number[]): void {
  const reason = sizeProblem(entry, params, size);
  if (!reason) return;
  const [tw, th] = entry.tile(params);
  const fit = (side: number, unit: number) => Math.max(unit, Math.round((side || unit) / unit) * unit);
  throw codeError('GFX_TEXTURE_SIZE', {
    id: entry.id,
    width: size[0],
    height: size[1],
    reason,
    tile: `${tw} × ${th}`,
    suggest: `${fit(size[0], tw)}, ${fit(size[1], th)}`,
  });
}

/** The problems of a texture beyond its fields: its parameter schema, and its size against its tile. */
function textureProblems(entry: TextureEntry): string[] {
  const problems: string[] = [];
  if (!isPlainObject(entry.params)) return ['params must be an object of schema fields'];
  for (const [key, field] of Object.entries(entry.params)) {
    problems.push(...checkField(field, `params.${key}`).map((problem) => problem.message));
    if (isPlainObject(field) && field.default === undefined) {
      problems.push(`params.${key} needs a default: a material may leave any parameter out`);
    }
  }
  if (problems.length) return problems;
  try {
    const reason = sizeProblem(entry, textureParams(entry), entry.size);
    if (reason) problems.push(`size [${entry.size.join(', ')}] does not tile: ${reason}`);
  } catch (error) {
    problems.push((error as Error).message);
  }
  return problems;
}

/** Declares the kind `texture` on `registry`, with the engine's v1 generators, unless it has it. */
export function textureKind(registry: Registry): void {
  if (registry.kinds().includes('texture')) return;
  registry.defineKind('texture', {
    description:
      'Seeded, periodic texture generators: colour, height, roughness and emissive per texel, with their parameters, size, tile, density and look.',
    fields: TEXTURE_FIELDS,
    defineWith:
      "defineTexture('<id>', { description: '…', params: { … }, create: ({ params, seed }) => (x, y, texel) => { … } })",
    check: (entry) => textureProblems(entry as unknown as TextureEntry),
  });
  for (const [id, spec] of Object.entries(V1_TEXTURES)) {
    registry.def('texture', id, spec as unknown as Record<string, unknown>);
  }
}
textureKind(sharedRegistry);

/**
 * Defines a texture generator on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC`
 * naming each problem (a parameter without a description or default, a size that does not tile…),
 * `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineTexture<const S extends Schema>(
  id: string,
  spec: TextureSpec<S>,
  registry: Registry = sharedRegistry,
): TextureEntry {
  textureKind(registry);
  return registry.def('texture', id, spec as unknown as Record<string, unknown>) as unknown as TextureEntry;
}

/** The texture `id` of `registry` (the shared one by default); throws `CORE_NO_ENTRY` naming the closest ids. */
export function getTexture(id: string, registry: Registry = sharedRegistry): TextureEntry {
  textureKind(registry);
  return registry.get('texture', id) as unknown as TextureEntry;
}
